import { readFileSync } from 'node:fs';

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { sessionEnded } from '@/features/auth/authSlice';
import { AppUnderTest, routedPaths } from '@/test/AppUnderTest';
import type { RecordedRequest } from '@/test/fakeAdapter';
import { testRouter } from '@/test/navigation';
import { renderApp, sessionWith } from '@/test/renderApp';

import { signInHref } from './guards';
import { allPaths } from './navigation';
import { HOME_PATH, PUBLIC_PATHS } from './paths';
import { workspaces } from './workspaces';

const routes = <AppUnderTest />;

describe('navigation table', () => {
  it('lists exactly the screens that have a page', () => {
    const listed = allPaths(workspaces).sort();
    // Sign-in and onboarding sit outside the signed-in app, so the sidebar table does not list them.
    expect(routedPaths.filter((path) => !PUBLIC_PATHS.includes(path))).toEqual(listed);
  });

  it('gives every path one entry', () => {
    const listed = allPaths(workspaces);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('redirects the bare address to the default workspace', () => {
    // next.config.ts cannot import from src, so the destination is written there too.
    const config = readFileSync('next.config.ts', 'utf8');
    expect(config).toContain(`{ source: '/', destination: '${HOME_PATH}', permanent: false }`);
  });
});

describe('route guard', () => {
  it('sends a signed-out visitor to sign-in instead of showing a protected page', async () => {
    const { requests } = renderApp(routes, { route: '/moh/users' });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'User management' })).not.toBeInTheDocument();
    // The protected page never mounted, so it never asked the API for anything.
    expect(requests).toHaveLength(0);
    expect(testRouter.location).toBe('/sign-in?from=%2Fmoh%2Fusers');
  });

  it('keeps the sign-in address clean when the visitor was headed for the default page', () => {
    expect(signInHref('/moh')).toBe('/sign-in');
    expect(signInHref('/')).toBe('/sign-in');
    expect(signInHref('/dcfp/orders?page=2')).toBe('/sign-in?from=%2Fdcfp%2Forders%3Fpage%3D2');
  });

  it('does not follow a return address that leaves the app', async () => {
    renderApp(routes, { route: '/sign-in?from=%2F%2Fevil.example', signedIn: true });
    expect(await screen.findByRole('heading', { name: 'MOH dashboard' })).toBeInTheDocument();
    expect(testRouter.location).toBe('/moh');
  });

  it('shows the requested page to a signed-in user', async () => {
    renderApp(routes, { route: '/moh/users', signedIn: true });
    expect(await screen.findByRole('heading', { name: 'User management' })).toBeInTheDocument();
  });

  it('sends a signed-in user away from the sign-in page', async () => {
    renderApp(routes, { route: '/sign-in', signedIn: true });
    expect(await screen.findByRole('heading', { name: 'MOH dashboard' })).toBeInTheDocument();
  });

  it('returns to sign-in the moment the session ends', async () => {
    const { store } = renderApp(routes, { route: '/moh/users', signedIn: true });
    await screen.findByRole('heading', { name: 'User management' });

    store.dispatch(sessionEnded());

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs the user out when the API rejects their token', async () => {
    const { store } = renderApp(routes, {
      route: '/moh/users',
      signedIn: true,
      replies: [{ status: 401, body: { message: 'Unauthenticated.' } }],
    });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(store.getState().auth.session).toBeNull();
  });

  it('shows a not-found page for an unknown address, inside the app', async () => {
    renderApp(routes, { route: '/no/such/page', signedIn: true });
    expect(await screen.findByText('There is no page at this address')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('keeps the workspace of a mistyped address inside it', async () => {
    renderApp(routes, { route: '/dcfp/no-such-page', signedIn: true });
    await screen.findByText('There is no page at this address');
    expect(
      screen.getByRole('button', { name: /Workspace\s*District focal person/ }),
    ).toBeInTheDocument();
  });
});

describe('signing in', () => {
  it.each([
    ['dfcp', '/dcfp'],
    ['jms', '/warehouse'],
    ['nms', '/warehouse'],
    ['admin', '/moh/users'],
  ])('returns %s to an accessible workspace after sign-in', async (role, destination) => {
    renderApp(routes, {
      route: '/sign-in?from=%2Fmoh%2Fusers',
      session: sessionWith(['users:read'], [role]),
    });
    await waitFor(() => {
      expect(testRouter.location).toBe(destination);
    });
  });

  it('keeps a permitted deep link and its query after sign-in', async () => {
    renderApp(routes, {
      route: '/sign-in?from=%2Fdcfp%2Frestock%3Fstatus%3Dheld',
      session: sessionWith(['orders:read'], ['dfcp']),
    });
    await waitFor(() => {
      expect(testRouter.location).toBe('/dcfp/restock?status=held');
    });
  });

  it('signs in and lands on the page the visitor originally asked for', async () => {
    const user = userEvent.setup();
    const { store, requests } = renderApp(routes, {
      route: '/dcfp/stockouts',
      replies: [
        {
          status: 200,
          body: {
            success: true,
            message: 'login successful',
            data: {
              token: 'tok',
              token_type: 'Bearer',
              user: { id: 3, username: 'okello', role: { id: 5, name: 'dfcp', permissions: [] } },
            },
          },
        },
        { status: 200, body: [] },
      ],
    });

    // A phone number is accepted as well as an email address or username.
    await user.type(await screen.findByLabelText('Email, username or phone'), ' 0772 123456 ');
    await user.type(screen.getByLabelText('Password'), 'a-test-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Stockout notifications' }),
    ).toBeInTheDocument();
    expect(store.getState().auth.session?.token).toBe('tok');
    expect(requests[0]).toMatchObject({
      url: '/auth/login',
      authorization: null,
      body: { login: '0772 123456', password: 'a-test-password' },
    });
  });

  it('explains wrong credentials next to the form and stays signed out', async () => {
    const user = userEvent.setup();
    const { store } = renderApp(routes, {
      route: '/sign-in',
      replies: [{ status: 401, body: { success: false, message: 'invalid credentials' } }],
    });

    await user.type(await screen.findByLabelText('Email, username or phone'), 'okello@example.org');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid credentials');
    expect(store.getState().auth.session).toBeNull();
    // What was typed is kept so the user can correct it.
    expect(screen.getByLabelText('Email, username or phone')).toHaveValue('okello@example.org');
  });

  it.each(['vht', 'hotspot manager', 'delivery agent'])(
    'keeps a %s off the web: the session is ended and the mobile app named',
    async (role) => {
      const user = userEvent.setup();
      const { store, requests } = renderApp(routes, {
        route: '/sign-in',
        replies: [
          {
            status: 200,
            body: {
              success: true,
              data: {
                token: 'field-tok',
                refresh_token: 'field-refresh',
                user: { id: 'u-9', username: 'nakato', role: { id: 'r', name: role } },
              },
            },
          },
          { status: 200, body: { success: true, message: 'signed out' } },
        ],
      });

      await user.type(await screen.findByLabelText('Email, username or phone'), 'nakato');
      await user.type(screen.getByLabelText('Password'), 'a-test-password');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(await screen.findByText('Use the CLIMS mobile app')).toBeInTheDocument();
      expect(screen.getByText(/work in the mobile app, not on the web/)).toBeInTheDocument();
      expect(store.getState().auth.session).toBeNull();
      expect(testRouter.location).toBe('/sign-in');
      // The session the API opened is ended at once, with its own token.
      await waitFor(() => {
        expect(requests[1]).toMatchObject({
          method: 'POST',
          url: '/auth/logout',
          authorization: 'Bearer field-tok',
        });
      });
    },
  );

  it('keeps a field account off the web when it comes from the portal', async () => {
    const { store, requests } = renderApp(routes, {
      route: '/sso/complete',
      replies: [
        {
          status: 200,
          body: {
            success: true,
            data: {
              token: 'portal-tok',
              user: { id: 'u-9', username: 'nakato', role: { id: 'r', name: 'vht' } },
            },
          },
        },
        { status: 200, body: { success: true, message: 'signed out' } },
      ],
    });

    expect(await screen.findByText('Use the CLIMS mobile app')).toBeInTheDocument();
    expect(testRouter.location).toBe('/sign-in?sso_error=mobile');
    expect(store.getState().auth.session).toBeNull();
    expect(requests.map((request) => request.url)).toEqual(['/auth/sso/exchange', '/auth/logout']);
    expect(requests[1]?.authorization).toBe('Bearer portal-tok');
  });

  it('does not call the API until both fields are filled in', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(routes, { route: '/sign-in' });

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Enter your email, username or phone number.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });
});

describe('app shell', () => {
  it("shows only the current workspace's sections in the sidebar", async () => {
    renderApp(routes, { route: '/dcfp/hotspot-map', signedIn: true });
    await screen.findByRole('heading', { level: 1, name: 'Hotspot map' });

    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const section of ['Overview', 'Fulfilment', 'Network']) {
      expect(within(nav).getByRole('group', { name: section })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole('link', { name: 'Procurement' })).not.toBeInTheDocument();
    // On a tab other than the first, the item is current without being this page.
    expect(within(nav).getByRole('link', { name: 'Hotspots' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('heads the page with its title and description, and no breadcrumb', async () => {
    renderApp(routes, { route: '/moh/users', signedIn: true });
    await screen.findByRole('heading', { level: 1, name: 'User management' });

    expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument();
    expect(
      screen.getByText('Everyone who can sign in to CLIMS, and the roles they hold.'),
    ).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Users & access pages' });
    expect(within(tabs).getByRole('link', { name: 'Roles & permissions' })).toHaveAttribute(
      'href',
      '/moh/users/roles',
    );
  });

  it('shows no tabs for a section with one page', async () => {
    renderApp(routes, { route: '/moh/audit', signedIn: true });
    await screen.findByRole('heading', { level: 1, name: 'Audit log' });
    expect(screen.queryByRole('navigation', { name: /pages$/ })).not.toBeInTheDocument();
  });

  it("moves between a section's pages with its tabs, each at its own address", async () => {
    const user = userEvent.setup();
    renderApp(routes, { route: '/dcfp/hotspots', signedIn: true });
    await screen.findByRole('heading', { level: 1, name: 'Hotspots' });

    const tabs = screen.getByRole('navigation', { name: 'Hotspots pages' });
    expect(within(tabs).getByRole('link', { name: 'List' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.click(within(tabs).getByRole('link', { name: 'Map' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hotspot map' }),
    ).toBeInTheDocument();
    expect(testRouter.location).toBe('/dcfp/hotspot-map');
    expect(
      within(screen.getByRole('navigation', { name: 'Hotspots pages' })).getByRole('link', {
        name: 'Map',
      }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('switches workspace from the foot of the sidebar', async () => {
    const user = userEvent.setup();
    renderApp(routes, { route: '/moh/users', signedIn: true });
    await screen.findByRole('heading', { name: 'User management' });

    await user.click(screen.getByRole('button', { name: /Workspace\s*Ministry of Health/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Warehouse' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Warehouse dashboard' }),
    ).toBeInTheDocument();
    expect(testRouter.location).toBe('/warehouse');
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
        name: 'District requests',
      }),
    ).toHaveAttribute('href', '/warehouse/requests');
  });

  it('collapses the sidebar from the top bar and remembers it', async () => {
    const user = userEvent.setup();
    const { storage } = renderApp(routes, { route: '/moh/users', signedIn: true });
    await screen.findByRole('heading', { name: 'User management' });

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(storage.getItem('clims.sidebar-open')).toBe('false');
  });

  it('lists the inbox in the bell, counting the unread, and marks them read', async () => {
    const user = userEvent.setup();
    const inbox = [
      {
        id: 'n1',
        type: 'order.stockout_reported',
        title: 'Stockout at Kisenyi Landing',
        body: 'Kisenyi Landing, Kisenyi, Kampala, is out of Engabu Free Female.',
        resource_type: 'hotspot',
        resource_id: 'h1',
        read_at: null,
        created_at: '2026-11-21T09:00:00Z',
      },
      {
        id: 'n2',
        type: 'order.shipment_received',
        title: 'Stock received at Kampala',
        body: '500 boxes arrived.',
        resource_type: 'order',
        resource_id: 'o1',
        read_at: '2026-11-20T09:00:00Z',
        created_at: '2026-11-20T08:00:00Z',
      },
    ];
    const { requests } = renderApp(routes, {
      route: '/moh/users',
      signedIn: true,
      replies: [
        (request) =>
          request.method === 'GET' && request.url.startsWith('/notifications')
            ? { status: 200, body: { success: true, data: inbox } }
            : { status: 200, body: [] },
      ],
    });
    await screen.findByRole('heading', { name: 'User management' });

    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 new' }));

    expect(
      await screen.findByText('Kisenyi Landing, Kisenyi, Kampala, is out of Engabu Free Female.'),
    ).toBeInTheDocument();
    expect(screen.getByText('500 boxes arrived.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({ method: 'POST', url: '/notifications/read-all' }),
      );
    });
  });
});

describe('theme', () => {
  it('starts light, switches to dark on request and remembers the choice', async () => {
    const user = userEvent.setup();
    const { storage } = renderApp(routes, { route: '/moh/procurement', signedIn: true });
    await screen.findByRole('heading', { name: 'Procurement' });
    expect(document.documentElement).not.toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(storage.getItem('clims.theme')).toBe('"dark"');

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });
});

describe('signing out', () => {
  it('starts a different role at its own workspace after an administrator signs out', async () => {
    const user = userEvent.setup();
    const reply = (request: RecordedRequest) => {
      if (request.url === '/auth/login')
        return {
          status: 200,
          body: {
            success: true,
            data: {
              token: 'dcfp-token',
              user: {
                id: '2',
                username: 'district',
                role: { name: 'dfcp', permissions: ['orders:read'] },
              },
            },
          },
        };
      if (request.url === '/auth/me')
        return {
          status: 200,
          body: {
            success: true,
            data: {
              id: '2',
              username: 'district',
              roles: [{ name: 'dfcp', permissions: ['orders:read'] }],
            },
          },
        };
      return { status: 200, body: { success: true, data: [] } };
    };
    renderApp(routes, { route: '/moh/users', signedIn: true, replies: [reply] });
    await screen.findByRole('heading', { name: 'User management' });
    await user.click(screen.getByRole('button', { name: /account menu/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await user.type(await screen.findByLabelText('Email, username or phone'), 'district');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(testRouter.location).toBe('/dcfp');
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'District dashboard' }),
    ).toBeInTheDocument();
  });

  it('ends the session, clears storage and returns to sign-in', async () => {
    const user = userEvent.setup();
    const { store, storage, requests } = renderApp(routes, {
      route: '/moh/users',
      signedIn: true,
    });
    await screen.findByRole('heading', { name: 'User management' });

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    // The page they left is not carried over to whoever signs in next.
    await waitFor(() => {
      expect(testRouter.location).toBe('/sign-in');
    });
    expect(store.getState().auth.session).toBeNull();
    expect(storage.getItem('clims.session')).toBeNull();
    // The server session ends too, using the token from before sign-out.
    expect(requests.find((request) => request.url === '/auth/logout')).toMatchObject({
      method: 'POST',
      authorization: 'Bearer test-token',
    });
  });

  it('remembers a new protected link opened after an explicit sign-out', async () => {
    const user = userEvent.setup();
    renderApp(routes, { route: '/moh/users', signedIn: true });
    await screen.findByRole('heading', { name: 'User management' });
    await user.click(screen.getByRole('button', { name: /account menu/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    act(() => {
      testRouter.push('/dcfp/stockouts');
    });
    await waitFor(() => {
      expect(testRouter.location).toBe('/sign-in?from=%2Fdcfp%2Fstockouts');
    });
  });

  it('still signs out locally when the server cannot be reached', async () => {
    const user = userEvent.setup();
    const { store } = renderApp(routes, {
      route: '/moh/procurement',
      signedIn: true,
      replies: [{ failure: 'network' }],
    });
    await screen.findByRole('heading', { name: 'Procurement' });

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(store.getState().auth.session).toBeNull();
  });
});
