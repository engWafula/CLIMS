'use client';

import {
  BadgeCheck,
  CalendarX2,
  ClockAlert,
  Inbox,
  LockKeyhole,
  Package,
  PackageOpen,
  PackagePlus,
  Pencil,
  Scale,
  Trash2,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { ROW_ACTION_SEPARATOR, RowActions } from '@/components/data-table/RowActions';
import { FilterSelect } from '@/components/FilterSelect';
import { FilterTabs } from '@/components/FilterTabs';
import { PageActions } from '@/components/PageActions';
import { StatCard } from '@/components/StatCard';
import { TaskList } from '@/components/TaskList';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { WriteAction } from '@/components/WriteAction';
import { useCan } from '@/features/auth/queries';
import type {
  Movement,
  MovementReason,
  ProductSummary,
  StockBatch,
} from '@/features/inventory/api';
import { BAND_STATUS, batchLabel, shelfLifeLeft } from '@/features/inventory/bands';
import { formatDate, formatNumber, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useReadOnly } from '@/navigation/useAccess';

import { AdjustBatchDialog } from './AdjustBatchDialog';
import { DeleteBatchDialog } from './DeleteBatchDialog';
import { EditBatchDialog } from './EditBatchDialog';
import { DispatchToDistrictSheet } from './DispatchToDistrictSheet';
import { useCurrentWarehouse, useStoreBatches } from './orderQueries';
import { WAREHOUSE_PATHS, withStore } from './paths';
import { RegisterStockSheet } from './RegisterStockSheet';
import { ShelfLifeOverview } from './ShelfLifeOverview';
import { shelfLifeByUnit, stockAttention } from './shelfLife';
import { ugandaToday } from './receiving';
import {
  BATCH_FILTERS,
  batchFilterFrom,
  keepsBatch,
  MOVEMENT_LABEL,
  movementBatch,
  signed,
  type BatchFilter,
} from './stock';
import { useMovementLedger, useStoreSummary } from './stockQueries';
import { StoreSwitch } from './StoreSwitch';
import {
  dispatchBreakdown,
  formatMonths,
  formatPercent,
  formatStock,
  isPieces,
  nextExpiry,
  pendingBreakdown,
  pendingOrders,
  PERIODS,
  periodFrom,
  periodPhrase,
  periodRange,
  productName,
  stockCover,
  successBreakdown,
  successRate,
  totalsByUnit,
  type Period,
  type UnitAmount,
} from './summary';

const VIEWS = [
  { value: 'products', label: 'Products' },
  { value: 'batches', label: 'Batches' },
  { value: 'movements', label: 'Movements' },
] as const;

type View = (typeof VIEWS)[number]['value'];

/** The view in the address; a shelf-life filter alone means the batches. */
function viewFrom(params: URLSearchParams): View {
  const named = VIEWS.find((view) => view.value === params.get('view'))?.value;
  if (named) return named;
  return params.get('band') ? 'batches' : 'products';
}

/** The ledger's filter: every entry, or one reason. `reason` in the address picks one. */
type ReasonFilter = MovementReason | 'all';

const REASON_FILTERS: readonly { value: ReasonFilter; label: string }[] = [
  { value: 'all', label: 'Every movement' },
  ...(['receipt', 'dispatch', 'adjustment', 'order_receipt', 'opening'] as const).map((reason) => ({
    value: reason,
    label: MOVEMENT_LABEL[reason].label,
  })),
];

function reasonFrom(param: string | null): ReasonFilter {
  return REASON_FILTERS.find((option) => option.value === param)?.value ?? 'all';
}

/** The stock page's address for a view, filter and period, keeping the defaults out of it. */
function stockPath(
  view: View,
  band: BatchFilter,
  period: Period,
  reason: ReasonFilter = 'all',
): string {
  const params = new URLSearchParams();
  if (view !== 'products') params.set('view', view);
  if (view === 'batches' && band !== 'all') params.set('band', band);
  if (view === 'movements' && reason !== 'all') params.set('reason', reason);
  if (period !== '30d') params.set('period', period);
  const query = params.toString();
  return query ? `${WAREHOUSE_PATHS.stock}?${query}` : WAREHOUSE_PATHS.stock;
}

/** A figure that is only worth attention when it is above zero. */
function Flagged({ value, tone }: { value: number; tone: 'warning' | 'destructive' }) {
  return (
    <span
      className={cn(
        'tabular-nums',
        value > 0 && (tone === 'warning' ? 'text-warning' : 'text-destructive'),
        value > 0 && 'font-medium',
      )}
    >
      {formatNumber(value)}
    </span>
  );
}

/**
 * Per-unit amounts on separate lines, for a footer total: units are never added together. Pieces
 * go unnamed; an old record's other unit keeps its name.
 */
function UnitTotals({ amounts }: { amounts: readonly UnitAmount[] }) {
  if (amounts.length === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span className="flex flex-col items-end text-xs leading-4">
      {amounts.map((amount) => (
        <span key={amount.unit} className="whitespace-nowrap">
          {formatNumber(amount.quantity)}
          {isPieces(amount.unit) ? null : (
            <span className="text-muted-foreground font-normal"> {amount.unit}</span>
          )}
        </span>
      ))}
    </span>
  );
}

/** A product's name, and under it its unit when that is not pieces. */
function ProductCell({
  product,
  unit,
  className,
}: {
  product: string;
  unit: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate" title={product}>
        {product}
      </div>
      {isPieces(unit) ? null : <div className="text-muted-foreground text-xs">{unit}</div>}
    </div>
  );
}

/** A column's footer: `pick` summed per unit over every matching row. */
function unitTotal<Row extends { unit: string }>(pick: (row: Row) => number) {
  return function total(rows: readonly Row[]) {
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.unit, (totals.get(row.unit) ?? 0) + pick(row));
    return (
      <UnitTotals
        amounts={[...totals.entries()]
          .filter(([, quantity]) => quantity !== 0)
          .map(([unit, quantity]) => ({ unit, quantity }))
          .sort((a, b) => b.quantity - a.quantity || a.unit.localeCompare(b.unit))}
      />
    );
  };
}

/**
 * Free stock with a thin meter of what the rest of the shelf is doing: free, reserved for orders,
 * and expired. Across hundreds of products, a red or blue tail picks out the ones to look at.
 */
function FreeStock({ row }: { row: ProductSummary }) {
  const parts = [
    { key: 'free', value: row.usable, fill: 'bg-primary', label: 'free' },
    { key: 'reserved', value: row.reserved, fill: 'bg-info/70', label: 'reserved' },
    { key: 'expired', value: row.expired, fill: 'bg-destructive', label: 'expired' },
  ].filter((part) => part.value > 0);
  const description = parts.map((part) => `${formatNumber(part.value)} ${part.label}`).join(', ');
  return (
    <div className="ml-auto flex w-24 flex-col items-end gap-1">
      <span className="font-semibold tabular-nums">{formatNumber(row.usable)}</span>
      {row.on_hand > 0 ? (
        <div
          role="img"
          aria-label={`Of ${formatNumber(row.on_hand)} on hand: ${description}`}
          title={`Of ${formatNumber(row.on_hand)} on hand: ${description}`}
          className="bg-muted flex h-1 w-full gap-px overflow-hidden rounded-full"
        >
          {parts.map((part) => (
            <div
              key={part.key}
              className={cn('h-full min-w-0.5', part.fill)}
              style={{ flexGrow: part.value, flexBasis: 0 }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function productColumns(period: Period): DataTableColumn<ProductSummary>[] {
  const phrase = periodPhrase(period);
  return [
    {
      id: 'product',
      header: 'Product',
      value: (row) => productName(row.product, row.unit),
      cell: (row) => (
        <ProductCell product={row.product} unit={row.unit} className="max-w-52 font-medium" />
      ),
    },
    {
      id: 'usable',
      header: 'Free to dispatch',
      numeric: true,
      value: (row) => row.usable,
      cell: (row) => <FreeStock row={row} />,
      total: unitTotal((row) => row.usable),
    },
    {
      id: 'on_hand',
      header: 'On hand',
      numeric: true,
      value: (row) => row.on_hand,
      cell: (row) => formatNumber(row.on_hand),
      total: unitTotal((row) => row.on_hand),
    },
    {
      id: 'reserved',
      header: 'Reserved',
      numeric: true,
      hideable: true,
      value: (row) => row.reserved,
      cell: (row) => formatNumber(row.reserved),
      total: unitTotal((row) => row.reserved),
    },
    {
      id: 'expiring',
      header: 'Expiring',
      numeric: true,
      value: (row) => row.expiring,
      cell: (row) => <Flagged value={row.expiring} tone="warning" />,
      total: unitTotal((row) => row.expiring),
    },
    {
      id: 'expired',
      header: 'Expired',
      numeric: true,
      value: (row) => row.expired,
      cell: (row) => <Flagged value={row.expired} tone="destructive" />,
      total: unitTotal((row) => row.expired),
    },
    {
      id: 'received',
      header: 'Registered',
      numeric: true,
      // In the View menu: the period's flows matter less here than what is on the shelf.
      defaultHidden: true,
      value: (row) => row.received,
      cell: (row) => (
        <span title={`Registered in the ${phrase}`}>{formatNumber(row.received)}</span>
      ),
    },
    {
      id: 'dispatched',
      header: 'Dispatched',
      numeric: true,
      defaultHidden: true,
      value: (row) => row.dispatched,
      cell: (row) => (
        <span title={`Dispatched in the ${phrase}`}>{formatNumber(row.dispatched)}</span>
      ),
    },
    {
      id: 'cover',
      header: 'Stock cover',
      numeric: true,
      hideable: true,
      value: (row) => stockCover(row),
      cell: (row) => {
        const months = stockCover(row);
        return months === null ? (
          <span className="text-muted-foreground" title="Nothing dispatched in the last 90 days">
            —
          </span>
        ) : (
          <span className="whitespace-nowrap">{formatMonths(months)}</span>
        );
      },
    },
    {
      id: 'next_expiry',
      filter: 'date',
      header: 'Next expiry',
      hideable: true,
      value: (row) => row.next_expiry,
      cell: (row) =>
        row.next_expiry ? (
          <span className="whitespace-nowrap">{formatDate(row.next_expiry)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
}

const batchColumns: DataTableColumn<StockBatch>[] = [
  {
    id: 'batch',
    header: 'Batch',
    value: (batch) => batch.batch_number ?? '',
    cell: (batch) => (
      <div className="flex min-w-0 flex-col">
        <span
          className={cn(
            'max-w-64 truncate',
            batch.batch_number ? 'font-medium' : 'text-muted-foreground',
          )}
          title={batchLabel(batch)}
        >
          {batchLabel(batch)}
        </span>
        {batch.batch_number ? null : (
          <span className="text-muted-foreground text-xs">Count it and record its batches</span>
        )}
      </div>
    ),
  },
  {
    id: 'product',
    header: 'Product',
    value: (batch) => productName(batch.product, batch.unit),
    cell: (batch) => <ProductCell product={batch.product} unit={batch.unit} className="max-w-56" />,
  },
  {
    id: 'expires',
    filter: 'date',
    header: 'Expires',
    value: (batch) => batch.expiry_date,
    cell: (batch) =>
      batch.expiry_date ? (
        <div>
          <div className="whitespace-nowrap">{formatDate(batch.expiry_date)}</div>
          <div className="text-muted-foreground text-xs">{shelfLifeLeft(batch.days_remaining)}</div>
        </div>
      ) : (
        <span className="text-muted-foreground">Not recorded</span>
      ),
  },
  {
    id: 'band',
    filter: 'select',
    header: 'Shelf life',
    value: (batch) => BAND_STATUS[batch.band].label,
    cell: (batch) => (
      <StatusBadge status={BAND_STATUS[batch.band].label} tone={BAND_STATUS[batch.band].tone} />
    ),
  },
  {
    id: 'on_hand',
    header: 'On hand',
    numeric: true,
    value: (batch) => batch.on_hand,
    cell: (batch) => formatNumber(batch.on_hand),
    total: unitTotal((batch) => batch.on_hand),
  },
];

/** A product's own batches, without the product column the row above already shows. */
const PRODUCT_BATCH_COLUMNS = batchColumns.filter((column) => column.id !== 'product');

/** Earliest expiry first, undated last: the order stock leaves the store. */
function firstExpiryFirst(a: StockBatch, b: StockBatch): number {
  if (a.expiry_date === b.expiry_date) return 0;
  if (a.expiry_date === null) return 1;
  if (b.expiry_date === null) return -1;
  return a.expiry_date.localeCompare(b.expiry_date);
}

/** A product row opened up: its batches in the order they leave. */
function ProductBatches({
  product,
  batches,
  isLoading,
}: {
  product: ProductSummary;
  batches: readonly StockBatch[] | undefined;
  isLoading: boolean;
}) {
  const held = useMemo(
    () => [...(batches ?? [])].filter((batch) => batch.on_hand > 0).sort(firstExpiryFirst),
    [batches],
  );
  return (
    <div className="bg-card rounded-card max-w-3xl overflow-hidden border">
      <DataTable
        variant="embedded"
        label={`Batches of ${productName(product.product, product.unit)}`}
        columns={PRODUCT_BATCH_COLUMNS}
        rows={held}
        getRowId={(batch) => batch.id}
        isLoading={isLoading}
        rowTone={(batch) => (batch.band === 'expired' ? 'negative' : 'default')}
        emptyTitle="No batches hold this product now."
      />
    </div>
  );
}

function movementColumns(href: (path: string) => string): DataTableColumn<Movement>[] {
  return [
    {
      id: 'at',
      filter: 'date',
      header: 'When',
      value: (movement) => movement.created_at,
      cell: (movement) => (
        <span className="whitespace-nowrap">{formatTimestamp(movement.created_at)}</span>
      ),
    },
    {
      id: 'reason',
      filter: 'select',
      header: 'What',
      value: (movement) => MOVEMENT_LABEL[movement.reason].label,
      cell: (movement) => {
        const shown = MOVEMENT_LABEL[movement.reason];
        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            {movement.order_id ? (
              <Link
                href={href(WAREHOUSE_PATHS.request(movement.order_id))}
                className="font-medium underline-offset-4 hover:underline"
              >
                {shown.label}
              </Link>
            ) : (
              <span className="font-medium">{shown.label}</span>
            )}
            {movement.note ? (
              <span
                className="text-muted-foreground block max-w-56 truncate text-xs"
                title={movement.note}
              >
                {movement.note}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'batch',
      header: 'Batch',
      value: (movement) => movementBatch(movement) ?? '',
      cell: (movement) => {
        const batch = movementBatch(movement);
        return batch ? (
          <span className="block max-w-40 truncate" title={batch}>
            {batch}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: 'product',
      header: 'Product',
      value: (movement) => productName(movement.product, movement.unit),
      cell: (movement) => {
        const name = productName(movement.product, movement.unit);
        return (
          <span className="block max-w-56 truncate" title={name}>
            {name}
          </span>
        );
      },
    },
    {
      id: 'change',
      header: 'Change',
      numeric: true,
      value: (movement) => movement.quantity,
      cell: (movement) => (
        <span className={cn('tabular-nums', movement.quantity > 0 && 'text-success')}>
          {signed(movement.quantity)}
        </span>
      ),
    },
    {
      id: 'after',
      header: 'On hand after',
      numeric: true,
      value: (movement) => movement.on_hand_after,
      cell: (movement) => formatNumber(movement.on_hand_after),
    },
  ];
}

const VIEW_DESCRIPTION: Record<View, (period: Period) => string> = {
  products: (period) =>
    `Open a product to see its batches. Registered and dispatched cover the ${periodPhrase(period)}; expiring means under three months left; stock cover is free stock over the average month of dispatches in the last 90 days.`,
  batches: () =>
    "Each product's batches in the order they are dispatched, earliest expiry first. Expired batches can't leave; write them off once they are disposed of.",
  movements: () =>
    'Stock registered, dispatches out and corrections, newest first. Older entries load a hundred at a time.',
};

export default function WarehouseStockPage() {
  const { code, href, warehouse, ...stores } = useCurrentWarehouse();
  const params = useSearchParams();
  const router = useRouter();
  const readOnly = useReadOnly();
  const can = useCan();
  const view = viewFrom(params);
  const band = batchFilterFrom(params.get('band'));
  const period = periodFrom(params.get('period'));
  const reason = reasonFrom(params.get('reason'));
  const today = useMemo(() => ugandaToday(new Date()), []);
  const range = useMemo(() => periodRange(period, today), [period, today]);
  const enabled = warehouse !== undefined;
  const summary = useStoreSummary(warehouse?.id, range, { enabled });
  const batches = useStoreBatches(warehouse?.id ?? '', { enabled });
  const ledger = useMovementLedger(warehouse?.id, reason === 'all' ? null : reason, {
    enabled: enabled && view === 'movements',
  });
  const [registering, setRegistering] = useState(() => params.get('register') === '1');
  const [startProduct, setStartProduct] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<StockBatch | null>(null);
  const [editing, setEditing] = useState<StockBatch | null>(null);
  const [deleting, setDeleting] = useState<StockBatch | null>(null);
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  // Where the row whose menu opened a batch dialog sat, for when the batch leaves the list.
  const openedFrom = useRef<{ rows: HTMLCollectionOf<HTMLTableRowElement>; index: number } | null>(
    null,
  );
  const openFrom = (batchId: string) => {
    const row = actionButtons.current.get(batchId)?.closest('tr');
    const body = row?.closest('tbody');
    openedFrom.current = row && body ? { rows: body.rows, index: row.sectionRowIndex } : null;
  };
  // The menu item that opened a batch dialog has gone; focus returns to the row's button or, once
  // the batch has left the list (deleted, written off, joined to another), to the row in its place.
  const focusRowButton = (batchId: string, event: Event) => {
    let target = actionButtons.current.get(batchId);
    if (!target?.isConnected && openedFrom.current) {
      const { rows, index } = openedFrom.current;
      target =
        rows[Math.min(index, rows.length - 1)]?.querySelector<HTMLButtonElement>(
          'button[aria-haspopup="menu"]',
        ) ?? undefined;
    }
    if (!target?.isConnected) return;
    event.preventDefault();
    target.focus();
  };
  const productCols = useMemo(() => productColumns(period), [period]);
  const movementCols = useMemo(() => movementColumns(href), [href]);
  const waiting = stores.isPending || !enabled;
  const pathFor = (next: {
    view?: View;
    band?: BatchFilter;
    period?: Period;
    reason?: ReasonFilter;
  }) =>
    href(
      stockPath(next.view ?? view, next.band ?? band, next.period ?? period, next.reason ?? reason),
    );

  const openRegister = (productId: string | null = null) => {
    setStartProduct(productId);
    setRegistering(true);
  };
  const closeRegister = (open: boolean) => {
    setRegistering(open);
    // Opened from a link (?register=1): closing leaves the address as the page's own.
    if (!open && params.get('register')) router.replace(pathFor({}), { scroll: false });
  };
  // Sending stock to a district before it orders is an order step, so it needs orders:process.
  const canDispatch = can('orders:process');
  // Registering, correcting and deleting stock need inventory:manage, as the API checks.
  const canManage = !readOnly && can('inventory:manage');
  const [dispatching, setDispatching] = useState(() => params.get('dispatch') === '1');
  const [dispatchProduct, setDispatchProduct] = useState<string | null>(null);
  const openDispatch = (productId: string | null = null) => {
    setDispatchProduct(productId);
    setDispatching(true);
  };
  const closeDispatch = (open: boolean) => {
    setDispatching(open);
    if (!open && params.get('dispatch')) router.replace(pathFor({}), { scroll: false });
  };

  const products = summary.data?.products;
  const orders = summary.data?.orders;
  const figuresLoading = waiting || summary.isPending;
  const summaryEmpty =
    !figuresLoading &&
    products?.length === 0 &&
    orders &&
    Object.values(orders).every((value) => value === 0 || value === null);
  const amounts = (pick: (row: ProductSummary) => number, none?: string) =>
    products ? formatStock(totalsByUnit(products, pick), none) : '—';
  /** A headline amount: the unit holding most as the figure, any other units on a line under it. */
  const figure = (pick: (row: ProductSummary) => number, none?: string) => {
    if (!products) return { value: '—' };
    const [first, ...rest] = totalsByUnit(products, pick);
    return {
      value: formatStock(first ? [first] : [], none),
      ...(rest.length > 0 ? { extra: formatStock(rest) } : {}),
    };
  };
  const rate = orders ? successRate(orders) : null;
  const expiringNext = products ? nextExpiry(products) : null;
  const expiredBatches = batches.data?.filter((batch) => batch.band === 'expired').length ?? 0;
  const shelfLife = useMemo(
    () => (batches.data ? shelfLifeByUnit(batches.data) : undefined),
    [batches.data],
  );
  const attention = useMemo(
    () => (batches.data && products ? stockAttention(batches.data, products, href) : undefined),
    [batches.data, products, href],
  );
  /** A product's batches, earliest expiry first, for its row's detail. */
  const batchesOf = useMemo(() => {
    const byProduct = new Map<string, StockBatch[]>();
    for (const batch of batches.data ?? []) {
      const key = `${batch.condom_id}:${batch.unit_of_measure_id}`;
      byProduct.set(key, [...(byProduct.get(key) ?? []), batch]);
    }
    return byProduct;
  }, [batches.data]);

  const registerButton = canManage ? (
    <WriteAction>
      <Button
        onClick={() => {
          openRegister();
        }}
        disabled={!enabled}
      >
        <PackagePlus data-icon="inline-start" />
        Register stock
      </Button>
    </WriteAction>
  ) : undefined;
  const dispatchButton = canDispatch ? (
    <WriteAction>
      <Button
        variant="outline"
        onClick={() => {
          openDispatch();
        }}
        disabled={!enabled}
      >
        <Truck data-icon="inline-start" />
        Dispatch to district
      </Button>
    </WriteAction>
  ) : null;

  if (summary.error?.kind === 'forbidden') {
    return (
      <div className="gap-section flex flex-col">
        <StoreSwitch
          store={code}
          hrefFor={(other) => withStore(stockPath(view, band, period, reason), other)}
        />
        <div className="bg-card rounded-card border">
          <EmptyState
            icon={LockKeyhole}
            title={`${code} stock is unavailable`}
            description="You do not have access to this warehouse's stock. Ask an administrator to check your store assignment and permissions."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="gap-section flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <StoreSwitch
          store={code}
          hrefFor={(other) => withStore(stockPath(view, band, period, reason), other)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            label="Period"
            value={period}
            options={PERIODS.map((option) => ({ value: option.value, label: option.label }))}
            onValueChange={(next) => {
              router.replace(pathFor({ period: next }), { scroll: false });
            }}
          />
          <PageActions>
            {dispatchButton}
            {registerButton}
          </PageActions>
        </div>
      </div>

      <section aria-labelledby="stock-figures" className="@container">
        <h2 id="stock-figures" className="sr-only">
          {code} stock at a glance
        </h2>
        {(stores.error ?? summary.error) ? (
          <div className="bg-card rounded-card border">
            <ErrorState
              title={`Could not load ${code} stock`}
              error={stores.error ?? summary.error}
              onRetry={() => {
                void stores.refetch();
                void summary.refetch();
              }}
              isRetrying={summary.isRefetching}
            />
          </div>
        ) : summaryEmpty ? (
          <div className="bg-card rounded-card border">
            <EmptyState
              icon={PackageOpen}
              title={`No stock data at ${code} yet`}
              description="Stock and district order activity will appear here once recorded."
            />
          </div>
        ) : (
          // Six figures read as one row where each card has about 200px, then two rows of three,
          // three rows of two, or one column on a phone; never 5 + 1. The section's own width
          // decides, so a collapsed sidebar gives the row back its room.
          <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3 @7xl:grid-cols-6">
            <StatCard
              label="On hand"
              {...figure((row) => row.on_hand)}
              detail={
                products
                  ? `${amounts((row) => row.usable)} free to dispatch · ${amounts((row) => row.reserved)} reserved`
                  : undefined
              }
              icon={Package}
              href={pathFor({ view: 'products' })}
              isLoading={figuresLoading}
            />
            <StatCard
              label={`Dispatched, ${periodPhrase(period)}`}
              {...figure((row) => row.dispatched)}
              detail={orders ? dispatchBreakdown(orders, period) : undefined}
              icon={Truck}
              accent="violet"
              href={href(WAREHOUSE_PATHS.requestsWithStatus('dispatched'))}
              isLoading={figuresLoading}
            />
            <StatCard
              label="Expired"
              {...figure((row) => row.expired, 'None')}
              detail={
                products && totalsByUnit(products, (row) => row.expired).length > 0
                  ? `${formatNumber(expiredBatches)} ${expiredBatches === 1 ? 'batch' : 'batches'} to write off; can't be dispatched`
                  : 'Nothing past its expiry date'
              }
              icon={CalendarX2}
              accent="caution"
              href={pathFor({ view: 'batches', band: 'expired' })}
              isLoading={figuresLoading}
            />
            <StatCard
              label="Expiring within 3 months"
              {...figure((row) => row.expiring, 'None')}
              detail={
                expiringNext
                  ? `Next expiry ${formatDate(expiringNext)}; earliest goes out first`
                  : 'No expiry dates recorded yet'
              }
              icon={ClockAlert}
              accent="caution"
              href={pathFor({ view: 'batches', band: 'expiring' })}
              isLoading={figuresLoading}
            />
            <StatCard
              label="Pending district orders"
              value={orders ? formatNumber(pendingOrders(orders)) : '—'}
              detail={orders ? pendingBreakdown(orders) : undefined}
              icon={Inbox}
              accent="info"
              href={href(WAREHOUSE_PATHS.requests)}
              isLoading={figuresLoading}
            />
            <StatCard
              label={`Success rate, ${periodPhrase(period)}`}
              value={rate === null ? '—' : formatPercent(rate)}
              detail={orders ? successBreakdown(orders, period) : undefined}
              icon={BadgeCheck}
              accent="positive"
              href={href(WAREHOUSE_PATHS.requests)}
              isLoading={figuresLoading}
            />
          </div>
        )}
      </section>

      {/* Each card is as tall as what it holds, so a short attention list leaves no empty card. */}
      <div className="gap-section grid items-start xl:grid-cols-2">
        <ShelfLifeOverview
          code={code}
          units={shelfLife}
          isLoading={waiting || batches.isPending}
          error={batches.error}
          onRetry={() => void batches.refetch()}
          isRetrying={batches.isRefetching}
          hrefForBand={(next) => pathFor({ view: 'batches', band: next })}
        />
        <TaskList
          title={`Needs attention at ${code}`}
          tasks={attention}
          isLoading={figuresLoading || batches.isPending}
          error={batches.error ?? summary.error}
          errorTitle={`Could not check the stock at ${code}`}
          onRetry={() => {
            void batches.refetch();
            void summary.refetch();
          }}
          isRetrying={batches.isRefetching || summary.isRefetching}
          loadingLabel="Checking the stock…"
          empty={
            shelfLife?.length === 0
              ? {
                  title: 'Nothing to check yet',
                  description: `Register stock at ${code}, and anything about it that needs doing shows here.`,
                }
              : {
                  title: 'Nothing needs attention',
                  description:
                    'No expired, undated or month-to-go batches, and every product has a month of stock or more.',
                }
          }
        />
      </div>

      <section aria-labelledby="stock-detail" className="flex flex-col gap-3">
        <h2 id="stock-detail" className="sr-only">
          Stock at {code} in detail
        </h2>
        <div className="flex flex-col gap-1.5">
          <FilterTabs
            label="Show stock by"
            value={view}
            hrefFor={(next) => pathFor({ view: next, band: 'all', reason: 'all' })}
            tabs={VIEWS.map((option) => ({
              value: option.value,
              label: option.label,
              ...(option.value === 'products' && products ? { count: products.length } : {}),
              ...(option.value === 'batches' && batches.data ? { count: batches.data.length } : {}),
            }))}
          />
          <p className="text-muted-foreground max-w-[75ch] text-sm text-pretty">
            {VIEW_DESCRIPTION[view](period)}
          </p>
        </div>

        {view === 'products' ? (
          <DataTable
            label={`Stock by product at ${code}`}
            columns={productCols}
            rows={products}
            getRowId={(row) => `${row.condom_id}:${row.unit_of_measure_id}`}
            preferencesKey="warehouse-stock-products"
            pageSize={25}
            renderExpanded={(row) => (
              <ProductBatches
                product={row}
                batches={batchesOf.get(`${row.condom_id}:${row.unit_of_measure_id}`)}
                isLoading={waiting || batches.isPending}
              />
            )}
            expandLabel={(row) => `Show batches of ${productName(row.product, row.unit)}`}
            isLoading={figuresLoading}
            error={summary.error}
            onRetry={() => void summary.refetch()}
            isRetrying={summary.isRefetching}
            searchPlaceholder="Search products…"
            emptyTitle={`No stock registered at ${code} yet`}
            emptyDescription="Register the first stock, batch by batch, and each product appears here."
            emptyAction={readOnly ? undefined : registerButton}
            rowActions={
              readOnly || (!canManage && !canDispatch)
                ? undefined
                : (row) => (
                    <RowActions
                      label={`Actions for ${productName(row.product, row.unit)}`}
                      actions={[
                        ...(canManage
                          ? [
                              {
                                label: 'Register stock…',
                                icon: PackagePlus,
                                onSelect: () => {
                                  openRegister(row.condom_id);
                                },
                              },
                            ]
                          : []),
                        ...(canDispatch
                          ? [
                              {
                                label: 'Dispatch to a district…',
                                icon: Truck,
                                onSelect: () => {
                                  openDispatch(row.condom_id);
                                },
                              },
                            ]
                          : []),
                      ]}
                    />
                  )
            }
          />
        ) : null}

        {view === 'batches' ? (
          <DataTable
            label={`Batches at ${code}`}
            columns={batchColumns}
            rows={batches.data?.filter((batch) => keepsBatch(band, batch))}
            getRowId={(batch) => batch.id}
            preferencesKey="warehouse-stock-batches"
            pageSize={25}
            rowTone={(batch) => (batch.band === 'expired' ? 'negative' : 'default')}
            isLoading={waiting || batches.isPending}
            error={batches.error}
            onRetry={() => void batches.refetch()}
            isRetrying={batches.isRefetching}
            searchPlaceholder="Search batches…"
            toolbar={
              <FilterSelect
                label="Shelf life"
                value={band}
                options={BATCH_FILTERS.map((option) => ({
                  value: option.value,
                  label: batches.data
                    ? `${option.label} (${formatNumber(
                        batches.data.filter((batch) => keepsBatch(option.value, batch)).length,
                      )})`
                    : option.label,
                }))}
                onValueChange={(next) => {
                  router.replace(pathFor({ view: 'batches', band: next }), { scroll: false });
                }}
              />
            }
            emptyTitle={band === 'all' ? `No batches held at ${code}` : 'No batches in this view'}
            emptyDescription={
              band === 'all'
                ? 'Batches appear here when stock is registered.'
                : 'Choose another shelf life to see the rest of the batches.'
            }
            emptyAction={band === 'all' && !readOnly ? registerButton : undefined}
            rowActions={
              !canManage
                ? undefined
                : (batch) => (
                    <RowActions
                      label={`Actions for batch ${batchLabel(batch)}`}
                      triggerRef={(button) => {
                        if (button) actionButtons.current.set(batch.id, button);
                        else actionButtons.current.delete(batch.id);
                      }}
                      actions={[
                        {
                          label: 'Edit batch…',
                          icon: Pencil,
                          onSelect: () => {
                            openFrom(batch.id);
                            setEditing(batch);
                          },
                        },
                        {
                          label: batch.band === 'expired' ? 'Write off…' : 'Adjust stock…',
                          icon: Scale,
                          onSelect: () => {
                            openFrom(batch.id);
                            setAdjusting(batch);
                          },
                        },
                        ROW_ACTION_SEPARATOR,
                        {
                          label: 'Delete batch…',
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => {
                            openFrom(batch.id);
                            setDeleting(batch);
                          },
                        },
                      ]}
                    />
                  )
            }
          />
        ) : null}

        {view === 'movements' ? (
          <DataTable
            label={`Stock movements at ${code}`}
            columns={movementCols}
            rows={ledger.rows}
            getRowId={(movement) => movement.id}
            preferencesKey="warehouse-stock-movements"
            pageSize={25}
            isLoading={waiting || ledger.isPending}
            error={ledger.error}
            onRetry={() => void ledger.refetch()}
            isRetrying={ledger.isRefetching}
            searchPlaceholder="Search movements…"
            more={{
              hasMore: ledger.hasMore,
              isLoading: ledger.isLoadingMore,
              onLoadMore: ledger.loadMore,
              noun: 'movements',
            }}
            toolbar={
              <FilterSelect
                label="What"
                value={reason}
                options={REASON_FILTERS}
                onValueChange={(next) => {
                  router.replace(pathFor({ view: 'movements', reason: next }), { scroll: false });
                }}
              />
            }
            emptyTitle={
              reason === 'all'
                ? 'No stock movements yet'
                : `No ${MOVEMENT_LABEL[reason].label.toLowerCase()} entries`
            }
            emptyDescription={
              reason === 'all'
                ? 'Stock registered, dispatches and corrections are listed here.'
                : 'Choose another kind of movement to see the rest of the ledger.'
            }
          />
        ) : null}
      </section>

      <RegisterStockSheet
        open={registering}
        onOpenChange={closeRegister}
        code={code}
        warehouse={warehouse}
        startProductId={startProduct}
      />

      {canDispatch ? (
        <DispatchToDistrictSheet
          open={dispatching}
          onOpenChange={closeDispatch}
          code={code}
          warehouse={warehouse}
          startProductId={dispatchProduct}
        />
      ) : null}

      {adjusting ? (
        <AdjustBatchDialog
          key={adjusting.id}
          batch={adjusting}
          open
          onOpenChange={(open) => {
            if (!open) setAdjusting(null);
          }}
          onCloseAutoFocus={(event) => {
            focusRowButton(adjusting.id, event);
          }}
        />
      ) : null}

      {editing ? (
        <EditBatchDialog
          key={editing.id}
          batch={editing}
          held={batches.data ?? []}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onCloseAutoFocus={(event) => {
            focusRowButton(editing.id, event);
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteBatchDialog
          key={deleting.id}
          batch={deleting}
          code={code}
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onCloseAutoFocus={(event) => {
            focusRowButton(deleting.id, event);
          }}
        />
      ) : null}
    </div>
  );
}
