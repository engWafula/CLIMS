'use client';

import { formatNumber } from '@/lib/format';

import { ChartCard, type ChartCardProps, type ChartMode } from './ChartCard';
import { percentLabel } from './format';

export interface FunnelStage {
  label: string;
  value: number;
}

interface FunnelChartProps extends Omit<
  ChartCardProps,
  'children' | 'legendShape' | 'series' | 'rows' | 'categoryLabel'
> {
  stages: readonly FunnelStage[];
  /** What the values count, e.g. "Pieces". */
  unit: string;
  color?: string;
}

/**
 * A pipeline that narrows stage by stage (requested, approved, issued,
 * acknowledged), as Power BI's funnel: one centred bar per stage, sized to the
 * first, with the share of the first stage and of the stage before printed.
 */
export function FunnelChart({
  stages,
  unit,
  color = 'var(--chart-1)',
  valueFormat = formatNumber,
  ...card
}: FunnelChartProps) {
  const first = stages[0]?.value ?? 0;
  const max = Math.max(1, ...stages.map((stage) => stage.value));
  const rows = stages.map((stage) => ({ label: stage.label, values: { value: stage.value } }));

  const plot = (mode: ChartMode) => (
    <ol className="flex flex-col gap-2" aria-label={`${card.title}, by stage`}>
      {stages.map((stage, index) => {
        const previous = index > 0 ? (stages[index - 1]?.value ?? 0) : null;
        const width = Math.max(2, (stage.value / max) * 100);
        const ofFirst = first > 0 ? (stage.value / first) * 100 : null;
        const ofPrevious = previous ? (stage.value / previous) * 100 : null;
        return (
          <li
            key={stage.label}
            className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] items-center gap-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{stage.label}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {ofPrevious === null ? 'Start' : `${percentLabel(ofPrevious)} of the stage before`}
              </p>
            </div>
            <div className="flex justify-center">
              <div
                className="text-primary-foreground flex items-center justify-center rounded-[4px] px-2 text-xs font-semibold tabular-nums transition-[width] duration-300 ease-out motion-reduce:transition-none"
                style={{
                  width: `${width}%`,
                  minWidth: '4.5rem',
                  height: mode === 'focus' ? 44 : 30,
                  backgroundColor: color,
                }}
              >
                <span className="truncate">
                  {valueFormat(stage.value)}
                  {ofFirst !== null && index > 0 ? ` · ${percentLabel(ofFirst)}` : ''}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );

  return (
    <ChartCard
      series={[{ key: 'value', label: unit, color }]}
      rows={rows}
      categoryLabel="Stage"
      valueFormat={valueFormat}
      {...card}
    >
      {plot}
    </ChartCard>
  );
}
