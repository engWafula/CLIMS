import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Ref } from 'react';

import { DistrictContextProvider } from '@/features/district/DistrictContext';
import type { FakeReply } from '@/test/fakeAdapter';
import { renderApp, sessionWith } from '@/test/renderApp';

import HotspotMapPage from './HotspotMapPage';
import HotspotsPage from './HotspotsPage';
import type { HotspotMapHandle } from './map/HotspotMapCanvas';

// jsdom has no WebGL. The map itself is checked in a browser; these tests cover
// what loads, the list beside the map and the detail panel.
vi.mock('./map/HotspotMapCanvas', async () => {
  const { useImperativeHandle } = await import('react');
  return {
    default: function MapStub({ handleRef }: { handleRef?: Ref<HotspotMapHandle> }) {
      useImperativeHandle(
        handleRef,
        () => ({ fitTo: () => undefined, flyTo: () => undefined }),
        [],
      );
      return <div data-testid="hotspot-map" />;
    },
  };
});

const id = '6f1e2c50-9d8a-4f3b-8c1e-2b7a9d0c4e11';
const region = '1a2b3c4d-0000-4000-8000-0000000000aa';
const district = '7f2c3c5e-1d4b-4c1a-9a51-2a8f6f0b9e11';
const subcounty = '2b3c4d5e-0000-4000-8000-0000000000bb';
const hotspot = (reviewStatus: string, extra: object = {}) => ({
  id,
  name: 'Lake view bar',
  type: 'Bar',
  village: 'Seja',
  region: { id: region, name: 'Central' },
  district: { id: district, name: 'Buvuma' },
  subcounty: { id: subcounty, name: 'Nairambi' },
  latitude: 0.3295,
  longitude: 32.6016,
  has_condom_dispenser: true,
  dispenser_condition: 'Good',
  status: reviewStatus === 'active' ? 'active' : 'inactive',
  review_status: reviewStatus,
  submitted_by_id: 'a1b2c3d4-0000-4000-8000-000000000003',
  contact_person: {
    id: 'a1b2c3d4-0000-4000-8000-000000000004',
    name: 'Okello James',
    phone_number: '+256772000000',
  },
  created_at: '2026-11-19T10:00:00Z',
  updated_at: '2026-11-19T10:00:00Z',
  ...extra,
});
const list = (...items: object[]) => ({ status: 200, body: { success: true, data: items } });
const done = { status: 200, body: { success: true } };
const submittedEvent = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  hot_spot_id: id,
  actor_id: 'a1b2c3d4-0000-4000-8000-000000000002',
  action: 'submitted',
  status: 'submitted',
  created_at: '2026-11-19T10:00:00Z',
};

/**
 * Replies for the DCFP's review queue, by address: it reads every page of the
 * district's hotspots at once, so the order its requests go out in is not
 * fixed. `write` answers the decision.
 */
/** A reply the router hands back: a fixed one, not another router. */
type Reply = Exclude<FakeReply, (request: never) => unknown>;

function reviewApi(hotspots: object[], write: Reply = done) {
  return (request: { method: string; url: string }): Reply => {
    if (request.method === 'POST') return write;
    // Only the first page holds anything: the list is shorter than a page.
    if (request.url.startsWith('/hotspots?')) {
      return request.url.includes('offset=0') ? list(...hotspots) : list();
    }
    return list();
  };
}

function rowOf(name: string) {
  const cell = screen.getAllByText(name).find((node) => node.closest('tr'));
  const row = cell?.closest('tr');
  if (!row) throw new Error(`No table row for ${name}`);
  return row;
}

describe('HotspotsPage review queue', () => {
  it('shows submissions and their manager', async () => {
    renderApp(<HotspotsPage />, {
      signedIn: true,
      replies: [reviewApi([hotspot('submitted')])],
    });

    await screen.findAllByText('Lake view bar');
    const row = rowOf('Lake view bar');
    expect(within(row).getByText('submitted')).toBeInTheDocument();
    expect(within(row).getByText('Okello James')).toBeInTheDocument();
    expect(within(row).getByText('Yes, good')).toBeInTheDocument();
  });

  it('offers activate and reject for a submission, deactivate for an active hotspot', async () => {
    const user = userEvent.setup();
    renderApp(<HotspotsPage />, {
      signedIn: true,
      replies: [
        reviewApi([hotspot('submitted'), hotspot('active', { id: 'other', name: 'Pier' })]),
      ],
    });

    await user.click(await screen.findByRole('button', { name: 'Actions for Lake view bar' }));
    expect(await screen.findByRole('menuitem', { name: 'Activate' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Actions for Pier' }));
    expect(await screen.findByRole('menuitem', { name: 'Deactivate' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Activate' })).not.toBeInTheDocument();
  });

  it('activates a hotspot only with a comment', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<HotspotsPage />, {
      signedIn: true,
      replies: [reviewApi([hotspot('submitted')])],
    });

    await user.click(await screen.findByRole('button', { name: 'Actions for Lake view bar' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Activate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Activate Lake view bar?' });
    await user.click(within(dialog).getByRole('button', { name: 'Activate hotspot' }));
    expect(await within(dialog).findByText(/Add a comment/)).toBeInTheDocument();
    expect(requests.some((request) => request.method === 'POST')).toBe(false);

    await user.type(within(dialog).getByLabelText(/Comment/), 'Visited and confirmed');
    await user.click(within(dialog).getByRole('button', { name: 'Activate hotspot' }));

    await waitFor(() => {
      expect(requests.find((request) => request.method === 'POST')).toMatchObject({
        url: `/hotspots/${id}/activate`,
        body: { comment: 'Visited and confirmed' },
      });
    });
  });

  it('keeps the comment and shows the refusal when the decision is no longer allowed', async () => {
    const user = userEvent.setup();
    renderApp(<HotspotsPage />, {
      signedIn: true,
      replies: [
        reviewApi([hotspot('submitted')], {
          status: 409,
          body: { success: false, message: 'Hotspot was already rejected.' },
        }),
      ],
    });

    await user.click(await screen.findByRole('button', { name: 'Actions for Lake view bar' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject Lake view bar?' });
    await user.type(within(dialog).getByLabelText(/Comment/), 'Already mapped');
    await user.click(within(dialog).getByRole('button', { name: 'Reject hotspot' }));

    expect(await within(dialog).findByText('Hotspot was already rejected.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Comment/)).toHaveValue('Already mapped');
  });
});

describe('HotspotMapPage', () => {
  const gulu = '0d6c4b1e-5a3f-4e2b-8c7d-9f1a2b3c4d5e';
  const goHotspot = (fields: object = {}) => ({
    id,
    name: 'Lake view bar',
    type: 'Bar',
    village: 'Seja',
    region: { id: 'r1', name: 'Central' },
    district: { id: district, name: 'Wakiso' },
    subcounty: null,
    latitude: 0.3295,
    longitude: 32.6016,
    has_condom_dispenser: true,
    dispenser_condition: 'Good',
    status: 'active',
    review_status: 'active',
    contact_person: { id: 'c1', name: 'Okello James', phone_number: '+256772000000' },
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-02-03T10:00:00Z',
    ...fields,
  });
  const unplaced = goHotspot({
    id: '9a9a9a9a-0000-4000-8000-000000000009',
    name: 'Nowhere lodge',
    latitude: null,
    longitude: null,
  });
  const abroad = goHotspot({
    id: '9b9b9b9b-0000-4000-8000-00000000000b',
    name: 'Emulator bar',
    latitude: 37.4221,
    longitude: -122.0839,
  });
  const api =
    (hotspots: object[] = [goHotspot()]) =>
    (request: { url: string }) => {
      if (request.url === '/locations/districts')
        return list({ id: district, name: 'Wakiso' }, { id: gulu, name: 'Gulu' });
      if (request.url === '/locations/regions') return list({ id: 'r1', name: 'Central' });
      if (request.url.startsWith('/hotspots?')) {
        const query = new URLSearchParams(request.url.split('?')[1]);
        const inDistrict = query.get('district_id') !== gulu;
        return list(...(query.get('offset') === '0' && inDistrict ? hotspots : []));
      }
      if (request.url.endsWith('/events')) return list(submittedEvent);
      if (request.url.startsWith('/hotspots/'))
        return { status: 200, body: { success: true, data: { ...goHotspot(), comments: [] } } };
      return list();
    };
  const hotspotUrls = (requests: { url: string }[]) =>
    requests.map(({ url }) => url).filter((url) => url.startsWith('/hotspots?'));

  it('loads the whole country a district at a time for a national user', async () => {
    const { requests } = renderApp(<HotspotMapPage canSwitchDistrict />, {
      route: '/moh/hotspot-map',
      signedIn: true,
      replies: [api()],
    });

    expect(await screen.findByRole('button', { name: /Lake view bar/ })).toBeInTheDocument();
    expect(hotspotUrls(requests)).toEqual(
      expect.arrayContaining([
        `/hotspots?limit=100&offset=0&district_id=${district}`,
        `/hotspots?limit=100&offset=0&district_id=${gulu}`,
      ]),
    );
    expect(screen.getByText('1 of 1 hotspot is on the map.')).toBeInTheDocument();
  });

  it('loads only the district chosen in the top bar', async () => {
    const { requests } = renderApp(
      <DistrictContextProvider>
        <HotspotMapPage canSwitchDistrict />
      </DistrictContextProvider>,
      {
        route: '/moh/hotspot-map?district=Wakiso',
        signedIn: true,
        replies: [api()],
      },
    );

    expect(await screen.findByRole('button', { name: /Lake view bar/ })).toBeInTheDocument();
    const urls = hotspotUrls(requests);
    expect(urls).toContain(`/hotspots?limit=100&offset=0&district_id=${district}`);
    expect(urls.some((url) => url.includes(gulu))).toBe(false);
  });

  it('shows a DCFP what the API scopes them to, without a district filter', async () => {
    const { requests } = renderApp(<HotspotMapPage />, {
      route: '/dcfp/hotspot-map',
      session: sessionWith(['hotspots:read', 'hotspots:activate'], ['dfcp']),
      replies: [api()],
    });

    expect(await screen.findByRole('button', { name: /Lake view bar/ })).toBeInTheDocument();
    expect(hotspotUrls(requests)).toContain('/hotspots?limit=100&offset=0');
    expect(hotspotUrls(requests).some((url) => url.includes('district_id'))).toBe(false);
    expect(requests.some(({ url }) => url === '/locations/districts')).toBe(false);
  });

  it('opens a hotspot from the list with its contact and history', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<HotspotMapPage canSwitchDistrict />, {
      route: '/moh/hotspot-map',
      signedIn: true,
      replies: [api()],
    });

    await user.click(await screen.findByRole('button', { name: /Lake view bar/ }));

    const heading = await screen.findByRole('heading', { level: 2, name: 'Lake view bar' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+256772000000');
    expect(await screen.findByText('Submitted for review')).toBeInTheDocument();
    expect(requests.map(({ url }) => url)).toEqual(
      expect.arrayContaining([`/hotspots/${id}`, `/hotspots/${id}/events`]),
    );

    await user.click(screen.getByRole('button', { name: 'Back to list' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'In view' })).toHaveFocus();
  });

  it('lists the hotspots it leaves off the map, and why, so they can be fixed', async () => {
    const user = userEvent.setup();
    renderApp(<HotspotMapPage canSwitchDistrict />, {
      route: '/moh/hotspot-map',
      signedIn: true,
      replies: [api([goHotspot(), unplaced, abroad])],
    });

    expect(
      await screen.findByText(
        '1 of 3 hotspots are on the map. 1 has no position recorded and 1 has one outside Uganda.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'List the 2 not on the map' }));

    expect(screen.getByRole('heading', { level: 2, name: 'Not on the map' })).toBeInTheDocument();
    const outside = screen.getByRole('button', { name: /Emulator bar/ });
    expect(within(outside).getByText('Outside Uganda')).toBeInTheDocument();
    expect(within(outside).getByText('Wakiso · 37.4221, -122.0839')).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Nowhere lodge/ })).getByText('No position'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Lake view bar/ })).not.toBeInTheDocument();
  });

  it('narrows the list by search and by status', async () => {
    const user = userEvent.setup();
    renderApp(<HotspotMapPage canSwitchDistrict />, {
      route: '/moh/hotspot-map',
      signedIn: true,
      replies: [api([goHotspot(), unplaced])],
    });

    await user.type(
      await screen.findByLabelText('Search hotspots by name, place or contact'),
      'nowhere',
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Search results' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nowhere lodge/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Lake view bar/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Status: all shown' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Active/ }));
    await user.keyboard('{Escape}');

    expect(await screen.findByText('No hotspots match')).toBeInTheDocument();
  });
});
