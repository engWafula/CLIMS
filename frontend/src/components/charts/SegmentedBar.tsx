'use client';

import { formatNumber } from '@/lib/format';
import { toPercentages } from '@/lib/percent';

import { ChartCard, type ChartCardProps, type ChartMode } from './ChartCard';

export interface Segment {
  key: string;
  label: string;
  value: number;
  /** A CSS colour: a chart token for identity, a status token when the part is a state. */
  color: string;
  /**
   * Text on the fill: near-black for the mid-tone chart colours (default), or
   * `surface` for status colours, which are dark in the light theme and light
   * in the dark one, so the card colour always contrasts with them.
   */
  ink?: 'dark' | 'surface';
}

interface SegmentedBarProps extends Omit<
  ChartCardProps,
  'children' | 'legendShape' | 'series' | 'rows' | 'categoryLabel'
> {
  segments: readonly Segment[];
  /** What the total counts, e.g. "Requests". */
  totalLabel: string;
}

/** A part narrower than this prints no share inside it; its legend entry carries it. */
const LABEL_MIN_PERCENT = 9;

/**
 * One whole split into its parts (statuses, expiry bands, conditions): a tall
 * segmented bar with each share printed where it fits, and a legend listing
 * every part with its count and share. Used instead of a donut: lengths on one
 * baseline compare better than angles, and every figure is printed.
 */
export function SegmentedBar({
  segments,
  totalLabel,
  valueFormat = formatNumber,
  ...card
}: SegmentedBarProps) {
  const shown = segments.filter((segment) => segment.value > 0);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const shares = toPercentages(segments.map((segment) => segment.value));
  const rows =
    total > 0
      ? segments.map((segment) => ({ label: segment.label, values: { value: segment.value } }))
      : [];

  const plot = (mode: ChartMode) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground text-sm">{totalLabel}</span>
        <span className="text-2xl font-bold">{valueFormat(total)}</span>
      </div>
      <div
        className="flex w-full gap-0.5 overflow-hidden rounded-[4px]"
        style={{ height: mode === 'focus' ? 40 : 28 }}
        role="img"
        aria-label={segments
          .map(
            (segment, index) =>
              `${segment.label} ${valueFormat(segment.value)} (${shares[index] ?? 0}%)`,
          )
          .join(', ')}
      >
        {shown.map((segment) => {
          const share = shares[segments.indexOf(segment)] ?? 0;
          return (
            <div
              key={segment.key}
              title={`${segment.label}: ${valueFormat(segment.value)} (${share}%)`}
              className="flex min-w-1 items-center overflow-hidden px-1.5 text-xs font-semibold tabular-nums"
              style={{
                flexGrow: segment.value,
                flexBasis: 0,
                backgroundColor: segment.color,
                color: segment.ink === 'surface' ? 'var(--card)' : '#020203',
              }}
            >
              {share >= LABEL_MIN_PERCENT ? `${share}%` : null}
            </div>
          );
        })}
      </div>
      <ul className="grid grid-cols-1 gap-y-1.5 text-sm">
        {segments.map((segment, index) => (
          <li key={segment.key} className="flex min-w-0 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: segment.color }}
              aria-hidden="true"
            />
            <span className="truncate">{segment.label}</span>
            <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
              {valueFormat(segment.value)}
              <span className="text-foreground ml-2 font-medium">{shares[index] ?? 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <ChartCard
      series={[{ key: 'value', label: totalLabel, color: 'var(--chart-1)' }]}
      rows={rows}
      categoryLabel="Part"
      valueFormat={valueFormat}
      legend={false}
      {...card}
    >
      {plot}
    </ChartCard>
  );
}
