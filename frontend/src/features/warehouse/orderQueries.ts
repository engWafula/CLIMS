import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { productName, type Product } from '@/features/catalogue/api';
import { useLookups, useProducts } from '@/features/catalogue/queries';
import { dcfpKeys } from '@/features/dcfp/queries';
import { nationalKeys } from '@/features/moh/queries';
import { useStores } from '@/features/geography/queries';
import { listBatches, listStock } from '@/features/inventory/api';
import {
  checkOrderStock,
  dispatchOrder,
  getOrder,
  listOrderEvents,
  listOrders,
  listWarehouses,
  rejectOrder,
  reviewOrder,
  type DispatchInput,
  type Order,
  type ReviewInput,
} from '@/features/orders/api';
import { useApiQuery, useHttp } from '@/lib/api';
import { formatNumber } from '@/lib/format';

import { ordersAt, warehouseStoreOf } from './requests';
import { useWarehouseStore } from './useWarehouseStore';
import { warehouseOrderKeys, warehouseStockKeys } from './queryKeys';
export { warehouseOrderKeys } from './queryKeys';

/*
 * The warehouse's district orders and the stock it decides and dispatches from, on the Go API.
 * Every key starts with `warehouse-orders`: one step changes the order, the lists, the stock and
 * the batches together, so each write refetches the lot, and the DCFP's views of the same order.
 */

interface ReadOptions {
  enabled?: boolean;
}

/** NMS and JMS change rarely, so they are kept for the session. */
function useWarehouses(options: ReadOptions = {}) {
  return useApiQuery(warehouseOrderKeys.warehouses, listWarehouses, {
    ...options,
    staleTime: Infinity,
  });
}

/**
 * The warehouse being shown (from the address, as `useWarehouseStore` decides) and its Go
 * store, once the national stores have loaded.
 */
export function useCurrentWarehouse(options: ReadOptions = {}) {
  const { store: code, href } = useWarehouseStore();
  const warehouses = useWarehouses(options);
  return {
    code,
    href,
    warehouse: warehouseStoreOf(code, warehouses.data),
    isPending: warehouses.isPending,
    error: warehouses.error,
    refetch: warehouses.refetch,
  };
}

/** The orders districts placed with the store, newest first. */
export function useStoreOrders(storeId: string | undefined, options: ReadOptions = {}) {
  const orders = useApiQuery(warehouseOrderKeys.orders, listOrders, {
    enabled: (options.enabled ?? true) && storeId !== undefined,
  });
  const data = useMemo(
    () => (orders.data && storeId ? ordersAt(orders.data, storeId) : undefined),
    [orders.data, storeId],
  );
  return {
    data,
    isPending: orders.isPending,
    error: orders.error,
    refetch: orders.refetch,
    isRefetching: orders.isRefetching,
  };
}

export function useStoreOrder(id: string) {
  return useApiQuery(warehouseOrderKeys.order(id), (http, signal) => getOrder(http, id, signal));
}

export function useStoreOrderEvents(id: string) {
  return useApiQuery(warehouseOrderKeys.events(id), (http, signal) =>
    listOrderEvents(http, id, signal),
  );
}

/** The store's balances, one per product and unit. */
export function useStoreStock(storeId: string, options: ReadOptions = {}) {
  return useApiQuery(
    warehouseOrderKeys.stock(storeId),
    (http, signal) => listStock(http, { storeId }, signal),
    options,
  );
}

/** The store's batches with stock, earliest expiry first within each product and unit. */
export function useStoreBatches(storeId: string, options: ReadOptions = {}) {
  return useApiQuery(
    warehouseOrderKeys.batches(storeId),
    (http, signal) => listBatches(http, { storeId }, signal),
    options,
  );
}

export interface RequestNames {
  /** The product's name, else the category requested until the warehouse chooses a product. */
  product: (id: string | null, category: string | null) => string;
  /** Active products of a category, the ones the warehouse may send for it. */
  productsOf: (category: string | null) => Product[];
  /** The ordering store's name, e.g. "Wakiso"; "District store" while stores load. */
  store: (id: string) => string;
  /** The store's district, for the district filter. */
  district: (id: string) => string | null;
  /** "500 boxes", or the bare number when the unit is unknown; "—" for none. */
  quantity: (value: number | null, unitId: string | null) => string;
  error: unknown;
  isPending: boolean;
  refetch: () => void;
}

/** "Male condoms" or "Female condoms", for an order whose product is not chosen yet. */
export function categoryName(category: string | null): string | null {
  if (category === 'male') return 'Male condoms';
  if (category === 'female') return 'Female condoms';
  return null;
}

/**
 * Orders carry ids only; this names their product, unit and district store from the catalogue
 * and the stores list. Names that have not loaded fall back to something readable.
 */
export function useRequestNames(): RequestNames {
  const products = useProducts();
  const units = useLookups('units');
  const stores = useStores();
  return useMemo(() => {
    const productById = new Map((products.data ?? []).map((p) => [p.id, productName(p)]));
    const unitById = new Map((units.data ?? []).map((u) => [u.id, u.name]));
    const storeById = new Map((stores.data ?? []).map((s) => [s.id, s]));
    return {
      product: (id, category) =>
        (id ? productById.get(id) : undefined) || categoryName(category) || 'Condoms',
      productsOf: (category) =>
        (products.data ?? []).filter((p) => p.active && p.category === category),
      store: (id) => storeById.get(id)?.name ?? 'District store',
      district: (id) => storeById.get(id)?.district_name ?? null,
      quantity: (value, unitId) => {
        if (value === null) return '—';
        const unit = unitId ? unitById.get(unitId) : undefined;
        return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
      },
      // Units and stores only label things, so their failure leaves them plain rather than blocking.
      error: products.error,
      isPending: products.isPending,
      refetch: () => {
        void products.refetch();
        void stores.refetch();
      },
    } satisfies RequestNames;
  }, [products, units, stores]);
}

/** A workflow step that refetches every view of the order and says what it did. */
function useStep<Input>(
  write: (input: Input) => Promise<Order>,
  success: (order: Order) => string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (order) => {
      toast.success(success(order));
    },
    // A failed approval may still have reviewed the order, so refetch either way. Reserving and
    // dispatching change stock and the ledger too.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: warehouseOrderKeys.all }),
        queryClient.invalidateQueries({ queryKey: dcfpKeys.all }),
        queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all }),
        queryClient.invalidateQueries({ queryKey: nationalKeys.all }),
      ]),
    // The order page shows each failure next to the step that failed.
    meta: { handlesOwnErrors: true },
  });
}

const reservedOrHeld = (order: Order, district: string) =>
  order.order_status === 'confirmed'
    ? `Approved and reserved. ${district} has been told what is coming.`
    : order.order_status === 'on_hold'
      ? `Approved, but there is not enough stock to reserve yet. ${district} has been told it is approved.`
      : `Approved. ${district} has been told.`;

/**
 * Approves the order for a product, all or part, then checks the stock at once: it is reserved,
 * or the order waits for stock. An order already approved (on hold, or not yet checked) can be
 * approved again with another product or quantity.
 */
export function useApproveOrder(id: string, district: string) {
  const http = useHttp();
  return useStep(
    async (input: ReviewInput) => {
      await reviewOrder(http, id, input);
      return checkOrderStock(http, id);
    },
    (order) => reservedOrHeld(order, district),
  );
}

/** Checks the stock again for an approved order: it is reserved, or keeps waiting. */
export function useCheckStock(id: string, district: string) {
  const http = useHttp();
  return useStep(
    () => checkOrderStock(http, id),
    (order) =>
      order.order_status === 'confirmed'
        ? `Stock reserved for ${district}.`
        : 'Still not enough stock to reserve. The order keeps waiting.',
  );
}

export function useRejectOrder(id: string, district: string) {
  const http = useHttp();
  return useStep(
    (reason: string) => rejectOrder(http, id, reason),
    () => `Order rejected. ${district} has been told why.`,
  );
}

export function useDispatchOrder(id: string, district: string) {
  const http = useHttp();
  return useStep(
    (input: DispatchInput) => dispatchOrder(http, id, input),
    () => `Dispatched to ${district}.`,
  );
}
