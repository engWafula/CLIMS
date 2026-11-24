import type { Band, ProductSummary, StockBatch } from '@/features/inventory/api';
import { BAND_STATUS, batchLabel } from '@/features/inventory/bands';
import type { TaskItem } from '@/components/TaskList';
import { formatDate, formatNumber } from '@/lib/format';

import { WAREHOUSE_PATHS } from './paths';
import { formatMonths, formatStock, isPieces, stockCover, type UnitAmount } from './summary';

/*
 * A store's stock against its expiry dates, worked out from its batches. However many products and
 * batches a store holds, the picture stays the same size: one bar per unit of measure, six bands,
 * and at most four things to do. Units are never added together (a carton is not a piece).
 */

/** The bands in the order stock leaves the store: expired first, no date last. */
export const BAND_ORDER = [
  'expired',
  'under_1_month',
  'under_3_months',
  'under_6_months',
  'ok',
  'unknown',
] as const satisfies readonly Band[];

/** One band of one unit's stock. */
export interface BandShare {
  band: Band;
  quantity: number;
  batches: number;
}

/** One unit's stock split by shelf life, bands in `BAND_ORDER`, empty bands included. */
export interface UnitShelfLife {
  unit: string;
  total: number;
  batches: number;
  bands: BandShare[];
}

/** Each unit's stock by shelf life, the unit holding most first. Empty batches are left out. */
export function shelfLifeByUnit(batches: readonly StockBatch[]): UnitShelfLife[] {
  const units = new Map<string, Map<Band, BandShare>>();
  for (const batch of batches) {
    if (batch.on_hand <= 0) continue;
    let bands = units.get(batch.unit);
    if (!bands) {
      bands = new Map(BAND_ORDER.map((band) => [band, { band, quantity: 0, batches: 0 }]));
      units.set(batch.unit, bands);
    }
    const share = bands.get(batch.band);
    if (share) {
      share.quantity += batch.on_hand;
      share.batches += 1;
    }
  }
  return [...units.entries()]
    .map(([unit, bands]) => {
      const shares = BAND_ORDER.map((band) => bands.get(band) ?? { band, quantity: 0, batches: 0 });
      return {
        unit,
        total: shares.reduce((sum, share) => sum + share.quantity, 0),
        batches: shares.reduce((sum, share) => sum + share.batches, 0),
        bands: shares,
      };
    })
    .sort((a, b) => b.total - a.total || a.unit.localeCompare(b.unit));
}

/** A band across every unit: how much of each unit, and how many batches. */
export function bandAcrossUnits(
  units: readonly UnitShelfLife[],
  band: Band,
): { amounts: UnitAmount[]; batches: number } {
  const amounts: UnitAmount[] = [];
  let count = 0;
  for (const unit of units) {
    const share = unit.bands.find((candidate) => candidate.band === band);
    if (!share || share.batches === 0) continue;
    amounts.push({ unit: unit.unit, quantity: share.quantity });
    count += share.batches;
  }
  return { amounts, batches: count };
}

const batchCount = (count: number) => `${formatNumber(count)} ${count === 1 ? 'batch' : 'batches'}`;

/**
 * What needs doing about the stock, most urgent first: expired batches to write off, batches
 * leaving within a month, stock without an expiry date, and products about to run out. Each links
 * to the list that shows them. `href` adds the current store to a warehouse path.
 */
export function stockAttention(
  batches: readonly StockBatch[],
  products: readonly ProductSummary[],
  href: (path: string) => string,
  stockPath: string = WAREHOUSE_PATHS.stock,
): TaskItem[] {
  const held = batches.filter((batch) => batch.on_hand > 0);
  const units = shelfLifeByUnit(held);
  const inBand = (band: Band) => held.filter((batch) => batch.band === band);
  const tasks: TaskItem[] = [];

  const expired = inBand('expired');
  if (expired.length > 0) {
    tasks.push({
      id: 'expired',
      status: { label: BAND_STATUS.expired.label, tone: 'negative' },
      title: `Write off ${batchCount(expired.length)}`,
      detail: `${formatStock(bandAcrossUnits(units, 'expired').amounts)} past expiry can't be dispatched. Dispose of it, then write it off.`,
      action: 'See expired batches',
      href: href(`${stockPath}?view=batches&band=expired`),
    });
  }

  const soon = inBand('under_1_month').sort((a, b) =>
    (a.expiry_date ?? '').localeCompare(b.expiry_date ?? ''),
  );
  const [first] = soon;
  if (first) {
    tasks.push({
      id: 'under_1_month',
      status: { label: BAND_STATUS.under_1_month.label, tone: 'negative' },
      title: `${batchCount(soon.length)} ${soon.length === 1 ? 'expires' : 'expire'} within a month`,
      detail: `First: ${batchLabel(first)}, ${first.product}${
        first.expiry_date ? ` on ${formatDate(first.expiry_date)}` : ''
      }. It leaves first, with a documented exception.`,
      action: 'See these batches',
      href: href(`${stockPath}?view=batches&band=under_1_month`),
    });
  }

  const undated = inBand('unknown');
  if (undated.length > 0) {
    tasks.push({
      id: 'unknown',
      status: { label: 'No expiry date', tone: 'neutral' },
      title: `Record expiry dates for ${batchCount(undated.length)}`,
      detail: `${formatStock(bandAcrossUnits(units, 'unknown').amounts)} has no expiry date, so it can't be dispatched first-expiry-first-out. Count it and record its batches.`,
      action: 'See undated batches',
      href: href(`${stockPath}?view=batches&band=unknown`),
    });
  }

  const running = products
    .map((product) => ({ product, months: stockCover(product) }))
    .filter(
      (entry): entry is { product: ProductSummary; months: number } =>
        entry.months !== null && entry.months < 1,
    )
    .sort((a, b) => a.months - b.months);
  const [lowest] = running;
  if (lowest) {
    tasks.push({
      id: 'cover',
      status: { label: 'Low stock', tone: 'caution' },
      title: `${formatNumber(running.length)} ${
        running.length === 1 ? 'product has' : 'products have'
      } under a month of stock`,
      detail: `Lowest: ${lowest.product.product}${
        isPieces(lowest.product.unit) ? '' : ` (${lowest.product.unit})`
      }, ${formatMonths(lowest.months).toLowerCase()} at the last 90 days' rate of dispatch.`,
      action: 'See products',
      href: href(stockPath),
    });
  }

  return tasks;
}
