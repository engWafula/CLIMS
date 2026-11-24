'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PackageX, Plus, Trash2 } from 'lucide-react';
import { useId, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { toast } from 'sonner';

import { ComboboxField, type ComboboxOption } from '@/components/form/ComboboxField';
import { SelectField } from '@/components/form/SelectField';
import { TextareaField } from '@/components/form/TextareaField';
import { TextField } from '@/components/form/TextField';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useProducts } from '@/features/catalogue/queries';
import { dcfpKeys } from '@/features/dcfp/queries';
import { nationalKeys } from '@/features/moh/queries';
import { useStores } from '@/features/geography/queries';
import { BAND_STATUS, batchLabel } from '@/features/inventory/bands';
import {
  dispatchToDistrict,
  type DistrictDispatchInput,
  type Warehouse,
} from '@/features/orders/api';
import { ApiError, getErrorMessage, useHttp } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';

import {
  checkDispatch,
  dispatchables,
  dispatchTotals,
  type DispatchLine,
  type Dispatchable,
} from './districtDispatch';
import { useStoreBatches, useStoreStock, warehouseOrderKeys } from './orderQueries';
import type { PlannedTake } from './picking';
import { lineOfError } from './receiving';
import { formatAmounts } from './summary';

/** The API takes at most this many lines in one dispatch. */
const MAX_LINES = 20;

interface Transport {
  vehicle_registration: string;
  driver_name: string;
  driver_phone: string;
}

const NO_TRANSPORT: Transport = {
  vehicle_registration: '',
  driver_name: '',
  driver_phone: '',
};

const TRANSPORT_FIELDS: { key: keyof Transport; label: string; max: number }[] = [
  { key: 'vehicle_registration', label: 'Vehicle registration', max: 30 },
  { key: 'driver_name', label: 'Driver', max: 200 },
  { key: 'driver_phone', label: "Driver's phone", max: 30 },
];

const blank = (key: number, productId = ''): DispatchLine => ({ key, productId, quantity: '' });

/**
 * Sends the dispatch. It changes the warehouse's stock, its orders and the district's orders,
 * so every view of them refetches, whether it went or not (a refusal may follow a change).
 */
function useDispatchToDistrict() {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DistrictDispatchInput) => dispatchToDistrict(http, input),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: warehouseOrderKeys.all }),
        // The stock page's ledger and the DCFP's order lists.
        queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] }),
        queryClient.invalidateQueries({ queryKey: dcfpKeys.all }),
        queryClient.invalidateQueries({ queryKey: nationalKeys.all }),
      ]),
    // The panel shows each failure beside the field or line it is about.
    meta: { handlesOwnErrors: true },
  });
}

interface DispatchToDistrictSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "NMS". */
  code: string;
  warehouse: Warehouse | undefined;
  /** A product to start an empty form with, when opened from a product's row. */
  startProductId?: string | null;
}

/**
 * Sends stock to a district store before it orders any, without leaving the stock page: a
 * district, one line per product, a note and the transport. Only free stock can go, first
 * expiry first out; the lines go together or not at all. The district is told, and counts the
 * stock in when it arrives. What has been typed stays if the panel is closed, until it is sent
 * or started over.
 */
export function DispatchToDistrictSheet({
  open,
  onOpenChange,
  code,
  warehouse,
  startProductId,
}: DispatchToDistrictSheetProps) {
  const enabled = open && warehouse !== undefined;
  const products = useProducts();
  const stores = useStores(open);
  const balances = useStoreStock(warehouse?.id ?? '', { enabled });
  const batches = useStoreBatches(warehouse?.id ?? '', { enabled });
  const dispatch = useDispatchToDistrict();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const nextKey = useRef(1);
  const [districtId, setDistrictId] = useState('');
  const [lines, setLines] = useState<DispatchLine[]>(() => [blank(0)]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [transport, setTransport] = useState<Transport>(NO_TRANSPORT);
  const [tried, setTried] = useState(false);

  const items = useMemo(
    () => dispatchables(products.data ?? [], balances.data ?? [], batches.data ?? []),
    [products.data, balances.data, batches.data],
  );
  const byId = useMemo(() => new Map(items.map((item) => [item.product.id, item])), [items]);
  const districts = useMemo<ComboboxOption[]>(
    () =>
      (stores.data ?? [])
        .filter((store) => store.store_type === 'district')
        .map((store) => ({
          value: store.id,
          label: store.name,
          ...(store.district_name && store.district_name !== store.name
            ? { hint: `${store.district_name} district` }
            : {}),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [stores.data],
  );
  const districtName = districts.find((option) => option.value === districtId)?.label;

  const check = checkDispatch(lines, byId);
  const amounts = dispatchTotals(lines, check.lines, byId);
  const chosen = lines.filter((line) => line.productId !== '').length;
  const fieldError = (field: string) =>
    dispatch.error instanceof ApiError ? dispatch.error.fieldErrors[field]?.[0] : undefined;
  const failed = dispatch.error ? lineOfError(getErrorMessage(dispatch.error)) : null;
  const failedKey = failed ? lines[failed.index]?.key : undefined;
  const serverReason = fieldError('expiry_exception_reason');
  const needsReason = check.nearExpiry.length > 0 || serverReason !== undefined;
  const reasonError =
    needsReason && reason.trim() === ''
      ? 'Say why stock with under a month left is dispatched.'
      : undefined;
  const districtError = districtId ? undefined : 'Choose the district store to send to.';
  const dirty =
    districtId !== '' ||
    note.trim() !== '' ||
    lines.some((line) => line.productId !== '' || line.quantity.trim() !== '') ||
    TRANSPORT_FIELDS.some(({ key }) => transport[key].trim() !== '');

  // Opened from a product's row: an untouched form starts with that product. This adjusts state
  // while rendering, once per opening, rather than in an effect.
  const start = open && startProductId ? byId.get(startProductId) : undefined;
  const [started, setStarted] = useState<string | null>(null);
  if ((start?.product.id ?? null) !== started) {
    setStarted(start?.product.id ?? null);
    const first = lines[0];
    if (start && lines.length === 1 && first && !first.productId && !first.quantity) {
      setLines([{ ...first, productId: start.product.id }]);
    }
  }

  const focusLater = (selector: string) => {
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
  };

  const update = (key: number, changes: Partial<DispatchLine>) => {
    if (dispatch.error) dispatch.reset();
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    );
  };

  const addLine = () => {
    const key = nextKey.current++;
    setLines((current) => [...current, blank(key)]);
    // A line just added is not wrong yet; the errors come back at the next try.
    setTried(false);
    focusLater(`[data-line-key="${String(key)}"] button[role="combobox"]`);
  };

  const removeLine = (key: number, index: number) => {
    if (dispatch.error) dispatch.reset();
    setLines((current) => current.filter((line) => line.key !== key));
    const neighbour = lines[index + 1] ?? lines[index - 1];
    if (neighbour) focusLater(`[data-line-key="${String(neighbour.key)}"] input[name="quantity"]`);
  };

  const startOver = () => {
    dispatch.reset();
    setDistrictId('');
    setLines([blank(nextKey.current++)]);
    setNote('');
    setReason('');
    setTransport(NO_TRANSPORT);
    setTried(false);
  };

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (districtError || !check.valid || reasonError) {
      focusLater('[aria-invalid="true"]');
      return;
    }
    if (!warehouse || dispatch.isPending) return;
    const optional = Object.fromEntries(
      TRANSPORT_FIELDS.map(({ key }) => [key, transport[key].trim()] as const).filter(
        ([, text]) => text !== '',
      ),
    );
    const sentTo = districtName ?? 'the district';
    const sentAmounts = formatAmounts(amounts);
    const count = lines.length;
    dispatch.mutate(
      {
        warehouse_store_id: warehouse.id,
        district_store_id: districtId,
        lines: lines.map((line, index) => ({
          condom_id: line.productId,
          quantity: check.lines[index]?.quantity ?? 0,
        })),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(needsReason ? { expiry_exception_reason: reason.trim() } : {}),
        ...optional,
      },
      {
        onSuccess: () => {
          toast.success(
            `Dispatched to ${sentTo}: ${productCount(count)}, ${sentAmounts}. ${sentTo} has been told and records the receipt when it arrives.`,
          );
          startOver();
          onOpenChange(false);
        },
        onError: (error) => {
          const line = lineOfError(getErrorMessage(error));
          const key = line ? lines[line.index]?.key : undefined;
          if (key !== undefined)
            focusLater(`[data-line-key="${String(key)}"] input[name="quantity"]`);
          else focusLater('[aria-invalid="true"]');
        },
      },
    );
  }

  const loading = products.isPending || (enabled && (balances.isPending || batches.isPending));
  const loadError = products.error ?? balances.error ?? batches.error;
  const retry = () => {
    void products.refetch();
    void balances.refetch();
    void batches.refetch();
  };
  const nothingFree = !loading && !loadError && items.length === 0;
  const busy = dispatch.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-lg font-semibold">
            Dispatch to a district from {code}
          </SheetTitle>
          <SheetDescription>
            Send stock before the district orders it. Batches leave first expiry first out, and the
            district records the receipt when the stock arrives.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
          {loadError ? (
            <ErrorState
              title="Could not load the stock to dispatch"
              error={loadError}
              onRetry={retry}
              isRetrying={products.isRefetching || balances.isRefetching || batches.isRefetching}
            />
          ) : loading ? (
            <div className="flex flex-col gap-3" role="status">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-40 w-full" />
              <span className="sr-only">Loading the stock…</span>
            </div>
          ) : nothingFree ? (
            <EmptyState
              icon={PackageX}
              title={`No free stock at ${code}`}
              description="Every product is used up, reserved for district orders or expired. Register stock first, then dispatch it."
            />
          ) : (
            <form
              ref={formRef}
              id={formId}
              onSubmit={submit}
              noValidate
              className="flex flex-col gap-5"
            >
              <ComboboxField
                label="District store"
                required
                value={districtId}
                onValueChange={(value) => {
                  if (dispatch.error) dispatch.reset();
                  setDistrictId(value);
                }}
                options={districts}
                placeholder="Choose a district store…"
                searchLabel="Search by store or district"
                noun="district stores"
                isLoading={stores.isPending}
                loadError={stores.error ? getErrorMessage(stores.error) : undefined}
                error={(tried ? districtError : undefined) ?? fieldError('district_store_id')}
                disabled={busy}
              />

              <ol aria-label="Products to dispatch" className="flex flex-col">
                {lines.map((line, index) => {
                  const lineCheck = check.lines[index];
                  const item = byId.get(line.productId);
                  const shown = (field: 'productId' | 'quantity') =>
                    tried ? lineCheck?.errors[field] : undefined;
                  // A product already chosen on another line is left out of this line's choices.
                  const taken = new Set(
                    lines.filter((other) => other.key !== line.key).map((other) => other.productId),
                  );
                  return (
                    <li
                      key={line.key}
                      data-line-key={line.key}
                      className="flex flex-col gap-3 border-t py-4 first:border-t-0 first:pt-0"
                    >
                      <div className="flex min-h-7 items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">Product {index + 1}</h3>
                        {lines.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove product ${String(index + 1)}`}
                            onClick={() => {
                              removeLine(line.key, index);
                            }}
                            disabled={busy}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] [&>*]:min-w-0">
                        <SelectField
                          label="Product"
                          required
                          value={line.productId}
                          onValueChange={(productId) => {
                            update(line.key, { productId });
                          }}
                          options={items
                            .filter(
                              (candidate) =>
                                candidate.product.id === line.productId ||
                                !taken.has(candidate.product.id),
                            )
                            .map((candidate) => ({
                              value: candidate.product.id,
                              label: candidate.label,
                            }))}
                          placeholder="Choose a product"
                          description={
                            item
                              ? `Free to dispatch: ${formatNumber(item.free)} ${item.unit}.`
                              : undefined
                          }
                          error={shown('productId')}
                          disabled={busy}
                        />
                        <TextField
                          label="Quantity"
                          name="quantity"
                          required
                          inputMode="numeric"
                          autoComplete="off"
                          value={line.quantity}
                          onChange={(event) => {
                            update(line.key, { quantity: event.target.value });
                          }}
                          description={item ? `In ${item.unit}.` : undefined}
                          error={shown('quantity')}
                          disabled={busy}
                          className="text-right tabular-nums"
                        />
                      </div>
                      {item && lineCheck?.plan && lineCheck.plan.takes.length > 0 ? (
                        <PlannedBatches takes={lineCheck.plan.takes} item={item} />
                      ) : null}
                      {failed && failedKey === line.key ? (
                        <Alert variant="destructive">
                          <AlertTitle>This product was refused</AlertTitle>
                          <AlertDescription>{failed.message}</AlertDescription>
                        </Alert>
                      ) : null}
                    </li>
                  );
                })}
              </ol>

              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={addLine}
                disabled={busy || lines.length >= Math.min(MAX_LINES, items.length)}
              >
                <Plus data-icon="inline-start" />
                Add another product
              </Button>

              {needsReason ? (
                <TextareaField
                  label="Why dispatch stock with under a month left?"
                  required
                  rows={2}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => {
                    if (dispatch.error) dispatch.reset();
                    setReason(event.target.value);
                  }}
                  placeholder="e.g. The district is out of stock and will use it within the week"
                  description={`${nearExpiryNames(check.nearExpiry)}The reason is recorded with your name as an expiry exception.`}
                  error={(tried ? reasonError : undefined) ?? serverReason}
                  disabled={busy}
                />
              ) : null}

              <TextareaField
                label="Note to the district"
                rows={2}
                maxLength={4000}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                placeholder="e.g. Quarterly allocation for January to March"
                description="The district reads it in the notification about this stock."
                error={fieldError('note')}
                disabled={busy}
              />

              <fieldset className="flex min-w-0 flex-col gap-3">
                <legend className="mb-1 text-sm font-medium">Transport</legend>
                <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                  {TRANSPORT_FIELDS.map((field) => (
                    <TextField
                      key={field.key}
                      label={field.label}
                      value={transport[field.key]}
                      maxLength={field.max}
                      onChange={(event) => {
                        setTransport((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }));
                      }}
                      error={fieldError(field.key)}
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={field.key === 'driver_name'}
                      {...(field.key === 'driver_phone' ? { inputMode: 'tel' as const } : {})}
                    />
                  ))}
                </div>
              </fieldset>

              {dispatch.error ? (
                <Alert variant="destructive">
                  <AlertTitle>Nothing was dispatched</AlertTitle>
                  <AlertDescription>
                    {failed
                      ? `Product ${String(failed.index + 1)} was refused, so none of the stock went. Correct it and dispatch again.`
                      : getErrorMessage(dispatch.error)}
                  </AlertDescription>
                </Alert>
              ) : null}
            </form>
          )}
        </div>

        <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-between gap-3 border-t">
          <p className="text-muted-foreground min-w-0 text-sm" aria-live="polite">
            {productCount(chosen)}
            {amounts.length > 0 ? (
              <>
                {' · '}
                <span className="text-foreground font-medium tabular-nums">
                  {formatAmounts(amounts)}
                </span>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-2">
            {dirty ? (
              <Button type="button" variant="ghost" onClick={startOver} disabled={busy}>
                Start over
              </Button>
            ) : null}
            <Button
              type="submit"
              form={formId}
              disabled={busy || loading || Boolean(loadError) || nothingFree}
              className="h-auto min-h-8 whitespace-normal"
            >
              {busy ? 'Dispatching…' : districtName ? `Dispatch to ${districtName}` : 'Dispatch'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** The batches a line takes, first expiry first, with their shelf life. */
function PlannedBatches({ takes, item }: { takes: readonly PlannedTake[]; item: Dispatchable }) {
  return (
    <div className="bg-muted/50 flex flex-col gap-1.5 rounded-lg px-3 py-2">
      <p className="text-muted-foreground text-xs font-medium">Leaves from</p>
      <ul className="flex flex-col gap-1.5">
        {takes.map((take) => (
          <li key={take.batch.id} className="flex items-start justify-between gap-3 text-sm">
            <span className="flex min-w-0 flex-col">
              <span
                className={
                  take.batch.batch_number ? 'font-medium wrap-anywhere' : 'text-muted-foreground'
                }
              >
                {batchLabel(take.batch)}
              </span>
              <span className="text-muted-foreground text-xs">
                {take.batch.expiry_date
                  ? `Expires ${formatDate(take.batch.expiry_date)}`
                  : 'Expiry not recorded'}
              </span>
              {take.batch.band === 'under_1_month' ? (
                <StatusBadge
                  className="mt-1 self-start"
                  status={BAND_STATUS.under_1_month.label}
                  tone={BAND_STATUS.under_1_month.tone}
                />
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatNumber(take.quantity)} {item.unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function productCount(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'product' : 'products'}`;
}

/** "NEAR-1 and NEAR-2 have under a month left. ", or "" for none. */
function nearExpiryNames(takes: readonly PlannedTake[]): string {
  if (takes.length === 0) return '';
  const names = takes.map((take) => batchLabel(take.batch));
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return `${list ?? ''} ${names.length === 1 ? 'has' : 'have'} under a month left. `;
}
