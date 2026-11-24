'use client';

import {
  CalendarClock,
  Megaphone,
  PackageCheck,
  Store,
  Timer,
  Truck,
  Warehouse,
  MapPin,
} from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { hoursLabel, percentLabel } from '@/components/charts/format';
import { FunnelChart } from '@/components/charts/FunnelChart';
import { SegmentedBar } from '@/components/charts/SegmentedBar';
import { TrendChart } from '@/components/charts/TrendChart';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { formatNumber } from '@/lib/format';

import { EXPIRY_BANDS } from '../api';
import { apiParams } from '../filters';
import {
  useBatchReport,
  useHotspotReport,
  useNotificationReport,
  useStockReport,
  useSupplyReport,
  useTrends,
} from '../queries';
import type { ReportFilters } from '../useReportFilters';
import {
  BAND_COLORS,
  BAND_LABELS,
  INTERVAL_WORD,
  isFlat,
  percentOrNa,
  ReportSection,
  series,
  statusSegments,
  sumBy,
  trendRows,
  VisualGrid,
  type AnalyticsWorkspace,
  piecesValue,
} from './shared';

interface OverviewViewProps {
  filters: ReportFilters;
  workspace: AnalyticsWorkspace;
  /** The warehouse a warehouse workspace shows; its reports are limited to it. */
  storeId?: string | undefined;
  /** False hides the hotspot visuals, for accounts without hotspot reports. */
  showHotspots?: boolean;
}

/**
 * The programme at a glance: hotspot stockout requests, district orders to the
 * national warehouses, stock and its expiry, and hotspot coverage, for the
 * period and filters chosen. The server limits each figure to what the viewer
 * may see, so the same view serves MOH (national), a DCFP (their district) and
 * a warehouse (its own store).
 */
export function OverviewView({
  filters,
  workspace,
  storeId,
  showHotspots = true,
}: OverviewViewProps) {
  const { state } = filters;
  const hotspotSide = workspace !== 'warehouse';
  const store: Record<string, string> = storeId ? { store_id: storeId } : {};
  const warehouse: Record<string, string> = storeId ? { warehouse_store_id: storeId } : {};

  const trend = useTrends({
    ...apiParams(state, [
      'from',
      'to',
      'interval',
      'district_id',
      'category',
      'warehouse_store_id',
    ]),
    ...warehouse,
    ...store,
  });
  const notifications = useNotificationReport(
    apiParams(state, ['from', 'to', 'district_id', 'category']),
    hotspotSide,
  );
  const supply = useSupplyReport({
    ...apiParams(state, ['from', 'to', 'district_id', 'category', 'warehouse_store_id']),
    ...warehouse,
  });
  const stockParams = { ...apiParams(state, ['district_id', 'category', 'store_type']), ...store };
  const stock = useStockReport(stockParams);
  const batches = useBatchReport(stockParams);
  const hotspots = useHotspotReport(
    apiParams(state, ['region_id', 'district_id']),
    hotspotSide && showHotspots,
  );

  const interval = trend.data?.interval ?? filters.interval;
  const caption = `vs ${INTERVAL_WORD[interval]}`;
  const n = notifications.data;
  const usablePieces = stock.data
    ? stock.data.lines.reduce((sum, line) => sum + (line.usable_pieces ?? 0), 0)
    : undefined;
  const transitPieces = stock.data
    ? stock.data.lines.reduce((sum, line) => sum + (line.in_transit_pieces ?? 0), 0)
    : 0;
  const expiringPieces = batches.data
    ? batches.data.lines
        .filter(
          (line) =>
            line.band === 'expired' ||
            line.band === 'under_1_month' ||
            line.band === 'under_3_months',
        )
        .reduce((sum, line) => sum + (line.pieces ?? 0), 0)
    : undefined;
  const deliveredPieces = trend.data
    ? trend.data.buckets.reduce(
        (sum, bucket) => sum + bucket.deliveries.male_pieces + bucket.deliveries.female_pieces,
        0,
      )
    : undefined;

  const dispatchedPieces = trend.data
    ? trend.data.buckets.reduce((sum, bucket) => sum + bucket.stock.dispatched_pieces, 0)
    : undefined;

  const requestRows = trendRows(trend.data, (bucket) => ({
    raised: bucket.notifications.raised,
    fulfilled: bucket.notifications.fulfilled,
  }));
  const flowRows = trendRows(trend.data, (bucket) => ({
    received: bucket.stock.received_pieces,
    dispatched: bucket.stock.dispatched_pieces,
    delivered: bucket.stock.delivered_pieces,
  }));
  const total = supply.data?.total;
  const bandPieces = sumBy(
    batches.data?.lines ?? [],
    (line) => line.band,
    (line) => line.pieces,
  );
  const byStore = sumBy(
    stock.data?.lines ?? [],
    (line) => (workspace === 'moh' ? line.store : line.product),
    (line) => line.usable_pieces,
  );
  const districtRows = (n?.districts ?? [])
    .filter((row) => row.fulfilment_rate !== null)
    .map((row) => ({
      label: row.district ?? 'No district',
      values: { rate: row.fulfilment_rate },
    }));

  return (
    <div className="gap-section flex flex-col">
      <StatCardGrid>
        {hotspotSide ? (
          <>
            <StatCard
              label="Stockout requests raised"
              value={formatNumber(n?.notifications_raised)}
              icon={Megaphone}
              accent="info"
              isLoading={notifications.isPending}
              detail={
                n
                  ? `${formatNumber(n.notifications_fulfilled)} fulfilled · ${formatNumber(n.response.pending)} open`
                  : undefined
              }
              trend={
                trend.data && trend.data.buckets.length > 1
                  ? { series: series(trend.data, (b) => b.notifications.raised), caption }
                  : undefined
              }
            />
            <StatCard
              label="Fulfilment rate"
              value={n ? percentOrNa(n.fulfilment_rate) : ''}
              icon={PackageCheck}
              accent="positive"
              isLoading={notifications.isPending}
              detail={
                n
                  ? `On time (${n.deadline.days} days): ${percentOrNa(n.deadline.on_time_rate)}, target ${n.deadline.target_percent}%`
                  : undefined
              }
            />
            <StatCard
              label="Median time to fulfil"
              value={
                n
                  ? n.response.median_hours === null
                    ? 'Not applicable'
                    : hoursLabel(n.response.median_hours)
                  : ''
              }
              icon={Timer}
              isLoading={notifications.isPending}
              detail={
                n && n.response.oldest_pending_hours !== null
                  ? `Oldest open request: ${hoursLabel(n.response.oldest_pending_hours)}`
                  : 'From the request to the last acknowledged delivery'
              }
            />
            <StatCard
              label="Delivered to hotspots"
              value={deliveredPieces === undefined ? '' : piecesValue(deliveredPieces)}
              icon={Truck}
              accent="violet"
              isLoading={trend.isPending}
              trend={
                trend.data && trend.data.buckets.length > 1
                  ? {
                      series: series(
                        trend.data,
                        (b) => b.deliveries.male_pieces + b.deliveries.female_pieces,
                      ),
                      caption,
                      goodDirection: 'up',
                    }
                  : undefined
              }
            />
          </>
        ) : null}
        {!hotspotSide ? (
          <StatCard
            label="Dispatched to districts"
            value={dispatchedPieces === undefined ? '' : piecesValue(dispatchedPieces)}
            icon={Truck}
            accent="violet"
            isLoading={trend.isPending}
            trend={
              trend.data && trend.data.buckets.length > 1
                ? {
                    series: series(trend.data, (b) => b.stock.dispatched_pieces),
                    caption,
                    goodDirection: 'up',
                  }
                : undefined
            }
          />
        ) : null}
        <StatCard
          label={hotspotSide ? 'District orders to warehouses' : 'District orders'}
          value={formatNumber(total?.requests)}
          icon={Warehouse}
          accent="info"
          isLoading={supply.isPending}
          detail={
            total
              ? `${percentOrNa(total.quantity_fulfilment_rate)} of requested pieces received · ${formatNumber(total.pending)} open`
              : undefined
          }
        />
        <StatCard
          label="Usable stock"
          value={usablePieces === undefined ? '' : piecesValue(usablePieces)}
          icon={Store}
          accent="positive"
          isLoading={stock.isPending}
          detail={
            transitPieces > 0
              ? `${formatNumber(transitPieces)} pcs in transit`
              : 'Nothing in transit'
          }
        />
        <StatCard
          label="Expiring within 3 months"
          value={expiringPieces === undefined ? '' : piecesValue(expiringPieces)}
          icon={CalendarClock}
          accent="caution"
          isLoading={batches.isPending}
          detail="Expired, under 1 month and 1 to 3 months left"
        />
        {hotspotSide && showHotspots ? (
          <StatCard
            label="Active hotspots"
            value={formatNumber(hotspots.data?.total.active)}
            icon={MapPin}
            isLoading={hotspots.isPending}
            detail={
              hotspots.data
                ? `${formatNumber(hotspots.data.total.with_dispenser)} with a dispenser · ${formatNumber(hotspots.data.total.open_requests)} waiting on stock`
                : undefined
            }
          />
        ) : null}
      </StatCardGrid>

      {hotspotSide ? (
        <>
          <ReportSection
            title="Supply over time"
            description="How requests, orders and stock moved through the period, by the interval chosen."
          >
            <VisualGrid>
              <ColumnChart
                title="Stockout requests raised and fulfilled"
                description="Hotspot requests by the day they were raised; fulfilled counts those fully acknowledged so far."
                categoryLabel="Period"
                series={[
                  { key: 'raised', label: 'Raised', color: 'var(--chart-1)' },
                  { key: 'fulfilled', label: 'Fulfilled', color: 'var(--chart-2)' },
                ]}
                rows={isFlat(requestRows) ? [] : requestRows}
                isLoading={trend.isPending}
                error={trend.error}
                onRetry={() => void trend.refetch()}
                emptyMessage="No stockout requests were raised in this period."
              />
              <TrendChart
                title="Stock flow through the supply chain"
                description="Pieces received from suppliers, dispatched by warehouses to districts and delivered to hotspots."
                categoryLabel="Period"
                kind="line"
                series={[
                  { key: 'received', label: 'Received from suppliers', color: 'var(--chart-1)' },
                  { key: 'dispatched', label: 'Dispatched to districts', color: 'var(--chart-3)' },
                  { key: 'delivered', label: 'Delivered to hotspots', color: 'var(--chart-2)' },
                ]}
                rows={isFlat(flowRows) ? [] : flowRows}
                isLoading={trend.isPending}
                error={trend.error}
                onRetry={() => void trend.refetch()}
                emptyMessage="No stock moved in this period."
                footer="Quantities in another unit than the product's catalogue unit cannot be converted to pieces and are left out."
              />
            </VisualGrid>
          </ReportSection>

          <ReportSection
            title="Fulfilment"
            description="How far orders and requests raised in the period got, and where they are stuck."
          >
            <VisualGrid>
              <FunnelChart
                title="Warehouse order pipeline"
                description="District orders to NMS and JMS raised in the period, in pieces, stage by stage."
                unit="Pieces"
                stages={
                  total && total.requests > 0
                    ? [
                        { label: 'Requested', value: total.requested_pieces },
                        { label: 'Approved', value: total.approved_pieces },
                        { label: 'Issued', value: total.issued_pieces },
                        { label: 'Received by district', value: total.acknowledged_pieces },
                      ]
                    : []
                }
                isLoading={supply.isPending}
                error={supply.error}
                onRetry={() => void supply.refetch()}
                emptyMessage="No district orders to the warehouses in this period."
                footer={
                  total && total.awaiting_unit > 0
                    ? `${formatNumber(total.awaiting_unit)} order${total.awaiting_unit === 1 ? '' : 's'} name only a category; the warehouse sets the product and unit at review, so their pieces are not counted yet.`
                    : undefined
                }
              />
              {n ? (
                <SegmentedBar
                  title="Stockout request status"
                  description="Where each request raised in the period stands now."
                  totalLabel="Requests raised"
                  segments={n.notifications_raised > 0 ? statusSegments(n) : []}
                  emptyMessage="No stockout requests were raised in this period."
                />
              ) : (
                <SegmentedBar
                  title="Stockout request status"
                  description="Where each request raised in the period stands now."
                  totalLabel="Requests raised"
                  segments={[]}
                  isLoading={notifications.isPending}
                  error={notifications.error}
                  onRetry={() => void notifications.refetch()}
                />
              )}
              {workspace === 'moh' ? (
                <BarChart
                  title="Fulfilment rate by district"
                  description="Requests raised in the period and fully acknowledged, as a percentage."
                  categoryLabel="District"
                  series={{ key: 'rate', label: 'Fulfilment rate', color: 'var(--chart-1)' }}
                  rows={districtRows}
                  valueFormat={percentLabel}
                  xMax={100}
                  reference={
                    n
                      ? {
                          value: n.deadline.target_percent,
                          label: `Target ${n.deadline.target_percent}%`,
                        }
                      : undefined
                  }
                  isLoading={notifications.isPending}
                  error={notifications.error}
                  onRetry={() => void notifications.refetch()}
                  emptyMessage="No district had stockout requests in this period."
                />
              ) : null}
            </VisualGrid>
          </ReportSection>
        </>
      ) : (
        <ReportSection
          title="Supply and fulfilment"
          description="Stock moved through the period, and how far the district orders raised in it got."
        >
          <VisualGrid>
            <TrendChart
              title="Stock flow through the supply chain"
              description="Pieces received from suppliers, dispatched by warehouses to districts and delivered to hotspots."
              categoryLabel="Period"
              kind="line"
              series={[
                { key: 'received', label: 'Received from suppliers', color: 'var(--chart-1)' },
                { key: 'dispatched', label: 'Dispatched to districts', color: 'var(--chart-3)' },
                { key: 'delivered', label: 'Delivered to hotspots', color: 'var(--chart-2)' },
              ]}
              rows={isFlat(flowRows) ? [] : flowRows}
              isLoading={trend.isPending}
              error={trend.error}
              onRetry={() => void trend.refetch()}
              emptyMessage="No stock moved in this period."
              footer="Quantities in another unit than the product's catalogue unit cannot be converted to pieces and are left out."
            />
            <FunnelChart
              title="Warehouse order pipeline"
              description="District orders to NMS and JMS raised in the period, in pieces, stage by stage."
              unit="Pieces"
              stages={
                total && total.requests > 0
                  ? [
                      { label: 'Requested', value: total.requested_pieces },
                      { label: 'Approved', value: total.approved_pieces },
                      { label: 'Issued', value: total.issued_pieces },
                      { label: 'Received by district', value: total.acknowledged_pieces },
                    ]
                  : []
              }
              isLoading={supply.isPending}
              error={supply.error}
              onRetry={() => void supply.refetch()}
              emptyMessage="No district orders to the warehouses in this period."
              footer={
                total && total.awaiting_unit > 0
                  ? `${formatNumber(total.awaiting_unit)} order${total.awaiting_unit === 1 ? '' : 's'} name only a category; the warehouse sets the product and unit at review, so their pieces are not counted yet.`
                  : undefined
              }
            />
          </VisualGrid>
        </ReportSection>
      )}

      <ReportSection
        title="Stock and expiry"
        description="Stock held today, whatever the period chosen."
      >
        <VisualGrid>
          <BarChart
            title={workspace === 'moh' ? 'Usable stock by store' : 'Usable stock by product'}
            description="Physical stock less expired, unknown-expiry and reserved stock, in pieces."
            categoryLabel={workspace === 'moh' ? 'Store' : 'Product'}
            series={{ key: 'pieces', label: 'Usable pieces', color: 'var(--chart-2)' }}
            rows={[...byStore.entries()]
              .filter(([, v]) => v > 0)
              .map(([label, v]) => ({ label, values: { pieces: v } }))}
            isLoading={stock.isPending}
            error={stock.error}
            onRetry={() => void stock.refetch()}
            emptyMessage="No usable stock is recorded for these filters."
          />
          <SegmentedBar
            title="Expiry risk"
            description="Pieces in stock by the time left before their batch expires."
            totalLabel="Pieces in stock"
            segments={
              batches.data && batches.data.lines.length > 0
                ? EXPIRY_BANDS.map((band) => ({
                    key: band,
                    label: BAND_LABELS[band],
                    value: bandPieces.get(band) ?? 0,
                    ...BAND_COLORS[band],
                  }))
                : []
            }
            isLoading={batches.isPending}
            error={batches.error}
            onRetry={() => void batches.refetch()}
            emptyMessage="No batches are in stock for these filters."
            footer="The National Medical Stores notify MOH six months before stock expires (Condom Distribution Guidelines 2022, p. 8)."
          />
          {hotspotSide && showHotspots ? (
            <BarChart
              title={workspace === 'moh' ? 'Hotspots by region' : 'Hotspots by venue type'}
              description="Hotspots recorded, split by whether they are active."
              categoryLabel={workspace === 'moh' ? 'Region' : 'Venue type'}
              series={[
                { key: 'active', label: 'Active', color: 'var(--chart-1)' },
                { key: 'inactive', label: 'Not active', color: 'var(--chart-4)' },
              ]}
              rows={(workspace === 'moh'
                ? (hotspots.data?.by_region ?? [])
                : (hotspots.data?.by_type ?? [])
              ).map((group) => ({
                label: group.name ?? 'Not recorded',
                values: { active: group.active, inactive: group.total - group.active },
              }))}
              isLoading={hotspots.isPending}
              error={hotspots.error}
              onRetry={() => void hotspots.refetch()}
              emptyMessage="No hotspots are recorded for these filters."
            />
          ) : null}
        </VisualGrid>
      </ReportSection>
    </div>
  );
}
