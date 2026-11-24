import type { ProductSummary, StoreSummary } from '@/features/inventory/api';
import { formatNumber } from '@/lib/format';

/*
 * The warehouse stock page's figures, from GET /inventory/store-summary. Stock levels are as of
 * now; what was received and dispatched, and how district orders went, cover a period chosen on
 * the page. Stock is handled in pieces, which the figures leave unnamed. Units differ in size (a
 * carton holds many boxes), so an old record in another unit is listed beside the pieces, named,
 * and never added to them.
 */

export const PERIODS = [
  { value: '30d', label: 'Last 30 days', phrase: 'last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', phrase: 'last 90 days', days: 90 },
  { value: '12m', label: 'Last 12 months', phrase: 'last 12 months', days: 365 },
] as const;

export type Period = (typeof PERIODS)[number]['value'];

export function periodFrom(param: string | null): Period {
  return PERIODS.find((period) => period.value === param)?.value ?? '30d';
}

export function periodPhrase(period: Period): string {
  return PERIODS.find((candidate) => candidate.value === period)?.phrase ?? 'last 30 days';
}

/** The period's first and last days, both included; `today` is YYYY-MM-DD. */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  const days = PERIODS.find((candidate) => candidate.value === period)?.days ?? 30;
  const [year = 0, month = 1, day = 1] = today.split('-').map(Number);
  const from = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  return { from: from.toISOString().slice(0, 10), to: today };
}

export interface UnitAmount {
  unit: string;
  quantity: number;
}

/** A figure totalled per unit, largest first; units with nothing are left out. */
export function totalsByUnit(
  products: readonly ProductSummary[],
  pick: (product: ProductSummary) => number,
): UnitAmount[] {
  const totals = new Map<string, number>();
  for (const product of products) {
    totals.set(product.unit, (totals.get(product.unit) ?? 0) + pick(product));
  }
  return [...totals.entries()]
    .filter(([, quantity]) => quantity !== 0)
    .map(([unit, quantity]) => ({ unit, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.unit.localeCompare(b.unit));
}

/** "3,770 Box", "3,770 Box · 400 Carton", or `none` when there is nothing. */
export function formatAmounts(amounts: readonly UnitAmount[], none = '0'): string {
  if (amounts.length === 0) return none;
  return amounts.map((amount) => `${formatNumber(amount.quantity)} ${amount.unit}`).join(' · ');
}

/** Stock is handled in pieces, so a figure in pieces needs no unit after it. */
export function isPieces(unit: string): boolean {
  return /^pieces?$/i.test(unit.trim());
}

/** What follows a figure: nothing for pieces, " Carton" for any other unit an old record holds. */
export function unitSuffix(unit: string): string {
  return isPieces(unit) ? '' : ` ${unit}`;
}

/** A product's name, with its unit only when that is not pieces: "Male condoms, Carton". */
export function productName(product: string, unit: string): string {
  return isPieces(unit) ? product : `${product}, ${unit}`;
}

/** Figures for the stock screens: "3,770", "3,770 · 400 Carton", or `none` when there is nothing. */
export function formatStock(amounts: readonly UnitAmount[], none = '0'): string {
  if (amounts.length === 0) return none;
  return amounts
    .map((amount) => `${formatNumber(amount.quantity)}${unitSuffix(amount.unit)}`)
    .join(' · ');
}

type Orders = StoreSummary['orders'];

/** Orders waiting on the warehouse: new, waiting for stock, or to dispatch. */
export function pendingOrders(orders: Orders): number {
  return orders.to_decide + orders.waiting_for_stock + orders.to_dispatch;
}

/** "2 new · 1 to dispatch", in the words of the requests page's filters, leaving out none. */
export function pendingBreakdown(orders: Orders): string {
  const parts = [
    [orders.to_decide, 'new'],
    [orders.to_dispatch, 'to dispatch'],
    [orders.waiting_for_stock, 'waiting for stock'],
  ] as const;
  const shown = parts.filter(([count]) => count > 0);
  if (shown.length === 0) return 'Nothing is waiting on the warehouse';
  return shown.map(([count, words]) => `${formatNumber(count)} ${words}`).join(' · ');
}

/**
 * Of the orders the warehouse closed in the period, the share it dispatched rather than rejected;
 * null when it closed none.
 */
export function successRate(orders: Orders): number | null {
  const closed = orders.dispatched + orders.rejected;
  return closed === 0 ? null : orders.dispatched / closed;
}

/** "86%"; a rate just short of all of them never rounds up to 100%. */
export function formatPercent(rate: number): string {
  const rounded = Math.round(rate * 100);
  return `${String(rate < 1 && rounded === 100 ? 99 : rounded)}%`;
}

const plural = (count: number, one: string, many: string) =>
  `${formatNumber(count)} ${count === 1 ? one : many}`;

/** What sits behind the success rate, in words. */
export function successBreakdown(orders: Orders, period: Period): string {
  const closed = orders.dispatched + orders.rejected;
  if (closed === 0) return `No orders dispatched or rejected in the ${periodPhrase(period)}`;
  const parts = [
    `${formatNumber(orders.dispatched)} of ${plural(closed, 'order', 'orders')} dispatched`,
  ];
  if (orders.median_days_to_dispatch !== null) {
    parts.push(`typically ${formatDays(orders.median_days_to_dispatch)} to dispatch`);
  }
  return parts.join(' · ');
}

/** "Under a day", "1 day", "2.5 days". */
export function formatDays(days: number): string {
  if (days < 1) return 'under a day';
  const rounded = Math.round(days * 10) / 10;
  return rounded === 1 ? '1 day' : `${formatNumber(rounded)} days`;
}

/**
 * How many months the free stock lasts at the average monthly dispatch of the last 90 days; null
 * when nothing was dispatched in that time.
 */
export function stockCover(product: ProductSummary): number | null {
  const monthly = product.dispatched_90_days / 3;
  return monthly > 0 ? product.usable / monthly : null;
}

/** "4.2 months", "Under a month" for less than one, "Over 2 years" past 24. */
export function formatMonths(months: number): string {
  if (months < 1) return 'Under a month';
  if (months > 24) return 'Over 2 years';
  const rounded = Math.round(months * 10) / 10;
  return rounded === 1 ? '1 month' : `${formatNumber(rounded)} months`;
}

/** The earliest next expiry date across products, YYYY-MM-DD, or null. */
export function nextExpiry(products: readonly ProductSummary[]): string | null {
  let earliest: string | null = null;
  for (const product of products) {
    if (product.next_expiry && (earliest === null || product.next_expiry < earliest)) {
      earliest = product.next_expiry;
    }
  }
  return earliest;
}

/** "3 orders to 2 districts", plus what is still on the road. */
export function dispatchBreakdown(orders: Orders, period: Period): string {
  if (orders.dispatched === 0) {
    return orders.in_transit > 0
      ? `None in the ${periodPhrase(period)} · ${plural(orders.in_transit, 'order', 'orders')} still in transit`
      : `No orders dispatched in the ${periodPhrase(period)}`;
  }
  const parts = [
    `${plural(orders.dispatched, 'order', 'orders')} to ${plural(orders.districts_supplied, 'district', 'districts')}`,
  ];
  if (orders.in_transit > 0) parts.push(`${formatNumber(orders.in_transit)} still in transit`);
  return parts.join(' · ');
}
