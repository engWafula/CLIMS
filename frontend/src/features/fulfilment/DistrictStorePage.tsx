'use client';

import {
  ArrowDownToLine,
  CalendarX2,
  ClockAlert,
  Package,
  PackageCheck,
  PackagePlus,
  Pencil,
  Scale,
  Store,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { RowActions } from '@/components/data-table/RowActions';
import { FilterSelect } from '@/components/FilterSelect';
import { FilterTabs } from '@/components/FilterTabs';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { TaskList } from '@/components/TaskList';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/features/auth/hooks';
import { useCan } from '@/features/auth/queries';
import { DCFP_PATHS } from '@/features/dcfp/orders';
import { DeliverStockDialog } from '@/features/dcfp/DeliverStockDialog';
import { useStores } from '@/features/geography/queries';
import {
  MOVEMENT_REASONS,
  type Movement,
  type MovementReason,
  type ProductSummary,
  type StockBatch,
} from '@/features/inventory/api';
import { BAND_STATUS, batchLabel } from '@/features/inventory/bands';
import { AdjustBatchDialog } from '@/features/warehouse/AdjustBatchDialog';
import { EditBatchDialog } from '@/features/warehouse/EditBatchDialog';
import { RegisterStockSheet } from '@/features/warehouse/RegisterStockSheet';
import { ShelfLifeOverview } from '@/features/warehouse/ShelfLifeOverview';
import { useStoreBatches } from '@/features/warehouse/orderQueries';
import { ugandaToday } from '@/features/warehouse/receiving';
import { shelfLifeByUnit, stockAttention } from '@/features/warehouse/shelfLife';
import {
  BATCH_FILTERS,
  batchFilterFrom,
  keepsBatch,
  MOVEMENT_LABEL,
  signed,
} from '@/features/warehouse/stock';
import { useMovementLedger, useStoreSummary } from '@/features/warehouse/stockQueries';
import {
  formatMonths,
  formatStock,
  PERIODS,
  periodFrom,
  periodPhrase,
  periodRange,
  productName,
  stockCover,
  totalsByUnit,
} from '@/features/warehouse/summary';
import { formatDate, formatNumber, formatTimestamp } from '@/lib/format';
import { useReadOnly } from '@/navigation/useAccess';

const VIEWS = [
  { value: 'products', label: 'Products' },
  { value: 'batches', label: 'Batches' },
  { value: 'movements', label: 'Movements' },
] as const;
// Stock is counted in pieces, so a unit shows only for another one an old record holds:
// "Male condoms, Carton" (as on the warehouse stock page).
const productColumns: DataTableColumn<ProductSummary>[] = [
  { id: 'product', header: 'Product', value: (row) => productName(row.product, row.unit) },
  ...(
    [
      ['on_hand', 'On hand'],
      ['usable', 'Available'],
      ['received', 'Received'],
      ['dispatched', 'Dispatched'],
      ['expired', 'Expired'],
      ['written_off', 'Written off'],
    ] as const
  ).map(([id, header]): DataTableColumn<ProductSummary> => ({
    id,
    header,
    numeric: true,
    value: (row) => row[id],
    cell: (row) => formatNumber(row[id]),
  })),
  {
    id: 'cover',
    header: 'Stock cover',
    value: (row) => stockCover(row),
    cell: (row) => {
      const months = stockCover(row);
      return months === null ? 'No dispatch history' : formatMonths(months);
    },
  },
  {
    id: 'next_expiry',
    filter: 'date',
    header: 'Next expiry',
    value: (row) => row.next_expiry,
    cell: (row) => (row.next_expiry ? formatDate(row.next_expiry) : 'Not recorded'),
  },
];
const batchColumns: DataTableColumn<StockBatch>[] = [
  { id: 'product', header: 'Product', value: (row) => productName(row.product, row.unit) },
  { id: 'batch', header: 'Batch', value: batchLabel },
  {
    id: 'on_hand',
    header: 'On hand',
    numeric: true,
    value: (row) => row.on_hand,
    cell: (row) => formatNumber(row.on_hand),
  },
  {
    id: 'expiry',
    filter: 'date',
    header: 'Expiry date',
    value: (row) => row.expiry_date,
    cell: (row) => (row.expiry_date ? formatDate(row.expiry_date) : 'Not recorded'),
  },
  {
    id: 'band',
    filter: 'select',
    header: 'Shelf life',
    value: (row) => BAND_STATUS[row.band].label,
    cell: (row) => (
      <StatusBadge status={BAND_STATUS[row.band].label} tone={BAND_STATUS[row.band].tone} />
    ),
  },
];
const movementColumns: DataTableColumn<Movement>[] = [
  {
    id: 'date',
    filter: 'date',
    header: 'Date',
    value: (row) => row.created_at,
    cell: (row) => formatTimestamp(row.created_at),
  },
  { id: 'product', header: 'Product', value: (row) => productName(row.product, row.unit) },
  {
    id: 'reason',
    filter: 'select',
    header: 'Movement',
    value: (row) => MOVEMENT_LABEL[row.reason].label,
  },
  {
    id: 'quantity',
    header: 'Change',
    numeric: true,
    value: (row) => row.quantity,
    cell: (row) => signed(row.quantity),
  },
  {
    id: 'balance',
    header: 'Balance after',
    numeric: true,
    value: (row) => row.on_hand_after,
    cell: (row) => formatNumber(row.on_hand_after),
  },
  { id: 'note', header: 'Note', value: (row) => row.note ?? '' },
  {
    id: 'order',
    header: 'Order',
    value: (row) => row.order_id,
    cell: (row) =>
      row.order_id ? (
        <Link className="text-primary underline" href={`${DCFP_PATHS.orders}/${row.order_id}`}>
          View order
        </Link>
      ) : (
        '—'
      ),
  },
];

/** The assigned district's real balances, batches and ledger, using the same inventory API as warehouses. */
export default function DistrictStorePage() {
  const user = useCurrentUser();
  const can = useCan();
  const readOnly = useReadOnly();
  const storeId = user?.store_id ?? undefined;
  const stores = useStores(Boolean(storeId));
  const store = stores.data?.find(
    (candidate) => candidate.id === storeId && candidate.store_type === 'district',
  );
  const params = useSearchParams();
  const router = useRouter();
  const view =
    VIEWS.find((item) => item.value === params.get('view'))?.value ??
    (params.has('band') ? 'batches' : 'products');
  const band = batchFilterFrom(params.get('band'));
  const period = periodFrom(params.get('period'));
  const reason = MOVEMENT_REASONS.find((item) => item === params.get('reason'));
  const today = useMemo(() => ugandaToday(new Date()), []);
  const range = useMemo(() => periodRange(period, today), [period, today]);
  const summary = useStoreSummary(store?.id, range);
  const batches = useStoreBatches(store?.id ?? '', { enabled: Boolean(store) });
  const ledger = useMovementLedger(store?.id, reason ?? null, {
    enabled: Boolean(store) && view === 'movements',
  });
  const [registering, setRegistering] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [adjusting, setAdjusting] = useState<StockBatch | null>(null);
  const [editing, setEditing] = useState<StockBatch | null>(null);
  const shelfLife = useMemo(
    () => (batches.data ? shelfLifeByUnit(batches.data) : undefined),
    [batches.data],
  );
  const products = summary.data?.products;
  const attention = useMemo(
    () =>
      batches.data && products
        ? stockAttention(batches.data, products, (path) => path, DCFP_PATHS.store)
        : undefined,
    [batches.data, products],
  );
  const manage = !readOnly && can('inventory:manage');
  const pathFor = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    return `${DCFP_PATHS.store}?${next.toString()}`;
  };
  const amount = (pick: (row: ProductSummary) => number) =>
    products ? formatStock(totalsByUnit(products, pick)) : '—';

  if (!storeId)
    return (
      <EmptyState
        icon={Store}
        title="No district store assigned"
        description="Ask an administrator to assign your account to its district store. Stock will appear here once it is assigned."
      />
    );
  if (stores.error)
    return (
      <ErrorState
        title="Could not load your district store"
        error={stores.error}
        onRetry={() => void stores.refetch()}
      />
    );
  if (stores.isSuccess && !store)
    return (
      <EmptyState
        icon={Store}
        title="No district store assigned"
        description="Your account's store is not a district store. Ask an administrator to check the assignment."
      />
    );

  return (
    <div className="gap-section flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{store?.name ?? 'District store'}</h2>
          <p className="text-muted-foreground text-sm">
            Current stock and activity in the {periodPhrase(period)}. Quantities stay in their
            recorded units.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Period"
            value={period}
            options={PERIODS.map((item) => ({ value: item.value, label: item.label }))}
            onValueChange={(value) => {
              router.replace(pathFor({ period: value }), { scroll: false });
            }}
          />
          {!readOnly && can('orders:receive') ? (
            <Button asChild variant="outline">
              <Link href={`${DCFP_PATHS.orders}?status=dispatched`}>
                <ArrowDownToLine data-icon="inline-start" />
                Receive warehouse delivery
              </Link>
            </Button>
          ) : null}
          {!readOnly && can('orders:replenish') ? (
            <Button asChild variant="outline">
              <Link href={DCFP_PATHS.newOrder}>Request stock</Link>
            </Button>
          ) : null}
          {!readOnly && can('orders:supply_hotspots') ? (
            <Button
              disabled={!store || !summary.isSuccess}
              onClick={() => {
                setDispatching(true);
              }}
            >
              <Truck data-icon="inline-start" />
              Dispatch to hotspot
            </Button>
          ) : null}
          {manage ? (
            <Button
              variant="outline"
              disabled={!store}
              onClick={() => {
                setRegistering(true);
              }}
            >
              <PackagePlus data-icon="inline-start" />
              Register stock
            </Button>
          ) : null}
        </div>
      </div>
      {summary.error ? (
        <ErrorState
          title="Could not load district stock"
          error={summary.error}
          onRetry={() => void summary.refetch()}
        />
      ) : summary.isSuccess && products?.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No stock in the district store"
          description="Receive a warehouse delivery or register stock from another source to get started."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="On hand"
            value={amount((row) => row.on_hand)}
            detail="Physical stock, including reserved and expired"
            icon={Package}
            isLoading={summary.isPending}
          />
          <StatCard
            label="Available to dispatch"
            value={amount((row) => row.usable)}
            detail={`${amount((row) => row.reserved)} reserved · excludes expired stock`}
            icon={PackageCheck}
            isLoading={summary.isPending}
          />
          <StatCard
            label="Received"
            value={amount((row) => row.received)}
            detail={`Warehouse receipts and registrations, ${periodPhrase(period)}`}
            icon={ArrowDownToLine}
            isLoading={summary.isPending}
          />
          <StatCard
            label="Dispatched"
            value={amount((row) => row.dispatched)}
            detail={`Stock sent out, including hotspot deliveries, ${periodPhrase(period)}`}
            icon={Truck}
            isLoading={summary.isPending}
          />
          <StatCard
            label="Expired"
            value={amount((row) => row.expired)}
            detail="Cannot be dispatched; write off after disposal"
            icon={CalendarX2}
            accent="caution"
            isLoading={summary.isPending}
            href={pathFor({ view: 'batches', band: 'expired' })}
          />
          <StatCard
            label="Expiring within 3 months"
            value={amount((row) => row.expiring)}
            detail="Prioritise these batches for dispatch"
            icon={ClockAlert}
            accent="caution"
            isLoading={summary.isPending}
            href={pathFor({ view: 'batches', band: 'expiring' })}
          />
          <StatCard
            label="Written off"
            value={amount((row) => row.written_off)}
            detail={`Negative adjustments, ${periodPhrase(period)}`}
            icon={Scale}
            isLoading={summary.isPending}
          />
          <StatCard
            label="Expiry not recorded"
            value={amount((row) => row.no_expiry)}
            detail="Check the cartons and update their expiry dates"
            icon={CalendarX2}
            accent="caution"
            isLoading={summary.isPending}
            href={pathFor({ view: 'batches', band: 'unknown' })}
          />
        </div>
      )}
      <div className="gap-section grid xl:grid-cols-2">
        <ShelfLifeOverview
          code={store?.name ?? 'the district store'}
          units={shelfLife}
          isLoading={batches.isPending}
          error={batches.error}
          onRetry={() => void batches.refetch()}
          isRetrying={batches.isRefetching}
          hrefForBand={(value) => pathFor({ view: 'batches', band: value })}
        />
        <TaskList
          title="Stock needing attention"
          tasks={attention}
          isLoading={summary.isPending || batches.isPending}
          error={summary.error ?? batches.error}
          errorTitle="Could not check district stock"
          onRetry={() => {
            void summary.refetch();
            void batches.refetch();
          }}
          loadingLabel="Checking district stock…"
          empty={{
            title: products?.length === 0 ? 'Nothing to check yet' : 'Nothing needs attention',
            description:
              'Expiry risks, missing batch dates and products with less than a month of stock appear here.',
          }}
        />
      </div>
      <div className="flex flex-col gap-3">
        <FilterTabs
          label="Show district stock by"
          tabs={VIEWS}
          value={view}
          hrefFor={(value) => pathFor({ view: value, band: 'all' })}
        />
        {view === 'products' ? (
          <>
            <p className="text-muted-foreground text-sm">
              Received, dispatched and written off cover the selected period. Stock cover uses the
              last 90 days of dispatches; it is an estimate, not measured consumption.
            </p>
            <DataTable
              label="District stock by product"
              columns={productColumns}
              rows={products}
              getRowId={(row) => `${row.condom_id}:${row.unit_of_measure_id}`}
              isLoading={summary.isPending}
              error={summary.error}
              onRetry={() => void summary.refetch()}
              emptyTitle="No products in stock yet"
              emptyDescription="Products appear here once stock has been received."
              preferencesKey="district-stock-products"
            />
          </>
        ) : view === 'batches' ? (
          <DataTable
            label="District stock batches"
            columns={batchColumns}
            rows={batches.data?.filter((row) => keepsBatch(band, row))}
            getRowId={(row) => row.id}
            isLoading={batches.isPending}
            error={batches.error}
            onRetry={() => void batches.refetch()}
            emptyTitle="No batches to show"
            emptyDescription="Receive stock or choose another shelf-life filter."
            preferencesKey="district-stock-batches"
            toolbar={
              <FilterSelect
                label="Shelf life"
                value={band}
                options={BATCH_FILTERS}
                onValueChange={(value) => {
                  router.replace(pathFor({ band: value }), { scroll: false });
                }}
              />
            }
            rowActions={
              manage
                ? (batch) => (
                    <RowActions
                      label={`Actions for batch ${batchLabel(batch)}`}
                      actions={[
                        {
                          label: 'Edit batch',
                          icon: Pencil,
                          onSelect: () => {
                            setEditing(batch);
                          },
                        },
                        {
                          label:
                            batch.band === 'expired'
                              ? 'Write off expired stock'
                              : 'Adjust or write off',
                          icon: Scale,
                          onSelect: () => {
                            setAdjusting(batch);
                          },
                        },
                      ]}
                    />
                  )
                : undefined
            }
          />
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Every movement, newest first. The ledger includes all dates; the period selector
              applies to the summary figures.
            </p>
            <DataTable
              label="District stock movements"
              columns={movementColumns}
              rows={ledger.rows}
              getRowId={(row) => row.id}
              isLoading={ledger.isPending}
              error={ledger.error}
              onRetry={() => void ledger.refetch()}
              emptyTitle="No stock movements yet"
              emptyDescription="Receipts, dispatches and adjustments appear here."
              preferencesKey="district-stock-movements"
              more={{
                hasMore: ledger.hasMore,
                isLoading: ledger.isLoadingMore,
                onLoadMore: ledger.loadMore,
                noun: 'movements',
              }}
              toolbar={
                <FilterSelect
                  label="Movement"
                  value={reason ?? 'all'}
                  options={[
                    { value: 'all', label: 'Every movement' },
                    ...MOVEMENT_REASONS.map((value) => ({
                      value,
                      label: MOVEMENT_LABEL[value].label,
                    })),
                  ]}
                  onValueChange={(value: MovementReason | 'all') => {
                    router.replace(pathFor({ reason: value }), { scroll: false });
                  }}
                />
              }
            />
          </>
        )}
      </div>
      {registering && manage ? (
        <RegisterStockSheet
          open
          onOpenChange={setRegistering}
          code={store?.name ?? 'the district store'}
          warehouse={store}
        />
      ) : null}
      {adjusting && manage ? (
        <AdjustBatchDialog
          batch={adjusting}
          open
          onOpenChange={(open) => {
            if (!open) setAdjusting(null);
          }}
        />
      ) : null}
      {editing && manage ? (
        <EditBatchDialog
          batch={editing}
          held={batches.data ?? []}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
      {dispatching && store && !readOnly && can('orders:supply_hotspots') ? (
        <DeliverStockDialog
          storeId={store.id}
          stock={products ?? []}
          onClose={() => {
            setDispatching(false);
          }}
        />
      ) : null}
    </div>
  );
}
