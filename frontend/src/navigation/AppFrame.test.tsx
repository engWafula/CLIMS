import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { sessionStarted, userRefreshed } from '@/features/auth/authSlice';
import { AppUnderTest } from '@/test/AppUnderTest';
import type { RecordedRequest } from '@/test/fakeAdapter';
import { testRouter } from '@/test/navigation';
import { renderApp, sessionWith } from '@/test/renderApp';

/*
 * The shell decides what each role sees: its own workspaces, other workspaces
 * read-only for MOH, a pointer to the mobile app for field roles, and an
 * explanation in place of a page the person cannot open.
 */

/** `/auth/me` answers with the session's own roles; everything else with an empty list. */
function api(roleNames: string[], permissions: string[]) {
  return (request: RecordedRequest) => {
    if (request.url === '/auth/me') {
      return {
        status: 200,
        body: {
          success: true,
          data: {
            id: '1',
            username: 'snakato',
            roles: roleNames.map((name) => ({ id: name, name, permissions })),
          },
        },
      };
    }
    return { status: 200, body: { success: true, data: [] } };
  };
}

function renderAs(route: string, roleNames: string[], permissions: string[] = []) {
  return renderApp(<AppUnderTest />, {
    route,
    session: sessionWith(permissions, roleNames),
    replies: [api(roleNames, permissions)],
  });
}

describe('role-based access in the shell', () => {
  it('moves to the new account’s home when another tab changes the signed-in user', async () => {
    const { store } = renderAs('/moh/users', ['admin'], ['users:read']);
    await screen.findByRole('heading', { name: 'User management' });
    const next = sessionWith(['orders:read'], ['jms']);
    act(() => {
      store.dispatch(
        sessionStarted({
          ...next,
          token: 'another-token',
          user: { ...next.user, id: 'other-user' },
        }),
      );
    });
    await waitFor(() => {
      expect(testRouter.location).toBe('/warehouse');
    });
  });

  it('moves home when a role change removes the current workspace', async () => {
    const { store, requests } = renderAs('/moh/users', ['admin'], ['users:read']);
    await screen.findByRole('heading', { name: 'User management' });
    await waitFor(() => {
      expect(requests.some((request) => request.url === '/auth/me')).toBe(true);
    });
    const user = store.getState().auth.session?.user;
    if (!user) throw new Error('Expected a signed-in user');
    act(() => {
      store.dispatch(userRefreshed({ ...user, roleNames: ['jms'], permissions: ['orders:read'] }));
    });
    await waitFor(() => {
      expect(testRouter.location).toBe('/warehouse');
    });
  });

  it('starts a JMS user in the warehouse workspace instead of MOH', async () => {
    renderAs('/moh', ['jms'], ['orders:read']);

    await waitFor(() => {
      expect(testRouter.location).toBe('/warehouse');
    });
  });

  it('explains, rather than shows, a page from another role’s workspace', async () => {
    renderAs('/dcfp/stockouts', ['jms'], ['orders:read']);

    expect(
      await screen.findByText('This page is in the District focal person workspace'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Not part of your work' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to Warehouse/ })).toHaveAttribute(
      'href',
      '/warehouse',
    );
  });

  it('offers only the workspaces a role opens in the switcher', async () => {
    renderAs('/warehouse', ['jms'], ['orders:read']);

    const sidebar = await screen.findByRole('button', { name: /^Workspace\s*Warehouse/ });
    expect(sidebar).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users & access' })).not.toBeInTheDocument();
  });

  it('keeps a JMS user on the JMS store, with no switch to NMS', async () => {
    renderAs('/warehouse?store=NMS', ['jms'], ['orders:read']);

    expect(await screen.findByText('JMS · Kampala')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Switch warehouse' })).not.toBeInTheDocument();
  });

  it('lets MOH look at the DCFP workspace read-only, with its actions left out', async () => {
    renderAs('/dcfp/restock', ['moh'], ['orders:read']);

    expect(
      await screen.findByText('You are viewing the District focal person workspace read-only'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New request/ })).not.toBeInTheDocument();
  });

  // A session kept from before (or a role changed since sign-in) opens no page either.
  it.each([
    ['hotspot manager', 'Hotspot manager', '/moh'],
    ['vht', 'VHT', '/vht'],
    ['delivery agent', 'Delivery agent', '/dcfp'],
  ])('points a %s to the mobile app', async (role, label, route) => {
    renderAs(route, [role]);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Use the CLIMS mobile app' }),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Your role \\(${label}\\)`))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('tells a registered user with no web role what to ask for', async () => {
    renderAs('/moh', ['registered user']);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Your account has no web workspace yet',
      }),
    ).toBeInTheDocument();
  });

  it('hides a page whose permission the role lacks, and explains it when opened directly', async () => {
    renderAs('/moh/users', ['moh'], ['roles:read']);

    expect(await screen.findByText('You cannot open User management')).toBeInTheDocument();
    expect(screen.getByText(/List users and view user accounts/)).toBeInTheDocument();
    // The sidebar entry now leads to the one page of the section the role may open.
    expect(screen.getByRole('link', { name: 'Users & access' })).toHaveAttribute(
      'href',
      '/moh/users/roles',
    );
  });

  it('does not render a detail when its parent list requires a missing permission', async () => {
    const { requests } = renderAs('/dcfp/hotspots/secret', ['dfcp'], ['orders:read']);
    expect(await screen.findByText('You cannot open Hotspots')).toBeInTheDocument();
    expect(requests.some((request) => request.url === '/hotspots/secret')).toBe(false);
  });

  it('warns a role that holds no permissions at all', async () => {
    renderAs('/dcfp', ['dfcp'], []);

    expect(await screen.findByText('Your role has no permissions yet')).toBeInTheDocument();
  });
});
