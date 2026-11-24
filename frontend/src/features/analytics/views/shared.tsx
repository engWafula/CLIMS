import { Children, useContext, type ReactNode } from 'react';

import { ChartHeadingLevel } from '@/components/charts/ChartCard';

import type { ChartRow } from '@/components/charts/ChartCard';
import type { Segment } from '@/components/charts/SegmentedBar';
import { axisNumber } from '@/components/charts/format';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { ExpiryBand, NotificationReport, TrendBucket, TrendReport } from '../api';
import { bucketLabel } from '../filters';

/** Which workspace a report section is shown in: it picks the reports and filters offered. */
export type AnalyticsWorkspace = 'moh' | 'dcfp' | 'warehouse';

/** A section of a report page: an h2 and what it holds, then its visuals. */
export function ReportSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  // A section's heading sits one level above its charts' (h2 and h3 on a page, h3 and h4 under a
  // dashboard section that has its own h2).
  const chartLevel = useContext(ChartHeadingLevel);
  const Heading = chartLevel === 4 ? 'h3' : 'h2';
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div>
        <Heading className="text-base font-semibold">{title}</Heading>
        {description ? (
          <p className="text-muted-foreground text-sm text-pretty">{description}</p>
        ) : null}
      </div>
      <ChartHeadingLevel.Provider value={chartLevel === 4 ? 4 : 3}>
        {children}
      </ChartHeadingLevel.Provider>
    </section>
  );
}

/**
 * Visuals side by side from 1024px; three or more go three across from 1280px,
 * so a section of three never leaves one card alone on a row.
 */
export function VisualGrid({ children, columns }: { children: ReactNode; columns?: 2 | 3 }) {
  const count = Children.toArray(children).filter(Boolean).length;
  // Four go two by two; three, five or six go three across.
  const three = (columns ?? (count === 3 || count >= 5 ? 3 : 2)) === 3;
  return (
    <div
      className={cn(
        'gap-section grid items-start',
        three ? 'lg:grid-cols-2 xl:grid-cols-3' : 'lg:grid-cols-2',
      )}
    >
      {children}
    </div>
  );
}

/** Chart rows from trend buckets, labelled by period, picking the measures each chart plots. */
export function trendRows(
  trend: TrendReport | undefined,
  pick: (bucket: TrendBucket) => Record<string, number | null>,
): ChartRow[] {
  if (!trend) return [];
  return trend.buckets.map((bucket) => ({
    label: bucketLabel(bucket.start, trend.interval),
    values: pick(bucket),
  }));
}

/** True when every bucket is zero for the measures picked: the trend has nothing to draw. */
export function isFlat(rows: readonly ChartRow[]): boolean {
  return rows.every((row) => Object.values(row.values).every((value) => !value));
}

/** The last two buckets' values of a measure, oldest first, for a stat card's change and sparkline. */
export function series(
  trend: TrendReport | undefined,
  pick: (bucket: TrendBucket) => number,
): number[] {
  return trend ? trend.buckets.map(pick) : [];
}

export const INTERVAL_WORD = { day: 'yesterday', week: 'last week', month: 'last month' } as const;

/** The notification statuses as parts of a whole, in workflow order, in status colours. */
export function statusSegments(report: NotificationReport): Segment[] {
  return [
    {
      key: 'fulfilled',
      label: 'Fulfilled',
      value: report.notifications_fulfilled,
      color: 'var(--success)',
      ink: 'surface',
    },
    {
      key: 'partly_received',
      label: 'Partly received',
      value: report.partly_received,
      color: 'var(--info)',
      ink: 'surface',
    },
    {
      key: 'awaiting_acknowledgement',
      label: 'Awaiting acknowledgement',
      value: report.awaiting_acknowledgement,
      color: 'var(--warning)',
      ink: 'surface',
    },
    {
      key: 'awaiting_supply',
      label: 'Awaiting supply',
      value: report.awaiting_supply,
      color: 'var(--destructive)',
      ink: 'surface',
    },
    {
      key: 'rejected',
      label: 'Rejected',
      value: report.notifications_rejected,
      color: 'var(--role-system)',
    },
  ];
}

export const BAND_LABELS: Record<ExpiryBand, string> = {
  expired: 'Expired',
  under_1_month: 'Under 1 month',
  under_3_months: '1 to 3 months',
  under_6_months: '3 to 6 months',
  ok: '6 months or more',
  unknown: 'No expiry date',
};

/** Expiry bands are states, from critical to safe, so they take status colours. */
export const BAND_COLORS: Record<ExpiryBand, { color: string; ink?: 'surface' }> = {
  expired: { color: 'var(--destructive)', ink: 'surface' },
  under_1_month: {
    color: 'color-mix(in oklab, var(--destructive) 70%, var(--warning))',
    ink: 'surface',
  },
  under_3_months: { color: 'var(--warning)', ink: 'surface' },
  under_6_months: { color: 'var(--info)', ink: 'surface' },
  ok: { color: 'var(--success)', ink: 'surface' },
  unknown: { color: 'var(--role-system)' },
};

/** Condom Distribution Guidelines 2022, p. 19: keep between 2 and 3 months of stock. */
export const MIN_MONTHS = 2;
export const MAX_MONTHS = 3;
export const GUIDELINE_NOTE =
  'Guideline: keep between 2 and 3 months of stock; below 2 months is low stock (Condom Distribution Guidelines 2022, pp. 13, 19).';

/**
 * A headline count of pieces, in display units from 100,000 as Power BI's cards
 * show them ("519.6K pcs"), so a card's figure stays on one line; the exact
 * figure is in the table view and the downloads.
 */
export function piecesValue(value: number): string {
  return `${value >= 100_000 ? axisNumber(value) : formatNumber(value)} pcs`;
}

export function piecesLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : formatNumber(value);
}

/** "3 of 8" style share in words. */
export function shareOf(part: number, whole: number): string {
  return whole > 0 ? `${formatNumber(part)} of ${formatNumber(whole)}` : 'None yet';
}

export function percentOrNa(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Not applicable' : `${formatNumber(value)}%`;
}

/** Sums by a key: e.g. pieces by store from stock lines. */
export function sumBy<T>(
  items: readonly T[],
  key: (item: T) => string,
  value: (item: T) => number | null,
) {
  const out = new Map<string, number>();
  for (const item of items) {
    const v = value(item);
    if (v === null) continue;
    out.set(key(item), (out.get(key(item)) ?? 0) + v);
  }
  return out;
}

/** A quality note in words under a section, e.g. unconverted quantities. */
export function QualityNote({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs leading-4 text-pretty">{children}</p>;
}
