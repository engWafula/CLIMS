import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  analyticsApi,
  BATCHES,
  NOTIFICATIONS,
  routes,
  STOCK,
  SUPPLY,
} from '@/test/analyticsFixtures';
import { renderApp, sessionWith } from '@/test/renderApp';

import MohDashboardPage from './MohDashboardPage';

const MOH = sessionWith(['reports:read', 'orders:read', 'orders:all_stores'], ['moh']);

describe('MohDashboardPage', () => {
  it('lists what needs watching, each linked to the report behind it', async () => {
    renderApp(<MohDashboardPage />, {
      route: '/moh',
      session: MOH,
      replies: [routes(analyticsApi())],
    });

    const list = await screen.findByRole('list', { name: 'Needs watching' });
    expect(
      within(list).getByText('2 stockout requests past the 7-day deadline'),
    ).toBeInTheDocument();
    expect(within(list).getByText('1 delivery not acknowledged in time')).toBeInTheDocument();
    expect(within(list).getByText('4,000 pieces expire within a month')).toBeInTheDocument();
    expect(within(list).getByText('1 stock line below 2 months of stock')).toBeInTheDocument();
    expect(within(list).getAllByRole('link', { name: 'See requests' })[0]).toHaveAttribute(
      'href',
      '/moh/programme-reports?view=notifications&status=awaiting_supply',
    );
  });

  it('shows the national figures and charts from the reports API, with a PDF download', async () => {
    renderApp(<MohDashboardPage />, {
      route: '/moh',
      session: MOH,
      replies: [routes(analyticsApi())],
    });

    expect(await screen.findByText('58.3%')).toBeInTheDocument(); // fulfilment rate
    expect(screen.getByText('50,300 pcs')).toBeInTheDocument(); // usable stock, two stores
    expect(screen.getByText('280')).toBeInTheDocument(); // active hotspots
    expect(
      screen.getByRole('heading', { name: 'Fulfilment rate by district' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Warehouse order pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Report filters' })).toBeInTheDocument();
  });

  it('says so when nothing needs watching', async () => {
    renderApp(<MohDashboardPage />, {
      route: '/moh',
      session: MOH,
      replies: [
        routes(
          analyticsApi({
            '/reports/notifications': {
              ...NOTIFICATIONS,
              acknowledgement_overdue: 0,
              backlog: { open: 0, oldest_raised_at: null },
              deadline: { ...NOTIFICATIONS.deadline, late_pending: 0 },
            },
            '/reports/warehouse-requests': { ...SUPPLY, total: { ...SUPPLY.total, pending: 0 } },
            '/reports/batches': { ...BATCHES, lines: [] },
            '/reports/stock': { ...STOCK, lines: [] },
          }),
        ),
      ],
    });
    expect(await screen.findByText('Nothing needs watching')).toBeInTheDocument();
  });

  it('says a failed report failed, rather than that nothing needs watching', async () => {
    renderApp(<MohDashboardPage />, {
      route: '/moh',
      session: MOH,
      replies: [routes(analyticsApi({ '/reports/warehouse-requests': new Error('boom') }))],
    });
    expect(await screen.findByText("Could not check the programme's figures")).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs watching')).not.toBeInTheDocument();
  });
});
