/*
 * Report responses in the Go API's shapes (docs/modules/reports.md), for tests
 * of the dashboards and the report section. Figures are small and consistent:
 * 12 stockout requests, 3 district orders, two stores' stock and three batches.
 */

import type { RecordedRequest } from '@/test/fakeAdapter';

export const envelope = (data: unknown) => ({ success: true, data });

export const NOTIFICATIONS = {
  period: { from: '2026-09-01', to: '2026-11-24' },
  data_updated_at: '2026-11-24T06:00:00Z',
  acknowledgements_through: '2026-11-24T06:00:00Z',
  category: null,
  notifications_raised: 12,
  by_selection: { male: 5, female: 3, both: 4 },
  notifications_fulfilled: 7,
  partly_received: 1,
  awaiting_acknowledgement: 1,
  awaiting_supply: 2,
  notifications_rejected: 1,
  fulfilment_rate: 58.3,
  component: null,
  response: { median_hours: 30.5, fulfilled_included: 7, pending: 4, oldest_pending_hours: 200 },
  deadline: {
    days: 7,
    target_percent: 80,
    fulfilled_on_time: 6,
    on_time_rate: 50,
    target_met: false,
    late_pending: 2,
  },
  backlog: { open: 1, oldest_raised_at: '2026-08-20T08:00:00Z' },
  acknowledgement_overdue: 1,
  districts: [
    {
      district_id: 'd1',
      district: 'Kampala District',
      notifications_raised: 8,
      notifications_fulfilled: 5,
      fulfilment_rate: 62.5,
    },
    {
      district_id: 'd2',
      district: 'Wakiso District',
      notifications_raised: 4,
      notifications_fulfilled: 2,
      fulfilment_rate: 50,
    },
  ],
  settings: { review_cycle: 'monthly', deadline_days: 7, target_percent: 80, source: 'default' },
};

const totals = {
  requests: 3,
  requested_pieces: 900,
  approved_pieces: 800,
  issued_pieces: 800,
  acknowledged_pieces: 600,
  quantity_fulfilment_rate: 66.7,
  fully_received: 1,
  partly_received: 1,
  pending: 1,
  rejected: 0,
  unconverted: 0,
  awaiting_unit: 1,
};

export const SUPPLY = {
  period: { from: '2026-09-01', to: '2026-11-24' },
  data_updated_at: '2026-11-24T06:00:00Z',
  total: totals,
  by_type: [{ ...totals, id: 'male', name: 'Male' }],
  by_warehouse: [{ ...totals, id: 'w1', name: 'National Medical Stores' }],
  by_district: [{ ...totals, id: 'd1', name: 'Kampala District' }],
  response: { median_hours: 20, fulfilled_included: 1, pending: 1, oldest_pending_hours: 49 },
  dispatches_without_request: {
    dispatches: 1,
    issued_pieces: 3000,
    received_pieces: 0,
    awaiting_receipt: 1,
  },
};

const stockLine = {
  district_id: null,
  district: null,
  condom_id: 'c1',
  product: 'ULINZI Free Male',
  category: 'male',
  unit_of_measure_id: 'u1',
  unit: 'Pieces',
  reserved: 0,
  expired: 0,
  unknown_expiry: 0,
  in_transit: 0,
  in_transit_pieces: 0,
  reconciled: true,
  batches_reconciled: true,
  average_monthly_issues: null,
  months_of_stock: null,
  coverage_status: 'unavailable_short_history',
};

export const STOCK = {
  stock_date: '2026-11-24T06:00:00Z',
  coverage_window: { from: '2026-08-01', to: '2026-10-31' },
  coverage_method: 'Usable stock divided by average monthly outward issues.',
  expiry_tracked: true,
  lines: [
    {
      ...stockLine,
      store_id: 's1',
      store: 'National Medical Stores',
      store_type: 'national',
      physical: 50000,
      usable: 50000,
      physical_pieces: 50000,
      usable_pieces: 50000,
    },
    {
      ...stockLine,
      store_id: 's2',
      store: 'Kampala District',
      store_type: 'district',
      district_id: 'd1',
      district: 'Kampala District',
      physical: 300,
      usable: 300,
      physical_pieces: 300,
      usable_pieces: 300,
      average_monthly_issues: 200,
      months_of_stock: 1.5,
      coverage_status: 'available',
    },
  ],
};

const batch = {
  store_type: 'national',
  district_id: null,
  condom_id: 'c1',
  product: 'ULINZI Free Male',
  category: 'male',
  unit_of_measure_id: 'u1',
  unit: 'Pieces',
};

export const BATCHES = {
  stock_date: '2026-11-24T06:00:00Z',
  rule_version: 'reporting-requirements-0.2-draft',
  lines: [
    {
      ...batch,
      id: 'b1',
      store_id: 's1',
      store: 'Joint Medical Store',
      batch_number: 'YT3456',
      expiry_date: '2026-12-10T00:00:00Z',
      days_remaining: 16,
      band: 'under_1_month',
      on_hand: 4000,
      pieces: 4000,
    },
    {
      ...batch,
      id: 'b2',
      store_id: 's1',
      store: 'National Medical Stores',
      batch_number: 'QWA1677',
      expiry_date: '2027-09-23T00:00:00Z',
      days_remaining: 303,
      band: 'ok',
      on_hand: 46000,
      pieces: 46000,
    },
  ],
};

const group = (name: string, total: number, active: number) => ({
  id: name,
  name,
  total,
  active,
  submitted: 0,
  rejected: 0,
  deactivated: total - active,
  with_dispenser: Math.round(total / 3),
  located: Math.round(total / 2),
  open_requests: 1,
});

export const HOTSPOTS = {
  data_updated_at: '2026-11-24T06:00:00Z',
  total: group('all', 300, 280),
  by_region: [group('Kampala', 200, 190), group('Busoga', 100, 90)],
  by_district: [group('Kampala District', 200, 190), group('Jinja District', 100, 90)],
  by_type: [group('Bar, pub or club', 150, 140), group('Lodge', 150, 140)],
  dispensers: [group('Working', 90, 90), group('Needs repair', 10, 10)],
  registrations: Array.from({ length: 12 }, (_, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    registered: index * 2,
    activated: index,
  })),
};

const bucket = (start: string, raised: number) => ({
  start,
  notifications: {
    raised,
    fulfilled: Math.max(0, raised - 1),
    rejected: 0,
    fulfilment_rate: raised ? 50 : null,
    median_response_hours: raised ? 24 : null,
  },
  requests: {
    requests: 1,
    requested_pieces: 300,
    approved_pieces: 300,
    issued_pieces: 300,
    acknowledged_pieces: 200,
  },
  deliveries: { deliveries: 1, male_pieces: 100, female_pieces: 50, acknowledged_pieces: 100 },
  stock: {
    received_pieces: 1000,
    dispatched_pieces: 300,
    district_received_pieces: 200,
    delivered_pieces: 150,
    adjusted_pieces: 0,
  },
});

export const TRENDS = {
  period: { from: '2026-09-01', to: '2026-11-24' },
  interval: 'month',
  data_updated_at: '2026-11-24T06:00:00Z',
  buckets: [bucket('2026-09-01', 3), bucket('2026-10-01', 4), bucket('2026-11-01', 5)],
};

/** Answers every analytics endpoint with the fixtures; `overrides` replaces a path's body. */
export function analyticsApi(overrides: Record<string, unknown> = {}) {
  const bodies: Record<string, unknown> = {
    '/reports/notifications': NOTIFICATIONS,
    '/reports/warehouse-requests': SUPPLY,
    '/reports/stock': STOCK,
    '/reports/batches': BATCHES,
    '/reports/hotspots': HOTSPOTS,
    '/reports/trends': TRENDS,
    '/locations/stores': [],
    '/locations/regions': [],
    ...overrides,
  };
  return (request: RecordedRequest) => {
    const path = new URL(request.url, 'http://test').pathname;
    if (!(path in bodies)) return null;
    const body = bodies[path];
    if (body instanceof Error)
      return { status: 500, body: { success: false, message: body.message } };
    return { status: 200, body: envelope(body) };
  };
}

type Handler = (request: RecordedRequest) => { status: number; body?: unknown } | null;

/** One scripted reply from several handlers: the first that knows the path answers, else 404. */
export function routes(...handlers: Handler[]) {
  return (request: RecordedRequest) => {
    for (const handler of handlers) {
      const reply = handler(request);
      if (reply) return reply;
    }
    return { status: 404, body: { success: false, message: 'Not found' } };
  };
}
