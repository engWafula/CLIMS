'use client';

import { ClockAlert, Inbox, PackageCheck, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';

import { ActivityTimeline, type ActivityEntry } from '@/components/ActivityTimeline';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { BarChart } from '@/components/charts/BarChart';
import { ChartHeadingLevel } from '@/components/charts/ChartCard';
import { PdfButton } from '@/components/reports/PdfButton';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { ErrorState } from '@/components/states/ErrorState';
import { TaskList } from '@/components/TaskList';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DistrictSelect, useDistrictContext } from '@/features/district/DistrictContext';
import type { Order } from '@/features/orders/api';
import { FilterBar } from '@/features/analytics/FilterBar';
import { kampalaToday, type FilterField } from '@/features/analytics/filters';
import { useSupplyReport, useTrends } from '@/features/analytics/queries';
import { useReportFilters } from '@/features/analytics/useReportFilters';
import { isFlat, trendRows } from '@/features/analytics/views/shared';
import { OverviewView } from '@/features/analytics/views/OverviewView';
import { useCan } from '@/features/auth/queries';
import { formatNumber, formatTimestamp } from '@/lib/format';

import {
  useCurrentWarehouse,
  useRequestNames,
  useStoreBatches,
  useStoreOrders,
  useStoreStock,
} from './orderQueries';
import { WAREHOUSE_PATHS, withStore } from './paths';
import { reservable } from './picking';
import { REQUEST_FILTERS } from './requests';
import { MOVEMENT_LABEL, movementBatch, signed } from './stock';
import { useStoreMovements } from './stockQueries';
import { StoreSwitch } from './StoreSwitch';
import { isPieces, productName, unitSuffix } from './summary';
import { warehouseTasks } from './tasks';

const RECENT_EVENTS = 6;

type FilterValue = (typeof REQUEST_FILTERS)[number]['value'];

function countOf(orders: readonly Order[] | undefined, value: FilterValue): string {
  const filter = REQUEST_FILTERS.find((candidate) => candidate.value === value);
  if (!orders || !filter) return '—';
  return formatNumber(orders.filter(filter.keeps).length);
}

export default function WarehouseDashboardPage() {
  const { code, href, warehouse, ...stores } = useCurrentWarehouse();
  const district = useDistrictContext()?.district;
  const names = useRequestNames();
  const orders = useStoreOrders(warehouse?.id);
  const stock = useStoreStock(warehouse?.id ?? '', { enabled: warehouse !== undefined });
  const batches = useStoreBatches(warehouse?.id ?? '', { enabled: warehouse !== undefined });
  const movements = useStoreMovements(warehouse?.id);
  const visibleOrders = district
    ? orders.data?.filter((order) => names.district(order.ordered_for_store_id) === district)
    : orders.data;
  const filtered = (value: FilterValue) => href(WAREHOUSE_PATHS.requestsWithStatus(value));
  const waiting = stores.isPending || warehouse === undefined;
  const expiring = batches.data?.filter(
    (batch) => batch.band === 'under_1_month' || batch.band === 'under_3_months',
  );
  const recent: ActivityEntry[] = (movements.data ?? [])
    .slice(0, RECENT_EVENTS)
    .map((movement) => ({
      id: movement.id,
      text: `${MOVEMENT_LABEL[movement.reason].label}: ${signed(movement.quantity)}${unitSuffix(movement.unit)}${
        movementBatch(movement) ? ` · ${movementBatch(movement) ?? ''}` : ''
      }`,
      meta: `${productName(movement.product, movement.unit)} · ${formatTimestamp(movement.created_at)}`,
      role: 'warehouse',
    }));

  return (
    <div className="gap-section flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <StoreSwitch
          store={code}
          hrefFor={(other) => withStore(WAREHOUSE_PATHS.dashboard, other)}
        />
        <DistrictSelect />
      </div>

      {/* The last card is as wide as the stock column under it, so the edges line up. */}
      <StatCardGrid className="xl:grid-cols-[1fr_1fr_1fr_22rem]">
        <StatCard
          label="New orders"
          value={countOf(visibleOrders, 'queued')}
          icon={Inbox}
          accent="info"
          href={filtered('queued')}
          isLoading={waiting || orders.isPending}
        />
        <StatCard
          label="To dispatch"
          value={countOf(visibleOrders, 'confirmed')}
          icon={PackageCheck}
          accent="caution"
          href={filtered('confirmed')}
          isLoading={waiting || orders.isPending}
        />
        <StatCard
          label="In transit"
          value={countOf(visibleOrders, 'dispatched')}
          icon={Truck}
          accent="violet"
          href={filtered('dispatched')}
          isLoading={waiting || orders.isPending}
        />
        <StatCard
          label="Batches expiring within 3 months"
          value={expiring ? formatNumber(expiring.length) : '—'}
          icon={ClockAlert}
          accent="caution"
          href={href(WAREHOUSE_PATHS.stock)}
          isLoading={waiting || batches.isPending}
        />
      </StatCardGrid>

      {/*
        Tasks, then the recent charts under them, with the warehouse's stock beside
        both. The task card is only as tall as its tasks, so the charts take the
        space a short list leaves. On a narrow screen the stock comes before the
        charts.
      */}
      <div className="gap-section grid items-start lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr]">
        <TaskList
          className="lg:col-start-1 lg:row-start-1"
          title="Needs your action"
          tasks={
            visibleOrders && batches.data
              ? warehouseTasks(visibleOrders, batches.data, names, (iso) =>
                  formatTimestamp(iso),
                ).map((task) => ({ ...task, href: href(task.href) }))
              : undefined
          }
          isLoading={waiting || orders.isPending || batches.isPending}
          error={stores.error ?? orders.error ?? batches.error}
          errorTitle="Could not load your tasks"
          onRetry={() => {
            void stores.refetch();
            void orders.refetch();
            void batches.refetch();
          }}
          isRetrying={orders.isRefetching || batches.isRefetching}
          loadingLabel="Loading tasks…"
          empty={
            district
              ? {
                  title: `Nothing from ${district} needs you right now`,
                  description: `New orders from ${district} will appear here.`,
                }
              : {
                  title: 'Nothing needs you right now',
                  description: 'New orders from district stores will appear here.',
                }
          }
        />

        <div className="gap-section flex min-w-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Card>
            <CardHeader>
              <CardTitle>Stock at {code}</CardTitle>
              <CardAction>
                <Button asChild variant="outline" size="sm">
                  <Link href={href(WAREHOUSE_PATHS.stock)}>View stock</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {waiting || stock.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : stock.isError ? (
                <ErrorState
                  title={`Could not load ${code} stock`}
                  error={stock.error}
                  onRetry={() => void stock.refetch()}
                  isRetrying={stock.isRefetching}
                />
              ) : stock.data.length === 0 ? (
                <p className="text-muted-foreground text-sm">No stock recorded yet.</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {stock.data.map((balance) => (
                    <li
                      key={`${balance.condom_id}:${balance.unit_of_measure_id}`}
                      className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
                    >
                      <span className="min-w-0 truncate text-sm">{balance.product}</span>
                      <span className="shrink-0 text-sm tabular-nums">
                        <span className="font-medium">
                          {formatNumber(
                            reservable(
                              balance,
                              batches.data?.filter(
                                (batch) =>
                                  batch.condom_id === balance.condom_id &&
                                  batch.unit_of_measure_id === balance.unit_of_measure_id,
                              ),
                            ),
                          )}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          {isPieces(balance.unit) ? 'free' : `${balance.unit} free`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent stock movements</CardTitle>
              <CardDescription>
                Stock registered, dispatches and corrections at {code}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {waiting || movements.isPending ? (
                <Skeleton className="h-32 w-full" />
              ) : movements.isError ? (
                <ErrorState
                  title="Could not load the stock movements"
                  error={movements.error}
                  onRetry={() => void movements.refetch()}
                  isRetrying={movements.isRefetching}
                />
              ) : recent.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {district
                    ? `Nothing has happened on orders from ${district} yet.`
                    : 'Nothing has happened yet.'}
                </p>
              ) : (
                <ActivityTimeline variant="compact" entries={recent} />
              )}
            </CardContent>
          </Card>
        </div>

        {!district && warehouse ? (
          <div className="@container min-w-0 lg:col-start-1 lg:row-start-2">
            <RecentCharts storeId={warehouse.id} />
          </div>
        ) : null}
      </div>

      {warehouse ? <WarehousePerformance storeId={warehouse.id} name={warehouse.name} /> : null}
    </div>
  );
}

/** Day `days` before today in Kampala, as YYYY-MM-DD. */
function daysAgo(days: number): string {
  const today = kampalaToday();
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/** The last eight weeks of dispatches and the last 30 days of orders, for the warehouse at a glance. */
function RecentCharts({ storeId }: { storeId: string }) {
  const trend = useTrends({
    from: daysAgo(7 * 7 + 6),
    to: kampalaToday(),
    interval: 'week',
    store_id: storeId,
    warehouse_store_id: storeId,
  });
  const supply = useSupplyReport({
    from: daysAgo(29),
    to: kampalaToday(),
    warehouse_store_id: storeId,
  });
  const dispatched = trendRows(trend.data, (bucket) => ({
    pieces: bucket.stock.dispatched_pieces,
  }));
  return (
    <div className="gap-section grid @2xl:grid-cols-2">
      <ColumnChart
        title="Pieces dispatched to districts"
        description="Per week, last 8 weeks, in pieces."
        categoryLabel="Week"
        series={{ key: 'pieces', label: 'Pieces dispatched', color: 'var(--chart-1)' }}
        rows={isFlat(dispatched) ? [] : dispatched}
        isLoading={trend.isPending}
        error={trend.error}
        onRetry={() => void trend.refetch()}
        emptyMessage="Nothing was dispatched in the last 8 weeks."
      />
      <BarChart
        title="Orders by district"
        description="District orders received in the last 30 days."
        categoryLabel="District"
        series={{ key: 'orders', label: 'Orders', color: 'var(--chart-3)' }}
        rows={(supply.data?.by_district ?? []).map((group) => ({
          label: group.name ?? 'Not recorded',
          values: { orders: group.requests },
        }))}
        limit={6}
        isLoading={supply.isPending}
        error={supply.error}
        onRetry={() => void supply.refetch()}
        emptyMessage="No district ordered in the last 30 days."
      />
    </div>
  );
}

const PERFORMANCE_FIELDS: readonly FilterField[] = ['period', 'interval', 'district', 'category'];

/** The warehouse's performance for a period, from the reports API, with a PDF of it. */
function WarehousePerformance({ storeId, name }: { storeId: string; name: string }) {
  const can = useCan();
  const filters = useReportFilters();
  const contentRef = useRef<HTMLDivElement>(null);
  if (!can('reports:read')) return null;
  return (
    <section className="gap-section flex flex-col" aria-labelledby="warehouse-performance">
      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-4">
        <div>
          <h2 id="warehouse-performance" className="text-lg font-semibold">
            {name} performance
          </h2>
          <p className="text-muted-foreground text-sm">
            Orders from districts, stock moved and held, and expiry, for the period chosen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/warehouse/programme-reports">All reports</Link>
          </Button>
          <PdfButton
            title={`${name} performance`}
            subtitle="District orders, stock flow, stock held and expiry for the warehouse."
            targetRef={contentRef}
          />
        </div>
      </div>
      <FilterBar filters={filters} fields={PERFORMANCE_FIELDS} />
      <div ref={contentRef} className="gap-section flex flex-col">
        <ChartHeadingLevel.Provider value={4}>
          <OverviewView filters={filters} workspace="warehouse" storeId={storeId} />
        </ChartHeadingLevel.Provider>
      </div>
    </section>
  );
}
