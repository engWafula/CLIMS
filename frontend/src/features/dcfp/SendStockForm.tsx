'use client';

import { AlertTriangle, PackagePlus, PackageX } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, type Ref, type SyntheticEvent } from 'react';

import { SelectField } from '@/components/form/SelectField';
import { InlineMessage } from '@/components/InlineMessage';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/features/auth/queries';
import { packLabel, productName, type Product } from '@/features/catalogue/api';
import { useProducts } from '@/features/catalogue/queries';
import { expiryOf, monthsUntil } from '@/features/fulfilment/batches';
import type { ProductSummary } from '@/features/inventory/api';
import { ugandaToday } from '@/features/warehouse/receiving';
import { useStoreSummary } from '@/features/warehouse/stockQueries';
import { periodRange } from '@/features/warehouse/summary';
import { getErrorMessage, toApiError } from '@/lib/api';
import { newClientReference } from '@/lib/clientReference';
import { formatDate, formatNumber } from '@/lib/format';
import { useReadOnly } from '@/navigation/useAccess';

import type { StockoutReport } from './api';
import { categoryLabel, DCFP_PATHS } from './orders';
import { useDeliverStock, useStockoutRiders } from './queries';

/** The API's limits on one delivery. */
const MAX_QUANTITY = 1_000_000;
const MAX_LINES = 20;
/** The delivery agent picker's value for "nobody named"; the API then takes no rider_id. */
const NO_RIDER = 'none';
/** A batch with under a month left needs a reason to leave the store (docs/modules/inventory.md). */
const EXCEPTION_MONTHS = 1;

type Category = 'male' | 'female';

/** A product the district store can send for this request, in its catalogue unit. */
interface Choice {
  product: Product;
  balance: ProductSummary;
  /** Single condoms in one unit. */
  perUnit: number;
  max: number;
}

interface Props {
  report: StockoutReport;
  storeId: string;
  /** Shown when stock has already gone, so sending more is a choice the DCFP opened. */
  onCancel?: () => void;
  onSent?: () => void;
  /**
   * Offered while nothing has been sent: the DCFP rejects the request instead. `rejectRef` lets the
   * page return focus to the button when rejecting is cancelled.
   */
  onReject?: () => void;
  rejectRef?: Ref<HTMLButtonElement>;
}

/**
 * Send district stock to a hotspot against its request, on the request's own page. Every product
 * of the requested type the store holds is listed with what is available; the DCFP types how many
 * of each to send, in the product's unit, and sees the total in single pieces as they go.
 */
export function SendStockForm({ report, storeId, onCancel, onSent, onReject, rejectRef }: Props) {
  // Opened by "Send more stock", which it replaces: focus moves here rather than to the page.
  const cardRef = useRef<HTMLDivElement>(null);
  // Decided once, on opening; later renders leave focus where the user put it.
  const [focusOnOpen] = useState(() => Boolean(onCancel));
  useEffect(() => {
    if (focusOnOpen) cardRef.current?.focus();
  }, [focusOnOpen]);
  const can = useCan();
  const title = onCancel ? 'Send more stock' : `Send stock to ${report.hot_spot.name}`;
  const contact = report.hot_spot.contact_name?.trim() || 'the hotspot manager';

  return (
    <Card
      ref={cardRef}
      tabIndex={-1}
      className="focus-visible:ring-ring min-w-0 outline-none focus-visible:ring-2"
      role="region"
      aria-label={title}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Enter how many to send, in each product&apos;s pack. The earliest expiry leaves first, and{' '}
          {contact} confirms what arrives.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {can('inventory:read') ? (
          <SendStockFields
            report={report}
            storeId={storeId}
            onCancel={onCancel}
            onSent={onSent}
            onReject={onReject}
            rejectRef={rejectRef}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <Alert variant="info">
              <AlertTitle>District stock is hidden from you</AlertTitle>
              <AlertDescription>
                Sending stock needs inventory access to see what the district store holds. Ask an
                administrator to add it to your role.
              </AlertDescription>
            </Alert>
            {onReject ? (
              <RejectButton onClick={onReject} buttonRef={rejectRef} className="self-start" />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SendStockFields({ report, storeId, onCancel, onSent, onReject, rejectRef }: Props) {
  const can = useCan();
  const readOnly = useReadOnly();
  const products = useProducts();
  const range = useMemo(() => periodRange('30d', ugandaToday(new Date())), []);
  const summary = useStoreSummary(storeId, range);
  const delivery = useDeliverStock();
  // Only delivery agents working in the hotspot's district are offered (and accepted by the API).
  const riders = useStockoutRiders(report.id);
  const formId = useId();
  const [now] = useState(() => new Date());
  const [reference] = useState(newClientReference);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [riderId, setRiderId] = useState(NO_RIDER);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  // After a failure that may still have saved, only the same send may be retried.
  const [uncertain, setUncertain] = useState(false);

  const categories: Category[] =
    report.selection === 'both' ? ['male', 'female'] : [report.selection];
  const groups = categories.map((category) => ({
    category,
    choices: choicesFor(products.data ?? [], summary.data?.products ?? [], category),
  }));
  const choices = groups.flatMap((group) => group.choices);

  const entries = choices.flatMap((choice) => {
    const text = (typed[choice.product.id] ?? '').trim();
    if (text === '') return [];
    const quantity = /^\d+$/.test(text) ? Number(text) : Number.NaN;
    const error =
      !Number.isSafeInteger(quantity) || quantity < 1
        ? 'Enter a whole number, or leave it blank to skip.'
        : quantity > choice.max
          ? `Only ${formatNumber(choice.max)} ${choice.balance.unit} can be sent.`
          : null;
    return [{ choice, quantity, error }];
  });
  const lines = entries.filter((entry) => entry.error === null);
  const pieces = (category?: Category) =>
    lines
      .filter((line) => !category || line.choice.product.category === category)
      .reduce((total, line) => total + line.quantity * line.choice.perUnit, 0);
  const total = pieces();

  const shortDated = lines.filter(({ choice }) => {
    const next = choice.balance.next_expiry;
    return next !== null && monthsUntil(next, now) < EXCEPTION_MONTHS;
  });
  const serverError = delivery.error ? toApiError(delivery.error) : null;
  const askedForReason = Boolean(serverError?.fieldErrors.expiry_exception_reason);
  const needsReason = shortDated.length > 0 || askedForReason;
  const reasonError =
    needsReason && reason.trim() === ''
      ? 'Say why this stock should go although it expires within a month.'
      : null;

  const missing =
    report.selection === 'both' && lines.length > 0
      ? groups.find(
          (group) =>
            group.choices.length > 0 &&
            !lines.some((line) => line.choice.product.category === group.category),
        )
      : undefined;

  const busy = delivery.isPending;
  const locked = busy || uncertain || readOnly;
  const formError =
    tried && entries.length === 0
      ? 'Enter how many to send of at least one product.'
      : lines.length > MAX_LINES
        ? `Send at most ${String(MAX_LINES)} products at a time.`
        : null;

  const inputId = (product: Product) => `${formId}-${product.id}`;

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (busy) return;
    const firstBad = entries.find((entry) => entry.error !== null);
    if (firstBad) {
      document.getElementById(inputId(firstBad.choice.product))?.focus();
      return;
    }
    if (entries.length === 0) {
      const first = choices[0];
      if (first) document.getElementById(inputId(first.product))?.focus();
      return;
    }
    if (reasonError) {
      document.getElementById(`${formId}-reason`)?.focus();
      return;
    }
    if (lines.length > MAX_LINES) return;
    delivery.mutate(
      {
        reportId: report.id,
        input: {
          client_reference: reference,
          lines: lines.map(({ choice, quantity }) => ({
            condom_id: choice.product.id,
            unit_of_measure_id: choice.balance.unit_of_measure_id,
            quantity,
          })),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(riderId !== NO_RIDER ? { rider_id: riderId } : {}),
          ...(needsReason && reason.trim() ? { expiry_exception_reason: reason.trim() } : {}),
        },
      },
      {
        onSuccess: () => onSent?.(),
        onError: (error) => {
          const kind = toApiError(error).kind;
          setUncertain(
            !['validation', 'conflict', 'forbidden', 'not_found', 'rate_limited'].includes(kind),
          );
        },
      },
    );
  }

  if (products.isPending || summary.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Loading district stock">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-8 w-40 self-end" />
      </div>
    );
  }
  const loadError = products.error ?? summary.error;
  if (loadError) {
    return (
      <ErrorState
        title="Could not load the district stock"
        error={loadError}
        onRetry={() => {
          void products.refetch();
          void summary.refetch();
        }}
      />
    );
  }
  const canOrder = can('orders:replenish') && !readOnly;

  if (choices.length === 0) {
    return (
      <EmptyState
        icon={PackageX}
        title={`The district store has no ${report.product} to send`}
        description="Order more from NMS or JMS. Once it arrives and you record the receipt, it shows here."
        action={
          canOrder || onReject ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              {canOrder ? (
                <Button asChild>
                  <Link href={DCFP_PATHS.newOrderFor(report.selection)}>
                    <PackagePlus aria-hidden="true" />
                    Order from a warehouse
                  </Link>
                </Button>
              ) : null}
              {onReject ? <RejectButton onClick={onReject} buttonRef={rejectRef} /> : null}
            </div>
          ) : undefined
        }
      />
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="@container flex flex-col gap-3"
      aria-label={`Send stock to ${report.hot_spot.name}`}
    >
      {groups.map((group) => (
        <fieldset key={group.category} className="min-w-0">
          <legend className="mb-1.5 text-sm font-semibold">
            {categoryLabel(group.category)}
            {report.selection === 'both' && pieces(group.category) > 0 ? (
              <span className="text-muted-foreground ml-2 font-normal tabular-nums">
                {formatNumber(pieces(group.category))} pieces
              </span>
            ) : null}
          </legend>
          {group.choices.length === 0 ? (
            <p className="text-muted-foreground border-t py-2 text-sm">
              None in the district store.{' '}
              {canOrder ? (
                <Link
                  href={DCFP_PATHS.newOrderFor(group.category)}
                  className="text-success font-medium underline underline-offset-4"
                >
                  Order {categoryLabel(group.category)?.toLowerCase()} from a warehouse
                </Link>
              ) : null}
            </p>
          ) : (
            <ul className="divide-y border-y">
              {group.choices.map((choice) => {
                const id = inputId(choice.product);
                const entry = entries.find((item) => item.choice === choice);
                // Too many is said at once; a malformed number waits for the send.
                const error =
                  entry?.error && (tried || entry.quantity > choice.max) ? entry.error : null;
                const sending = entry && !entry.error ? entry.quantity * choice.perUnit : 0;
                return (
                  <li
                    key={choice.product.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2"
                  >
                    <div className="min-w-0">
                      <Label htmlFor={id} className="leading-snug font-medium break-words">
                        {productName(choice.product)}
                      </Label>
                      <StockLine choice={choice} now={now} id={`${id}-stock`} />
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-2">
                        <Input
                          id={id}
                          inputMode="numeric"
                          name={`quantity-${choice.product.id}`}
                          autoComplete="off"
                          value={typed[choice.product.id] ?? ''}
                          onChange={(event) => {
                            setTyped((current) => ({
                              ...current,
                              [choice.product.id]: event.target.value,
                            }));
                          }}
                          disabled={locked}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={`${id}-stock ${id}-error`}
                          className="w-24 text-right tabular-nums"
                        />
                        <span className="text-muted-foreground min-w-12 text-sm">
                          {choice.balance.unit}
                        </span>
                      </div>
                      {choice.perUnit > 1 && sending > 0 ? (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {formatNumber(sending)} pieces
                        </span>
                      ) : null}
                    </div>
                    <InlineMessage id={`${id}-error`} className="col-span-2">
                      {error}
                    </InlineMessage>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
      ))}

      {missing ? (
        <p className="text-warning text-sm" role="status">
          {report.hot_spot.name} asked for {categoryLabel(missing.category)?.toLowerCase()} too. Add
          some, or send them later.
        </p>
      ) : null}

      {/* Side by side once the card is wide enough: both are optional and short. */}
      <div className="grid gap-3 @xl:grid-cols-2 @xl:items-start">
        <SelectField
          label="Delivery agent"
          value={riderId}
          onValueChange={setRiderId}
          options={[
            { value: NO_RIDER, label: 'No delivery agent' },
            ...(riders.data ?? []).map((rider) => ({
              value: rider.id,
              label: rider.phone ? `${rider.name} · ${rider.phone}` : rider.name,
            })),
          ]}
          placeholder="No delivery agent"
          isLoading={riders.isPending}
          loadError={riders.error ? 'Could not load the delivery agents.' : undefined}
          disabled={locked}
          description={
            riders.isSuccess && riders.data.length === 0
              ? `No delivery agents work in ${report.hot_spot.district ?? 'this district'} yet.`
              : 'Only delivery agents in the hotspot’s district are listed. They see this send in the field app.'
          }
          error={serverError?.fieldErrors.rider_id?.[0]}
        />

        {/* Field and FieldLabel, as in SelectField, so the two labels line up side by side. */}
        <Field>
          <FieldLabel htmlFor={`${formId}-note`}>
            Note <span className="text-muted-foreground font-normal">(optional)</span>
          </FieldLabel>
          <Textarea
            id={`${formId}-note`}
            name="note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            maxLength={4000}
            rows={2}
            disabled={locked}
            placeholder="Anything the hotspot should know…"
            className="min-h-16"
          />
        </Field>
      </div>

      {needsReason ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-reason`}>Why send stock that expires soon?</Label>
          <p className="text-muted-foreground text-xs" id={`${formId}-reason-hint`}>
            {shortDated.length > 0
              ? `${shortDated.map(({ choice }) => productName(choice.product)).join(', ')}: the oldest batch has under a month left, and it leaves first.`
              : 'Part of this stock has under a month left, and it leaves first.'}
          </p>
          <Textarea
            id={`${formId}-reason`}
            name="expiry_exception_reason"
            required
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            maxLength={1000}
            rows={2}
            disabled={locked}
            aria-invalid={tried && reasonError ? true : undefined}
            aria-describedby={`${formId}-reason-hint ${formId}-reason-error`}
            placeholder="e.g. The hotspot uses it within the week…"
          />
          <InlineMessage id={`${formId}-reason-error`}>{tried ? reasonError : null}</InlineMessage>
        </div>
      ) : null}

      {uncertain ? (
        <Alert variant="warning">
          <AlertTitle>The send could not be confirmed</AlertTitle>
          <AlertDescription>
            Send again with these same quantities: if the first send went through, it is recorded
            once. Check the history below before starting a different send.
          </AlertDescription>
        </Alert>
      ) : serverError ? (
        <Alert variant="destructive">
          <AlertTitle>The stock was not sent</AlertTitle>
          <AlertDescription>{getErrorMessage(delivery.error)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm" aria-live="polite">
          {total > 0 ? (
            <>
              <span className="font-semibold tabular-nums">{formatNumber(total)} pieces</span>
              <span className="text-muted-foreground">
                {' '}
                {breakdown(lines.length, report, pieces)}
              </span>
            </>
          ) : formError ? (
            <span className="text-destructive">{formError}</span>
          ) : (
            <span className="text-muted-foreground">
              {entries.length > 0 ? 'Check the quantities above.' : 'Nothing entered yet.'}
            </span>
          )}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          ) : null}
          {onReject ? (
            <RejectButton onClick={onReject} buttonRef={rejectRef} disabled={busy || uncertain} />
          ) : null}
          <Button type="submit" disabled={busy || readOnly}>
            {busy ? 'Sending…' : total > 0 ? `Send ${formatNumber(total)} pieces` : 'Send stock'}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Opens the rejection in the send form's place. */
function RejectButton({
  onClick,
  buttonRef,
  disabled,
  className,
}: {
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      Reject request…
    </Button>
  );
}

/** What is available of a product, and a warning when its oldest batch is close to expiry. */
function StockLine({ choice, now, id }: { choice: Choice; now: Date; id: string }) {
  const next = choice.balance.next_expiry;
  const expiry = next ? expiryOf(next, now) : null;
  const facts = [
    packLabel(choice.product),
    `${formatNumber(choice.balance.usable)} ${choice.balance.unit} available`,
  ].filter(Boolean);
  return (
    <p id={id} className="text-muted-foreground text-xs">
      {facts.join(' · ')}
      {next && expiry?.state === 'near' ? (
        <span
          className={
            monthsUntil(next, now) < EXCEPTION_MONTHS
              ? 'text-warning ml-1 inline-flex items-center gap-1'
              : 'ml-1'
          }
        >
          {monthsUntil(next, now) < EXCEPTION_MONTHS ? (
            <AlertTriangle aria-hidden="true" className="size-3" />
          ) : null}
          · oldest batch expires {formatDate(next)} ({expiry.left})
        </span>
      ) : null}
    </p>
  );
}

/** Active products of the category held in their catalogue unit, most available first. */
function choicesFor(
  products: readonly Product[],
  stock: readonly ProductSummary[],
  category: Category,
): Choice[] {
  return products
    .flatMap((product) => {
      if (!product.active || product.category !== category || !product.unit) return [];
      if (!product.pieces_per_unit) return [];
      const balance = stock.find(
        (item) => item.condom_id === product.id && item.unit_of_measure_id === product.unit?.id,
      );
      if (!balance || balance.usable <= 0) return [];
      return [
        {
          product,
          balance,
          perUnit: product.pieces_per_unit,
          max: Math.min(balance.usable, MAX_QUANTITY),
        },
      ];
    })
    .sort((a, b) => b.balance.usable * b.perUnit - a.balance.usable * a.perUnit);
}

/** "· 200 male, 100 female" for a request for both; "· 2 products" otherwise. */
function breakdown(
  count: number,
  report: StockoutReport,
  pieces: (category?: Category) => number,
): string {
  if (report.selection === 'both') {
    const parts = (['male', 'female'] as const)
      .filter((category) => pieces(category) > 0)
      .map((category) => `${formatNumber(pieces(category))} ${category}`);
    if (parts.length === 2) return `· ${parts.join(', ')}`;
  }
  return count > 1 ? `· ${String(count)} products` : '';
}
