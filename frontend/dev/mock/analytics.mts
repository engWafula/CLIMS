/**
 * The Go API's programme reports (`/api/v1/reports/*`, docs/modules/reports.md)
 * over a year of generated activity, so the dashboards and the report section
 * can be built and tested without a backend. The activity is deterministic
 * (a seeded generator), and every report is calculated from the same records,
 * so a trend adds up to its report's total as the real API's does.
 *
 *   MOCK_DATA=demo  a year of requests, orders, deliveries, stock and batches
 *   MOCK_DATA=empty nothing recorded yet: every report is empty or zero
 *   MOCK_DATA=worst long names and very large quantities
 */
import type { Reply } from './fulfilment.mts';
import { DISTRICTS_BY_REGION, MOCK_STORES, REGIONS } from './hotspots.mts';

type Body = Record<string, unknown>;

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });
const fail = (status: number, message: string): Reply => ({
  status,
  body: { success: false, message },
});

const DAY = 86_400_000;

/** A small seeded generator (mulberry32), so the activity is the same on every start. */
function generator(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Notification {
  id: string;
  district_id: string;
  district: string;
  hot_spot: string;
  selection: 'male' | 'female' | 'both';
  raised: number;
  fulfilled: number | null;
  rejected: number | null;
  delivered: number | null;
  acknowledged: number | null;
  male_pieces: number;
  female_pieces: number;
}

interface Order {
  id: string;
  warehouse_id: string;
  warehouse: string;
  district_id: string;
  district: string;
  category: 'male' | 'female';
  created: number;
  requested: number;
  approved: number | null;
  issued: number | null;
  received: number | null;
  received_at: number | null;
  status: 'queued' | 'confirmed' | 'dispatched' | 'received' | 'rejected';
}

interface Batch {
  id: string;
  store_id: string;
  store: string;
  store_type: 'national' | 'district';
  district_id: string | null;
  product: string;
  category: 'male' | 'female';
  batch_number: string | null;
  expiry: number | null;
  pieces: number;
}

interface State {
  notifications: Notification[];
  orders: Order[];
  receipts: { store_id: string; at: number; pieces: number; category: 'male' | 'female' }[];
  batches: Batch[];
}

const WAREHOUSES = MOCK_STORES.filter((store) => store.store_type === 'national');
const DISTRICT_STORES = MOCK_STORES.filter((store) => store.store_type === 'district');
const PRODUCTS = [
  { name: 'ULINZI Free Male', category: 'male' as const },
  { name: 'Orange Free Female', category: 'female' as const },
  { name: 'Life Guard Socially marketed Male', category: 'male' as const },
];

let dataset = 'demo';
let state: State = { notifications: [], orders: [], receipts: [], batches: [] };

function startOfToday(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function generate(kind: string): State {
  if (kind === 'empty') return { notifications: [], orders: [], receipts: [], batches: [] };
  const random = generator(20261124);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const scale = kind === 'worst' ? 4000 : 1;
  const today = startOfToday();
  const start = today - 365 * DAY;
  const now = Date.now();
  const notifications: Notification[] = [];
  const orders: Order[] = [];
  const receipts: State['receipts'] = [];

  for (const [index, store] of DISTRICT_STORES.entries()) {
    const busy = 0.25 + (index % 4) * 0.12; // some districts report far more than others
    for (let day = start; day < today + DAY; day += DAY) {
      // Hotspot stockout requests: more in the recent months, as CLIMS adoption grew.
      const growth = 0.4 + 0.6 * ((day - start) / (today - start));
      if (random() < busy * growth) {
        const raised = day + Math.floor(random() * DAY * 0.9);
        const selection = pick(['male', 'male', 'female', 'both'] as const);
        const age = (now - raised) / 3_600_000;
        const response = 6 + random() * 240;
        const rejectedRoll = random() < 0.05;
        const delivered =
          !rejectedRoll && age > response * 0.6 ? raised + response * 0.6 * 3_600_000 : null;
        const acknowledged = delivered && age > response ? raised + response * 3_600_000 : null;
        const pieces = Math.round((100 + random() * 900) / 50) * 50 * scale;
        notifications.push({
          id: `n-${String(notifications.length + 1)}`,
          district_id: store.district_id,
          district: store.district_name,
          hot_spot: `${pick(['Club', 'Lodge', 'Bar', 'Guest house'])} ${String(notifications.length + 1)}`,
          selection,
          raised,
          fulfilled: acknowledged && random() > 0.08 ? acknowledged : null,
          rejected: rejectedRoll ? raised + 12 * 3_600_000 : null,
          delivered,
          acknowledged,
          male_pieces: selection === 'female' ? 0 : pieces,
          female_pieces: selection === 'male' ? 0 : Math.round(pieces / 2),
        });
      }
      // District orders to the warehouses: about every two weeks.
      if (random() < 0.07) {
        const created = day + Math.floor(random() * DAY * 0.8);
        const age = (now - created) / DAY;
        const requested = Math.round((1000 + random() * 9000) / 100) * 100 * scale;
        const warehouse = pick(WAREHOUSES);
        const rejected = random() < 0.06;
        const approved =
          rejected || age < 1 ? null : Math.round(requested * (0.8 + random() * 0.2));
        const issued = approved !== null && age > 3 ? approved : null;
        const receivedAt = issued !== null && age > 6 ? created + (4 + random() * 5) * DAY : null;
        const received = receivedAt ? Math.round((issued ?? 0) * (0.95 + random() * 0.05)) : null;
        orders.push({
          id: `o-${String(orders.length + 1)}`,
          warehouse_id: warehouse.id,
          warehouse: warehouse.name,
          district_id: store.district_id,
          district: store.district_name,
          category: random() < 0.7 ? 'male' : 'female',
          created,
          requested,
          approved,
          issued,
          received,
          received_at: receivedAt,
          status: rejected
            ? 'rejected'
            : received
              ? 'received'
              : issued
                ? 'dispatched'
                : approved
                  ? 'confirmed'
                  : 'queued',
        });
      }
    }
  }
  // Supplier receipts at the warehouses, roughly monthly.
  for (let day = start; day < today; day += 30 * DAY) {
    for (const warehouse of WAREHOUSES) {
      receipts.push({
        store_id: warehouse.id,
        at: day + 5 * DAY,
        pieces: 400_000 * scale,
        category: 'male',
      });
      receipts.push({
        store_id: warehouse.id,
        at: day + 9 * DAY,
        pieces: 120_000 * scale,
        category: 'female',
      });
    }
  }
  // Batches in stock today, with expiries spread across the coming months and a few already past.
  const batches: Batch[] = [];
  const holders = [...WAREHOUSES, ...DISTRICT_STORES];
  for (const [index, store] of holders.entries()) {
    const count = store.store_type === 'national' ? 5 : 2;
    for (let n = 0; n < count; n += 1) {
      const product = PRODUCTS[(index + n) % PRODUCTS.length] ?? PRODUCTS[0];
      const months = [-1, 0.5, 2, 4.5, 9, 14, 20][(index * 3 + n) % 7] ?? 9;
      const known = (index + n) % 9 !== 4;
      batches.push({
        id: `b-${String(batches.length + 1)}`,
        store_id: store.id,
        store: store.name,
        store_type: store.store_type,
        district_id: store.district_id,
        product: product?.name ?? 'ULINZI Free Male',
        category: product?.category ?? 'male',
        batch_number: known ? `QWA${String(1600 + batches.length)}` : null,
        expiry: known ? today + Math.round(months * 30.4) * DAY : null,
        pieces:
          (store.store_type === 'national'
            ? 80_000 + Math.round(random() * 200_000)
            : 200 + Math.round(random() * 3000)) * scale,
      });
    }
  }
  return { notifications, orders, receipts, batches };
}

export function seedAnalytics(name: string): void {
  dataset = name;
  state = generate(name);
}

// Periods ---------------------------------------------------------------------------------------

interface Filter {
  from: number;
  to: number; // exclusive
  district: string | null;
  category: string | null;
  warehouse: string | null;
  store: string | null;
  storeType: string | null;
}

function day(text: string | null, fallback: number): number {
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : fallback;
}

function readFilter(query: URLSearchParams, defaultMonths = 0): Filter {
  const today = startOfToday();
  const to = day(query.get('to'), today) + DAY;
  const first = new Date(to - DAY);
  const from = day(
    query.get('from'),
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - defaultMonths, 1),
  );
  return {
    from,
    to,
    district: query.get('district_id'),
    category: query.get('category'),
    warehouse: query.get('warehouse_store_id'),
    store: query.get('store_id'),
    storeType: query.get('store_type'),
  };
}

const iso = (time: number) => new Date(time).toISOString();
const dateOnly = (time: number) => iso(time).slice(0, 10);
const period = (f: Filter) => ({ from: dateOnly(f.from), to: dateOnly(f.to - DAY) });
const rate = (part: number, whole: number) =>
  whole > 0 ? Math.round((part * 1000) / whole) / 10 : null;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function status(n: Notification): string {
  if (n.fulfilled) return 'fulfilled';
  if (n.rejected) return 'rejected';
  if (n.acknowledged) return 'partly_received';
  if (n.delivered) return 'awaiting_acknowledgement';
  return 'awaiting_supply';
}

function notificationsIn(f: Filter, inPeriod = true): Notification[] {
  return state.notifications.filter(
    (n) =>
      (!inPeriod || (n.raised >= f.from && n.raised < f.to)) &&
      (!f.district || n.district_id === f.district) &&
      (!f.category || n.selection === f.category || n.selection === 'both'),
  );
}

function ordersIn(f: Filter): Order[] {
  return state.orders.filter(
    (o) =>
      o.created >= f.from &&
      o.created < f.to &&
      (!f.district || o.district_id === f.district) &&
      (!f.category || o.category === f.category) &&
      (!f.warehouse || o.warehouse_id === f.warehouse),
  );
}

// Reports ----------------------------------------------------------------------------------------

function notificationReport(f: Filter) {
  const now = Date.now();
  const rows = notificationsIn(f);
  const deadline = 7 * DAY;
  const by = (s: string) => rows.filter((n) => status(n) === s).length;
  const fulfilled = rows.filter((n) => n.fulfilled);
  const open = rows.filter((n) => !n.fulfilled && !n.rejected);
  const backlog = notificationsIn({ ...f, to: f.from, from: 0 }).filter(
    (n) => !n.fulfilled && !n.rejected,
  );
  const onTime = fulfilled.filter((n) => (n.fulfilled ?? 0) - n.raised <= deadline).length;
  const districts = new Map<
    string,
    { id: string; name: string; raised: number; fulfilled: number }
  >();
  for (const n of rows) {
    const entry = districts.get(n.district_id) ?? {
      id: n.district_id,
      name: n.district,
      raised: 0,
      fulfilled: 0,
    };
    entry.raised += 1;
    if (n.fulfilled) entry.fulfilled += 1;
    districts.set(n.district_id, entry);
  }
  const onTimeRate = rate(onTime, rows.length);
  return {
    period: period(f),
    data_updated_at: iso(now),
    acknowledgements_through: iso(now),
    category: f.category,
    notifications_raised: rows.length,
    by_selection: {
      male: rows.filter((n) => n.selection === 'male').length,
      female: rows.filter((n) => n.selection === 'female').length,
      both: rows.filter((n) => n.selection === 'both').length,
    },
    notifications_fulfilled: fulfilled.length,
    partly_received: by('partly_received'),
    awaiting_acknowledgement: by('awaiting_acknowledgement'),
    awaiting_supply: by('awaiting_supply'),
    notifications_rejected: by('rejected'),
    fulfilment_rate: rate(fulfilled.length, rows.length),
    component: null,
    response: {
      median_hours: median(fulfilled.map((n) => ((n.fulfilled ?? 0) - n.raised) / 3_600_000)),
      fulfilled_included: fulfilled.length,
      pending: open.length,
      oldest_pending_hours: open.length
        ? (now - Math.min(...open.map((n) => n.raised))) / 3_600_000
        : null,
    },
    deadline: {
      days: 7,
      target_percent: 80,
      fulfilled_on_time: onTime,
      on_time_rate: onTimeRate,
      target_met: onTimeRate === null ? null : onTimeRate >= 80,
      late_pending: open.filter((n) => now - n.raised > deadline).length,
    },
    backlog: {
      open: backlog.length,
      oldest_raised_at: backlog.length ? iso(Math.min(...backlog.map((n) => n.raised))) : null,
    },
    acknowledgement_overdue: rows.filter(
      (n) => n.delivered && !n.acknowledged && now - n.delivered > deadline,
    ).length,
    districts: [...districts.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({
        district_id: d.id,
        district: d.name,
        notifications_raised: d.raised,
        notifications_fulfilled: d.fulfilled,
        fulfilment_rate: rate(d.fulfilled, d.raised),
      })),
    settings: { review_cycle: 'monthly', deadline_days: 7, target_percent: 80, source: 'default' },
  };
}

function totals(rows: Order[]) {
  const requested = rows.reduce((s, o) => s + o.requested, 0);
  const acknowledged = rows.reduce((s, o) => s + (o.received ?? 0), 0);
  return {
    requests: rows.length,
    requested_pieces: requested,
    approved_pieces: rows.reduce((s, o) => s + (o.approved ?? 0), 0),
    issued_pieces: rows.reduce((s, o) => s + (o.issued ?? 0), 0),
    acknowledged_pieces: acknowledged,
    quantity_fulfilment_rate: rate(acknowledged, requested),
    fully_received: rows.filter((o) => o.received !== null && o.received >= o.requested).length,
    partly_received: rows.filter((o) => o.received !== null && o.received < o.requested).length,
    pending: rows.filter((o) => o.received === null && o.status !== 'rejected').length,
    rejected: rows.filter((o) => o.status === 'rejected').length,
    unconverted: 0,
    awaiting_unit: 0,
  };
}

function groupOrders(rows: Order[], key: (o: Order) => [string, string]) {
  const groups = new Map<string, { name: string; rows: Order[] }>();
  for (const o of rows) {
    const [id, name] = key(o);
    const entry = groups.get(id) ?? { name, rows: [] };
    entry.rows.push(o);
    groups.set(id, entry);
  }
  return [...groups.entries()]
    .map(([id, g]) => ({ id, name: g.name, ...totals(g.rows) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function supplyReport(f: Filter) {
  const rows = ordersIn(f);
  const received = rows.filter((o) => o.received_at);
  const open = rows.filter((o) => o.received === null && o.status !== 'rejected');
  return {
    period: period(f),
    data_updated_at: iso(Date.now()),
    total: totals(rows),
    by_type: groupOrders(rows, (o) => [o.category, o.category === 'male' ? 'Male' : 'Female']),
    by_warehouse: groupOrders(rows, (o) => [o.warehouse_id, o.warehouse]),
    by_district: groupOrders(rows, (o) => [o.district_id, o.district]),
    response: {
      median_hours: median(received.map((o) => ((o.received_at ?? 0) - o.created) / 3_600_000)),
      fulfilled_included: received.length,
      pending: open.length,
      oldest_pending_hours: open.length
        ? (Date.now() - Math.min(...open.map((o) => o.created))) / 3_600_000
        : null,
    },
    dispatches_without_request: {
      dispatches: 0,
      issued_pieces: 0,
      received_pieces: 0,
      awaiting_receipt: 0,
    },
  };
}

function batchesIn(f: Filter) {
  const today = startOfToday();
  return state.batches
    .filter(
      (b) =>
        (!f.store || b.store_id === f.store) &&
        (!f.storeType || b.store_type === f.storeType) &&
        (!f.district || b.district_id === f.district) &&
        (!f.category || b.category === f.category),
    )
    .map((b) => {
      const days = b.expiry === null ? null : Math.round((b.expiry - today) / DAY);
      const band =
        days === null
          ? 'unknown'
          : days < 0
            ? 'expired'
            : days < 30
              ? 'under_1_month'
              : days < 91
                ? 'under_3_months'
                : days < 182
                  ? 'under_6_months'
                  : 'ok';
      return {
        id: b.id,
        store_id: b.store_id,
        store: b.store,
        store_type: b.store_type,
        district_id: b.district_id,
        condom_id: b.product,
        product: b.product,
        category: b.category,
        unit_of_measure_id: 'pieces',
        unit: 'Pieces',
        batch_number: b.batch_number,
        expiry_date: b.expiry === null ? null : `${dateOnly(b.expiry)}T00:00:00Z`,
        days_remaining: days,
        band,
        on_hand: b.pieces,
        pieces: b.pieces,
      };
    })
    .sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999'));
}

function stockReport(f: Filter) {
  const lines = new Map<
    string,
    Record<string, unknown> & { physical: number; usable: number; expired: number; unknown: number }
  >();
  for (const b of batchesIn(f)) {
    const key = `${b.store_id}|${b.product}`;
    const store = MOCK_STORES.find((s) => s.id === b.store_id);
    const entry = lines.get(key) ?? {
      store_id: b.store_id,
      store: b.store,
      store_type: b.store_type,
      district_id: b.district_id,
      district: store?.district_name ?? null,
      condom_id: b.product,
      product: b.product,
      category: b.category,
      unit_of_measure_id: 'pieces',
      unit: 'Pieces',
      physical: 0,
      usable: 0,
      expired: 0,
      unknown: 0,
    };
    entry.physical += b.on_hand;
    if (b.band === 'expired') entry.expired += b.on_hand;
    else if (b.band === 'unknown') entry.unknown += b.on_hand;
    else entry.usable += b.on_hand;
    lines.set(key, entry);
  }
  return {
    stock_date: iso(Date.now()),
    coverage_window: period(readFilter(new URLSearchParams(), 3)),
    coverage_method:
      'Usable stock divided by average monthly outward issues (warehouse dispatches to districts, district deliveries to hotspots) over the coverage window. Issue-based coverage; it does not measure consumption.',
    expiry_tracked: true,
    lines: [...lines.values()].map((line, index) => {
      const monthly =
        line.store_type === 'national' ? 60_000 + (index % 5) * 25_000 : 300 + (index % 7) * 250;
      const months = Math.round((line.usable / monthly) * 10) / 10;
      return {
        ...line,
        reserved: 0,
        unknown_expiry: line.unknown,
        in_transit: index % 6 === 0 ? 1200 : 0,
        physical_pieces: line.physical,
        usable_pieces: line.usable,
        in_transit_pieces: index % 6 === 0 ? 1200 : 0,
        reconciled: index % 17 !== 3,
        batches_reconciled: true,
        average_monthly_issues: monthly,
        months_of_stock: months,
        coverage_status: 'available',
      };
    }),
  };
}

function trendReport(query: URLSearchParams) {
  const f = readFilter(query, 5);
  const days = (f.to - f.from) / DAY;
  const interval = query.get('interval') ?? (days <= 31 ? 'day' : days <= 92 ? 'week' : 'month');
  if (!['day', 'week', 'month'].includes(interval))
    return fail(400, 'interval must be day, week or month');
  const startOf = (time: number) => {
    const d = new Date(time);
    if (interval === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return interval === 'week' ? midnight - ((d.getUTCDay() + 6) % 7) * DAY : midnight;
  };
  const next = (time: number) => {
    const d = new Date(time);
    return interval === 'month'
      ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
      : time + (interval === 'week' ? 7 : 1) * DAY;
  };
  const buckets: Record<string, unknown>[] = [];
  for (let start = startOf(f.from); start < f.to; start = next(start)) {
    if (buckets.length >= 400)
      return fail(
        400,
        'the period has too many buckets for this interval; choose a wider interval',
      );
    const slice = { ...f, from: Math.max(start, f.from), to: Math.min(next(start), f.to) };
    const raised = notificationsIn(slice);
    const fulfilled = raised.filter((n) => n.fulfilled);
    const orders = ordersIn(slice);
    const delivered = notificationsIn({ ...f, from: 0, to: Infinity }, false).filter(
      (n) => n.delivered !== null && n.delivered >= slice.from && n.delivered < slice.to,
    );
    const receipts = state.receipts.filter(
      (r) =>
        r.at >= slice.from &&
        r.at < slice.to &&
        (!f.category || r.category === f.category) &&
        (!f.store || r.store_id === f.store),
    );
    const issuedInSlice = state.orders.filter(
      (o) =>
        o.issued !== null &&
        o.created + 3 * DAY >= slice.from &&
        o.created + 3 * DAY < slice.to &&
        (!f.store || o.warehouse_id === f.store),
    );
    const malePieces = delivered.reduce((s, n) => s + n.male_pieces, 0);
    const femalePieces = delivered.reduce((s, n) => s + n.female_pieces, 0);
    buckets.push({
      start: dateOnly(start),
      notifications: {
        raised: raised.length,
        fulfilled: fulfilled.length,
        rejected: raised.filter((n) => n.rejected).length,
        fulfilment_rate: rate(fulfilled.length, raised.length),
        median_response_hours: median(
          fulfilled.map((n) => ((n.fulfilled ?? 0) - n.raised) / 3_600_000),
        ),
      },
      requests: {
        requests: orders.length,
        requested_pieces: orders.reduce((s, o) => s + o.requested, 0),
        approved_pieces: orders.reduce((s, o) => s + (o.approved ?? 0), 0),
        issued_pieces: orders.reduce((s, o) => s + (o.issued ?? 0), 0),
        acknowledged_pieces: orders.reduce((s, o) => s + (o.received ?? 0), 0),
      },
      deliveries: {
        deliveries: delivered.length,
        male_pieces: malePieces,
        female_pieces: femalePieces,
        acknowledged_pieces: delivered
          .filter((n) => n.acknowledged)
          .reduce((s, n) => s + n.male_pieces + n.female_pieces, 0),
      },
      stock: {
        received_pieces: receipts.reduce((s, r) => s + r.pieces, 0),
        dispatched_pieces: issuedInSlice.reduce((s, o) => s + (o.issued ?? 0), 0),
        district_received_pieces: issuedInSlice.reduce((s, o) => s + (o.received ?? 0), 0),
        delivered_pieces: malePieces + femalePieces,
        adjusted_pieces: 0,
      },
    });
  }
  return ok({ period: period(f), interval, data_updated_at: iso(Date.now()), buckets });
}

function hotspotReport(query: URLSearchParams) {
  const region = query.get('region_id');
  const district = query.get('district_id');
  const empty = dataset === 'empty';
  const districts = DISTRICTS_BY_REGION.filter(
    (d) => (!region || d.region_id === region) && (!district || d.id === district),
  );
  const counts = (seed: number) => {
    const total = empty ? 0 : 120 + ((seed * 7919) % 900);
    const active = Math.round(total * 0.93);
    return {
      total,
      active,
      submitted: Math.round(total * 0.02),
      rejected: Math.round(total * 0.01),
      deactivated: total - active - Math.round(total * 0.03),
      with_dispenser: Math.round(total * 0.31),
      located: Math.round(total * 0.66),
      open_requests: empty ? 0 : seed % 4,
    };
  };
  const byDistrict = districts.map((d, index) => ({
    id: d.id,
    name: `${d.name} District`,
    ...counts(index + 3),
  }));
  const sum = (rows: ReturnType<typeof counts>[]) =>
    rows.reduce(
      (acc, row) => {
        for (const key of Object.keys(acc) as (keyof typeof acc)[]) acc[key] += row[key];
        return acc;
      },
      {
        total: 0,
        active: 0,
        submitted: 0,
        rejected: 0,
        deactivated: 0,
        with_dispenser: 0,
        located: 0,
        open_requests: 0,
      },
    );
  const total = sum(byDistrict);
  const byRegion = REGIONS.map((r) => {
    const rows = byDistrict.filter(
      (d) => districts.find((x) => `${x.name} District` === d.name)?.region_id === r.id,
    );
    return { id: r.id, name: r.name, ...sum(rows) };
  }).filter((r) => r.total > 0);
  const share = (name: string, fraction: number) => ({
    id: null,
    name,
    ...Object.fromEntries(Object.entries(total).map(([k, v]) => [k, Math.round(v * fraction)])),
  });
  return ok({
    data_updated_at: iso(Date.now()),
    total,
    by_region: byRegion,
    by_district: byDistrict.sort((a, b) => b.total - a.total),
    by_type: total.total
      ? [
          share('Bar, pub or club', 0.34),
          share('Lodge', 0.2),
          share('Guest house', 0.16),
          share('Hotel or motel', 0.1),
          share('Transport stage', 0.06),
          share('Landing site', 0.04),
          share('Not recorded', 0.1),
        ]
      : [],
    dispensers: total.with_dispenser
      ? [
          share('Working', 0.27),
          share('Needs repair', 0.025),
          share('Empty', 0.008),
          share('Not recorded', 0.007),
        ]
      : [],
    registrations: Array.from({ length: 12 }, (_, index) => {
      const d = new Date(startOfToday());
      const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11 + index, 1));
      const registered = empty ? 0 : 40 + ((index * 37) % 90) * (index > 8 ? 3 : 1);
      return {
        month: iso(month.getTime()).slice(0, 7),
        registered,
        activated: Math.round(registered * 0.9),
      };
    }),
  });
}

function hmisReport(query: URLSearchParams) {
  const month = /^\d{4}-\d{2}$/.test(query.get('month') ?? '')
    ? (query.get('month') ?? '')
    : dateOnly(startOfToday()).slice(0, 7);
  const from = Date.parse(`${month}-01T00:00:00Z`);
  const to = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth() + 1, 1);
  const district = query.get('district_id');
  const acked = state.notifications.filter(
    (n) =>
      n.acknowledged !== null &&
      n.acknowledged >= from &&
      n.acknowledged < to &&
      (!district || n.district_id === district),
  );
  const groups = new Map<
    string,
    { district_id: string; district: string; female: number; male: number; count: number }
  >();
  for (const n of acked) {
    const entry = groups.get(n.district_id) ?? {
      district_id: n.district_id,
      district: n.district,
      female: 0,
      male: 0,
      count: 0,
    };
    entry.female += n.female_pieces;
    entry.male += n.male_pieces;
    entry.count += 1;
    groups.set(n.district_id, entry);
  }
  const rows = [...groups.values()].map((g) => ({
    district_id: g.district_id,
    district: g.district,
    subcounty_id: null,
    subcounty: null,
    ct11_female_pieces: g.female,
    ct12_male_pieces: g.male,
    acknowledgements: g.count,
    hotspots: g.count,
    unacknowledged_lines: 0,
  }));
  const add = (key: 'ct11_female_pieces' | 'ct12_male_pieces' | 'acknowledgements' | 'hotspots') =>
    rows.reduce((s, r) => s + r[key], 0);
  return ok({
    month,
    data_updated_at: iso(Date.now()),
    integration_enabled: false,
    pending_decisions: [
      'Counting event: whether an acknowledged delivery counts as dispensing.',
      'Dispensing channel: which of the four 2.4.2 channels community hotspot supply belongs to.',
      'Subcounty reporting units: approval and DHIS2 metadata before any submission.',
    ],
    total: {
      district_id: null,
      district: null,
      subcounty_id: null,
      subcounty: null,
      ct11_female_pieces: add('ct11_female_pieces'),
      ct12_male_pieces: add('ct12_male_pieces'),
      acknowledgements: add('acknowledgements'),
      hotspots: add('hotspots'),
      unacknowledged_lines: 2,
    },
    rows,
  });
}

/** A report's export table, as `/reports/export/{report}` returns it. */
function exportTable(report: string, query: URLSearchParams) {
  const f = readFilter(query, report === 'notifications' ? 0 : 0);
  const meta = {
    report,
    period: `${period(f).from} to ${period(f).to}`,
    data_updated_at: iso(Date.now()),
    scope: f.district ? 'One district' : 'National',
    product:
      f.category === 'male'
        ? 'Male condoms'
        : f.category === 'female'
          ? 'Female condoms'
          : 'Male and female condoms',
    rule_version: 'reporting-requirements-0.2-draft',
    filters: Object.fromEntries(query.entries()),
    definitions: [
      'A blank cell means not applicable or not recorded; 0 is a recorded zero. Times are Africa/Kampala.',
    ],
  };
  switch (report) {
    case 'notifications':
      return ok({
        ...meta,
        title: 'Notification fulfilment',
        columns: [
          { key: 'hot_spot', header: 'Hotspot' },
          { key: 'district', header: 'District' },
          { key: 'selection', header: 'Selection' },
          { key: 'status', header: 'Status' },
          { key: 'raised_at', header: 'Raised' },
          { key: 'response_hours', header: 'Response hours' },
        ],
        rows: notificationsIn(f)
          .filter((n) => !query.get('status') || status(n) === query.get('status'))
          .slice(-200)
          .reverse()
          .map((n) => ({
            hot_spot: n.hot_spot,
            district: n.district,
            selection: n.selection,
            status: status(n),
            raised_at: iso(n.raised),
            response_hours: n.fulfilled
              ? Math.round(((n.fulfilled - n.raised) / 3_600_000) * 10) / 10
              : null,
          })),
      });
    case 'warehouse-requests':
      return ok({
        ...meta,
        title: 'Warehouse requests',
        columns: [
          { key: 'warehouse', header: 'Warehouse' },
          { key: 'district', header: 'District' },
          { key: 'order_status', header: 'Status' },
          { key: 'requested_pieces', header: 'Requested pieces' },
          { key: 'issued_pieces', header: 'Issued pieces' },
          { key: 'received_pieces', header: 'Received pieces' },
        ],
        rows: ordersIn(f)
          .reverse()
          .map((o) => ({
            warehouse: o.warehouse,
            district: o.district,
            order_status: o.status,
            requested_pieces: o.requested,
            issued_pieces: o.issued,
            received_pieces: o.received,
          })),
      });
    case 'stock':
    case 'batches':
    case 'expiry-exceptions':
    case 'hmis-105': {
      const lines: Record<string, unknown>[] =
        report === 'stock'
          ? stockReport(f).lines
          : report === 'batches'
            ? batchesIn(f).filter((b) => !query.get('band') || b.band === query.get('band'))
            : [];
      return ok({
        ...meta,
        title: {
          stock: 'Store stock',
          batches: 'Batches and expiry',
          'expiry-exceptions': 'Expiry exceptions',
          'hmis-105': 'HMIS 105 readiness',
        }[report],
        columns: [
          { key: 'store', header: 'Store' },
          { key: 'product', header: 'Product' },
          {
            key: report === 'batches' ? 'band' : 'usable_pieces',
            header: report === 'batches' ? 'Band' : 'Usable pieces',
          },
        ],
        rows: lines.map((line) => ({
          store: typeof line.store === 'string' ? line.store : '',
          product: typeof line.product === 'string' ? line.product : '',
          [report === 'batches' ? 'band' : 'usable_pieces']:
            (report === 'batches' ? line.band : line.usable_pieces) ?? null,
        })),
      });
    }
    default:
      return fail(404, `There is no ${report} report.`);
  }
}

export function handleAnalytics(
  method: string,
  parts: readonly string[],
  _body: Body,
  query: URLSearchParams,
): Reply | null {
  const [resource = '', name = '', sub] = parts;
  if (resource !== 'reports' || method !== 'GET') return null;
  switch (name) {
    case 'notifications':
      return sub === 'records' ? ok([]) : ok(notificationReport(readFilter(query)));
    case 'warehouse-requests':
      return sub === 'records' ? ok([]) : ok(supplyReport(readFilter(query)));
    case 'stock':
      return ok(stockReport(readFilter(query)));
    case 'batches':
      return ok({
        stock_date: iso(Date.now()),
        rule_version: 'reporting-requirements-0.2-draft',
        lines: batchesIn(readFilter(query)).filter(
          (b) => !query.get('band') || b.band === query.get('band'),
        ),
      });
    case 'expiry-exceptions':
      return ok([]);
    case 'hmis-105':
      return hmisReport(query);
    case 'trends':
      return trendReport(query);
    case 'hotspots':
      return hotspotReport(query);
    case 'settings':
      return ok({
        effective: {
          id: null,
          store_id: null,
          review_cycle: 'monthly',
          deadline_days: 7,
          target_percent: 80,
          source: 'default',
        },
        history: [],
      });
    case 'versions':
      return ok([]);
    case 'export': {
      if (!sub) return fail(404, 'Not found');
      const table = exportTable(sub, query);
      if (query.get('format') !== 'csv' || table.status !== 200) return table;
      // The CSV the server sends: its information lines, then the headers and rows.
      const data = (
        table.body as {
          data: {
            title: string;
            period: string;
            columns: { key: string; header: string }[];
            rows: Record<string, unknown>[];
          };
        }
      ).data;
      const cell = (value: unknown) => {
        const text =
          typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const lines = [
        `Report,${cell(data.title)}`,
        `Period,${cell(data.period)}`,
        '',
        data.columns.map((column) => cell(column.header)).join(','),
        ...data.rows.map((row) => data.columns.map((column) => cell(row[column.key])).join(',')),
      ];
      return { status: 200, body: `\uFEFF${lines.join('\r\n')}\r\n` };
    }
    default:
      return null;
  }
}
