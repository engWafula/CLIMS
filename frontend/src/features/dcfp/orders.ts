import type { Step } from '@/components/StepTracker';
import type { StatusTone } from '@/lib/status';
import type { NavCounts } from '@/navigation/navigation';

import type { Order, OrderStatus, StockoutReport, Warehouse } from './api';

/** Paths of the DCFP screens. */
/**
 * Where a list of requests or orders links to, so the same screens serve the
 * DCFP's own district and MOH's national, read-only view of every district.
 */
export interface OrderLinks {
  list: string;
  detail: (id: string) => string;
  /** Every district's records: the list adds a District column and actions to raise orders are left out. */
  national?: boolean;
}

export const DCFP_PATHS = {
  dashboard: '/dcfp',
  stockouts: '/dcfp/stockouts',
  /** One hotspot's request: what it asked for, and the form to send it stock. */
  stockout: (reportId: string) => `/dcfp/stockouts/${encodeURIComponent(reportId)}`,
  orders: '/dcfp/restock',
  store: '/dcfp/restock/store',
  newOrder: '/dcfp/restock/new',
  /** The new-order form with the condom category of a stockout report chosen. */
  newOrderFor: (selection: string | null) =>
    selection === 'male' || selection === 'female'
      ? `/dcfp/restock/new?category=${selection}`
      : '/dcfp/restock/new',
  order: (id: string) => `/dcfp/restock/${encodeURIComponent(id)}`,
  hotspots: '/dcfp/hotspots',
  hotspot: (id: string) => `/dcfp/hotspots/${encodeURIComponent(id)}`,
} as const;

export const STOCKOUT_STATUS: Record<
  NonNullable<StockoutReport['status']>,
  { label: string; tone: StatusTone }
> = {
  awaiting_supply: { label: 'Awaiting supply', tone: 'negative' },
  awaiting_acknowledgement: { label: 'Awaiting receipt', tone: 'info' },
  partly_received: { label: 'Partly received', tone: 'caution' },
  fulfilled: { label: 'Fulfilled', tone: 'positive' },
  rejected: { label: 'Rejected', tone: 'negative' },
};

export type StockoutStatus = keyof typeof STOCKOUT_STATUS;

/** Fulfilled and rejected requests are closed: nothing more is sent against them. */
export function isStockoutClosed(status: StockoutStatus): boolean {
  return status === 'fulfilled' || status === 'rejected';
}

/** A report's status; one from before statuses existed has had nothing sent. */
export function stockoutStatus(report: Pick<StockoutReport, 'status'>): StockoutStatus {
  return report.status ?? 'awaiting_supply';
}

/**
 * The stockout list's filters. "Open" is everything the hotspot has not confirmed in full and the
 * district has not rejected.
 */
export const STOCKOUT_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'awaiting_supply', label: 'Awaiting supply' },
  { value: 'awaiting_acknowledgement', label: 'Awaiting receipt' },
  { value: 'partly_received', label: 'Partly received' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
] as const;

export type StockoutFilter = (typeof STOCKOUT_FILTERS)[number]['value'];

export function matchesStockoutFilter(report: StockoutReport, filter: StockoutFilter): boolean {
  const status = stockoutStatus(report);
  if (filter === 'all') return true;
  if (filter === 'open') return !isStockoutClosed(status);
  return status === filter;
}

/**
 * A request's progress: the hotspot reported, the district sent stock, the hotspot confirmed it.
 * Partly received marks the last step for attention: something sent has not been confirmed in full.
 * A rejected request stops at the district's decision, marked for attention, as a rejected order
 * does.
 */
export function stockoutSteps(status: StockoutStatus): Step[] {
  if (status === 'rejected') {
    return [
      { id: 'reported', label: 'Reported', state: 'done' },
      { id: 'sent', label: 'Rejected', state: 'attention' },
    ];
  }
  const sent = status !== 'awaiting_supply';
  return [
    { id: 'reported', label: 'Reported', state: 'done' },
    { id: 'sent', label: 'Stock sent', state: sent ? 'done' : 'current' },
    {
      id: 'received',
      label: 'Received by hotspot',
      state:
        status === 'fulfilled'
          ? 'done'
          : status === 'partly_received'
            ? 'attention'
            : sent
              ? 'current'
              : 'upcoming',
    },
  ];
}

/** What each status means to the DCFP who placed the order. */
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: StatusTone }> = {
  queued: { label: 'Sent', tone: 'info' },
  // The warehouse's review approves the order, all or part, for the product it chose.
  reviewed: { label: 'Approved', tone: 'info' },
  on_hold: { label: 'Waiting for stock', tone: 'caution' },
  confirmed: { label: 'Stock reserved', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'negative' },
  dispatched: { label: 'On the way', tone: 'caution' },
  received: { label: 'Received', tone: 'positive' },
  // Not used by warehouse orders; listed so every API status has a label.
  pending: { label: 'Pending', tone: 'neutral' },
  fulfilled: { label: 'Fulfilled', tone: 'positive' },
  delivered: { label: 'Delivered', tone: 'positive' },
};

/** Statuses where the order is still with the warehouse. */
const WITH_WAREHOUSE: ReadonlySet<OrderStatus> = new Set([
  'queued',
  'reviewed',
  'on_hold',
  'confirmed',
]);

/**
 * The DCFP's orders to NMS or JMS, newest first: orders from a national warehouse that are not
 * alert orders raised before stockouts became reports, nor generic store-to-store requests.
 */
export function warehouseOrders(
  orders: readonly Order[],
  warehouses: readonly Warehouse[],
): Order[] {
  const national = new Set(warehouses.map((warehouse) => warehouse.id));
  return orders.filter(
    (order) =>
      order.hot_spot_id === null &&
      national.has(order.ordered_from_store_id) &&
      order.order_status !== 'pending' &&
      order.order_status !== 'fulfilled',
  );
}

export function isWithWarehouse(order: Order): boolean {
  return WITH_WAREHOUSE.has(order.order_status);
}

/** "Male condoms" or "Female condoms", for an order whose product the warehouse has not chosen. */
export function categoryLabel(category: string | null): string | null {
  if (category === 'male') return 'Male condoms';
  if (category === 'female') return 'Female condoms';
  return null;
}

/** "NMS" or "JMS", or the store's name for any other warehouse. */
export function warehouseLabel(warehouse: Warehouse | undefined): string {
  if (!warehouse) return 'Warehouse';
  return ['nms', 'jms'].includes(warehouse.code) ? warehouse.code.toUpperCase() : warehouse.name;
}

/** The index of the last step done at each status; on hold, the order has been reviewed. */
const STEPS_DONE: Partial<Record<OrderStatus, number>> = {
  queued: 0,
  reviewed: 1,
  on_hold: 1,
  confirmed: 2,
  dispatched: 3,
  received: 4,
};

/**
 * The order's progress for the step tracker. A held order is marked for attention on the
 * stock check, since it waits there until the warehouse has the stock. A rejected order stops
 * at the warehouse's decision, marked for attention, since it goes no further. Stock the warehouse
 * sent without an order has only the dispatch and the receipt.
 */
export function orderSteps(status: OrderStatus, unrequested = false): Step[] {
  // The warehouse sent this stock without an order: it arrives to be counted, nothing more.
  if (unrequested) {
    return [
      { id: 'dispatched', label: 'Sent by the warehouse', state: 'done' },
      { id: 'received', label: 'Received', state: status === 'received' ? 'done' : 'current' },
    ];
  }
  if (status === 'rejected') {
    return [
      { id: 'sent', label: 'Sent to warehouse', state: 'done' },
      { id: 'reviewed', label: 'Rejected', state: 'attention' },
    ];
  }
  const reached = STEPS_DONE[status] ?? -1;
  const steps = [
    { id: 'sent', label: 'Sent to warehouse' },
    { id: 'reviewed', label: 'Approved' },
    {
      id: 'stock',
      label: status === 'on_hold' ? 'Waiting for stock' : 'Stock reserved',
      detail: status === 'on_hold' ? 'The warehouse is out of this product' : undefined,
    },
    { id: 'dispatched', label: 'Dispatched' },
    { id: 'received', label: 'Received' },
  ];
  return steps.map((step, index): Step => {
    if (index <= reached) return { ...step, state: 'done' };
    if (index === reached + 1)
      return { ...step, state: status === 'on_hold' ? 'attention' : 'current' };
    return { ...step, state: 'upcoming' };
  });
}

/** What each recorded step reads as in the order's history. */
export function eventLabel(action: string, status: OrderStatus): string {
  switch (action) {
    case 'replenishment_requested':
      return 'Order sent to the warehouse';
    case 'review':
      return 'Approved by the warehouse';
    case 'reject':
      return 'Rejected by the warehouse';
    case 'check-stock':
      return status === 'on_hold'
        ? 'Stock checked: waiting for stock'
        : 'Stock checked and reserved';
    case 'dispatch':
      return 'Dispatched by the warehouse';
    case 'receive':
      return 'Received at the district store';
    default:
      return action.replaceAll(/[-_]/g, ' ');
  }
}

/** Whole pieces, or null for anything else. */
export function parseCount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export interface ReceiptErrors {
  quantity?: string;
  note?: string;
}

/** The receipt's problems, mirroring the API: a whole count, and a note when it differs. */
export function receiptErrors(quantity: string, issued: number, note: string): ReceiptErrors {
  const counted = parseCount(quantity);
  if (counted === null) return { quantity: 'Enter the number counted, as a whole number.' };
  if (counted !== issued && note.trim() === '') {
    return { note: 'Say why the count differs from what was dispatched.' };
  }
  return {};
}

/** A stockout report's place, e.g. "Kisenyi, Central, Kampala". */
export function placeOf(report: StockoutReport): string {
  const { village, subcounty, district } = report.hot_spot;
  return [village, subcounty, district].filter((part) => part?.trim()).join(', ');
}

/** The hotspot's contact as one line, e.g. "Peter Okello · 0700 123456". */
export function contactOf(report: StockoutReport): string {
  const { contact_name: name, contact_phone: phone } = report.hot_spot;
  return [name, phone].filter((part) => part?.trim()).join(' · ');
}

/** Reports in the last `days` days. */
export function recentReports(
  reports: readonly StockoutReport[],
  now: Date,
  days = 7,
): StockoutReport[] {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  return reports.filter((report) => Date.parse(report.created_at) >= since);
}

/**
 * The sidebar badges: orders the warehouse has dispatched, waiting to be received, and
 * unread stockout notifications.
 */
export function dcfpCounts(
  orders: readonly Order[] | undefined,
  unreadStockouts: number | undefined,
): NavCounts {
  return {
    // Alert orders raised before stockouts became reports went to riders, not to the DCFP.
    [DCFP_PATHS.orders]: orders?.filter(
      (order) => order.order_status === 'dispatched' && order.hot_spot_id === null,
    ).length,
    [DCFP_PATHS.stockouts]: unreadStockouts,
  };
}

export interface DcfpTask {
  id: string;
  status: { label: string; tone: StatusTone };
  title: string;
  detail: string;
  action: string;
  href: string;
}

/**
 * What needs the DCFP, in the order it needs doing: record receipts for stock that has
 * arrived, then answer the week's stockout reports. A report drops off once the district has sent
 * the hotspot stock, or ordered that product since it came in.
 */
export function dcfpTasks(
  reports: readonly StockoutReport[],
  orders: readonly Order[],
  names: {
    product: (id: string | null, category: string | null) => string;
    warehouse: (id: string) => string;
  },
  now: Date,
  formatTime: (iso: string) => string,
): DcfpTask[] {
  const tasks: DcfpTask[] = orders
    .filter((order) => order.order_status === 'dispatched')
    .map((order) => ({
      id: `receive-${order.id}`,
      status: ORDER_STATUS.dispatched,
      title: `${names.product(order.condom_id, order.condom_category)} from ${names.warehouse(order.ordered_from_store_id)}`,
      detail: `Dispatched ${formatTime(order.updated_at)}. Count it and record the receipt.`,
      action: 'Record receipt',
      href: DCFP_PATHS.order(order.id),
    }));
  for (const report of recentReports(reports, now)) {
    // Once stock is on its way, the hotspot's confirmation is the next step, not the DCFP's.
    if (stockoutStatus(report) !== 'awaiting_supply') continue;
    const reported = Date.parse(report.created_at);
    const answered = orders.some(
      (order) =>
        (report.selection === 'both' || order.condom_category === report.selection) &&
        Date.parse(order.created_at) >= reported,
    );
    if (answered) continue;
    tasks.push({
      id: `stockout-${report.id}`,
      status: { label: 'Stockout', tone: 'negative' },
      title: `${report.hot_spot.name} is out of ${report.product}`,
      detail: [report.comment, `Reported ${formatTime(report.created_at)} by ${report.reported_by}`]
        .filter(Boolean)
        .join(' · '),
      action: 'Manage request',
      href: DCFP_PATHS.stockout(report.id),
    });
  }
  return tasks;
}

/** Who the list or record is shown to: the DCFP's own district, or MOH's national read-only view. */
export type OrderScope = 'district' | 'national';

/** Where hotspot stockout requests link to, by scope. */
export function stockoutLinks(scope: OrderScope = 'district'): OrderLinks {
  return scope === 'national'
    ? {
        list: '/moh/orders',
        detail: (id) => `/moh/orders/${encodeURIComponent(id)}`,
        national: true,
      }
    : { list: DCFP_PATHS.stockouts, detail: DCFP_PATHS.stockout };
}

/** Where district orders to the warehouses link to, by scope. */
export function orderLinks(scope: OrderScope = 'district'): OrderLinks {
  return scope === 'national'
    ? {
        list: '/moh/orders/warehouse',
        detail: (id) => `/moh/orders/warehouse/${encodeURIComponent(id)}`,
        national: true,
      }
    : { list: DCFP_PATHS.orders, detail: DCFP_PATHS.order };
}
