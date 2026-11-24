import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ReadOnlyProvider } from '@/navigation/useAccess';
import { aReport, BOX, FEMALE } from '@/test/dcfpFixtures';
import { renderApp, sessionWith } from '@/test/renderApp';
import {
  aMovement,
  aProductSummary,
  aStockBatch,
  aStoreSummary,
  warehouseOrderApi,
} from '@/test/warehouseOrderFixtures';

import DistrictStorePage from './DistrictStorePage';

const storeId = 'store-wakiso';
function districtSession(
  permissions = [
    'inventory:read',
    'inventory:manage',
    'orders:read',
    'orders:receive',
    'orders:replenish',
    'orders:supply_hotspots',
  ],
) {
  const session = sessionWith(permissions, ['dcfp']);
  session.user.store_id = storeId;
  return session;
}
const summary = aStoreSummary({ store_id: storeId, store_name: 'Wakiso', store_type: 'district' });
const route = '/dcfp/restock/store';

describe('District store', () => {
  it('loads the assigned store and shows live metrics with separate units', async () => {
    const { requests } = renderApp(<DistrictStorePage />, {
      route,
      session: districtSession(),
      replies: [
        warehouseOrderApi({
          summary: {
            ...summary,
            products: [
              ...summary.products,
              aProductSummary({
                condom_id: 'p2',
                unit_of_measure_id: 'u2',
                unit: 'carton',
                on_hand: 2,
              }),
            ],
          },
        }),
      ],
    });
    expect(await screen.findByText('910 box · 2 carton')).toBeInTheDocument();
    expect(screen.getByText('Available to dispatch')).toBeInTheDocument();
    expect(
      screen.getByText('Warehouse receipts and registrations, last 30 days'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Receive warehouse delivery' })).toHaveAttribute(
      'href',
      '/dcfp/restock?status=dispatched',
    );
    expect(screen.queryByText('Sample data')).not.toBeInTheDocument();
    const reads = requests.filter((r) => r.url.startsWith('/inventory/'));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.url.includes(`store_id=${storeId}`))).toBe(true);
    expect(requests.some((r) => r.url.startsWith('/district-store'))).toBe(false);
  });

  it('shows stock in pieces as a bare number, with no unit column', async () => {
    renderApp(<DistrictStorePage />, {
      route,
      session: districtSession(),
      replies: [
        warehouseOrderApi({
          summary: {
            ...summary,
            products: [
              aProductSummary({
                product: 'ULINZI Male',
                unit: 'Pieces',
                on_hand: 300,
                usable: 300,
                reserved: 0,
              }),
            ],
          },
        }),
      ],
    });
    // On hand and Available to dispatch are both 300; neither says "Pieces".
    expect(await screen.findAllByText('300', { selector: 'p, span, div' })).not.toHaveLength(0);
    expect(screen.queryByText(/\d Pieces/)).not.toBeInTheDocument();
    expect(screen.getByText('0 reserved · excludes expired stock')).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).queryByRole('columnheader', { name: 'Unit' })).not.toBeInTheDocument();
    expect(within(table).getByText('ULINZI Male')).toBeInTheDocument();
  });

  it('shows an empty state for no stock and assignment guidance for no assigned store', async () => {
    const view = renderApp(<DistrictStorePage />, {
      route,
      session: districtSession(),
      replies: [warehouseOrderApi({ summary: { ...summary, products: [] } })],
    });
    expect(await screen.findByText('No stock in the district store')).toBeInTheDocument();
    expect(screen.queryByText('Could not load district stock')).not.toBeInTheDocument();
    view.unmount();
    const { requests } = renderApp(<DistrictStorePage />, {
      route,
      session: sessionWith(['inventory:read'], ['dcfp']),
    });
    expect(screen.getByText('No district store assigned')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('keeps actual API failures visible instead of presenting them as no stock', async () => {
    const api = warehouseOrderApi({});
    renderApp(<DistrictStorePage />, {
      route,
      session: districtSession(),
      replies: [
        (request) =>
          request.url.startsWith('/inventory/store-summary')
            ? { status: 500, body: { success: false, message: 'Database unavailable' } }
            : api(request),
      ],
    });
    expect(await screen.findByText('Could not load district stock')).toBeInTheDocument();
    expect(screen.queryByText('No stock in the district store')).not.toBeInTheDocument();
  });

  it('reads hotspot dispatch movements and filters them on the server', async () => {
    const { requests } = renderApp(<DistrictStorePage />, {
      route: `${route}?view=movements&reason=hotspot_delivery`,
      session: districtSession(),
      replies: [
        warehouseOrderApi({
          summary,
          movements: [
            aMovement({
              store_id: storeId,
              reason: 'hotspot_delivery',
              quantity: -5,
              note: 'Delivered to Kisenyi',
            }),
          ],
        }),
      ],
    });
    const table = await screen.findByRole('table', { name: 'District stock movements' });
    expect(await within(table).findByText('Delivered to Kisenyi')).toBeInTheDocument();
    expect(within(table).getByText('Dispatched to hotspot')).toBeInTheDocument();
    expect(
      requests.some(
        (r) =>
          r.url.startsWith('/inventory/movements') && r.url.includes('reason=hotspot_delivery'),
      ),
    ).toBe(true);
  });

  it('writes off an expired district batch with a reason and refreshes stock', async () => {
    const user = userEvent.setup();
    const batch = aStockBatch({
      store_id: storeId,
      store_type: 'district',
      band: 'expired',
      on_hand: 10,
      expiry_date: '2026-01-01',
    });
    const { requests } = renderApp(<DistrictStorePage />, {
      route: `${route}?view=batches`,
      session: districtSession(),
      replies: [
        warehouseOrderApi(
          { summary, batches: [batch] },
          {
            'POST /inventory/movements': {
              status: 201,
              body: {
                success: true,
                data: aMovement({ reason: 'adjustment', quantity: -10, store_id: storeId }),
              },
            },
          },
        ),
      ],
    });
    await user.click(
      await screen.findByRole('button', { name: `Actions for batch ${batch.batch_number}` }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Write off expired stock' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Why'), 'Disposed following district procedure');
    await user.click(within(dialog).getByRole('button', { name: 'Write off' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requests.find((r) => r.method === 'POST')?.body).toMatchObject({
      store_id: storeId,
      reason: 'adjustment',
      quantity: -10,
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date,
    });
    expect(
      requests.filter((r) => r.url.startsWith('/inventory/store-summary')).length,
    ).toBeGreaterThan(1);
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('hides stock management without permission and in a read-only workspace', async () => {
    const view = renderApp(<DistrictStorePage />, {
      route,
      session: districtSession(['inventory:read']),
      replies: [warehouseOrderApi({ summary })],
    });
    await screen.findByText('910 box');
    expect(screen.queryByRole('button', { name: 'Register stock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispatch to hotspot' })).not.toBeInTheDocument();
    view.unmount();
    renderApp(
      <ReadOnlyProvider value>
        <DistrictStorePage />
      </ReadOnlyProvider>,
      { route, session: districtSession(), replies: [warehouseOrderApi({ summary })] },
    );
    await screen.findByText('910 box');
    expect(screen.queryByRole('button', { name: 'Register stock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispatch to hotspot' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Receive warehouse delivery' }),
    ).not.toBeInTheDocument();
  });

  it('dispatches available stock to a district hotspot and refreshes its balances', async () => {
    const user = userEvent.setup();
    const report = aReport({ district_store_id: storeId, status: 'awaiting_supply' });
    const api = warehouseOrderApi({ summary, products: [FEMALE] });
    const { requests } = renderApp(<DistrictStorePage />, {
      route,
      session: districtSession(),
      replies: [
        (request) =>
          request.url.startsWith('/orders/stockouts')
            ? {
                status: 200,
                body: { success: true, data: request.method === 'GET' ? [report] : report },
              }
            : api(request),
      ],
    });
    const button = await screen.findByRole('button', { name: 'Dispatch to hotspot' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await user.click(await screen.findByRole('combobox', { name: /Hotspot stockout/ }));
    await user.click(await screen.findByRole('option', { name: /Kisenyi Landing/ }));
    await user.type(await screen.findByRole('spinbutton'), '5');
    await user.click(screen.getByRole('button', { name: 'Record dispatch' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requests.find((r) => r.method === 'POST')).toMatchObject({
      url: '/orders/stockouts/r1/deliveries',
      body: {
        lines: [{ condom_id: FEMALE.id, unit_of_measure_id: BOX.id, quantity: 5 }],
      },
    });
    expect(
      requests.filter((r) => r.url.startsWith('/inventory/store-summary')).length,
    ).toBeGreaterThan(1);
  });
});
