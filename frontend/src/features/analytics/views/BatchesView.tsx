'use client';

import { CalendarClock, CalendarX, Layers, ShieldAlert, TriangleAlert } from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { SegmentedBar } from '@/components/charts/SegmentedBar';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { formatNumber } from '@/lib/format';

import { EXPIRY_BANDS, type BatchLine } from '../api';
import { apiParams, kampalaToday } from '../filters';
import { useBatchReport, useExpiryExceptions } from '../queries';
import type { ReportFilters } from '../useReportFilters';
import { BAND_COLORS, BAND_LABELS, ReportSection, sumBy, VisualGrid, piecesValue } from './shared';

/** The next twelve calendar months from `today`, as YYYY-MM. */
function nextMonths(today: string, count = 12): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(year, month + index, 1)).toISOString().slice(0, 7),
  );
}

function monthName(key: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${key}-01T00:00:00Z`));
}

/** Batches in stock by the time left before they expire, and when the stock runs out of date. */
export function BatchesView({
  filters,
  storeId,
}: {
  filters: ReportFilters;
  storeId?: string | undefined;
}) {
  const params = {
    ...apiParams(filters.state, ['district_id', 'category', 'store_type', 'band']),
    ...(storeId ? { store_id: storeId } : {}),
  };
  const report = useBatchReport(params);
  const lines = report.data?.lines ?? [];
  const loading = report.isPending;
  const retry = () => void report.refetch();
  const bands = sumBy(
    lines,
    (line) => line.band,
    (line) => line.pieces,
  );
  const pieces = (band: BatchLine['band']) => bands.get(band) ?? 0;
  const months = nextMonths(kampalaToday());
  const byMonth = sumBy(
    lines.filter((line) => line.expiry_date !== null),
    (line) => (line.expiry_date ?? '').slice(0, 7),
    (line) => line.pieces,
  );
  const atRisk = sumBy(
    lines.filter(
      (line) =>
        line.band === 'expired' ||
        line.band === 'under_1_month' ||
        line.band === 'under_3_months' ||
        line.band === 'under_6_months',
    ),
    (line) => line.store,
    (line) => line.pieces,
  );

  return (
    <div className="gap-section flex flex-col">
      <StatCardGrid>
        <StatCard
          label="Batches in stock"
          value={report.data ? formatNumber(lines.length) : ''}
          icon={Layers}
          isLoading={loading}
        />
        <StatCard
          label="Expired"
          value={report.data ? piecesValue(pieces('expired')) : ''}
          icon={CalendarX}
          accent="caution"
          isLoading={loading}
          detail="Still on hand; to separate and dispose of"
        />
        <StatCard
          label="Under 1 month left"
          value={report.data ? piecesValue(pieces('under_1_month')) : ''}
          icon={TriangleAlert}
          accent="caution"
          isLoading={loading}
        />
        <StatCard
          label="1 to 3 months left"
          value={report.data ? piecesValue(pieces('under_3_months')) : ''}
          icon={CalendarClock}
          accent="caution"
          isLoading={loading}
        />
        <StatCard
          label="3 to 6 months left"
          value={report.data ? piecesValue(pieces('under_6_months')) : ''}
          icon={CalendarClock}
          accent="info"
          isLoading={loading}
          detail="Inside the six-month notice to MOH"
        />
        <StatCard
          label="No expiry date"
          value={report.data ? piecesValue(pieces('unknown')) : ''}
          icon={ShieldAlert}
          isLoading={loading}
          detail="Not usable until the batch is reviewed"
        />
      </StatCardGrid>

      <ReportSection
        title="Expiry risk"
        description="Pieces in stock today, by batch expiry. Issue first-expiry-first-out (FEFO)."
      >
        <VisualGrid>
          <SegmentedBar
            title="Pieces by time left"
            description="Every batch in stock, by the calendar months left before it expires."
            totalLabel="Pieces in stock"
            segments={
              lines.length > 0
                ? EXPIRY_BANDS.map((band) => ({
                    key: band,
                    label: BAND_LABELS[band],
                    value: pieces(band),
                    ...BAND_COLORS[band],
                  }))
                : []
            }
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No batches are in stock for these filters."
          />
          <ColumnChart
            title="Pieces expiring by month"
            description="The next twelve months; stock already expired is counted above."
            categoryLabel="Month"
            series={{ key: 'pieces', label: 'Pieces expiring', color: 'var(--chart-4)' }}
            rows={
              lines.length > 0
                ? months.map((key) => ({
                    label: monthName(key),
                    values: { pieces: byMonth.get(key) ?? 0 },
                  }))
                : []
            }
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No batches are in stock for these filters."
          />
          <BarChart
            title="Stores holding stock with under 6 months left"
            description="Pieces expired or expiring within six months, by store."
            categoryLabel="Store"
            series={{ key: 'pieces', label: 'Pieces at risk', color: 'var(--chart-5)' }}
            rows={[...atRisk.entries()].map(([label, value]) => ({
              label,
              values: { pieces: value },
            }))}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No store holds stock with under six months left."
          />
        </VisualGrid>
      </ReportSection>
    </div>
  );
}

/** Batches with under a month left that left a store anyway, with the documented reason. */
export function ExceptionsView({
  filters,
  storeId,
}: {
  filters: ReportFilters;
  storeId?: string | undefined;
}) {
  const report = useExpiryExceptions({
    ...apiParams(filters.state, ['from', 'to', 'district_id', 'category', 'store_type']),
    ...(storeId ? { store_id: storeId } : {}),
  });
  const rows = report.data ?? [];
  const byReason = sumBy(
    rows,
    (row) => row.reason,
    (row) => row.quantity,
  );
  const byStore = sumBy(
    rows,
    (row) => row.store,
    (row) => row.quantity,
  );
  const retry = () => void report.refetch();
  return (
    <div className="gap-section flex flex-col">
      <StatCardGrid>
        <StatCard
          label="Exceptions"
          value={report.data ? formatNumber(rows.length) : ''}
          icon={ShieldAlert}
          accent="caution"
          isLoading={report.isPending}
        />
        <StatCard
          label="Quantity shipped near expiry"
          value={report.data ? formatNumber(rows.reduce((sum, row) => sum + row.quantity, 0)) : ''}
          icon={CalendarClock}
          isLoading={report.isPending}
          detail="In each batch's own unit"
        />
      </StatCardGrid>
      <VisualGrid>
        <BarChart
          title="By reason"
          description="Quantity that left with under a month of shelf life, by the documented reason."
          categoryLabel="Reason"
          series={{ key: 'quantity', label: 'Quantity', color: 'var(--chart-4)' }}
          rows={[...byReason.entries()].map(([label, value]) => ({
            label,
            values: { quantity: value },
          }))}
          isLoading={report.isPending}
          error={report.error}
          onRetry={retry}
          emptyMessage="No near-expiry stock left a store in this period."
        />
        <BarChart
          title="By store"
          description="Quantity that left each store with under a month of shelf life."
          categoryLabel="Store"
          series={{ key: 'quantity', label: 'Quantity', color: 'var(--chart-5)' }}
          rows={[...byStore.entries()].map(([label, value]) => ({
            label,
            values: { quantity: value },
          }))}
          isLoading={report.isPending}
          error={report.error}
          onRetry={retry}
          emptyMessage="No near-expiry stock left a store in this period."
        />
      </VisualGrid>
    </div>
  );
}
