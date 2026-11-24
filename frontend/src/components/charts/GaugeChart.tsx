'use client';

import { CircleCheck, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

import { ChartCard, type ChartCardProps, type ChartMode } from './ChartCard';
import { percentLabel } from './format';

interface GaugeChartProps extends Omit<
  ChartCardProps,
  'children' | 'legendShape' | 'series' | 'rows' | 'categoryLabel'
> {
  /** The measured percentage, or null when it does not apply (nothing to measure). */
  value: number | null;
  /** The target percentage, marked on the arc. */
  target: number;
  /** Names the measure in the table view, e.g. "On time". */
  measure: string;
  /** Says what was measured under the figure, e.g. "12 of 15 fulfilled within 7 days". */
  caption?: string;
}

const RADIUS = 80;
const STROKE = 14;
const CIRCUMFERENCE = Math.PI * RADIUS;

/** The point on the arc at `percent` (0 at the left end, 100 at the right). */
function arcPoint(percent: number, radius: number) {
  const angle = Math.PI * (1 - percent / 100);
  return { x: 100 + radius * Math.cos(angle), y: 100 - radius * Math.sin(angle) };
}

/**
 * One percentage against its target, as Power BI's gauge: a half-circle track,
 * the value as its fill and the target as a tick. The fill is the status colour
 * (met or below), and the status is also said in words beside an icon.
 */
export function GaugeChart({ value, target, measure, caption, ...card }: GaugeChartProps) {
  const met = value !== null && value >= target;
  const clamped = value === null ? 0 : Math.min(100, Math.max(0, value));
  const tickIn = arcPoint(target, RADIUS - STROKE / 2 - 4);
  const tickOut = arcPoint(target, RADIUS + STROKE / 2 + 4);
  const rows = [{ label: measure, values: { value, target } }];

  const plot = (mode: ChartMode) => (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox="0 0 200 112"
        className={cn('w-full', mode === 'focus' ? 'max-w-md' : 'max-w-60')}
        role="img"
        aria-label={`${measure}: ${value === null ? 'not applicable' : percentLabel(value)}, target ${percentLabel(target)}`}
      >
        <path
          d={`M ${100 - RADIUS} 100 A ${RADIUS} ${RADIUS} 0 0 1 ${100 + RADIUS} 100`}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {value !== null && clamped > 0 ? (
          <path
            d={`M ${100 - RADIUS} 100 A ${RADIUS} ${RADIUS} 0 0 1 ${100 + RADIUS} 100`}
            fill="none"
            stroke={met ? 'var(--success)' : 'var(--warning)'}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            className="transition-[stroke-dasharray] duration-500 ease-out motion-reduce:transition-none"
          />
        ) : null}
        <line
          x1={tickIn.x}
          y1={tickIn.y}
          x2={tickOut.x}
          y2={tickOut.y}
          stroke="var(--foreground)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <text
          x={100}
          y={88}
          textAnchor="middle"
          className="fill-foreground"
          fontSize={30}
          fontWeight={700}
        >
          {value === null ? 'n/a' : percentLabel(value)}
        </text>
        <text
          x={100 - RADIUS}
          y={111}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
        >
          0%
        </text>
        <text
          x={100 + RADIUS}
          y={111}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
        >
          100%
        </text>
      </svg>
      <p
        className={cn(
          'flex items-center gap-1.5 text-sm font-medium',
          value === null ? 'text-muted-foreground' : met ? 'text-success' : 'text-warning',
        )}
      >
        {value === null ? null : met ? (
          <CircleCheck className="size-4" aria-hidden="true" />
        ) : (
          <TriangleAlert className="size-4" aria-hidden="true" />
        )}
        {value === null
          ? 'Nothing to measure yet'
          : met
            ? `Target of ${percentLabel(target)} met`
            : `Below the ${percentLabel(target)} target`}
      </p>
      {caption ? (
        <p className="text-muted-foreground text-center text-xs text-pretty">{caption}</p>
      ) : null}
    </div>
  );

  return (
    <ChartCard
      series={[
        { key: 'value', label: measure, color: 'var(--success)' },
        { key: 'target', label: 'Target', color: 'var(--foreground)' },
      ]}
      rows={rows}
      categoryLabel="Measure"
      valueFormat={percentLabel}
      legend={false}
      {...card}
    >
      {plot}
    </ChartCard>
  );
}
