import { formatNumber } from '@/lib/format';

interface DataBarProps {
  value: number | null;
  /** The largest value in the column; the bar is the value's share of it. */
  max: number;
  format?: (value: number) => string;
  /** A CSS colour for the bar; defaults to the first chart colour. */
  color?: string;
}

/**
 * A table cell's number with a data bar behind it, as in a Power BI matrix
 * with conditional formatting: the column reads as a chart and stays a table.
 */
export function DataBar({
  value,
  max,
  format = formatNumber,
  color = 'var(--chart-1)',
}: DataBarProps) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="relative flex min-w-20 items-center justify-end">
      <span
        className="absolute inset-y-0.5 left-0 rounded-[3px] opacity-20"
        style={{ width: `${width}%`, backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="relative tabular-nums">{format(value)}</span>
    </span>
  );
}
