'use client';

import { BadgeCheck, Package, PackageCheck, Send, Timer, Truck, Warehouse } from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { hoursLabel, percentLabel } from '@/components/charts/format';
import { FunnelChart } from '@/components/charts/FunnelChart';
import { SegmentedBar } from '@/components/charts/SegmentedBar';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatNumber } from '@/lib/format';

import { apiParams } from '../filters';
import { useSupplyReport, useTrends } from '../queries';
import type { ReportFilters } from '../useReportFilters';
import {
  INTERVAL_WORD,
  isFlat,
  percentOrNa,
  QualityNote,
  ReportSection,
  series,
  trendRows,
  VisualGrid,
  type AnalyticsWorkspace,
  piecesValue,
} from './shared';

interface SupplyViewProps {
  filters: ReportFilters;
  workspace: AnalyticsWorkspace;
  /** The warehouse a warehouse workspace shows. */
  storeId?: string | undefined;
}

/** District orders to the national warehouses: requested, approved, issued and received, in pieces. */
export function SupplyView({ filters, workspace, storeId }: SupplyViewProps) {
  const own: Record<string, string> = storeId ? { warehouse_store_id: storeId } : {};
  const report = useSupplyReport({
    ...apiParams(filters.state, ['from', 'to', 'district_id', 'category', 'warehouse_store_id']),
    ...own,
  });
  const trend = useTrends({
    ...apiParams(filters.state, [
      'from',
      'to',
      'interval',
      'district_id',
      'category',
      'warehouse_store_id',
    ]),
    ...own,
  });
  const data = report.data;
  const total = data?.total;
  const loading = report.isPending;
  const retry = () => void report.refetch();
  const caption = `vs ${INTERVAL_WORD[trend.data?.interval ?? filters.interval]}`;
  const trendData = trendRows(trend.data, (b) => ({
    requested: b.requests.requested_pieces,
    issued: b.requests.issued_pieces,
    received: b.requests.acknowledged_pieces,
  }));
  const unrequested = data?.dispatches_without_request;

  return (
    <div className="gap-section flex flex-col">
      <StatCardGrid>
        <StatCard
          label="Orders raised"
          value={formatNumber(total?.requests)}
          icon={Warehouse}
          accent="info"
          isLoading={loading}
          detail={
            total
              ? `${formatNumber(total.pending)} open · ${formatNumber(total.rejected)} rejected`
              : undefined
          }
          trend={
            trend.data && trend.data.buckets.length > 1
              ? { series: series(trend.data, (b) => b.requests.requests), caption }
              : undefined
          }
        />
        <StatCard
          label="Requested"
          value={total ? piecesValue(total.requested_pieces) : ''}
          icon={Package}
          isLoading={loading}
        />
        <StatCard
          label="Issued by warehouses"
          value={total ? piecesValue(total.issued_pieces) : ''}
          icon={Send}
          accent="violet"
          isLoading={loading}
          detail={total ? `${formatNumber(total.approved_pieces)} pcs approved` : undefined}
        />
        <StatCard
          label="Received by districts"
          value={total ? piecesValue(total.acknowledged_pieces) : ''}
          icon={PackageCheck}
          accent="positive"
          isLoading={loading}
          detail={
            total
              ? `${percentOrNa(total.quantity_fulfilment_rate)} of the pieces requested`
              : undefined
          }
        />
        <StatCard
          label="Median time to receive"
          value={
            data
              ? data.response.median_hours === null
                ? 'Not applicable'
                : hoursLabel(data.response.median_hours)
              : ''
          }
          icon={Timer}
          isLoading={loading}
          detail={
            data && data.response.oldest_pending_hours !== null
              ? `Oldest open: ${hoursLabel(data.response.oldest_pending_hours)}`
              : 'From the order to the district counting it in'
          }
        />
        <StatCard
          label="Fully received"
          value={formatNumber(total?.fully_received)}
          icon={BadgeCheck}
          accent="positive"
          isLoading={loading}
          detail={total ? `${formatNumber(total.partly_received)} partly received` : undefined}
        />
      </StatCardGrid>

      {unrequested && unrequested.dispatches > 0 ? (
        <Alert variant="info">
          <Truck aria-hidden="true" />
          <AlertTitle>
            {formatNumber(unrequested.dispatches)} dispatch
            {unrequested.dispatches === 1 ? '' : 'es'} sent without a district order
          </AlertTitle>
          <AlertDescription>
            {formatNumber(unrequested.issued_pieces)} pcs sent,{' '}
            {formatNumber(unrequested.received_pieces)} pcs received so far
            {unrequested.awaiting_receipt > 0
              ? `, ${formatNumber(unrequested.awaiting_receipt)} still in transit`
              : ''}
            . They are not part of the order totals or the fulfilment rate.
          </AlertDescription>
        </Alert>
      ) : null}

      <ReportSection
        title="Pipeline"
        description="Orders raised in the period, from request to receipt."
      >
        <VisualGrid columns={3}>
          <FunnelChart
            title="From request to receipt"
            description="Pieces at each stage of the orders raised in the period."
            unit="Pieces"
            stages={
              total && total.requests > 0
                ? [
                    { label: 'Requested', value: total.requested_pieces },
                    { label: 'Approved', value: total.approved_pieces },
                    { label: 'Issued', value: total.issued_pieces },
                    { label: 'Received', value: total.acknowledged_pieces },
                  ]
                : []
            }
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No orders were raised in this period."
          />
          <SegmentedBar
            title="Order status"
            description="Where each order raised in the period stands now."
            totalLabel="Orders raised"
            segments={
              total && total.requests > 0
                ? [
                    {
                      key: 'full',
                      label: 'Fully received',
                      value: total.fully_received,
                      color: 'var(--success)',
                      ink: 'surface',
                    },
                    {
                      key: 'partly',
                      label: 'Partly received',
                      value: total.partly_received,
                      color: 'var(--info)',
                      ink: 'surface',
                    },
                    {
                      key: 'pending',
                      label: 'Open',
                      value: total.pending,
                      color: 'var(--warning)',
                      ink: 'surface',
                    },
                    {
                      key: 'rejected',
                      label: 'Rejected',
                      value: total.rejected,
                      color: 'var(--role-system)',
                    },
                  ]
                : []
            }
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No orders were raised in this period."
          />
          <ColumnChart
            title="By condom type"
            description="Pieces requested and received, by type."
            categoryLabel="Type"
            series={[
              { key: 'requested', label: 'Requested', color: 'var(--chart-1)' },
              { key: 'received', label: 'Received', color: 'var(--chart-2)' },
            ]}
            rows={(data?.by_type ?? []).map((group) => ({
              label: group.name ?? 'Not recorded',
              values: { requested: group.requested_pieces, received: group.acknowledged_pieces },
            }))}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No orders were raised in this period."
          />
        </VisualGrid>
        {total && (total.unconverted > 0 || total.awaiting_unit > 0) ? (
          <QualityNote>
            {total.awaiting_unit > 0
              ? `${formatNumber(total.awaiting_unit)} order${total.awaiting_unit === 1 ? '' : 's'} name only a category: the warehouse sets the product and unit at review, so their pieces are counted from then. `
              : ''}
            {total.unconverted > 0
              ? `Quality issue: ${formatNumber(total.unconverted)} order${total.unconverted === 1 ? ' is' : 's are'} in a unit that cannot be converted to pieces, and left out of the piece totals.`
              : ''}
          </QualityNote>
        ) : null}
      </ReportSection>

      <ReportSection title="Over time" description="By the day each order was placed.">
        <ColumnChart
          title="Requested, issued and received"
          description="Pieces of the orders placed in each period, by how far they got."
          categoryLabel="Period"
          series={[
            { key: 'requested', label: 'Requested', color: 'var(--chart-1)' },
            { key: 'issued', label: 'Issued', color: 'var(--chart-3)' },
            { key: 'received', label: 'Received', color: 'var(--chart-2)' },
          ]}
          rows={isFlat(trendData) ? [] : trendData}
          isLoading={trend.isPending}
          error={trend.error}
          onRetry={() => void trend.refetch()}
          emptyMessage="No orders were placed in this period."
        />
      </ReportSection>

      <ReportSection title="By warehouse and district">
        <VisualGrid>
          {workspace !== 'warehouse' ? (
            <ColumnChart
              title="By warehouse"
              description="Pieces requested from and issued by each national warehouse."
              categoryLabel="Warehouse"
              series={[
                { key: 'requested', label: 'Requested', color: 'var(--chart-1)' },
                { key: 'issued', label: 'Issued', color: 'var(--chart-3)' },
                { key: 'received', label: 'Received', color: 'var(--chart-2)' },
              ]}
              rows={(data?.by_warehouse ?? []).map((group) => ({
                label: group.name ?? 'Not recorded',
                values: {
                  requested: group.requested_pieces,
                  issued: group.issued_pieces,
                  received: group.acknowledged_pieces,
                },
              }))}
              isLoading={loading}
              error={report.error}
              onRetry={retry}
              emptyMessage="No orders were raised in this period."
            />
          ) : null}
          <BarChart
            title="Requested by district"
            description="Pieces requested in the period by each district store."
            categoryLabel="District"
            series={{ key: 'requested', label: 'Requested pieces', color: 'var(--chart-1)' }}
            rows={(data?.by_district ?? []).map((group) => ({
              label: group.name ?? 'Not recorded',
              values: { requested: group.requested_pieces },
            }))}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No orders were raised in this period."
          />
          <BarChart
            title="Quantity received by district"
            description="Pieces counted in by the district, of the pieces it requested."
            categoryLabel="District"
            series={{ key: 'rate', label: 'Received of requested', color: 'var(--chart-2)' }}
            rows={(data?.by_district ?? [])
              .filter((group) => group.quantity_fulfilment_rate !== null)
              .map((group) => ({
                label: group.name ?? 'Not recorded',
                values: { rate: group.quantity_fulfilment_rate },
              }))}
            valueFormat={percentLabel}
            xMax={100}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No orders in this period have pieces to compare."
          />
        </VisualGrid>
      </ReportSection>
    </div>
  );
}
