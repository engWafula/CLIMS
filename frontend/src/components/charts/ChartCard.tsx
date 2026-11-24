'use client';

import {
  ChartNoAxesColumn,
  Download,
  Ellipsis,
  ImageDown,
  Maximize2,
  Table2,
  TriangleAlert,
} from 'lucide-react';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { DataTable } from '@/components/data-table/DataTable';
import { SampleBadge } from '@/components/SampleData';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { downloadCsvText, downloadName, saveBlob, toCsv } from '@/lib/export/download';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface ChartSeries {
  /** Key of this series' value in each data row. */
  key: string;
  label: string;
  /** A CSS colour, normally a `var(--chart-n)` token. */
  color: string;
}

export interface ChartRow {
  /** The category on the x-axis, e.g. a month. */
  label: string;
  values: Readonly<Record<string, number | null>>;
}

/**
 * The heading level a chart card takes when it is not given one: 2 on its own, one below the
 * heading of the report section it sits in (`ReportSection` provides it).
 */
export const ChartHeadingLevel = createContext<2 | 3 | 4>(2);

/** Where a chart is drawn: in its card, or enlarged in focus mode. */
export type ChartMode = 'card' | 'focus';

/** Plot heights: the card's fixed 200px, and a larger plot in focus mode. */
export const PLOT_HEIGHT: Record<ChartMode, number> = { card: 200, focus: 420 };

export interface ChartCardProps {
  title: string;
  description: string;
  series: readonly ChartSeries[];
  rows: readonly ChartRow[];
  /** Header of the first table column, e.g. "Month". */
  categoryLabel: string;
  isSample?: boolean;
  className?: string;
  /** The heading level; by default one below the report section's heading (`ChartHeadingLevel`). */
  headingLevel?: 2 | 3 | 4;
  /** Formats values in the table view and the CSV; defaults to whole numbers. */
  valueFormat?: (value: number) => string;
  /** Legend keys: a short line for line charts, a square for bars. */
  legendShape?: 'line' | 'square';
  /** Shows the legend; on by default for two or more series. */
  legend?: boolean;
  /** True while the figures load: a skeleton of the plot is shown. */
  isLoading?: boolean;
  /** A failed load, said in words: the chart is never drawn as zeros. */
  error?: unknown;
  onRetry?: () => void;
  /** What to say when there are no rows, e.g. "No requests in this period". */
  emptyMessage?: string;
  /** A line under the chart: a definition, a guideline, a caveat. */
  footer?: ReactNode;
  /** The chart, drawn for its card or enlarged in focus mode. */
  children: ReactNode | ((mode: ChartMode) => ReactNode);
}

/**
 * The frame every visual sits in, after Power BI's visual header: title and
 * description, the legend, and the visual's options. Every chart can switch to
 * the same figures as a table (so no value is reachable only by hovering), open
 * enlarged in focus mode, and download its data as CSV or itself as a picture.
 * PDF reports find visuals by `data-visual`.
 */
export function ChartCard({
  title,
  description,
  series,
  rows,
  categoryLabel,
  isSample = false,
  className,
  headingLevel,
  valueFormat = formatNumber,
  legendShape = 'line',
  legend = series.length > 1,
  isLoading = false,
  error,
  onRetry,
  emptyMessage = 'Nothing to show for these filters.',
  footer,
  children,
}: ChartCardProps) {
  const [isTable, setIsTable] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const contextLevel = useContext(ChartHeadingLevel);
  const level = headingLevel ?? contextLevel;
  const Heading = level === 4 ? 'h4' : level === 3 ? 'h3' : 'h2';
  const hasError = error !== undefined && error !== null;
  const isEmpty = !isLoading && !hasError && rows.length === 0;
  const ready = !isLoading && !hasError && !isEmpty;
  const draw = (mode: ChartMode) => (typeof children === 'function' ? children(mode) : children);

  const downloadCsv = () => {
    downloadCsvText(
      toCsv(
        [categoryLabel, ...series.map((item) => item.label)],
        rows.map((row) => [row.label, ...series.map((item) => row.values[item.key] ?? null)]),
      ),
      title,
    );
  };

  const downloadImage = async () => {
    if (!cardRef.current) return;
    try {
      const { snapshotElements } = await import('@/lib/export/snapshot');
      const [shot] = await snapshotElements([cardRef.current]);
      if (!shot) return;
      const blob = await (await fetch(shot.dataUrl)).blob();
      saveBlob(blob, downloadName(title, 'png'));
    } catch (failure) {
      console.error('Chart image failed', failure);
      toast.error('Could not create the picture. Try again.');
    }
  };

  const table = (
    <DataTable
      variant="embedded"
      label={title}
      rows={rows}
      getRowId={(row) => row.label}
      columns={[
        { id: 'category', header: categoryLabel, value: (row) => row.label },
        ...series.map((item) => ({
          id: item.key,
          header: item.label,
          numeric: true,
          value: (row: ChartRow) => row.values[item.key] ?? null,
          cell: (row: ChartRow) => {
            const value = row.values[item.key];
            return value === null || value === undefined ? '—' : valueFormat(value);
          },
        })),
      ]}
    />
  );

  return (
    <section
      ref={cardRef}
      data-visual=""
      data-visual-title={title}
      aria-busy={isLoading || undefined}
      className={cn('bg-card rounded-card flex min-w-0 flex-col border px-4 py-3', className)}
    >
      <div className="flex items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Heading className="text-[0.9375rem] leading-5 font-semibold text-balance">
              {title}
            </Heading>
            {isSample ? <SampleBadge /> : null}
          </div>
          <p className="text-muted-foreground mt-0.5 text-[0.8125rem] leading-5 text-pretty">
            {description}
          </p>
        </div>
        <div className="-mt-0.5 -mr-1.5 flex shrink-0 items-center" data-snapshot-hide="">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={isTable ? `Show ${title} as a chart` : `Show ${title} as a table`}
            aria-pressed={isTable}
            disabled={!ready}
            onClick={() => {
              setIsTable((current) => !current);
            }}
          >
            {isTable ? <ChartNoAxesColumn aria-hidden="true" /> : <Table2 aria-hidden="true" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Open ${title} in focus mode`}
            disabled={!ready}
            onClick={() => {
              setIsFocused(true);
            }}
          >
            <Maximize2 aria-hidden="true" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={`More options for ${title}`}
                disabled={!ready}
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                {title}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={downloadCsv}>
                <Download aria-hidden="true" />
                Download data (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadImage()}>
                <ImageDown aria-hidden="true" />
                Download image (PNG)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {legend && ready && !isTable ? (
        <Legend series={series} shape={legendShape} className="mt-2" />
      ) : null}

      <div className="mt-3 min-w-0">
        {isLoading ? (
          <div role="status" className="flex h-[200px] items-end gap-2" aria-label="Loading">
            {[56, 80, 44, 92, 68, 74, 50, 86].map((height, index) => (
              <Skeleton
                key={index}
                className="flex-1 rounded-b-none"
                style={{ height: `${height}%` }}
              />
            ))}
            <span className="sr-only">Loading {title.toLowerCase()}…</span>
          </div>
        ) : hasError ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center">
            <TriangleAlert className="text-destructive size-5" aria-hidden="true" />
            <p className="text-sm font-medium">This chart could not be loaded</p>
            <p className="text-muted-foreground max-w-xs text-xs">
              The figures are not zero; the request failed.
            </p>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : isEmpty ? (
          <div className="text-muted-foreground flex h-[200px] items-center justify-center px-6 text-center text-sm text-pretty">
            {emptyMessage}
          </div>
        ) : isTable ? (
          <div className="max-h-72 overflow-auto">{table}</div>
        ) : (
          draw('card')
        )}
      </div>

      {footer && ready ? (
        <div className="text-muted-foreground mt-2 text-xs leading-4 text-pretty">{footer}</div>
      ) : null}

      <Dialog open={isFocused} onOpenChange={setIsFocused}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {legend ? <Legend series={series} shape={legendShape} /> : null}
          {isFocused && ready ? draw('focus') : null}
          {footer ? <div className="text-muted-foreground text-xs">{footer}</div> : null}
          {isFocused && ready ? <div className="max-h-80 overflow-auto">{table}</div> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Legend({
  series,
  shape,
  className,
}: {
  series: readonly ChartSeries[];
  shape: 'line' | 'square';
  className?: string;
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs', className)}>
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            className={shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-[3px]'}
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
