import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import Link from 'next/link';

import { Sparkline } from '@/components/charts/Sparkline';
import { SampleBadge } from '@/components/SampleData';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import { trendChange, type GoodDirection, type TrendMeaning } from '@/lib/trend';
import { cn } from '@/lib/utils';

/** Colour of the icon and sparkline. It identifies the card, it does not judge the figure. */
export type StatCardAccent = 'neutral' | 'info' | 'positive' | 'caution' | 'violet';

const ACCENT_CLASSES: Record<StatCardAccent, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-info',
  positive: 'text-success',
  caution: 'text-warning',
  violet: 'text-chart-3',
};

const MEANING_CLASSES: Record<TrendMeaning, string> = {
  good: 'bg-success/10 text-success',
  bad: 'bg-warning/10 text-warning',
  neutral: 'bg-secondary text-muted-foreground',
};

/** Read before the change by screen readers, since the arrow is hidden. */
const DIRECTION_WORDS = { up: 'Up', down: 'Down', flat: 'No change' } as const;

export interface StatCardTrend {
  /** Recent values, oldest first; the last is the current figure. */
  series: readonly number[];
  /** Which way is good news. Leave out when neither is. */
  goodDirection?: GoodDirection;
  /** What the change is measured against, e.g. "vs last week". */
  caption: string;
}

interface StatCardProps {
  label: string;
  /** Already formatted for display. */
  value: string;
  /**
   * The same figure in other units, on a quieter line under the value, e.g. "2,383,520 Box ·
   * 114,840 Carton" under "31,635,000 Piece". Units are never added together, and three of them
   * at full size would bury the figure.
   */
  extra?: string;
  icon: LucideIcon;
  /** Icon and sparkline colour. Defaults to neutral. */
  accent?: StatCardAccent;
  /** Adds the change since the previous point and a sparkline. */
  trend?: StatCardTrend;
  /** One line under the figure saying what is behind it, e.g. "2 to decide · 1 to dispatch". */
  detail?: string;
  /** Makes the whole card a link, e.g. to the list behind the figure. */
  href?: string;
  /** True while the figure is being fetched. */
  isLoading?: boolean;
  /** True when the figure is illustrative rather than read from the API. */
  isSample?: boolean;
  /** Layout adjustments only. */
  className?: string;
}

/**
 * One headline figure, optionally with its latest change and a sparkline.
 *
 * ```tsx
 * <StatCard label="Orders in queue" value="4" icon={Inbox} accent="info"
 *   trend={{ series: [3, 5, 4, 4], goodDirection: 'down', caption: 'vs last week' }}
 *   href="/dcfp/orders" />
 * ```
 */
export function StatCard({
  label,
  value,
  extra,
  icon: Icon,
  accent = 'neutral',
  trend,
  detail,
  href,
  isLoading = false,
  isSample = false,
  className,
}: StatCardProps) {
  const change = trend ? trendChange(trend.series, trend.goodDirection) : null;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground text-[0.8125rem] font-medium">{label}</span>
          {isSample ? <SampleBadge /> : null}
        </div>
        <div className="bg-secondary flex size-6 shrink-0 items-center justify-center rounded-md">
          <Icon className={cn('size-3.5', ACCENT_CLASSES[accent])} aria-hidden="true" />
        </div>
      </div>
      {isLoading ? (
        <div role="status">
          <Skeleton className="h-7 w-24" />
          <span className="sr-only">Loading {label.toLowerCase()}…</span>
        </div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-foreground text-2xl leading-7 font-bold tracking-tight break-words tabular-nums">
              {value}
            </p>
            {extra ? (
              <p className="text-foreground/80 -mt-1 text-sm font-semibold break-words tabular-nums">
                {extra}
              </p>
            ) : null}
            {trend && change ? (
              <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                <span
                  data-meaning={change.meaning}
                  className={cn(
                    'inline-flex h-4.5 items-center gap-0.5 rounded-sm px-1.5 font-semibold tabular-nums',
                    MEANING_CLASSES[change.meaning],
                  )}
                >
                  <TrendIcon direction={change.direction} />
                  <span className="sr-only">{DIRECTION_WORDS[change.direction]} </span>
                  {change.direction === 'flat' ? '0' : formatNumber(Math.abs(change.delta))}
                </span>
                {trend.caption}
              </p>
            ) : null}
            {detail ? (
              <p className="text-muted-foreground text-xs leading-4 text-pretty">{detail}</p>
            ) : null}
          </div>
          {trend ? <Sparkline series={trend.series} className={ACCENT_CLASSES[accent]} /> : null}
        </div>
      )}
    </>
  );

  const cardClasses = cn('bg-card rounded-card flex flex-col gap-1.5 border px-4 py-3', className);
  // PDF reports read the headline figures from these.
  const kpi = isLoading
    ? {}
    : {
        'data-kpi': '',
        'data-kpi-label': label,
        'data-kpi-value': extra ? `${value} (${extra})` : value,
        'data-kpi-detail': detail,
      };
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          cardClasses,
          'hover:bg-accent focus-visible:ring-ring outline-none focus-visible:ring-2',
        )}
        {...kpi}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={cardClasses} {...kpi}>
      {body}
    </div>
  );
}

function TrendIcon({ direction }: { direction: 'up' | 'down' | 'flat' }) {
  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;
  return <Icon className="size-3" aria-hidden="true" />;
}

/**
 * Lays stat cards out in equal columns that wrap, so three cards fill a row as
 * evenly as four do and a narrow screen stacks them.
 */
export function StatCardGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  /** Layout only, e.g. columns that line up with a sidebar column under the row. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[repeat(auto-fit,minmax(min(100%,13.5rem),1fr))] gap-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
