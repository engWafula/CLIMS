import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useApiQuery, useHttp } from '@/lib/api';
import { warehouseOrderKeys, warehouseStockKeys } from '@/features/warehouse/queryKeys';
import { nationalKeys } from '@/features/moh/queries';

import {
  createWarehouseOrder,
  deliverStock,
  getOrder,
  getStockout,
  listOrderEvents,
  listOrders,
  listStockoutRiders,
  listStockouts,
  listWarehouses,
  receiveOrder,
  rejectStockout,
  type ReceiptInput,
  type WarehouseOrderInput,
  type HotspotDeliveryInput,
} from './api';
import { createFieldUser, listFieldUsers, type NewFieldUserInput } from './fieldUsers';

/*
 * Every key starts with `dcfp`. Placing or receiving an order changes the order lists, the
 * order, its history and the counts together, so each write refetches the lot.
 */
const ROOT = 'dcfp';
export const dcfpKeys = {
  all: [ROOT] as const,
  stockouts: [ROOT, 'stockouts'] as const,
  stockout: (id: string) => [ROOT, 'stockouts', id] as const,
  riders: (reportId: string) => [ROOT, 'stockouts', reportId, 'riders'] as const,
  orders: [ROOT, 'orders'] as const,
  order: (id: string) => [ROOT, 'orders', id] as const,
  events: (id: string) => [ROOT, 'orders', id, 'events'] as const,
  warehouses: [ROOT, 'warehouses'] as const,
  fieldUsers: [ROOT, 'field-users'] as const,
};

interface ReadOptions {
  enabled?: boolean;
}

export function useStockouts(options: ReadOptions = {}) {
  return useApiQuery(dcfpKeys.stockouts, listStockouts, options);
}

export function useStockout(id: string | undefined) {
  return useApiQuery(
    dcfpKeys.stockout(id ?? ''),
    (http, signal) => getStockout(http, id ?? '', signal),
    { enabled: Boolean(id) },
  );
}

/** The delivery agents who may carry a delivery for a report, once one is chosen. */
export function useStockoutRiders(reportId: string) {
  return useApiQuery(
    dcfpKeys.riders(reportId),
    (http, signal) => listStockoutRiders(http, reportId, signal),
    { enabled: Boolean(reportId) },
  );
}

export function useOrders(options: ReadOptions = {}) {
  return useApiQuery(dcfpKeys.orders, listOrders, options);
}

export function useOrder(id: string) {
  return useApiQuery(dcfpKeys.order(id), (http, signal) => getOrder(http, id, signal));
}

export function useOrderEvents(id: string) {
  return useApiQuery(dcfpKeys.events(id), (http, signal) => listOrderEvents(http, id, signal));
}

/** NMS and JMS change rarely, so they are kept for the session. */
export function useWarehouses(options: ReadOptions = {}) {
  return useApiQuery(dcfpKeys.warehouses, listWarehouses, { ...options, staleTime: Infinity });
}

function useInvalidateDcfp() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: dcfpKeys.all });
}

export function useDeliverStock() {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reportId, input }: { reportId: string; input: HotspotDeliveryInput }) =>
      deliverStock(http, reportId, input),
    onSuccess: async () => {
      toast.success('Dispatch recorded. The hotspot manager confirms what arrives.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dcfpKeys.all }),
        queryClient.invalidateQueries({ queryKey: warehouseOrderKeys.all }),
        queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all }),
        queryClient.invalidateQueries({ queryKey: nationalKeys.all }),
      ]);
    },
    meta: { handlesOwnErrors: true },
  });
}

/** Reject a hotspot's request with a reason; the hotspot is told why. */
export function useRejectStockout(reportId: string) {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => rejectStockout(http, reportId, reason),
    onSuccess: async () => {
      toast.success('Request rejected. The hotspot is told why.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dcfpKeys.all }),
        queryClient.invalidateQueries({ queryKey: nationalKeys.all }),
      ]);
    },
    meta: { handlesOwnErrors: true },
  });
}

export function usePlaceOrder() {
  const http = useHttp();
  const invalidate = useInvalidateDcfp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WarehouseOrderInput) => createWarehouseOrder(http, input),
    onSuccess: async () => {
      toast.success('Order sent to the warehouse');
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: warehouseOrderKeys.all }),
        queryClient.invalidateQueries({ queryKey: nationalKeys.all }),
      ]);
    },
    // The order form shows the failure beside its fields.
    meta: { handlesOwnErrors: true },
  });
}

export function useReceiveOrder(id: string) {
  const http = useHttp();
  const invalidate = useInvalidateDcfp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceiptInput) => receiveOrder(http, id, input),
    onSuccess: async () => {
      toast.success('Receipt recorded; the district store is updated');
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: warehouseOrderKeys.all }),
        queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all }),
        queryClient.invalidateQueries({ queryKey: nationalKeys.all }),
      ]);
    },
    // The receipt form shows the failure in place.
    meta: { handlesOwnErrors: true },
  });
}

/** The VHTs, hotspot managers and delivery agents in the DCFP's district. */
export function useFieldUsers(options: ReadOptions = {}) {
  return useApiQuery(dcfpKeys.fieldUsers, listFieldUsers, options);
}

/** Creates a field user in the DCFP's district. The form places a refusal beside its fields. */
export function useCreateFieldUser() {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewFieldUserInput) => createFieldUser(http, input),
    onSuccess: async () => {
      toast.success('User created');
      await queryClient.invalidateQueries({ queryKey: dcfpKeys.fieldUsers });
    },
    meta: { handlesOwnErrors: true },
  });
}
