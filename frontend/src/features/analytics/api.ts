import { z } from 'zod';

import { parseBody, parseList, type HttpClient } from '@/lib/api';

/*
 * The figures behind the dashboards and the report section, from the Go API's
 * `/api/v1/reports` (see docs/modules/reports.md). Every figure is calculated by
 * the server from source records with the user's access applied, so a chart and
 * the export table under it always agree. Zod keeps only the fields read here.
 */

const count = z.number();
const rate = z.number().nullable();

function query(params: Record<string, string>): string {
  const search = new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value)
      .sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
  return search ? `?${search}` : '';
}

// Trends ------------------------------------------------------------------

const bucketSchema = z.object({
  start: z.string(),
  notifications: z.object({
    raised: count,
    fulfilled: count,
    rejected: count,
    fulfilment_rate: rate,
    median_response_hours: rate,
  }),
  requests: z.object({
    requests: count,
    requested_pieces: count,
    approved_pieces: count,
    issued_pieces: count,
    acknowledged_pieces: count,
  }),
  deliveries: z.object({
    deliveries: count,
    male_pieces: count,
    female_pieces: count,
    acknowledged_pieces: count,
  }),
  stock: z.object({
    received_pieces: count,
    dispatched_pieces: count,
    district_received_pieces: count,
    delivered_pieces: count,
    adjusted_pieces: count,
  }),
});
export type TrendBucket = z.infer<typeof bucketSchema>;

const trendSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  interval: z.enum(['day', 'week', 'month']),
  data_updated_at: z.string(),
  buckets: z.array(bucketSchema),
});
export type TrendReport = z.infer<typeof trendSchema>;

export async function getTrends(
  http: HttpClient,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<TrendReport> {
  return parseBody(
    trendSchema,
    await http.get(`/reports/trends${query(params)}`, { signal }),
    'trends',
  );
}

// Notifications ------------------------------------------------------------

export const notificationReportSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  data_updated_at: z.string(),
  acknowledgements_through: z.string(),
  notifications_raised: count,
  by_selection: z.record(z.string(), count).default({}),
  notifications_fulfilled: count,
  partly_received: count,
  awaiting_acknowledgement: count,
  awaiting_supply: count,
  notifications_rejected: count.default(0),
  fulfilment_rate: rate,
  response: z.object({
    median_hours: rate,
    pending: count,
    oldest_pending_hours: rate.default(null),
  }),
  deadline: z.object({
    days: count,
    target_percent: count,
    fulfilled_on_time: count.default(0),
    on_time_rate: rate,
    target_met: z.boolean().nullable(),
    late_pending: count,
  }),
  backlog: z.object({ open: count, oldest_raised_at: z.string().nullable() }).default({
    open: 0,
    oldest_raised_at: null,
  }),
  acknowledgement_overdue: count,
  districts: z
    .array(
      z.object({
        district_id: z.string().nullable().default(null),
        district: z.string().nullable(),
        notifications_raised: count,
        notifications_fulfilled: count.default(0),
        fulfilment_rate: rate,
      }),
    )
    .default([]),
  settings: z.object({
    review_cycle: z.string(),
    deadline_days: count,
    target_percent: count,
    source: z.enum(['store', 'national', 'default']),
  }),
});
export type NotificationReport = z.infer<typeof notificationReportSchema>;

export async function getNotificationReport(
  http: HttpClient,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<NotificationReport> {
  return parseBody(
    notificationReportSchema,
    await http.get(`/reports/notifications${query(params)}`, { signal }),
    'notification report',
  );
}

// Warehouse requests -------------------------------------------------------

const requestTotalsSchema = z.object({
  requests: count,
  requested_pieces: count,
  approved_pieces: count,
  issued_pieces: count,
  acknowledged_pieces: count,
  quantity_fulfilment_rate: rate,
  fully_received: count.default(0),
  partly_received: count.default(0),
  pending: count,
  rejected: count.default(0),
  unconverted: count.default(0),
  awaiting_unit: count.default(0),
});
export type RequestTotals = z.infer<typeof requestTotalsSchema>;

const requestGroupSchema = requestTotalsSchema.extend({
  id: z.string().nullable(),
  name: z.string().nullable(),
});
export type RequestGroup = z.infer<typeof requestGroupSchema>;

export const supplyReportSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  data_updated_at: z.string(),
  total: requestTotalsSchema,
  by_type: z.array(requestGroupSchema).default([]),
  by_warehouse: z.array(requestGroupSchema).default([]),
  by_district: z.array(requestGroupSchema).default([]),
  response: z
    .object({ median_hours: rate, pending: count, oldest_pending_hours: rate.default(null) })
    .default({ median_hours: null, pending: 0, oldest_pending_hours: null }),
  dispatches_without_request: z
    .object({
      dispatches: count,
      issued_pieces: count,
      received_pieces: count,
      awaiting_receipt: count,
    })
    .default({ dispatches: 0, issued_pieces: 0, received_pieces: 0, awaiting_receipt: 0 }),
});
export type SupplyReport = z.infer<typeof supplyReportSchema>;

export async function getSupplyReport(
  http: HttpClient,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<SupplyReport> {
  return parseBody(
    supplyReportSchema,
    await http.get(`/reports/warehouse-requests${query(params)}`, { signal }),
    'warehouse request report',
  );
}

// Stock -------------------------------------------------------------------

const stockLineSchema = z.object({
  store_id: z.string(),
  store: z.string(),
  store_type: z.string(),
  district_id: z.string().nullable(),
  district: z.string().nullable(),
  condom_id: z.string(),
  product: z.string(),
  category: z.string().nullable(),
  unit: z.string(),
  physical: count,
  reserved: count,
  expired: count,
  unknown_expiry: count,
  usable: count,
  in_transit: count,
  physical_pieces: count.nullable(),
  usable_pieces: count.nullable(),
  in_transit_pieces: count.nullable(),
  reconciled: z.boolean(),
  batches_reconciled: z.boolean(),
  average_monthly_issues: rate,
  months_of_stock: rate,
  coverage_status: z.string(),
});
export type StockLine = z.infer<typeof stockLineSchema>;

const stockReportSchema = z.object({
  stock_date: z.string(),
  coverage_window: z.object({ from: z.string(), to: z.string() }),
  coverage_method: z.string(),
  lines: z.array(stockLineSchema),
});
export type StockReport = z.infer<typeof stockReportSchema>;

export async function getStockReport(
  http: HttpClient,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<StockReport> {
  return parseBody(
    stockReportSchema,
    await http.get(`/reports/stock${query(params)}`, { signal }),
    'stock report',
  );
}

// Batches -----------------------------------------------------------------

export const EXPIRY_BANDS = [
  'expired',
  'under_1_month',
  'under_3_months',
  'under_6_months',
  'ok',
  'unknown',
] as const;
export type ExpiryBand = (typeof EXPIRY_BANDS)[number];

const batchLineSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  store: z.string(),
  store_type: z.string(),
  product: z.string(),
  category: z.string().nullable(),
  unit: z.string(),
  batch_number: z.string().nullable(),
  expiry_date: z.string().nullable(),
  days_remaining: z.number().nullable(),
  band: z.enum(EXPIRY_BANDS),
  on_hand: count,
  pieces: count.nullable(),
});
export type BatchLine = z.infer<typeof batchLineSchema>;

const batchReportSchema = z.object({ stock_date: z.string(), lines: z.array(batchLineSchema) });
export type BatchReport = z.infer<typeof batchReportSchema>;

export async function getBatchReport(
  http: HttpClient,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<BatchReport> {
  return parseBody(
    batchReportSchema,
    await http.get(`/reports/batches${query(params)}`, { signal }),
    'batch report',
  );
}

const expiryExceptionSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  store: z.string(),
  product: z.string(),
  batch_number: z.string().nullable(),
  expiry_date: z.string(),
  days_remaining: count,
  quantity: count,
  reason: z.string(),
  authorized_by: z.string().nullable(),
});
export type ExpiryException = z.infer<typeof expiryExceptionSchema>;

export async function getExpiryExceptions(
  http: HttpClient,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<ExpiryException[]> {
  return parseList(
    expiryExceptionSchema,
    await http.get(`/reports/expiry-exceptions${query({ ...params, limit: '100' })}`, { signal }),
    'expiry exceptions',
  );
}

// HMIS 105 ------------------------------------------------------------------

const hmisRowSchema = z.object({
  district_id: z.string().nullable(),
  district: z.string().nullable(),
  subcounty: z.string().nullable(),
  ct11_female_pieces: count,
  ct12_male_pieces: count,
  acknowledgements: count,
  hotspots: count.default(0),
  unacknowledged_lines: count,
});

const hmisReportSchema = z.object({
  month: z.string(),
  integration_enabled: z.boolean(),
  pending_decisions: z.array(z.string()),
  total: hmisRowSchema,
  rows: z.array(hmisRowSchema).default([]),
});
export type HmisReport = z.infer<typeof hmisReportSchema>;

export async function getHmisReport(
  http: HttpClient,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<HmisReport> {
  return parseBody(
    hmisReportSchema,
    await http.get(`/reports/hmis-105${query(params)}`, { signal }),
    'HMIS 105 report',
  );
}

// Hotspots ------------------------------------------------------------------

const hotspotCountsSchema = z.object({
  total: count,
  active: count,
  submitted: count,
  rejected: count,
  deactivated: count,
  with_dispenser: count,
  located: count,
  open_requests: count,
});
const hotspotGroupSchema = hotspotCountsSchema.extend({
  id: z.string().nullable(),
  name: z.string().nullable(),
});
export type HotspotGroup = z.infer<typeof hotspotGroupSchema>;

const hotspotReportSchema = z.object({
  data_updated_at: z.string(),
  total: hotspotCountsSchema,
  by_region: z.array(hotspotGroupSchema),
  by_district: z.array(hotspotGroupSchema),
  by_type: z.array(hotspotGroupSchema),
  dispensers: z.array(hotspotGroupSchema),
  registrations: z.array(z.object({ month: z.string(), registered: count, activated: count })),
});
export type HotspotReport = z.infer<typeof hotspotReportSchema>;

export async function getHotspotReport(
  http: HttpClient,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<HotspotReport> {
  return parseBody(
    hotspotReportSchema,
    await http.get(`/reports/hotspots${query(params)}`, { signal }),
    'hotspot report',
  );
}
