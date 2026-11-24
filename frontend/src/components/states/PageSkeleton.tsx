import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Shapes matched to the content a page shows while it loads. */
export type PageSkeletonLayout = 'dashboard' | 'table' | 'detail' | 'form' | 'stockout';

// Ragged widths so the placeholder reads as text, not as a grid of bars. Kept
// as whole class names so Tailwind can see them.
const WIDTHS = [
  'w-[62%]',
  'w-[78%]',
  'w-[54%]',
  'w-[70%]',
  'w-[58%]',
  'w-[82%]',
  'w-[66%]',
  'w-[74%]',
];
const SHORT_WIDTHS = [
  'w-[38%]',
  'w-[44%]',
  'w-[30%]',
  'w-[48%]',
  'w-[34%]',
  'w-[40%]',
  'w-[46%]',
  'w-[36%]',
];

const width = (list: readonly string[], index: number): string =>
  list[index % list.length] ?? 'w-1/2';

function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('bg-card rounded-card overflow-hidden border', className)}>{children}</div>
  );
}

function Line({ className }: { className?: string }) {
  return <Skeleton className={cn('h-2.75 rounded-full', className)} />;
}

function Chip() {
  return <Skeleton className="h-5.5 w-21 shrink-0 rounded-full" />;
}

function TableSkeleton() {
  return (
    <>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-60 max-w-[55%] rounded-lg" />
        <Skeleton className="h-8 w-30 rounded-lg" />
        <Skeleton className="ml-auto h-8 w-28 rounded-lg" />
      </div>
      <Panel>
        <div className="bg-table-head flex h-7.5 items-center gap-4 border-b px-4">
          {[0, 1, 2, 3].map((column) => (
            <Line key={column} className={cn('h-2 flex-1', width(SHORT_WIDTHS, column))} />
          ))}
        </div>
        {WIDTHS.map((_, row) => (
          <div
            key={row}
            className="grid h-12 grid-cols-[1.1fr_1.6fr_minmax(0,1fr)_auto] items-center gap-4 border-b px-4 last:border-b-0 sm:grid-cols-[1.1fr_1.6fr_1.2fr_auto_0.8fr]"
          >
            <Line className={width(WIDTHS, row + 2)} />
            <div className="flex flex-col gap-1.75">
              <Line className={width(WIDTHS, row)} />
              <Line className={cn('h-2.25', width(SHORT_WIDTHS, row + 5))} />
            </div>
            <Line className={width(WIDTHS, row + 3)} />
            <Chip />
            <Line className={cn('hidden sm:block', width(SHORT_WIDTHS, row + 6))} />
          </div>
        ))}
      </Panel>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <Panel key={card} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Line className={cn('h-2.5', width(WIDTHS, card))} />
              <Skeleton className="size-7 shrink-0 rounded-md" />
            </div>
            <Skeleton className="h-7 w-1/3 rounded-md" />
            <Line className={cn('h-2.25', width(SHORT_WIDTHS, card))} />
          </Panel>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <Panel className="min-w-0 flex-[2_1_30rem]">
          <div className="border-b px-3.5 py-3">
            <Line className="h-3 w-35" />
          </div>
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="flex items-center gap-3.5 border-b px-3.5 py-2.5 last:border-b-0"
            >
              <Chip />
              <div className="flex min-w-0 flex-1 flex-col gap-1.75">
                <Line className={width(WIDTHS, row)} />
                <Line className={cn('h-2.25', width(SHORT_WIDTHS, row))} />
              </div>
              <Skeleton className="hidden h-8 w-28 shrink-0 rounded-lg sm:block" />
            </div>
          ))}
        </Panel>
        <Panel className="flex min-w-0 flex-[1_1_18rem] flex-col gap-4.5 px-3.5 py-3">
          <Line className="h-3 w-30" />
          {[0, 1].map((row) => (
            <div key={row} className="flex flex-col gap-2">
              <div className="flex justify-between gap-3">
                <Line className="w-[45%]" />
                <Line className="w-[18%]" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
              <Line className="h-2.25 w-2/5" />
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}

function SummaryPanel({ rows }: { rows: number }) {
  return (
    <Panel className="flex min-w-0 flex-[1_1_18rem] flex-col gap-3.5 px-3.5 py-3">
      <Line className="h-2.5 w-[30%]" />
      <Skeleton className="h-3.5 w-3/5 rounded-md" />
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex justify-between gap-3">
          <Line className="h-2.5 w-[35%]" />
          <Line className={cn('h-2.5', width(SHORT_WIDTHS, row + 6))} />
        </div>
      ))}
    </Panel>
  );
}

function DetailSkeleton() {
  return (
    <>
      <Panel>
        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-32 rounded-md" />
            <Chip />
          </div>
          <Line className="h-2.5 w-[min(23.75rem,70%)]" />
        </div>
        <div className="grid grid-cols-3 gap-3 border-t px-3.5 pt-2.5 pb-4 sm:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((step) => (
            <div key={step} className="flex flex-col gap-2">
              <Skeleton className="h-1 rounded-full" />
              <Line className={cn('h-2.25', width(WIDTHS, step + 3))} />
            </div>
          ))}
        </div>
      </Panel>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-[2_1_32rem] flex-col gap-3">
          <Skeleton className="rounded-card h-15 w-full" />
          <Panel>
            <div className="border-b px-3.5 py-3">
              <Line className="h-3 w-30" />
            </div>
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-4 border-b px-3.5 py-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr]"
              >
                <div className="flex flex-col gap-1.75">
                  <Line className={width(WIDTHS, row)} />
                  <Line className={cn('h-2.25', width(SHORT_WIDTHS, row))} />
                </div>
                <Line className={width(SHORT_WIDTHS, row + 6)} />
                <Skeleton className="h-7.5 w-full rounded-lg" />
                <Line className={cn('hidden sm:block', width(WIDTHS, row + 3))} />
              </div>
            ))}
            <div className="bg-table-head flex justify-end gap-2.5 px-3.5 py-2.5">
              <Skeleton className="h-8 w-30 rounded-lg" />
              <Skeleton className="h-8 w-50 max-w-[50%] rounded-lg" />
            </div>
          </Panel>
        </div>
        <SummaryPanel rows={4} />
      </div>
    </>
  );
}

/** The stockout request's progress, send form, request and contact cards. */
function StockoutSkeleton() {
  return (
    <>
      <Panel>
        <div className="flex flex-col gap-2 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-40" />
            <Chip />
          </div>
          <Line className="h-2.5 w-[min(24rem,75%)]" />
        </div>
        <div className="bg-muted/40 flex flex-wrap gap-3 border-t px-4 pt-2 pb-3">
          {[0, 1, 2].map((step) => (
            <div key={step} className="flex min-w-0 flex-[1_1_6.5rem] flex-col gap-1.5">
              <Skeleton className="h-1 rounded-full" />
              <Line className="mt-1 h-2 w-1/3" />
              <Line className={cn('h-3', width(WIDTHS, step))} />
            </div>
          ))}
        </div>
      </Panel>
      <div className="gap-section grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="gap-section flex min-w-0 flex-col">
          <div className="bg-card rounded-lg border px-3 py-3">
            <Line className="h-3 w-40" />
            <Line className="mt-2 h-2.5 w-4/5" />
          </div>
          <div className="flex flex-col gap-4">
            <Line className="h-3 w-36" />
            <div className="divide-y border-y">
              {[0, 1].map((row) => (
                <div key={row} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Line className={cn('h-3', width(WIDTHS, row))} />
                    <Line className="h-2.5 w-2/5" />
                  </div>
                  <Skeleton className="h-8 w-24 shrink-0 rounded-lg" />
                  <Line className="hidden w-12 sm:block" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Line className="h-2.5 w-28" />
              <Skeleton className="h-8 w-full rounded-lg" />
              <Line className="h-2 w-2/3" />
            </div>
            <div className="flex flex-col gap-2">
              <Line className="h-2.5 w-24" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
            <Skeleton className="h-8 w-36 rounded-lg" />
          </div>
        </div>
        <div className="gap-section flex min-w-0 flex-col">
          <Panel className="flex flex-col gap-3.5 px-4 py-3">
            <Line className="h-3 w-20" />
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center justify-between gap-3">
                <Line className="h-2.5 w-1/3" />
                <Line className={cn('h-2.5', width(SHORT_WIDTHS, row + 6))} />
              </div>
            ))}
            <Skeleton className="h-7 w-40 rounded-lg" />
          </Panel>
          <Panel className="flex flex-col gap-3.5 px-4 py-3">
            <Line className="h-3 w-20" />
            <Line className="h-3 w-2/3" />
            <Line className="h-2.5 w-4/5" />
            <Skeleton className="h-7 w-32 rounded-lg" />
          </Panel>
        </div>
      </div>
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Panel className="min-w-0 flex-[2_1_32rem]">
        {[0, 1, 2].map((section) => (
          <div key={section} className="flex flex-col gap-3.5 border-b px-3.5 py-3 last:border-b-0">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <Line className="h-3 w-40" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[0, 1].map((field) => (
                <div key={field} className="flex flex-col gap-2">
                  <Line className={cn('h-2.25', width(SHORT_WIDTHS, section + field))} />
                  <Skeleton className="h-8 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </Panel>
      <SummaryPanel rows={3} />
    </div>
  );
}

const LAYOUTS: Record<PageSkeletonLayout, () => ReactNode> = {
  table: TableSkeleton,
  dashboard: DashboardSkeleton,
  detail: DetailSkeleton,
  form: FormSkeleton,
  stockout: StockoutSkeleton,
};

interface PageSkeletonProps {
  /** Which shape to draw: match it to the page that is loading. */
  layout: PageSkeletonLayout;
  className?: string;
}

/**
 * A placeholder in the shape of the page that is loading, so the layout does
 * not jump when the content arrives. Announced once as "Loading page"; the
 * shapes themselves are hidden from assistive technology.
 *
 * Usage: `<PageSkeleton layout="table" />`. The route loading state picks the
 * layout from the navigation table.
 */
export function PageSkeleton({ layout, className }: PageSkeletonProps) {
  const Layout = LAYOUTS[layout];
  return (
    <div
      role="status"
      aria-busy="true"
      data-layout={layout}
      className={cn('motion-reduce:**:data-[slot=skeleton]:animate-none', className)}
    >
      <span className="sr-only">Loading page…</span>
      <div aria-hidden="true" className="gap-section flex flex-col">
        <Layout />
      </div>
    </div>
  );
}
