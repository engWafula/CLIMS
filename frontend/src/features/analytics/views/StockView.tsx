'use client';

import { CalendarX, Gauge, Package, PackageOpen, Scale, Truck } from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { SegmentedBar } from '@/components/charts/SegmentedBar';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { formatNumber, formatTimestamp } from '@/lib/format';

import type { StockLine } from '../api';
import { apiParams } from '../filters';
import { useStockReport } from '../queries';
import type { ReportFilters } from '../useReportFilters';
import {
  GUIDELINE_NOTE,
  MAX_MONTHS,
  MIN_MONTHS,
  QualityNote,
  ReportSection,
  sumBy,
  VisualGrid,
  type AnalyticsWorkspace,
  piecesValue,
} from './shared';

/** Pieces in one unit of a line's stock, when its unit is the product's catalogue unit. */
function piecesPerUnit(line: StockLine): number | null {
  if (line.physical_pieces !== null && line.physical > 0)
    return line.physical_pieces / line.physical;
  if (line.usable_pieces !== null && line.usable > 0) return line.usable_pieces / line.usable;
  return null;
}

function inPieces(line: StockLine, units: number): number | null {
  const per = piecesPerUnit(line);
  return per === null ? null : Math.round(units * per);
}

/** "today, 08:40" or "21 Nov 2026, 14:05", to follow "as of" mid-sentence. */
function asOf(timestamp: string): string {
  const text = formatTimestamp(timestamp);
  return /^(Today|Yesterday)/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

const COVERAGE_WORDS: Record<string, string> = {
  unavailable_short_history: 'the ledger does not cover the whole three-month window yet',
  unavailable_unreconciled: 'the ledger does not reconcile',
  unavailable_no_issues: 'nothing was issued in the window',
};

/** Stock held at warehouses and district stores today, and how long it lasts at the recent rate of issue. */
export function StockView({
  filters,
  workspace,
  storeId,
}: {
  filters: ReportFilters;
  workspace: AnalyticsWorkspace;
  storeId?: string | undefined;
}) {
  const report = useStockReport({
    ...apiParams(filters.state, ['district_id', 'category', 'store_type']),
    ...(storeId ? { store_id: storeId } : {}),
  });
  const lines = report.data?.lines ?? [];
  const loading = report.isPending;
  const retry = () => void report.refetch();
  const sum = (pick: (line: StockLine) => number | null) =>
    lines.reduce((total, line) => total + (pick(line) ?? 0), 0);
  const covered = lines.filter((line) => line.months_of_stock !== null);
  const low = covered.filter((line) => (line.months_of_stock ?? 0) < MIN_MONTHS);
  const unreconciled = lines.filter((line) => !line.reconciled || !line.batches_reconciled);
  const reasons = sumBy(
    lines.filter((line) => line.months_of_stock === null),
    (line) => line.coverage_status,
    () => 1,
  );
  const groupKey = (line: StockLine) => (workspace === 'warehouse' ? line.product : line.store);
  const composition = new Map<string, Record<string, number>>();
  for (const line of lines) {
    const entry = composition.get(groupKey(line)) ?? {
      usable: 0,
      reserved: 0,
      expired: 0,
      unknown: 0,
    };
    entry.usable = (entry.usable ?? 0) + (line.usable_pieces ?? 0);
    entry.reserved = (entry.reserved ?? 0) + (inPieces(line, line.reserved) ?? 0);
    entry.expired = (entry.expired ?? 0) + (inPieces(line, line.expired) ?? 0);
    entry.unknown = (entry.unknown ?? 0) + (inPieces(line, line.unknown_expiry) ?? 0);
    composition.set(groupKey(line), entry);
  }
  const byProduct = sumBy(
    lines,
    (line) => line.product,
    (line) => line.usable_pieces,
  );
  const byLevel = sumBy(
    lines,
    (line) => line.store_type,
    (line) => line.usable_pieces,
  );

  return (
    <div className="gap-section flex flex-col">
      <StatCardGrid>
        <StatCard
          label="Physical stock"
          value={report.data ? piecesValue(sum((l) => l.physical_pieces)) : ''}
          icon={Package}
          isLoading={loading}
        />
        <StatCard
          label="Usable stock"
          value={report.data ? piecesValue(sum((l) => l.usable_pieces)) : ''}
          icon={PackageOpen}
          accent="positive"
          isLoading={loading}
          detail="Physical less expired, unknown-expiry and reserved"
        />
        <StatCard
          label="In transit"
          value={report.data ? piecesValue(sum((l) => l.in_transit_pieces)) : ''}
          icon={Truck}
          accent="info"
          isLoading={loading}
          detail="Dispatched to a store, not yet received"
        />
        <StatCard
          label="Expired, still on hand"
          value={report.data ? piecesValue(sum((l) => inPieces(l, l.expired))) : ''}
          icon={CalendarX}
          accent="caution"
          isLoading={loading}
        />
        <StatCard
          label="Below 2 months of stock"
          value={report.data ? formatNumber(low.length) : ''}
          icon={Gauge}
          accent="caution"
          isLoading={loading}
          detail={
            report.data
              ? `${formatNumber(covered.length)} of ${formatNumber(lines.length)} stock lines have a coverage figure`
              : undefined
          }
        />
        <StatCard
          label="Not reconciled"
          value={report.data ? formatNumber(unreconciled.length) : ''}
          icon={Scale}
          accent={unreconciled.length > 0 ? 'caution' : 'neutral'}
          isLoading={loading}
          detail="Stock lines whose ledger or batches do not add up to the balance"
        />
      </StatCardGrid>

      <ReportSection
        title="What is held"
        description={
          report.data ? `Stock as of ${asOf(report.data.stock_date)}, in pieces.` : undefined
        }
      >
        <VisualGrid>
          <BarChart
            title={workspace === 'warehouse' ? 'Stock by product' : 'Stock by store'}
            description="Usable stock and what is held back from use."
            categoryLabel={workspace === 'warehouse' ? 'Product' : 'Store'}
            series={[
              { key: 'usable', label: 'Usable', color: 'var(--chart-2)' },
              { key: 'reserved', label: 'Reserved', color: 'var(--chart-1)' },
              { key: 'expired', label: 'Expired', color: 'var(--chart-5)' },
              { key: 'unknown', label: 'Expiry unknown', color: 'var(--chart-4)' },
            ]}
            rows={[...composition.entries()]
              .map(([label, values]) => ({ label, values }))
              .filter((row) => Object.values(row.values).some((v) => v > 0))}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No stock is recorded for these filters."
          />
          <BarChart
            title="Months of stock"
            description="Usable stock divided by average monthly issues over the last three complete months."
            categoryLabel="Store and product"
            series={{ key: 'months', label: 'Months of stock', color: 'var(--chart-1)' }}
            rows={covered.map((line) => ({
              label: `${line.store} · ${line.product}`,
              values: { months: line.months_of_stock },
            }))}
            valueFormat={(value) => `${formatNumber(Math.round(value * 10) / 10)} mo`}
            sort="ascending"
            highlight={(row) =>
              (row.values.months ?? 0) < MIN_MONTHS ? 'var(--warning)' : undefined
            }
            reference={{ value: MIN_MONTHS, label: `Minimum ${MIN_MONTHS} months` }}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage={
              reasons.size > 0
                ? `No coverage figure yet: ${[...reasons.keys()].map((key) => COVERAGE_WORDS[key] ?? key.replace(/_/g, ' ')).join('; ')}.`
                : 'No stock lines for these filters.'
            }
            footer={`Lowest first; orange bars are under the minimum. ${GUIDELINE_NOTE} Maximum ${MAX_MONTHS} months. Issue-based coverage: it does not measure consumption.`}
          />
          <ColumnChart
            title="Usable stock by product"
            description="Pieces ready to issue, by product."
            categoryLabel="Product"
            series={{ key: 'pieces', label: 'Usable pieces', color: 'var(--chart-3)' }}
            rows={[...byProduct.entries()].map(([label, value]) => ({
              label,
              values: { pieces: value },
            }))}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No stock is recorded for these filters."
          />
          {workspace === 'moh' ? (
            <SegmentedBar
              title="Where usable stock is held"
              description="National warehouses against district stores."
              totalLabel="Usable pieces"
              segments={
                lines.length > 0
                  ? [
                      {
                        key: 'national',
                        label: 'National warehouses',
                        value: byLevel.get('national') ?? 0,
                        color: 'var(--chart-1)',
                      },
                      {
                        key: 'district',
                        label: 'District stores',
                        value: byLevel.get('district') ?? 0,
                        color: 'var(--chart-2)',
                      },
                    ]
                  : []
              }
              isLoading={loading}
              error={report.error}
              onRetry={retry}
            />
          ) : null}
        </VisualGrid>
        {report.data ? <QualityNote>{report.data.coverage_method}</QualityNote> : null}
      </ReportSection>
    </div>
  );
}
