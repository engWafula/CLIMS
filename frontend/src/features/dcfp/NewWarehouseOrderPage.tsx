'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState, type SyntheticEvent } from 'react';

import { DetailList } from '@/components/DetailList';
import { TextField } from '@/components/form/TextField';
import { RadioCardGroup } from '@/components/RadioCardGroup';
import { ErrorState } from '@/components/states/ErrorState';
import { PageSkeleton } from '@/components/states/PageSkeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WriteAction } from '@/components/WriteAction';
import { getErrorMessage, toApiError } from '@/lib/api';
import { formatNumber } from '@/lib/format';

import type { Warehouse } from './api';
import { categoryLabel, DCFP_PATHS, parseCount, warehouseLabel } from './orders';
import { usePlaceOrder, useWarehouses } from './queries';

/** The API's fields, for showing its validation messages beside the right control. */
type Field = 'warehouse_store_id' | 'condom_category' | 'quantity';
type Category = 'male' | 'female';

const CATEGORIES: readonly { value: Category; label: string; description: string }[] = [
  { value: 'male', label: 'Male condoms', description: 'The warehouse chooses the brand.' },
  { value: 'female', label: 'Female condoms', description: 'The warehouse chooses the brand.' },
];

export default function NewWarehouseOrderPage() {
  const warehouses = useWarehouses();
  // A stockout report's "Order stock" action names its condom category.
  const preselected = useSearchParams().get('category');

  if (warehouses.error) {
    return (
      <div className="bg-card rounded-card border">
        <ErrorState
          title="Could not load the warehouses"
          error={warehouses.error}
          onRetry={() => {
            void warehouses.refetch();
          }}
          isRetrying={warehouses.isRefetching}
        />
      </div>
    );
  }
  if (!warehouses.data) return <PageSkeleton layout="form" />;
  return (
    <OrderForm
      warehouses={warehouses.data}
      preselected={preselected === 'male' || preselected === 'female' ? preselected : null}
    />
  );
}

interface OrderFormProps {
  warehouses: readonly Warehouse[];
  preselected: Category | null;
}

function OrderForm({ warehouses, preselected }: OrderFormProps) {
  const router = useRouter();
  const place = usePlaceOrder();
  const commentId = useId();

  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [category, setCategory] = useState<Category | null>(preselected);
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');
  const [attempted, setAttempted] = useState(false);

  const count = parseCount(quantity);

  const serverErrors = place.error ? toApiError(place.error).fieldErrors : {};
  const serverError = (field: Field) => serverErrors[field]?.[0];
  const errors: Partial<Record<Field, string>> = {
    warehouse_store_id: warehouseId ? serverError('warehouse_store_id') : 'Choose NMS or JMS.',
    condom_category: category ? serverError('condom_category') : 'Choose male or female condoms.',
    quantity:
      count === null || count < 1
        ? 'Enter how many to order, as a whole number.'
        : serverError('quantity'),
  };
  const shown = (field: Field) => (attempted || serverError(field) ? errors[field] : undefined);
  const hasErrors = Object.values(errors).some(Boolean);
  const formFailure =
    place.error && Object.keys(serverErrors).length === 0 ? getErrorMessage(place.error) : null;

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (place.isPending || !warehouseId || !category || count === null || count < 1) return;
    place.reset();
    place.mutate(
      {
        warehouse_store_id: warehouseId,
        condom_category: category,
        quantity: count,
        comment: comment.trim() || null,
      },
      {
        onSuccess: (order) => {
          router.push(DCFP_PATHS.order(order.id));
        },
      },
    );
  }

  const busy = place.isPending;
  const warehouse = warehouses.find((candidate) => candidate.id === warehouseId);

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="new-order-heading"
      className="gap-section grid lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <h2 id="new-order-heading" className="sr-only">
        Order stock from a warehouse
      </h2>
      <div className="gap-section flex min-w-0 flex-col">
        <Card>
          <CardHeader>
            <CardTitle asChild>
              <h3>Order from</h3>
            </CardTitle>
            <CardDescription>
              The warehouse reviews the order, checks its stock, then dispatches it or holds it
              until stock arrives.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioCardGroup
              legend="Warehouse"
              hideLegend
              layout="row"
              value={warehouseId || null}
              onValueChange={setWarehouseId}
              options={warehouses.map((candidate) => ({
                value: candidate.id,
                label: warehouseLabel(candidate),
                description: candidate.name,
              }))}
              error={shown('warehouse_store_id')}
              disabled={busy}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle asChild>
              <h3>What to order</h3>
            </CardTitle>
            <CardDescription>
              Name the condom type and how many. The warehouse chooses the product, and its unit,
              when it reviews the order.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RadioCardGroup
              legend="Condom type"
              layout="row"
              value={category}
              onValueChange={setCategory}
              options={CATEGORIES}
              error={shown('condom_category')}
              disabled={busy}
            />
            <TextField
              label="Quantity"
              required
              inputMode="numeric"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
              }}
              error={shown('quantity')}
              disabled={busy}
              className="max-w-40 tabular-nums"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor={commentId}>
              Comment for the warehouse{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id={commentId}
              rows={3}
              maxLength={4000}
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
              }}
              placeholder="e.g. Two hotspots in Katabi are out of stock"
              disabled={busy}
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle asChild>
              <h3>Summary</h3>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DetailList
              items={[
                { label: 'Ordered from', value: warehouseLabel(warehouse) },
                { label: 'Condom type', value: categoryLabel(category) ?? '—' },
                {
                  label: 'Quantity',
                  value: count !== null && count > 0 ? formatNumber(count) : '—',
                },
              ]}
            />
            {formFailure ? (
              <Alert variant="destructive">
                <AlertTitle>The order was not sent</AlertTitle>
                <AlertDescription>{formFailure}</AlertDescription>
              </Alert>
            ) : null}
            {attempted && hasErrors ? (
              <p className="text-destructive text-sm" role="alert">
                Check the highlighted fields.
              </p>
            ) : null}
            <WriteAction>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Sending…' : `Send order to ${warehouseLabel(warehouse)}`}
              </Button>
            </WriteAction>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
