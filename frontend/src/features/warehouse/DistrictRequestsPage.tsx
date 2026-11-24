'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { RowActions } from '@/components/data-table/RowActions';
import { FilterTabs } from '@/components/FilterTabs';
import { StatusBadge } from '@/components/StatusBadge';
import { DistrictSelect, useDistrictContext } from '@/features/district/DistrictContext';
import type { Order } from '@/features/orders/api';
import { formatTimestamp } from '@/lib/format';

import {
  useCurrentWarehouse,
  useRequestNames,
  useStoreOrders,
  type RequestNames,
} from './orderQueries';
import { WAREHOUSE_PATHS, withStore } from './paths';
import { REQUEST_FILTERS, requestFilterFrom, requestStatus } from './requests';
import { StoreSwitch } from './StoreSwitch';

function columnsFor(names: RequestNames, href: (path: string) => string): DataTableColumn<Order>[] {
  return [
    {
      id: 'district',
      filter: 'select',
      header: 'Ordered for',
      value: (order) => names.store(order.ordered_for_store_id),
      cell: (order) => (
        <Link
          href={href(WAREHOUSE_PATHS.request(order.id))}
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          {names.store(order.ordered_for_store_id)}
        </Link>
      ),
    },
    {
      id: 'product',
      header: 'Product',
      value: (order) => names.product(order.condom_id, order.condom_category),
      cell: (order) => (
        <span className="block max-w-64 truncate">
          {names.product(order.condom_id, order.condom_category)}
        </span>
      ),
    },
    {
      id: 'quantity',
      header: 'Quantity',
      value: (order) => order.quantity_needed ?? 0,
      cell: (order) => (
        <div className="tabular-nums">
          <div>{names.quantity(order.quantity_needed, order.unit_of_measure_id)}</div>
          {order.quantity_approved !== null && order.quantity_approved !== order.quantity_needed ? (
            <div className="text-muted-foreground text-xs">
              {names.quantity(order.quantity_approved, order.unit_of_measure_id)} approved
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'received',
      filter: 'date',
      header: 'Received',
      value: (order) => order.created_at,
      cell: (order) => formatTimestamp(order.created_at),
    },
    {
      id: 'status',
      filter: 'select',
      header: 'Status',
      value: (order) => requestStatus(order).label,
      cell: (order) => {
        const status = requestStatus(order);
        return <StatusBadge status={status.label} tone={status.tone} />;
      },
    },
  ];
}

/** What opening the order is for, by what it waits on. */
function actionLabel(order: Order): string {
  switch (order.order_status) {
    case 'queued':
      return 'Manage order';
    case 'reviewed':
    case 'on_hold':
      return 'Check stock';
    case 'confirmed':
      return 'Dispatch order';
    default:
      return 'Open order';
  }
}

export default function DistrictRequestsPage() {
  const { code, href, warehouse, ...stores } = useCurrentWarehouse();
  const orders = useStoreOrders(warehouse?.id);
  const names = useRequestNames();
  const district = useDistrictContext()?.district;
  const router = useRouter();
  const filter = requestFilterFrom(useSearchParams().get('status'));
  const columns = useMemo(() => columnsFor(names, href), [names, href]);

  const visible = district
    ? orders.data?.filter((order) => names.district(order.ordered_for_store_id) === district)
    : orders.data;
  const rows = visible?.filter(filter.keeps);
  const error = stores.error ?? orders.error;

  return (
    <div className="gap-section flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <StoreSwitch store={code} hrefFor={(other) => withStore(WAREHOUSE_PATHS.requests, other)} />
        <DistrictSelect />
      </div>
      <FilterTabs
        label="Filter orders by status"
        value={filter.value}
        hrefFor={(value) =>
          href(
            value === 'all' ? WAREHOUSE_PATHS.requests : WAREHOUSE_PATHS.requestsWithStatus(value),
          )
        }
        tabs={REQUEST_FILTERS.map((option) => ({
          value: option.value,
          label: option.label,
          ...(visible ? { count: visible.filter(option.keeps).length } : {}),
        }))}
      />
      <DataTable
        label={`District orders at ${code}`}
        preferencesKey="warehouse-district-orders"
        columns={columns}
        rows={rows}
        getRowId={(order) => order.id}
        isLoading={stores.isPending || (warehouse !== undefined && orders.isPending)}
        error={error}
        onRetry={() => {
          void stores.refetch();
          void orders.refetch();
        }}
        isRetrying={orders.isRefetching}
        searchPlaceholder="Search by district or product…"
        emptyTitle={
          filter.value !== 'all'
            ? 'No orders in this view'
            : district
              ? `No orders from ${district} at ${code} yet`
              : `No district orders at ${code} yet`
        }
        emptyDescription={
          filter.value !== 'all'
            ? 'Choose another filter to see the rest of the orders.'
            : district
              ? `Choose All districts in the District menu to see every order at ${code}.`
              : 'Orders from district stores appear here as soon as a DCFP sends one.'
        }
        rowActions={(order) => (
          <RowActions
            label={`Actions for the order from ${names.store(order.ordered_for_store_id)}`}
            actions={[
              {
                label: actionLabel(order),
                icon: ArrowRight,
                onSelect: () => {
                  router.push(href(WAREHOUSE_PATHS.request(order.id)));
                },
              },
            ]}
          />
        )}
      />
    </div>
  );
}
