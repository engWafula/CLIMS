'use client';

import { useParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';

import {
  ActivityTimeline,
  ActivityTimelineSkeleton,
  type ActivityEntry,
} from '@/components/ActivityTimeline';
import { DataTable } from '@/components/data-table/DataTable';
import { DetailHeader } from '@/components/DetailHeader';
import { DetailList } from '@/components/DetailList';
import { TextField } from '@/components/form/TextField';
import { InlineMessage } from '@/components/InlineMessage';
import { RadioCardGroup } from '@/components/RadioCardGroup';
import { RecordView } from '@/components/RecordView';
import { ErrorState } from '@/components/states/ErrorState';
import { StatusBadge } from '@/components/StatusBadge';
import { StepTracker } from '@/components/StepTracker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { packLabel, type Product } from '@/features/catalogue/api';
import type { StockBatch } from '@/features/inventory/api';
import { BAND_STATUS, batchLabel, shelfLifeLeft } from '@/features/inventory/bands';
import { useCan } from '@/features/auth/queries';
import type { Order } from '@/features/orders/api';
import { useFocusWhenLost } from '@/hooks/useFocusWhenLost';
import { ApiError, getErrorMessage } from '@/lib/api';
import { formatDate, formatTimestamp } from '@/lib/format';
import { useReadOnly } from '@/navigation/useAccess';

import {
  useApproveOrder,
  useCheckStock,
  useCurrentWarehouse,
  useDispatchOrder,
  useRejectOrder,
  useRequestNames,
  useStoreBatches,
  useStoreOrder,
  useStoreOrderEvents,
  useStoreStock,
  type RequestNames,
} from './orderQueries';
import { WAREHOUSE_PATHS, withStore } from './paths';
import { planDispatch, reservable, type PlannedTake } from './picking';
import {
  requestBanner,
  requestEventLabel,
  requestStatus,
  requestSteps,
  WAREHOUSE_ACTIONS,
} from './requests';
import { StoreSwitch } from './StoreSwitch';

export default function DistrictRequestPage() {
  const { id } = useParams<{ id: string }>();
  const { code, href } = useCurrentWarehouse();
  const order = useStoreOrder(id);
  // Each step replaces the form that took it (the detail remounts per status); focus goes to the
  // banner that says what is true now.
  const bannerRef = useRef<HTMLDivElement>(null);
  useFocusWhenLost(bannerRef, order.data?.order_status);
  return (
    <div className="gap-section flex flex-col">
      <StoreSwitch store={code} hrefFor={(other) => withStore(WAREHOUSE_PATHS.requests, other)} />
      <RecordView
        query={order}
        layout="detail"
        noun="order"
        back={{ href: href(WAREHOUSE_PATHS.requests), label: 'Back to district orders' }}
      >
        {(data) => (
          <OrderDetail key={`${data.id}:${data.order_status}`} order={data} bannerRef={bannerRef} />
        )}
      </RecordView>
    </div>
  );
}

interface DetailProps {
  order: Order;
  names: RequestNames;
  district: string;
  quantity: (value: number | null) => string;
}

function OrderDetail({
  order,
  bannerRef,
}: {
  order: Order;
  bannerRef: RefObject<HTMLDivElement | null>;
}) {
  const names = useRequestNames();
  const events = useStoreOrderEvents(order.id);
  const readOnly = useReadOnly();
  // Every step on this page is an order step; the API refuses them without orders:process.
  const canProcess = useCan()('orders:process');
  const district = names.store(order.ordered_for_store_id);
  const product = names.product(order.condom_id, order.condom_category);
  const quantity = (value: number | null) => names.quantity(value, order.unit_of_measure_id);
  const props: DetailProps = { order, names, district, quantity };
  const status = requestStatus(order);
  const banner = requestBanner(order, district, product, quantity);
  const history: ActivityEntry[] = (events.data ?? []).map((event) => ({
    id: event.id,
    text: requestEventLabel(event.action, event.status),
    meta: formatTimestamp(event.created_at),
    role: WAREHOUSE_ACTIONS.has(event.action) ? 'warehouse' : 'dcfp',
  }));
  const state = order.order_status;

  return (
    <div className="gap-section flex flex-col">
      <DetailHeader
        title={`${product} for ${district}`}
        status={<StatusBadge status={status.label} tone={status.tone} />}
        description={`Ordered ${formatDate(order.order_date)}`}
      >
        <StepTracker aria-label="Order progress" steps={requestSteps(order)} />
      </DetailHeader>

      <div className="gap-section grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="gap-section flex min-w-0 flex-col">
          <Alert ref={bannerRef} tabIndex={-1} variant={banner.variant} role="status">
            <AlertTitle>{banner.title}</AlertTitle>
            <AlertDescription className="break-words">{banner.body}</AlertDescription>
          </Alert>
          {readOnly || !canProcess ? null : state === 'queued' ? (
            <DecisionCard {...props} />
          ) : state === 'reviewed' || state === 'on_hold' ? (
            <StockCheckCard {...props} />
          ) : state === 'confirmed' ? (
            <DispatchCard {...props} />
          ) : null}
          {state === 'dispatched' || state === 'received' ? <ShipmentCard {...props} /> : null}
        </div>

        <div className="gap-section flex min-w-0 flex-col">
          <Card>
            <CardHeader>
              <CardTitle>Order</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: 'Ordered for', value: district },
                  {
                    label: order.condom_id ? 'Product' : 'Requested',
                    value: product,
                  },
                  { label: 'Quantity ordered', value: quantity(order.quantity_needed) },
                  ...(order.quantity_approved !== null && state !== 'rejected'
                    ? [{ label: 'Quantity approved', value: quantity(order.quantity_approved) }]
                    : []),
                  ...(order.quantity_issued !== null
                    ? [{ label: 'Quantity dispatched', value: quantity(order.quantity_issued) }]
                    : []),
                  ...(order.quantity_received !== null
                    ? [{ label: 'Quantity received', value: quantity(order.quantity_received) }]
                    : []),
                  ...(order.rejection_reason
                    ? [{ label: 'Why it was rejected', value: order.rejection_reason }]
                    : []),
                  { label: 'Comment', value: order.comment ?? '—' },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {events.isPending ? (
                <ActivityTimelineSkeleton />
              ) : events.isError ? (
                <ErrorState
                  title="Could not load the history"
                  error={events.error}
                  onRetry={() => void events.refetch()}
                  isRetrying={events.isRefetching}
                />
              ) : history.length === 0 ? (
                <p className="text-muted-foreground text-sm">No steps recorded yet.</p>
              ) : (
                <ActivityTimeline entries={history} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The product's catalogue unit, the unit an order for it is counted in. */
function catalogueUnit(products: readonly Product[], id: string | null): string | null {
  return products.find((product) => product.id === id)?.unit?.id ?? null;
}

/** A whole number, or null for anything else (including blank). */
function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * The warehouse's stock and batches, and what each product can still reserve in the unit `unitOf`
 * gives it: the order's unit once reviewed, else the product's catalogue unit, which the order takes
 * when approved.
 */
function useReservable(order: Order, unitOf: (condomId: string | null) => string | null) {
  const storeId = order.ordered_from_store_id;
  const stock = useStoreStock(storeId);
  const batches = useStoreBatches(storeId);
  return {
    unitOf,
    isPending: stock.isPending || batches.isPending,
    error: stock.error ?? batches.error,
    retry: () => {
      void stock.refetch();
      void batches.refetch();
    },
    of: (condomId: string) => {
      const unit = unitOf(condomId);
      if (!unit) return 0;
      return reservable(
        stock.data?.find((row) => row.condom_id === condomId && row.unit_of_measure_id === unit),
        batches.data?.filter(
          (batch) => batch.condom_id === condomId && batch.unit_of_measure_id === unit,
        ),
      );
    },
  };
}

/**
 * Approving an order: the product to send, of the category the district asked for, and how much
 * of the order. Approving checks the stock at once: it is reserved, or the order waits for stock.
 */
function DecisionCard({
  order,
  names,
  district,
  onCancel,
}: DetailProps & { onCancel?: () => void }) {
  const products = names.productsOf(order.condom_category);
  // Approving counts the order in the chosen product's catalogue unit, so read each in its own.
  const stock = useReservable(order, (id) => catalogueUnit(products, id));
  const approve = useApproveOrder(order.id, district);
  const ordered = order.quantity_needed ?? 0;
  const inputId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  // Untouched, the quantity offers what the chosen product can cover: the order, or what is left.
  const [typed, setTyped] = useState<string | null>(order.quantity_approved?.toString() ?? null);
  const [tried, setTried] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const best = useMemo(() => {
    if (stock.isPending) return null;
    const ranked = [...products].sort((a, b) => stock.of(b.id) - stock.of(a.id));
    return ranked[0]?.id ?? null;
  }, [products, stock]);
  const productId = chosen ?? order.condom_id ?? best;
  // Quantities read in the chosen product's unit, which the order takes when approved.
  const quantity = (amount: number | null, id: string | null = productId) =>
    names.quantity(amount, stock.unitOf(id));
  const available = productId ? stock.of(productId) : 0;
  const offered = available > 0 ? Math.min(ordered, available) : ordered;
  const text = typed ?? String(offered);
  const value = parseWhole(text);
  const productError = productId ? null : 'Choose the product to send.';
  const quantityError =
    value === null || value < 1
      ? 'Enter how many to approve, as a whole number.'
      : value > ordered
        ? `You can approve at most the ${quantity(ordered)} ordered.`
        : null;
  const willWait = value !== null && !quantityError && value > available;

  function submit() {
    setTried(true);
    if (productError || quantityError || value === null || productId === null) {
      if (quantityError) document.getElementById(inputId)?.focus();
      return;
    }
    if (approve.isPending) return;
    approve.mutate({
      condom_id: productId,
      ...(value === ordered ? {} : { quantity_approved: value }),
    });
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{onCancel ? 'Change the approval' : 'Manage this order'}</CardTitle>
        <CardDescription>
          {district} asked for {names.product(null, order.condom_category).toLowerCase()}. Choose
          which product to send; approving reserves the stock if this warehouse has it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {stock.isPending || names.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : stock.error ? (
          <ErrorState
            title="Could not load the warehouse's stock"
            error={stock.error}
            onRetry={stock.retry}
          />
        ) : products.length === 0 ? (
          <Alert variant="warning">
            <AlertTitle>No active product of this type in the catalogue</AlertTitle>
            <AlertDescription>
              Ask a catalogue manager to add or reactivate one, or reject the order.
            </AlertDescription>
          </Alert>
        ) : (
          <RadioCardGroup
            legend="Product to send"
            value={productId}
            onValueChange={(next) => {
              setChosen(next);
              if (!order.quantity_approved) setTyped(null);
            }}
            options={products.map((product) => {
              const free = stock.of(product.id);
              return {
                value: product.id,
                // Products can share a brand and type and differ only in their pack.
                label: [names.product(product.id, null), packLabel(product)]
                  .filter(Boolean)
                  .join(', '),
                description:
                  free > 0
                    ? `${quantity(free, product.id)} can be reserved`
                    : 'None that can be reserved',
                aside:
                  free >= ordered ? (
                    <StatusBadge status="Covers the order" tone="positive" />
                  ) : free > 0 ? (
                    <StatusBadge status="Part of the order" tone="caution" />
                  ) : (
                    <StatusBadge status="Out of stock" tone="negative" />
                  ),
              };
            })}
            error={tried ? (productError ?? undefined) : undefined}
            disabled={approve.isPending}
          />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>Quantity to approve</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={inputId}
              inputMode="numeric"
              value={text}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              aria-invalid={tried && quantityError ? true : undefined}
              aria-describedby={`${inputId}-note`}
              disabled={approve.isPending}
              className="w-32 text-right tabular-nums"
            />
            <span className="text-muted-foreground text-sm">of {quantity(ordered)} ordered</span>
            {available > 0 && available < ordered && value !== available ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() => {
                  setTyped(String(available));
                }}
                disabled={approve.isPending}
              >
                Approve the {quantity(available)} that can be reserved
              </Button>
            ) : null}
          </div>
          <InlineMessage id={`${inputId}-note`} tone={tried && quantityError ? 'error' : 'warning'}>
            {tried && quantityError
              ? quantityError
              : willWait
                ? `Only ${quantity(available)} can be reserved now, so the order will wait for stock. ${district} is told it is approved.`
                : value !== null && value < ordered && !quantityError
                  ? `Approving ${quantity(value)} of the ${quantity(ordered)} ordered. ${district} is told how much is coming.`
                  : null}
          </InlineMessage>
        </div>

        {approve.error ? (
          <Alert variant="destructive">
            <AlertTitle>The order was not approved</AlertTitle>
            <AlertDescription>{getErrorMessage(approve.error)}</AlertDescription>
          </Alert>
        ) : null}
        {rejecting ? (
          <RejectPanel
            order={order}
            district={district}
            onCancel={() => {
              setRejecting(false);
            }}
          />
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            {onCancel ? (
              <Button variant="ghost" onClick={onCancel} disabled={approve.isPending}>
                Cancel
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setRejecting(true);
                }}
                disabled={approve.isPending}
              >
                Reject order…
              </Button>
            )}
            <Button
              onClick={submit}
              disabled={approve.isPending || products.length === 0}
              className="h-auto min-h-8 whitespace-normal"
            >
              {approve.isPending
                ? 'Approving…'
                : value !== null && value > 0
                  ? `Approve ${quantity(value)}`
                  : 'Approve'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * An approved order without a reservation: the stock check failed, or the warehouse is waiting for
 * stock. Check again, change the approval (while waiting for stock), or reject the order.
 */
function StockCheckCard(props: DetailProps) {
  const { order, district, quantity } = props;
  const stock = useReservable(order, () => order.unit_of_measure_id);
  const check = useCheckStock(order.id, district);
  const [mode, setMode] = useState<'check' | 'change' | 'reject'>('check');
  const approved = order.quantity_approved ?? order.quantity_needed ?? 0;
  const available = order.condom_id ? stock.of(order.condom_id) : 0;
  const enough = !stock.isPending && available >= approved;

  if (mode === 'change') {
    return (
      <DecisionCard
        {...props}
        onCancel={() => {
          setMode('check');
        }}
      />
    );
  }
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          {order.order_status === 'on_hold' ? 'Check the stock again' : 'Reserve the stock'}
        </CardTitle>
        <CardDescription>
          {stock.isPending
            ? 'Looking up the stock…'
            : enough
              ? `${quantity(available)} can be reserved now, enough for the ${quantity(approved)} approved.`
              : `${quantity(available)} can be reserved now, short of the ${quantity(approved)} approved.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {check.error ? (
          <Alert variant="destructive">
            <AlertTitle>The stock was not checked</AlertTitle>
            <AlertDescription>{getErrorMessage(check.error)}</AlertDescription>
          </Alert>
        ) : null}
        {mode === 'reject' ? (
          <RejectPanel
            order={order}
            district={district}
            onCancel={() => {
              setMode('check');
            }}
          />
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setMode('reject');
              }}
              disabled={check.isPending}
            >
              Reject order…
            </Button>
            {/* A new review is allowed only while the order waits for stock. */}
            {order.order_status === 'on_hold' ? (
              <Button
                variant="outline"
                onClick={() => {
                  setMode('change');
                }}
                disabled={check.isPending}
              >
                Change product or quantity
              </Button>
            ) : null}
            <Button
              onClick={() => {
                if (!check.isPending) check.mutate(undefined);
              }}
              disabled={check.isPending}
            >
              {check.isPending ? 'Checking…' : 'Check stock and reserve'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Rejecting an order before dispatch: the reason goes to the district's DCFPs. */
function RejectPanel({
  order,
  district,
  onCancel,
}: {
  order: Order;
  district: string;
  onCancel: () => void;
}) {
  const reject = useRejectOrder(order.id, district);
  const reasonId = useId();
  // The panel replaces the button that opened it; carry focus to the reason it asks for.
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    reasonRef.current?.focus();
  }, []);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const error = reason.trim() === '' ? 'Say why the order is rejected.' : null;

  return (
    <section
      aria-label="Reject the order"
      className="border-destructive/30 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>Why are you rejecting it?</Label>
        <Textarea
          id={reasonId}
          rows={3}
          maxLength={4000}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          aria-required
          aria-invalid={tried && error ? true : undefined}
          aria-describedby={tried && error ? `${reasonId}-error` : `${reasonId}-hint`}
          placeholder="e.g. This product is held for the national campaign until March"
          disabled={reject.isPending}
          ref={reasonRef}
        />
        {tried && error ? (
          <FieldError id={`${reasonId}-error`}>{error}</FieldError>
        ) : (
          <p id={`${reasonId}-hint`} className="text-muted-foreground text-xs">
            {district} reads this. Rejecting closes the order
            {order.order_status === 'confirmed' ? ' and releases the reserved stock' : ''}; they
            place a new one if they still need stock.
          </p>
        )}
      </div>
      {reject.error ? (
        <Alert variant="destructive">
          <AlertTitle>The order was not rejected</AlertTitle>
          <AlertDescription>{getErrorMessage(reject.error)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={reject.isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-auto min-h-8 whitespace-normal"
          onClick={() => {
            setTried(true);
            if (error || reject.isPending) return;
            reject.mutate(reason.trim());
          }}
          disabled={reject.isPending}
        >
          {reject.isPending ? 'Rejecting…' : `Reject and tell ${district}`}
        </Button>
      </div>
    </section>
  );
}

interface Transport {
  vehicle_registration: string;
  driver_name: string;
  driver_phone: string;
}

const TRANSPORT_FIELDS: { key: keyof Transport; label: string; max: number }[] = [
  { key: 'vehicle_registration', label: 'Vehicle registration', max: 30 },
  { key: 'driver_name', label: 'Driver', max: 200 },
  { key: 'driver_phone', label: "Driver's phone", max: 30 },
];

/** The field message the API gave for `field`, if the failure was about it. */
function fieldError(error: unknown, field: string): string | undefined {
  return error instanceof ApiError ? error.fieldErrors[field]?.[0] : undefined;
}

/**
 * Dispatching a confirmed order: how much (all that is reserved, or less), the batches that go
 * first expiry first out, a reason when one has under a month left, and the transport.
 */
function DispatchCard({ order, district, quantity }: DetailProps) {
  const batches = useStoreBatches(order.ordered_from_store_id);
  const dispatch = useDispatchOrder(order.id, district);
  const quantityRef = useRef<HTMLDivElement>(null);
  const reasonId = useId();
  const approved = order.quantity_approved ?? order.quantity_needed ?? 0;
  const [typed, setTyped] = useState(String(approved));
  const [reason, setReason] = useState('');
  const [transport, setTransport] = useState<Transport>({
    vehicle_registration: '',
    driver_name: '',
    driver_phone: '',
  });
  const [tried, setTried] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const value = parseWhole(typed);
  const quantityError =
    value === null || value < 1
      ? 'Enter how many to dispatch, as a whole number.'
      : value > approved
        ? `You can dispatch at most the ${quantity(approved)} reserved.`
        : null;
  const own = batches.data?.filter(
    (batch) =>
      batch.condom_id === order.condom_id && batch.unit_of_measure_id === order.unit_of_measure_id,
  );
  const plan = own && !quantityError && value !== null ? planDispatch(own, value) : null;
  const serverReason = fieldError(dispatch.error, 'expiry_exception_reason');
  const needsReason = (plan?.nearExpiry.length ?? 0) > 0 || serverReason !== undefined;
  const reasonError =
    needsReason && reason.trim() === ''
      ? 'Say why stock with under a month left is dispatched.'
      : null;

  function submit() {
    setTried(true);
    if (quantityError || value === null) {
      quantityRef.current?.querySelector('input')?.focus();
      return;
    }
    if (reasonError) {
      document.getElementById(reasonId)?.focus();
      return;
    }
    if (dispatch.isPending) return;
    const optional = Object.fromEntries(
      TRANSPORT_FIELDS.map(({ key }) => [key, transport[key].trim()] as const).filter(
        ([, text]) => text !== '',
      ),
    );
    dispatch.mutate({
      ...(value === approved ? {} : { quantity_issued: value }),
      ...(needsReason ? { expiry_exception_reason: reason.trim() } : {}),
      ...optional,
    });
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Dispatch to {district}</CardTitle>
        <CardDescription>
          Batches leave first expiry first out; expired batches stay behind.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div ref={quantityRef}>
          <TextField
            label="Quantity to dispatch"
            required
            inputMode="numeric"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            description={
              value !== null && !quantityError && value < approved
                ? `Less than the ${quantity(approved)} reserved; the rest of the reservation is released.`
                : `${quantity(approved)} is reserved for this order.`
            }
            error={tried ? (quantityError ?? undefined) : undefined}
            disabled={dispatch.isPending}
            className="max-w-40 text-right tabular-nums"
          />
        </div>

        {batches.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : batches.isError ? (
          <ErrorState
            title="Could not load the batches"
            error={batches.error}
            onRetry={() => void batches.refetch()}
            isRetrying={batches.isRefetching}
          />
        ) : plan ? (
          <PlanTable plan={plan.takes} quantity={quantity} short={plan.short} />
        ) : null}

        {needsReason ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={reasonId}>Why dispatch stock with under a month left?</Label>
            <Textarea
              id={reasonId}
              rows={2}
              maxLength={1000}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              aria-required
              aria-invalid={tried && reasonError ? true : undefined}
              aria-describedby={`${reasonId}-hint${tried && reasonError ? ` ${reasonId}-error` : ''}`}
              placeholder="e.g. The district is out of stock and will use it within the week"
              disabled={dispatch.isPending}
            />
            <p id={`${reasonId}-hint`} className="text-muted-foreground text-xs">
              {plan && plan.nearExpiry.length > 0
                ? `${plan.nearExpiry.map((take) => batchLabel(take.batch)).join(', ')} ${plan.nearExpiry.length === 1 ? 'has' : 'have'} under a month left. `
                : ''}
              The reason is recorded with your name as an expiry exception.
            </p>
            {tried && reasonError ? (
              <FieldError id={`${reasonId}-error`}>{reasonError}</FieldError>
            ) : null}
          </div>
        ) : null}

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Transport</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {TRANSPORT_FIELDS.map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                value={transport[field.key]}
                maxLength={field.max}
                onChange={(event) => {
                  setTransport((current) => ({ ...current, [field.key]: event.target.value }));
                }}
                disabled={dispatch.isPending}
                autoComplete="off"
                spellCheck={field.key === 'driver_name'}
                {...(field.key === 'driver_phone' ? { inputMode: 'tel' as const } : {})}
              />
            ))}
          </div>
        </fieldset>

        {dispatch.error ? (
          <Alert variant="destructive">
            <AlertTitle>The order was not dispatched</AlertTitle>
            <AlertDescription>{getErrorMessage(dispatch.error)}</AlertDescription>
          </Alert>
        ) : null}

        {rejecting ? (
          <RejectPanel
            order={order}
            district={district}
            onCancel={() => {
              setRejecting(false);
            }}
          />
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setRejecting(true);
              }}
              disabled={dispatch.isPending}
            >
              Reject instead…
            </Button>
            <Button
              onClick={submit}
              disabled={dispatch.isPending}
              className="h-auto min-h-8 whitespace-normal"
            >
              {dispatch.isPending ? 'Dispatching…' : `Dispatch to ${district}`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The batches a dispatch takes, first expiry first, with their shelf life. */
function PlanTable({
  plan,
  short,
  quantity,
}: {
  plan: readonly PlannedTake[];
  short: number;
  quantity: (value: number | null) => string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <DataTable<PlannedTake>
        variant="embedded"
        label="Batches this dispatch takes"
        rows={plan}
        getRowId={(take) => take.batch.id}
        rowTone={(take) => (take.batch.band === 'under_1_month' ? 'caution' : 'default')}
        columns={[
          {
            id: 'batch',
            header: 'Batch',
            cell: (take) => <BatchName batch={take.batch} />,
          },
          {
            id: 'taking',
            header: 'Taking',
            numeric: true,
            cell: (take) => quantity(take.quantity),
          },
        ]}
      />
      {short > 0 ? (
        <InlineMessage tone="error">
          {`The batches hold ${quantity(short)} less unexpired stock than this. Count the stock, or dispatch less.`}
        </InlineMessage>
      ) : null}
    </div>
  );
}

function BatchName({ batch }: { batch: StockBatch }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className={batch.batch_number ? 'font-medium wrap-anywhere' : 'text-muted-foreground'}>
        {batchLabel(batch)}
      </span>
      <span className="text-muted-foreground text-xs">
        {batch.expiry_date
          ? `Expires ${formatDate(batch.expiry_date)} · ${shelfLifeLeft(batch.days_remaining)}`
          : 'Expiry not recorded'}
      </span>
      {/* The badge sits in the cell, not its own column, so the table fits a phone. */}
      {batch.band === 'unknown' ? null : (
        <StatusBadge
          className="mt-1 self-start"
          status={BAND_STATUS[batch.band].label}
          tone={BAND_STATUS[batch.band].tone}
        />
      )}
    </div>
  );
}

/** What was dispatched, the transport and, once received, what the district counted. */
function ShipmentCard({ order, quantity }: DetailProps) {
  const driver = [order.driver_name, order.driver_phone && `(${order.driver_phone})`]
    .filter(Boolean)
    .join(' ');
  const items = [
    { label: 'Dispatched', value: quantity(order.quantity_issued) },
    ...(order.quantity_received !== null
      ? [{ label: 'Counted by the district', value: quantity(order.quantity_received) }]
      : []),
    ...(order.discrepancy_note ? [{ label: 'Why it differs', value: order.discrepancy_note }] : []),
    ...(order.vehicle_registration
      ? [{ label: 'Vehicle', value: order.vehicle_registration }]
      : []),
    ...(driver ? [{ label: 'Driver', value: driver }] : []),
  ];
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Dispatch</CardTitle>
      </CardHeader>
      <CardContent>
        <DetailList items={items} />
      </CardContent>
    </Card>
  );
}
