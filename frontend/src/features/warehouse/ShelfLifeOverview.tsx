import { PackageOpen } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Band } from '@/features/inventory/api';
import { BAND_STATUS } from '@/features/inventory/bands';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

import { BAND_ORDER, bandAcrossUnits, type UnitShelfLife } from './shelfLife';
import { formatStock, unitSuffix } from './summary';

/**
 * Each band's fill. Reds can't leave (or leave only by exception), oranges are warnings, green is
 * healthy and grey is unknown. The legend names every band in words, so colour is never alone, and
 * a 2px gap separates neighbouring bands whatever their contrast.
 */
const BAND_FILL: Record<Band, string> = {
  expired: 'bg-destructive',
  under_1_month: 'bg-destructive/45',
  under_3_months: 'bg-warning',
  under_6_months: 'bg-warning/40',
  ok: 'bg-primary',
  unknown: 'bg-muted-foreground/35',
};

const batchCount = (count: number) => `${formatNumber(count)} ${count === 1 ? 'batch' : 'batches'}`;

interface ShelfLifeOverviewProps {
  code: string;
  units: readonly UnitShelfLife[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  isRetrying: boolean;
  /** The batch list showing one band. */
  hrefForBand: (band: Band) => string;
}

/**
 * The store's stock against its expiry dates: a bar per unit of measure split into six shelf-life
 * bands, and a legend whose entries open the batches in each band. Stock is in pieces, so there is
 * normally one bar; an old record in another unit gets its own, named.
 */
export function ShelfLifeOverview({
  code,
  units,
  isLoading,
  error,
  onRetry,
  isRetrying,
  hrefForBand,
}: ShelfLifeOverviewProps) {
  const hasFailed = error !== undefined && error !== null;
  return (
    <Card className="@container min-w-0 gap-0 py-0">
      <CardHeader className="border-b py-3">
        <CardTitle>Shelf life of stock at {code}</CardTitle>
        <CardDescription>
          Every batch held, by how long it has left. Stock leaves in this order, earliest expiry
          first.
        </CardDescription>
      </CardHeader>
      {hasFailed ? (
        <ErrorState
          title={`Could not load the batches at ${code}`}
          error={error}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      ) : isLoading || !units ? (
        <CardContent className="flex flex-col gap-3 py-3" role="status">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full rounded-full" />
          <div className="grid gap-2 @sm:grid-cols-2 @xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
          <span className="sr-only">Loading shelf life…</span>
        </CardContent>
      ) : units.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title={`No stock held at ${code}`}
          description="Once stock is registered, its batches are shown here by how long they have left."
        />
      ) : (
        <CardContent className="flex flex-col gap-3 py-3">
          <div className="flex flex-col gap-3">
            {units.map((unit) => {
              const held = unit.bands.filter((share) => share.quantity > 0);
              const onHand = `${formatNumber(unit.total)}${unitSuffix(unit.unit)} on hand`;
              return (
                <div key={unit.unit} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span className="font-medium tabular-nums">{onHand}</span>
                    <span className="text-muted-foreground text-[0.8125rem] tabular-nums">
                      {batchCount(unit.batches)}
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={`Of ${onHand}: ${held
                      .map(
                        (share) =>
                          `${formatNumber(share.quantity)} ${BAND_STATUS[share.band].label.toLowerCase()}`,
                      )
                      .join(', ')}`}
                    className="bg-muted flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
                  >
                    {held.map((share) => (
                      <div
                        key={share.band}
                        title={`${BAND_STATUS[share.band].label}: ${formatNumber(share.quantity)}${unitSuffix(unit.unit)}, ${batchCount(share.batches)}`}
                        className={cn('h-full min-w-1', BAND_FILL[share.band])}
                        style={{ flexGrow: share.quantity, flexBasis: 0 }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <ul
            aria-label="Shelf-life bands"
            className="grid gap-x-4 gap-y-1 border-t pt-3 @sm:grid-cols-2 @xl:grid-cols-3"
          >
            {BAND_ORDER.map((band) => {
              const { amounts, batches } = bandAcrossUnits(units, band);
              const content = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn('mt-1 size-2.5 shrink-0 rounded-sm', BAND_FILL[band])}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{BAND_STATUS[band].label}</span>
                    <span className="text-muted-foreground block text-xs break-words tabular-nums">
                      {batches > 0 ? `${formatStock(amounts)} · ${batchCount(batches)}` : 'None'}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={band}>
                  {batches > 0 ? (
                    <Link
                      href={hrefForBand(band)}
                      scroll={false}
                      className="hover:bg-muted focus-visible:ring-ring -mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-1 outline-none focus-visible:ring-2"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="-mx-1.5 flex items-start gap-2 px-1.5 py-1">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
