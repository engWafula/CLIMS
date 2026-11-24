import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Session } from '@/features/auth/session';
import { navigationFor, webAccessFor } from '@/navigation/access';
import { workspaces } from '@/navigation/workspaces';
import type { FakeReply, RecordedRequest } from '@/test/fakeAdapter';
import { renderApp, testSession } from '@/test/renderApp';

import FieldUsersPage from './FieldUsersPage';

const STORE = {
  id: 'store-wakiso',
  code: 'wakiso',
  name: 'Wakiso District Store',
  store_type: 'district',
  district_id: 'district-wakiso',
  district_name: 'Wakiso',
};
const SUBCOUNTY = { id: 'subcounty-katabi', name: 'Katabi Town Council' };
const HOTSPOTS = [
  {
    id: 'hotspot-landing',
    name: 'Kasenyi Landing Site',
    village: 'Kasenyi',
    subcounty: SUBCOUNTY,
    review_status: 'active',
  },
  // Only an active hotspot can have a manager.
  { id: 'hotspot-new', name: 'Nansana Bar', village: 'Nansana', review_status: 'submitted' },
];

const FIELD_USERS = [
  {
    id: 'u-1',
    username: 'gatim',
    firstname: 'Grace',
    lastname: 'Atim',
    phone_number: '+256772000001',
    status: 'active',
    roles: [{ id: 'role-vht', name: 'vht', permissions: [] }],
    hot_spot: null,
    subcounty: {
      id: SUBCOUNTY.id,
      name: SUBCOUNTY.name,
      district_id: STORE.district_id,
      district_name: 'Wakiso',
    },
    store: null,
  },
  {
    id: 'u-2',
    username: 'pokello',
    firstname: 'Peter',
    lastname: 'Okello',
    phone_number: '+256772000002',
    status: 'disabled',
    roles: [{ id: 'role-manager', name: 'hotspot manager', permissions: [] }],
    hot_spot: {
      id: 'hotspot-landing',
      name: 'Kasenyi Landing Site',
      type: 'landing site',
      status: 'active',
      village: 'Kasenyi',
      subcounty: SUBCOUNTY.name,
      district: 'Wakiso',
    },
    subcounty: null,
    store: null,
  },
  {
    id: 'u-3',
    username: 'rmugisha',
    firstname: 'Ronald',
    lastname: 'Mugisha',
    phone_number: null,
    status: 'active',
    roles: [{ id: 'role-agent', name: 'delivery agent', permissions: [] }],
    hot_spot: null,
    subcounty: null,
    store: STORE,
  },
];

const ok = (data: unknown): { status: number; body: unknown } => ({
  status: 200,
  body: { success: true, data },
});

/** Answers the page's reads from the fixtures and hands every write to `write`. */
function api(
  write: (request: RecordedRequest) => { status: number; body?: unknown } = () => ({
    status: 201,
    body: { success: true, data: { user_id: 'u-new' } },
  }),
  users: unknown[] = FIELD_USERS,
): FakeReply {
  return (request) => {
    if (request.method === 'GET') {
      if (request.url === '/users/district') return ok({ users });
      if (request.url === '/locations/stores') return ok([STORE]);
      if (request.url === `/locations/subcounties?district_id=${STORE.district_id}`)
        return ok([SUBCOUNTY]);
      if (request.url.startsWith(`/hotspots?district_id=${STORE.district_id}`)) return ok(HOTSPOTS);
      return { status: 404, body: { message: `No fixture for ${request.url}` } };
    }
    return write(request);
  };
}

function dcfpSession(
  permissions = ['users:district_read', 'users:district_create', 'hotspots:read'],
): Session {
  return {
    ...testSession,
    user: { ...testSession.user, permissions, roleNames: ['dfcp'], store_id: STORE.id },
  };
}

const writes = (requests: RecordedRequest[]) =>
  requests.filter((request) => request.method !== 'GET');

type User = ReturnType<typeof userEvent.setup>;

async function openForm(user: User) {
  await user.click(await screen.findByRole('button', { name: 'New user' }));
  return screen.findByRole('dialog');
}

async function fillDetails(user: User, dialog: HTMLElement) {
  await user.type(within(dialog).getByLabelText('First name'), 'Agnes');
  await user.type(within(dialog).getByLabelText('Last name'), 'Nambi');
  await user.type(within(dialog).getByLabelText('Username'), 'anambi');
  await user.type(within(dialog).getByLabelText('Email'), 'Agnes.Nambi@Example.org');
  await user.type(within(dialog).getByLabelText(/Phone number/), '0772 100 201');
  await user.type(within(dialog).getByLabelText('Password'), 'a-test-password');
}

describe('FieldUsersPage', () => {
  it("lists the district's field users with their role, where they work, phone and status", async () => {
    renderApp(<FieldUsersPage />, {
      route: '/dcfp/users',
      session: dcfpSession(),
      replies: [api()],
    });

    const table = await screen.findByRole('table', { name: 'Field users' });
    const rowOf = async (name: string) => {
      const row = (await within(table).findByText(name)).closest('tr');
      if (!row) throw new Error(`${name} has no row.`);
      return within(row);
    };
    const grace = await rowOf('Grace Atim');
    expect(grace.getByText('VHT')).toBeInTheDocument();
    expect(grace.getByText(SUBCOUNTY.name)).toBeInTheDocument();
    expect(grace.getByText('Subcounty')).toBeInTheDocument();
    expect(grace.getByText('+256772000001')).toBeInTheDocument();
    expect(grace.getByText('Active')).toBeInTheDocument();

    const peter = await rowOf('Peter Okello');
    expect(peter.getByText('Hotspot manager')).toBeInTheDocument();
    expect(peter.getByText('Kasenyi Landing Site')).toBeInTheDocument();
    expect(peter.getByText('Deactivated')).toBeInTheDocument();

    const ronald = await rowOf('Ronald Mugisha');
    expect(ronald.getByText('Delivery agent')).toBeInTheDocument();
    expect(ronald.getByText('Wakiso District Store')).toBeInTheDocument();
  });

  it('says so when the district has no field users yet', async () => {
    renderApp(<FieldUsersPage />, { session: dcfpSession(), replies: [api(undefined, [])] });
    expect(await screen.findByText('No field users yet')).toBeInTheDocument();
  });

  it('explains a 403 as an account with no district', async () => {
    renderApp(<FieldUsersPage />, {
      session: dcfpSession(),
      replies: [{ status: 403, body: { success: false, message: 'no district assigned' } }],
    });
    expect(await screen.findByText(/no district store or subcounty/)).toBeInTheDocument();
  });

  it('offers New user only to those who may create accounts', async () => {
    renderApp(<FieldUsersPage />, {
      session: dcfpSession(['users:district_read']),
      replies: [api()],
    });
    await screen.findByText('Grace Atim');
    expect(screen.queryByRole('button', { name: 'New user' })).not.toBeInTheDocument();
  });

  it('offers exactly the three field roles', async () => {
    const user = userEvent.setup();
    renderApp(<FieldUsersPage />, { session: dcfpSession(), replies: [api()] });
    const dialog = await openForm(user);

    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
      'vht',
      'hotspot manager',
      'delivery agent',
    ]);
    expect(within(dialog).getByRole('radio', { name: /^VHT/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /^Hotspot manager/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /^Delivery agent/ })).toBeInTheDocument();
  });

  it("needs a VHT's subcounty before sending, then posts the contract body", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<FieldUsersPage />, {
      session: dcfpSession(),
      replies: [api()],
    });
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    await user.click(within(dialog).getByRole('radio', { name: /^VHT/ }));
    // No hotspot is asked for a VHT.
    expect(within(dialog).queryByRole('combobox', { name: /^Hotspot/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(
      await within(dialog).findByText('Choose the subcounty they work in.'),
    ).toBeInTheDocument();
    expect(writes(requests)).toHaveLength(0);

    const select = within(dialog).getByRole('combobox', { name: /^Subcounty/ });
    await waitFor(() => {
      expect(select).toBeEnabled();
    });
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: SUBCOUNTY.name }));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const [post] = writes(requests);
    expect(post?.method).toBe('POST');
    expect(post?.url).toBe('/users/district');
    expect(post?.body).toEqual({
      username: 'anambi',
      email: 'agnes.nambi@example.org',
      password: 'a-test-password',
      first_name: 'Agnes',
      last_name: 'Nambi',
      phone_number: '+256772100201',
      role: 'vht',
      subcounty_id: SUBCOUNTY.id,
    });
    // The list is read again so the new account shows.
    await waitFor(() => {
      expect(
        requests.filter((request) => request.method === 'GET' && request.url === '/users/district'),
      ).toHaveLength(2);
    });
  });

  it("needs a hotspot manager's hotspot, offering only active ones in the district", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<FieldUsersPage />, {
      session: dcfpSession(),
      replies: [api()],
    });
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    await user.click(within(dialog).getByRole('radio', { name: /^Hotspot manager/ }));
    expect(within(dialog).queryByRole('combobox', { name: /^Subcounty/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByText('Choose the hotspot they run.')).toBeInTheDocument();
    expect(writes(requests)).toHaveLength(0);

    const picker = within(dialog).getByRole('combobox', { name: /^Hotspot/ });
    await waitFor(() => {
      expect(picker).toBeEnabled();
    });
    await user.click(picker);
    await screen.findByRole('combobox', { name: 'Search by name or village' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Kasenyi Landing SiteKasenyi, Katabi Town Council',
    ]);
    await user.keyboard('{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(writes(requests)[0]?.body).toEqual({
      username: 'anambi',
      email: 'agnes.nambi@example.org',
      password: 'a-test-password',
      first_name: 'Agnes',
      last_name: 'Nambi',
      phone_number: '+256772100201',
      role: 'hotspot manager',
      hot_spot_id: 'hotspot-landing',
    });
  });

  it('sends a delivery agent with no place: the server assigns the district store', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<FieldUsersPage />, {
      session: dcfpSession(),
      replies: [api()],
    });
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    await user.click(within(dialog).getByRole('radio', { name: /^Delivery agent/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const body = writes(requests)[0]?.body;
    expect(body).toMatchObject({ role: 'delivery agent' });
    expect(body).not.toHaveProperty('subcounty_id');
    expect(body).not.toHaveProperty('hot_spot_id');
  });

  it("shows the server's 422 field errors beside their fields and keeps the form open", async () => {
    const user = userEvent.setup();
    renderApp(<FieldUsersPage />, {
      session: dcfpSession(),
      replies: [
        api(() => ({
          status: 422,
          body: {
            success: false,
            message: 'validation failed',
            error: {
              username: 'username is already taken',
              subcounty_id: 'subcounty is not in your district',
            },
          },
        })),
      ],
    });
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    await user.click(within(dialog).getByRole('radio', { name: /^VHT/ }));
    const select = within(dialog).getByRole('combobox', { name: /^Subcounty/ });
    await waitFor(() => {
      expect(select).toBeEnabled();
    });
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: SUBCOUNTY.name }));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByText('username is already taken')).toBeInTheDocument();
    expect(within(dialog).getByText('subcounty is not in your district')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows a 409 as a message on the form', async () => {
    const user = userEvent.setup();
    renderApp(<FieldUsersPage />, {
      session: dcfpSession(),
      replies: [
        api(() => ({
          status: 409,
          body: { success: false, message: 'a user with this phone number already exists' },
        })),
      ],
    });
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    await user.click(within(dialog).getByRole('radio', { name: /^Delivery agent/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(
      await within(dialog).findByText('a user with this phone number already exists'),
    ).toBeInTheDocument();
  });
});

describe('Field users in the navigation', () => {
  const paths = (permissions: readonly string[]) =>
    navigationFor(workspaces, webAccessFor(['dfcp']), (code) => permissions.includes(code))
      .flatMap((workspace) => workspace.sections)
      .flatMap((section) => section.items)
      .flatMap((item) => item.pages.map((page) => page.path));

  it('shows the page only to those holding users:district_read', () => {
    expect(paths(['users:district_read'])).toContain('/dcfp/users');
    expect(paths(['users:district_create', 'hotspots:read'])).not.toContain('/dcfp/users');
  });
});
