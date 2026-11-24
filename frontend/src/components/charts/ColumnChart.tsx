'use client';

import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts';

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
import { entryColor, seriesName, TooltipValue, type ChartReference } from './TrendChart';

interface ColumnChartProps extends Omit<ChartCardProps, 'children' | 'legendShape' | 'series'> {
  /** One series (the card title names it, so there is no legend) or several, clustered or stacked. */
  series: ChartSeries | readonly ChartSeries[];
  rows: readonly ChartRow[];
  /** Stack the series in one column per category instead of side by side. */
  stacked?: boolean;
  /** A horizontal guide such as a target. */
  reference?: ChartReference;
  /** Fixes the y-axis top, e.g. 100 for a percentage. */
  yMax?: number;
}

/** Magnitude across categories or periods: thin columns from a shared baseline. */
export function ColumnChart({
  series: input,
  rows,
  stacked = false,
  reference,
  yMax,
  valueFormat = formatNumber,
  ...card
}: ColumnChartProps) {
  const animate = !useReducedMotion();
  const series: readonly ChartSeries[] = Array.isArray(input) ? input : [input as ChartSeries];
  const config: ChartConfig = Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  );
  const data = rows.map((row) => ({ label: row.label, ...row.values }));
  // Values ride the column caps only where they stay readable: one series, a dozen columns.
  const capLabels = series.length === 1 && rows.length <= 12;
  const last = series.length - 1;

  const plot = (mode: ChartMode) => (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: PLOT_HEIGHT[mode] }}
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: capLabels ? 18 : 12, right: 8, bottom: 0, left: 0 }}
        barGap={2}
        barCategoryGap="20%"
      >
        <CartesianGrid vertical={false} strokeDasharray="0" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={8}
          // A handful of categories each keep their name; a long series of periods thins out.
          interval={rows.length <= 8 ? 0 : 'preserveStartEnd'}
          tickFormatter={(value: string) => (value.length > 18 ? `${value.slice(0, 17)}…` : value)}
        />
        <YAxis
          width="auto"
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          domain={[0, yMax ?? 'auto']}
          allowDecimals={false}
          tickFormatter={(value: number) => axisNumber(value)}
        />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)' }}
          content={
            <ChartTooltipContent
              hideIndicator
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
        {series.map((item, index) => (
          <Bar
            isAnimationActive={animate}
            key={item.key}
            dataKey={item.key}
            fill={`var(--color-${item.key})`}
            stackId={stacked ? 'stack' : undefined}
            // Rounded at the data end only; in a stack only the top segment is.
            radius={!stacked || index === last ? [4, 4, 0, 0] : 0}
            // The 2px surface gap between stacked segments.
            stroke={stacked ? 'var(--card)' : undefined}
            strokeWidth={stacked ? 1 : 0}
            maxBarSize={mode === 'focus' ? 40 : 24}
          >
            {capLabels ? (
              <LabelList
                dataKey={item.key}
                position="top"
                offset={6}
                fill="var(--muted-foreground)"
                fontSize={11}
                formatter={(value: unknown) => (typeof value === 'number' ? axisNumber(value) : '')}
              />
            ) : null}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );

  return (
    <ChartCard series={series} rows={rows} valueFormat={valueFormat} legendShape="square" {...card}>
      {plot}
    </ChartCard>
  );
}
