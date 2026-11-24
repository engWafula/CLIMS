import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { RecordedRequest } from '@/test/fakeAdapter';
import { testRouter } from '@/test/navigation';
import { renderApp, sessionWith } from '@/test/renderApp';

import UsersPage from './UsersPage';

const ADMIN = { id: 'role-admin', name: 'admin', permissions: ['users:read'] };
const DCFP = { id: 'role-dcfp', name: 'dfcp', permissions: [] };
const VHT = { id: 'role-vht', name: 'vht', permissions: [] };
const MANAGER = { id: 'role-manager', name: 'hotspot manager', permissions: [] };
const roles = [ADMIN, DCFP, VHT, MANAGER];

const users = [
  // id 1 is the signed-in test user.
  {
    id: '1',
    username: 'snakato',
    firstname: 'Sarah',
    lastname: 'Nakato',
    email: 'sarah@example.org',
    status: 'active',
    role: ADMIN,
    roles: [ADMIN],
  },
  {
    id: 'u-7',
    username: 'okello',
    firstname: 'James',
    lastname: 'Okello',
    email: 'james@example.org',
    phone_number: '+256772000007',
    status: 'disabled',
    role: DCFP,
    roles: [DCFP, VHT],
  },
  {
    id: 'u-8',
    username: 'atim',
    firstname: 'Grace',
    lastname: 'Atim',
    email: 'grace@example.org',
    status: 'active',
    role: VHT,
    roles: [VHT],
  },
];

type Reply = { status: number; body?: unknown } | { failure: 'network' };

/**
 * Answers the page's two reads (users, roles) from the fixtures and hands
 * every write to `write`, so the order the queries fire in does not matter.
 */
/** The places the location step offers, in the Go API's lookup shapes. */
const REGION = { id: 'region-sc', name: 'South Central' };
const DISTRICT = { id: 'district-wakiso', name: 'Wakiso' };
const SUBCOUNTY = { id: 'subcounty-katabi', name: 'Katabi Town Council' };
const HOTSPOTS_IN_WAKISO = [
  {
    id: 'hotspot-landing',
    name: 'Kasenyi Landing Site',
    village: 'Kasenyi',
    subcounty: SUBCOUNTY,
    review_status: 'active',
  },
  { id: 'hotspot-bar', name: 'Kasenyi Bar', village: 'kasenyi', subcounty: SUBCOUNTY },
  {
    id: 'hotspot-market',
    name: 'Nansana Market',
    village: 'Nansana',
    subcounty: { id: 'subcounty-nansana', name: 'Nansana' },
    review_status: 'rejected',
  },
  // Most converted hotspots have no subcounty; a manager must still find them.
  { id: 'hotspot-legacy', name: 'Gayaza Road Lodge', village: 'Kiwenda', subcounty: null },
];

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });

function geography(request: RecordedRequest): Reply | null {
  if (request.method !== 'GET') return null;
  if (request.url === '/locations/regions') return ok([REGION]);
  if (request.url === `/locations/districts?region_id=${REGION.id}`) return ok([DISTRICT]);
  if (request.url === `/locations/subcounties?district_id=${DISTRICT.id}`) return ok([SUBCOUNTY]);
  if (request.url.startsWith(`/hotspots?district_id=${DISTRICT.id}`)) return ok(HOTSPOTS_IN_WAKISO);
  return null;
}

function api(write: (request: RecordedRequest) => Reply = () => ({ status: 200, body: {} })) {
  return (request: RecordedRequest): Reply => {
    const place = geography(request);
    if (place) return place;
    if (request.method === 'GET' && request.url.startsWith('/users')) {
      return { status: 200, body: { success: true, data: { users, limit: 100, offset: 0 } } };
    }
    if (request.method === 'GET' && request.url === '/roles') {
      return { status: 200, body: { success: true, data: roles } };
    }
    return write(request);
  };
}

const writes = (requests: RecordedRequest[]) =>
  requests.filter((request) => request.method !== 'GET');

async function fillNewUser(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('First name'), 'Grace');
  await user.type(within(dialog).getByLabelText('Last name'), 'Akello');
  await user.type(within(dialog).getByLabelText('Username'), 'gakello');
  await user.type(within(dialog).getByLabelText('Email'), 'Grace.Akello@Example.org');
  await user.type(within(dialog).getByLabelText(/Phone number/), '0772 100 201');
  await user.type(within(dialog).getByLabelText('Password'), 'a-test-password');
  await user.click(within(dialog).getByRole('radio', { name: /^VHT/ }));
  // A VHT works in one village, so the form asks where, down to the village.
  await choosePlace(user, dialog, 'Region', REGION.name);
  await choosePlace(user, dialog, 'District', DISTRICT.name);
  await choosePlace(user, dialog, 'Subcounty', SUBCOUNTY.name);
  await user.type(within(dialog).getByLabelText(/^Village/), 'Kasenyi');
  return dialog;
}

async function choosePlace(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  level: string,
  name: string,
) {
  const select = within(dialog).getByRole('combobox', { name: new RegExp(`^${level}`) });
  await waitFor(() => {
    expect(select).toBeEnabled();
  });
  await user.click(select);
  await user.click(await screen.findByRole('option', { name }));
}

describe('UsersPage', () => {
  it('lists users with every role they hold, by name, and their status', async () => {
    renderApp(<UsersPage />, { signedIn: true, replies: [api()] });

    const row = (await screen.findByText('James Okello')).closest('tr');
    if (!row) throw new Error('James Okello has no table row');
    expect(within(row).getByText('District focal person')).toBeInTheDocument();
    expect(within(row).getByText('VHT')).toBeInTheDocument();
    expect(within(row).getByText('Deactivated')).toBeInTheDocument();
  });

  it('filters by status and role from the address, so the view survives a refresh', async () => {
    renderApp(<UsersPage />, {
      route: '/moh/users?status=active&role=role-vht',
      signedIn: true,
      replies: [api()],
    });

    expect(await screen.findByText('Grace Atim')).toBeInTheDocument();
    expect(screen.queryByText('Sarah Nakato')).not.toBeInTheDocument();
    expect(screen.queryByText('James Okello')).not.toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Filter users by status' });
    expect(within(tabs).getByRole('link', { name: /Active/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('puts the status filter in the address when a tab is chosen', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { route: '/moh/users', signedIn: true, replies: [api()] });
    await screen.findByText('James Okello');

    const tabs = screen.getByRole('navigation', { name: 'Filter users by status' });
    await user.click(within(tabs).getByRole('link', { name: /Deactivated/ }));

    expect(testRouter.location).toBe('/moh/users?status=disabled');
    await waitFor(() => {
      expect(screen.queryByText('Grace Atim')).not.toBeInTheDocument();
    });
    expect(screen.getByText('James Okello')).toBeInTheDocument();
  });

  it('creates a user with the role chosen, sending the phone in +256 form', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<UsersPage />, {
      signedIn: true,
      replies: [api(() => ({ status: 201, body: { success: true, data: { user_id: 'new' } } }))],
    });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const dialog = await fillNewUser(user);
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(writes(requests)).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: '/users',
        body: {
          username: 'gakello',
          email: 'grace.akello@example.org',
          password: 'a-test-password',
          firstname: 'Grace',
          lastname: 'Akello',
          phone_number: '+256772100201',
          role_ids: ['role-vht'],
        },
      }),
    ]);
    // The location was checked but not sent: the API does not store it and rejects unknown fields.
    expect(writes(requests)[0]?.body).not.toHaveProperty('village');
  });

  it('lets a new user start with one role only', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { signedIn: true, replies: [api()] });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const dialog = await screen.findByRole('dialog');
    const group = within(dialog).getByRole('radiogroup', { name: 'Role' });
    await user.click(within(group).getByRole('radio', { name: /^VHT/ }));
    await user.click(within(group).getByRole('radio', { name: /^District focal person/ }));

    expect(within(group).getByRole('radio', { name: /^District focal person/ })).toBeChecked();
    expect(within(group).getByRole('radio', { name: /^VHT/ })).not.toBeChecked();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('asks a hotspot manager for their hotspot, found by name or village, and saves it', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<UsersPage />, {
      signedIn: true,
      replies: [api(() => ({ status: 201, body: { success: true, data: { user_id: 'new' } } }))],
    });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('First name'), 'Grace');
    await user.type(within(dialog).getByLabelText('Last name'), 'Akello');
    await user.type(within(dialog).getByLabelText('Username'), 'gakello');
    await user.type(within(dialog).getByLabelText('Email'), 'grace@example.org');
    await user.type(within(dialog).getByLabelText('Password'), 'a-test-password');
    await user.click(within(dialog).getByRole('radio', { name: /^Hotspot manager/ }));
    await choosePlace(user, dialog, 'Region', REGION.name);
    await choosePlace(user, dialog, 'District', DISTRICT.name);
    // The hotspot itself places them, so there is no subcounty or village to fill in.
    expect(within(dialog).queryByRole('combobox', { name: /^Subcounty/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^Village/)).not.toBeInTheDocument();

    // Submitting without one says what is missing and moves there.
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByText('Choose the hotspot they run.')).toBeInTheDocument();
    const picker = within(dialog).getByRole('combobox', { name: /^Hotspot/ });
    expect(picker).toHaveFocus();

    await user.click(picker);
    const search = await screen.findByRole('combobox', { name: 'Search by name or village' });
    // A rejected hotspot is not offered; one with no subcounty on record is.
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Gayaza Road LodgeKiwenda',
      'Kasenyi Barkasenyi, Katabi Town Council',
      'Kasenyi Landing SiteKasenyi, Katabi Town Council',
    ]);
    await user.type(search, 'kasenyi landing');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(picker).toHaveTextContent('Kasenyi Landing Site');

    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(writes(requests)[0]?.body).toMatchObject({
      role_ids: ['role-manager'],
      hot_spot_id: 'hotspot-landing',
    });
  });

  it('checks the form before sending anything', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<UsersPage />, { signedIn: true, replies: [api()] });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Phone number/), '+254 712 345 678');
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByText('Enter a first name.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Enter a Ugandan mobile number, e.g. +256 772 123 456.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a role.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(writes(requests)).toEqual([]);
  });

  it('shows a Go validation failure beside the field it is about and keeps the form open', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, {
      signedIn: true,
      replies: [
        api(() => ({
          status: 422,
          body: {
            success: false,
            message: 'validation failed',
            error: { Username: 'failed on validation rule: min' },
          },
        })),
      ],
    });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const dialog = await fillNewUser(user);
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByText('Use at least 3 characters.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByLabelText('First name')).toHaveValue('Grace');
  });

  it('shows a duplicate email beside the email field', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, {
      signedIn: true,
      replies: [
        api(() => ({ status: 409, body: { success: false, message: 'email already exists' } })),
      ],
    });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const dialog = await fillNewUser(user);
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(
      await within(dialog).findByText('An account with this email address already exists.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reports a failure that belongs to no field inside the dialog, and keeps what was typed', async () => {
    const user = userEvent.setup();
    const { onMutationError } = renderApp(<UsersPage />, {
      signedIn: true,
      replies: [api(() => ({ failure: 'network' }))],
    });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const dialog = await fillNewUser(user);
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Check your connection and try again.',
    );
    expect(within(dialog).getByLabelText('Username')).toHaveValue('gakello');
    // Shown in place, so the global toast must not announce it a second time.
    expect(onMutationError).not.toHaveBeenCalled();
  });

  it('never asks for or shows a password outside the create form', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { signedIn: true, replies: [api()] });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Actions for James Okello' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit roles' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("requires a single choice to replace a user's existing multiple roles", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<UsersPage />, {
      signedIn: true,
      replies: [api(() => ({ status: 200, body: { success: true } }))],
    });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Actions for James Okello' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit roles' }));
    const dialog = await screen.findByRole('dialog');
    const group = within(dialog).getByRole('radiogroup', { name: 'Role' });
    expect(within(group).queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(await within(dialog).findByText('Choose exactly one role.')).toBeInTheDocument();
    expect(writes(requests)).toEqual([]);

    await user.click(within(group).getByRole('radio', { name: /^District focal person/ }));
    await user.click(within(group).getByRole('radio', { name: /^VHT/ }));
    expect(within(group).getByRole('radio', { name: /^District focal person/ })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: /^VHT/ })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(writes(requests)).toEqual([
      expect.objectContaining({
        method: 'PUT',
        url: '/users/u-7/roles',
        body: { role_ids: ['role-vht'] },
      }),
    ]);
  });

  it('does not offer to deactivate the account you are signed in with', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { signedIn: true, replies: [api()] });
    await screen.findByText('Sarah Nakato');

    await user.click(screen.getByRole('button', { name: 'Actions for Sarah Nakato' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit roles' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate user' })).not.toBeInTheDocument();
  });

  it('deactivates only after confirmation', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<UsersPage />, {
      signedIn: true,
      replies: [api(() => ({ status: 200, body: { success: true } }))],
    });
    await screen.findByText('Grace Atim');

    await user.click(screen.getByRole('button', { name: 'Actions for Grace Atim' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate user' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Deactivate Grace Atim?');
    expect(writes(requests)).toEqual([]);

    await user.click(within(confirm).getByRole('button', { name: 'Deactivate user' }));

    await waitFor(() => {
      expect(writes(requests)).toEqual([
        expect.objectContaining({
          method: 'PATCH',
          url: '/users/u-8/status',
          body: { status: 'disabled' },
        }),
      ]);
    });
  });

  it('keeps the confirmation open and explains when the server refuses', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, {
      signedIn: true,
      replies: [
        api(() => ({
          status: 409,
          body: { success: false, message: 'cannot disable or demote the last active admin' },
        })),
      ],
    });
    await screen.findByText('Grace Atim');

    await user.click(screen.getByRole('button', { name: 'Actions for Grace Atim' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate user' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Deactivate user' }));

    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'cannot disable or demote the last active admin',
    );
  });

  it('reactivates a deactivated user straight away', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<UsersPage />, {
      signedIn: true,
      replies: [api(() => ({ status: 200, body: { success: true } }))],
    });
    await screen.findByText('James Okello');

    await user.click(screen.getByRole('button', { name: 'Actions for James Okello' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reactivate user' }));

    await waitFor(() => {
      expect(writes(requests)).toEqual([
        expect.objectContaining({ url: '/users/u-7/status', body: { status: 'active' } }),
      ]);
    });
  });

  it('shows an error with a retry when the users cannot be loaded', async () => {
    renderApp(<UsersPage />, { signedIn: true, replies: [{ status: 500, body: {} }] });
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('UsersPage permissions', () => {
  it('leaves out adding users and editing roles for someone who may only read', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { session: sessionWith(['users:read']), replies: [api()] });

    const row = (await screen.findByText('Grace Atim')).closest('tr');
    if (!row) throw new Error('Grace Atim has no table row');
    expect(screen.queryByRole('button', { name: 'Add user' })).not.toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Actions for Grace Atim' }));
    expect(await screen.findByRole('menuitem', { name: 'Signed-in devices' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit roles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate user' })).not.toBeInTheDocument();
  });

  it('needs both users:create and roles:assign to add a user, as the API does', async () => {
    renderApp(<UsersPage />, {
      session: sessionWith(['users:read', 'users:create']),
      replies: [api()],
    });
    await screen.findByText('Grace Atim');
    expect(screen.queryByRole('button', { name: 'Add user' })).not.toBeInTheDocument();
  });
});

describe("UsersPage: a user's signed-in devices", () => {
  const sessions = [
    {
      id: '00000000-0000-4000-8003-000000000101',
      user_agent: 'okhttp/4.12.0',
      ip_address: '41.210.143.92',
      created_at: '2026-11-18T08:00:00Z',
      last_seen_at: '2026-11-20T09:30:00Z',
      expires_at: '2099-12-18T08:00:00Z',
      revoked_at: null,
      current: false,
    },
    {
      id: '00000000-0000-4000-8003-000000000102',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
      ip_address: null,
      created_at: '2026-11-19T08:00:00Z',
      last_seen_at: '2026-11-19T17:00:00Z',
      expires_at: '2099-12-19T08:00:00Z',
      revoked_at: null,
      current: false,
    },
    {
      id: '00000000-0000-4000-8003-000000000103',
      user_agent: 'curl/8.5.0',
      ip_address: null,
      created_at: '2026-11-17T08:00:00Z',
      last_seen_at: '2026-11-17T09:00:00Z',
      expires_at: '2099-12-17T08:00:00Z',
      revoked_at: '2026-11-17T09:00:00Z',
      current: false,
    },
  ];

  /** The page's reads, plus the sessions of u-8 until they are signed out. */
  function sessionsApi(
    revoke: () => Reply = () => ({ status: 200, body: { success: true, data: { revoked: 2 } } }),
  ) {
    let signedOut = false;
    const page = api();
    return (request: RecordedRequest): Reply => {
      if (request.url === '/users/u-8/sessions') {
        if (request.method === 'GET') {
          return { status: 200, body: { success: true, data: signedOut ? [] : sessions } };
        }
        const reply = revoke();
        if ('status' in reply && reply.status === 200) signedOut = true;
        return reply;
      }
      return page(request);
    };
  }

  async function openDevices(user: ReturnType<typeof userEvent.setup>, name = 'Grace Atim') {
    const row = (await screen.findByText(name)).closest('tr');
    if (!row) throw new Error(`${name} has no table row`);
    await user.click(within(row).getByRole('button', { name: `Actions for ${name}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Signed-in devices' }));
    return screen.findByRole('dialog', { name: 'Signed-in devices' });
  }

  it('lists the devices still signed in, leaving out signed-out ones', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { signedIn: true, replies: [sessionsApi()] });

    const dialog = await openDevices(user);
    expect(within(dialog).getByText('Where Grace Atim is signed in now.')).toBeInTheDocument();
    const list = await within(dialog).findByRole('list', {
      name: 'Devices signed in as Grace Atim',
    });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Android app');
    expect(rows[0]).toHaveTextContent('IP 41.210.143.92');
    expect(rows[1]).toHaveTextContent('Chrome on Windows');
    expect(within(dialog).queryByText('curl')).not.toBeInTheDocument();
  });

  it('signs the user out everywhere after confirmation', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<UsersPage />, { signedIn: true, replies: [sessionsApi()] });

    const dialog = await openDevices(user);
    await within(dialog).findByRole('list', { name: /Devices signed in/ });
    await user.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));

    const confirm = await screen.findByRole('alertdialog', {
      name: 'Sign Grace Atim out everywhere?',
    });
    expect(confirm).toHaveTextContent('This ends their session on 2 devices.');
    expect(writes(requests)).toEqual([]);
    await user.click(within(confirm).getByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => {
      expect(writes(requests)).toMatchObject([{ method: 'DELETE', url: '/users/u-8/sessions' }]);
    });
    expect(await within(dialog).findByText('Not signed in anywhere')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the confirmation open and explains when the server refuses', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, {
      signedIn: true,
      replies: [
        sessionsApi(() => ({ status: 403, body: { success: false, message: 'forbidden' } })),
      ],
    });

    const dialog = await openDevices(user);
    await within(dialog).findByRole('list', { name: /Devices signed in/ });
    await user.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Sign out everywhere' }));

    expect(await within(confirm).findByRole('alert')).toHaveTextContent('forbidden');
  });

  it("returns focus to the row's actions button when closed", async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { signedIn: true, replies: [sessionsApi()] });

    const dialog = await openDevices(user);
    await within(dialog).findByRole('list', { name: /Devices signed in/ });
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Actions for Grace Atim' })).toHaveFocus();
  });

  it('only shows the devices to someone without users:update', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { session: sessionWith(['users:read']), replies: [sessionsApi()] });

    const dialog = await openDevices(user);
    await within(dialog).findByRole('list', { name: /Devices signed in/ });
    expect(
      within(dialog).queryByRole('button', { name: 'Sign out everywhere' }),
    ).not.toBeInTheDocument();
  });

  it('says when the devices cannot be loaded, with a retry', async () => {
    const user = userEvent.setup();
    const page = api();
    renderApp(<UsersPage />, {
      signedIn: true,
      replies: [
        (request) =>
          request.url.endsWith('/sessions') ? { status: 500, body: {} } : page(request),
      ],
    });

    const dialog = await openDevices(user);
    expect(await within(dialog).findByText('Could not load signed-in devices')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('UsersPage insights, bulk actions and profile', () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const [sarah, james, grace] = users;
  const withActivity = [
    { ...sarah, last_login_at: daysAgo(0), login_count: 40, active_sessions: 1 },
    { ...james, last_login_at: daysAgo(120), login_count: 3, active_sessions: 0 },
    { ...grace, last_login_at: null, login_count: 0, active_sessions: 0 },
  ];

  function activityApi(
    write: (request: RecordedRequest) => Reply = () => ({ status: 200, body: {} }),
  ) {
    const base = api(write);
    return (request: RecordedRequest): Reply => {
      if (request.method === 'GET' && request.url.startsWith('/users?')) {
        return ok({ users: withActivity, limit: 100, offset: 0 });
      }
      return base(request);
    };
  }

  it('sums the accounts up, each figure a shortcut to its list', async () => {
    renderApp(<UsersPage />, { signedIn: true, replies: [activityApi()] });

    await screen.findByText('Grace Atim');
    const never = screen.getByRole('link', { name: /Never signed in/ });
    expect(never).toHaveTextContent('1');
    expect(never).toHaveAttribute('href', '/moh/users?activity=never');
    expect(screen.getByRole('link', { name: /Can sign in/ })).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: /Signed in this month/ })).toHaveTextContent('1');
  });

  it('filters by activity from the address, and says when someone last signed in', async () => {
    renderApp(<UsersPage />, {
      route: '/moh/users?activity=dormant',
      signedIn: true,
      replies: [activityApi()],
    });

    const row = (await screen.findByText('James Okello')).closest('tr');
    if (!row) throw new Error('James Okello has no table row');
    expect(within(row).getByText('4 months ago')).toBeInTheDocument();
    expect(screen.queryByText('Grace Atim')).not.toBeInTheDocument();
  });

  it('deactivates the ticked users it applies to, after confirming', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<UsersPage />, {
      signedIn: true,
      replies: [activityApi(() => ({ status: 200, body: { success: true, data: null } }))],
    });

    await screen.findByText('Grace Atim');
    for (const name of ['Sarah Nakato', 'James Okello', 'Grace Atim']) {
      await user.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
    }
    const bar = screen.getByRole('region', { name: 'Selected users' });
    expect(within(bar).getByText('3 users selected')).toBeInTheDocument();

    // Sarah is the signed-in user and James is already deactivated: only Grace is left.
    await user.click(within(bar).getByRole('button', { name: /^Deactivate/ }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Deactivate 1 user?' });
    expect(confirm).toHaveTextContent('2 users of those ticked are left out');
    await user.click(within(confirm).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      expect(writes(requests)).toEqual([
        expect.objectContaining({
          method: 'PATCH',
          url: '/users/u-8/status',
          body: { status: 'disabled' },
        }),
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Selected users' })).not.toBeInTheDocument();
    });
  });

  it('opens a profile that says what the person can open and do', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { signedIn: true, replies: [activityApi()] });

    await user.click(await screen.findByRole('button', { name: 'James Okello' }));
    const profile = await screen.findByRole('dialog', { name: 'James Okello' });
    const opens = within(profile).getByRole('region', { name: 'What they can open' });
    // A district focal person (and VHT) opens the DCFP workspace; the VHT role adds nothing on the web.
    expect(within(opens).getByText('District focal person')).toBeInTheDocument();
    expect(within(opens).queryByText('Village health team')).not.toBeInTheDocument();
    expect(within(profile).getByText('4 months ago')).toBeInTheDocument();

    await user.click(within(profile).getByRole('button', { name: 'Edit roles' }));
    expect(
      await screen.findByRole('dialog', { name: 'Roles for James Okello' }),
    ).toBeInTheDocument();
  });

  it('asks where a new user works only for roles that work in one place', async () => {
    const user = userEvent.setup();
    renderApp(<UsersPage />, { signedIn: true, replies: [activityApi()] });
    await screen.findByText('Grace Atim');

    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add user' });
    await user.click(within(dialog).getByRole('radio', { name: /^Administrator/ }));
    expect(
      within(dialog).queryByRole('group', { name: 'Where they work' }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: /^District focal person/ }));
    const where = within(dialog).getByRole('group', { name: 'Where they work' });
    expect(within(where).getByText(/Not saved with the account yet/)).toBeInTheDocument();
    expect(within(where).getByRole('combobox', { name: /^District/ })).toBeDisabled();
    // For a district focal person only the region and district are required.
    expect(within(where).getAllByText('(optional)')).toHaveLength(2);

    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(where).findByText('Choose a region.')).toBeInTheDocument();
  });
});
