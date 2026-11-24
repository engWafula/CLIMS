'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { formatNumber } from '@/lib/format';

import {
  ChartCard,
  PLOT_HEIGHT,
  type ChartCardProps,
  type ChartMode,
  type ChartRow,
  type ChartSeries,
} from './ChartCard';
import { axisNumber } from './format';

export interface ChartReference {
  value: number;
  /** Printed at the line's right end, e.g. "Target 80%". */
  label: string;
}

interface TrendChartProps extends Omit<ChartCardProps, 'children' | 'legendShape'> {
  series: readonly ChartSeries[];
  rows: readonly ChartRow[];
  /** `area` (default) washes each line at 10%; `line` draws the lines alone, for overlapping series. */
  kind?: 'area' | 'line';
  /** A horizontal guide such as a target, labelled at its end. */
  reference?: ChartReference;
  /** Fixes the y-axis top, e.g. 100 for a percentage. */
  yMax?: number;
}

/** Change over time for up to a few series sharing one unit: 2px lines, optionally over a light wash. */
export function TrendChart({
  series,
  rows,
  kind = 'area',
  reference,
  yMax,
  valueFormat = formatNumber,
  ...card
}: TrendChartProps) {
  const animate = !useReducedMotion();
  const config: ChartConfig = Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  );
  const data = rows.map((row) => ({ label: row.label, ...row.values }));
  const domain: [number, number | 'auto'] = [0, yMax ?? 'auto'];

  const plot = (mode: ChartMode) => {
    const common = (
      <>
        <CartesianGrid vertical={false} strokeDasharray="0" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          interval="preserveStartEnd"
        />
        <YAxis
          width="auto"
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          domain={domain}
          allowDecimals={false}
          tickFormatter={(value: number) => axisNumber(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              formatter={(value, name, item) => (
                <TooltipValue
                  color={entryColor(item)}
                  label={seriesName(config, name)}
                  value={typeof value === 'number' ? valueFormat(value) : '—'}
                />
              )}
            />
          }
        />
        {reference ? (
          <ReferenceLine
            y={reference.value}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            label={{
              value: reference.label,
              position: 'insideTopRight',
              fill: 'var(--muted-foreground)',
              fontSize: 11,
            }}
          />
        ) : null}
      </>
    );
    const margin = { top: 12, right: 8, bottom: 0, left: 0 };
    return (
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: PLOT_HEIGHT[mode] }}
      >
        {kind === 'line' ? (
          <LineChart accessibilityLayer data={data} margin={margin}>
            {common}
            {series.map((item) => (
              <Line
                isAnimationActive={animate}
                key={item.key}
                dataKey={item.key}
                type="monotone"
                stroke={`var(--color-${item.key})`}
                strokeWidth={2}
                dot={rows.length <= 1 ? { r: 4, strokeWidth: 2, stroke: 'var(--card)' } : false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                connectNulls
              />
            ))}
          </LineChart>
        ) : (
          <AreaChart accessibilityLayer data={data} margin={margin}>
            {common}
            {series.map((item) => (
              <Area
                isAnimationActive={animate}
                key={item.key}
                dataKey={item.key}
                type="monotone"
                stroke={`var(--color-${item.key})`}
                strokeWidth={2}
                fill={`var(--color-${item.key})`}
                fillOpacity={0.1}
                dot={rows.length <= 1 ? { r: 4, strokeWidth: 2, stroke: 'var(--card)' } : false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                connectNulls
              />
            ))}
          </AreaChart>
        )}
      </ChartContainer>
    );
  };

  return (
    <ChartCard series={series} rows={rows} valueFormat={valueFormat} legendShape="line" {...card}>
      {plot}
    </ChartCard>
  );
}

/** A series' name from the chart config, for a tooltip row. */
export function seriesName(config: ChartConfig, name: unknown): string {
  const key = typeof name === 'string' || typeof name === 'number' ? String(name) : '';
  const label = config[key]?.label;
  return typeof label === 'string' ? label : key;
}

/** The colour of a tooltip entry: the series colour, else the mark's fill. */
export function entryColor(item: { color?: string | undefined; payload?: unknown }): string {
  if (item.color) return item.color;
  const payload: unknown = item.payload;
  if (
    payload &&
    typeof payload === 'object' &&
    'fill' in payload &&
    typeof payload.fill === 'string'
  )
    return payload.fill;
  return '';
}

/** One tooltip row: the series key, its name and its value, in text colours. */
export function TooltipValue({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex w-full min-w-36 items-center gap-2">
      <span
        className="h-2.5 w-1 shrink-0 rounded-[2px]"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground ml-auto font-medium tabular-nums">{value}</span>
    </div>
  );
}
