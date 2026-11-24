import { z } from 'zod';

import { parseBody, parseList, readAllPages, type HttpClient } from '@/lib/api';

/*
 * Orders against the Go API (docs/modules/orders.md), shared by the two stores an order joins.
 * A DCFP orders a condom category and quantity from NMS or JMS for the district store. The
 * warehouse reviews it (choosing the product and approving all or part), checks stock (which
 * reserves it, or holds the order until stock arrives) and dispatches it first expiry first out,
 * or rejects it with a reason before dispatch. The district counts it in.
 *
 * Ids are UUIDs. The API scopes every list to the signed-in user's store (every store with
 * `orders:all_stores`).
 */

const text = z.string().nullable();
const count = z.number().int();

/**
 * Warehouse orders go queued → reviewed → confirmed (or on_hold until stock arrives) →
 * dispatched → received, or end rejected before dispatch. `pending` and `fulfilled` belong to the
 * generic store-to-store orders of the first API slice, and `delivered` to alert orders raised
 * before stockouts became reports; both are history.
 */
export const ORDER_STATUSES = [
  'pending',
  'fulfilled',
  'queued',
  'reviewed',
  'on_hold',
  'confirmed',
  'rejected',
  'dispatched',
  'received',
  'delivered',
] as const;

export const orderSchema = z.object({
  id: z.string(),
  /** Null until the warehouse chooses the product at review. */
  condom_id: z.string().nullable(),
  /** The condom category the district requested. */
  condom_category: z.enum(['male', 'female']).nullable(),
  quantity_needed: count.nullable(),
  /** What the warehouse approved at review; at most the quantity ordered. */
  quantity_approved: count.nullable().default(null),
  quantity_issued: count.nullable(),
  quantity_received: count.nullable(),
  order_status: z.enum(ORDER_STATUSES),
  order_date: z.string(),
  ordered_by_id: z.string(),
  ordered_for_store_id: z.string(),
  ordered_from_store_id: z.string(),
  unit_of_measure_id: text,
  comment: text,
  discrepancy_note: text,
  /** Why the warehouse rejected the order; set only on rejected orders. */
  rejection_reason: text.default(null),
  /** The transport the warehouse recorded at dispatch, each optional. */
  waybill_number: text.default(null),
  vehicle_registration: text.default(null),
  driver_name: text.default(null),
  driver_phone: text.default(null),
  /**
   * Stock the warehouse sent without an order: created dispatched, received like any shipment,
   * and left out of request statistics.
   */
  unrequested: z.boolean().default(false),
  /** Set only on alert orders raised before stockouts became reports. */
  hot_spot_id: text,
  created_at: z.string(),
  updated_at: z.string(),
});

export type Order = z.infer<typeof orderSchema>;
export type OrderStatus = Order['order_status'];

const eventSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  actor_id: z.string(),
  action: z.string(),
  status: z.enum(ORDER_STATUSES),
  created_at: z.string(),
});

export type OrderEvent = z.infer<typeof eventSchema>;

const storeSchema = z.object({
  id: z.string(),
  /** `nms` or `jms` for a national warehouse. */
  code: z.string(),
  name: z.string(),
  store_type: z.enum(['national', 'district']),
});

export type Warehouse = z.infer<typeof storeSchema>;

/* Reads. */

/**
 * Every order the user can see, newest first, read 100 at a time (the API's largest page). The lists,
 * counts and tasks filter it by store and status, so stopping at the newest 100 would hide older open
 * orders once a warehouse has handled that many.
 */
export async function listOrders(http: HttpClient, signal?: AbortSignal): Promise<Order[]> {
  const { items } = await readAllPages(
    async (offset, limit) =>
      parseList(
        orderSchema,
        await http.get(`/orders?limit=${limit}&offset=${offset}`, { signal }),
        'orders',
      ),
    // Up to 10,000 orders, three pages at a time.
    { pageSize: 100, maxPages: 100, pagesAtOnce: 3 },
  );
  return items;
}

export async function getOrder(http: HttpClient, id: string, signal?: AbortSignal): Promise<Order> {
  const body = await http.get(`/orders/${encodeURIComponent(id)}`, { signal });
  return parseBody(orderSchema, body, 'order');
}

/** The order's history, newest step first. */
export async function listOrderEvents(
  http: HttpClient,
  id: string,
  signal?: AbortSignal,
): Promise<OrderEvent[]> {
  const body = await http.get(`/orders/${encodeURIComponent(id)}/events`, { signal });
  return parseList(eventSchema, body, 'order history');
}

/** NMS and JMS. */
export async function listWarehouses(http: HttpClient, signal?: AbortSignal): Promise<Warehouse[]> {
  const body = await http.get('/locations/stores?store_type=national', { signal });
  return parseList(storeSchema, body, 'warehouses');
}

/* Writes: each workflow step returns the order as it now stands. */

export function orderAction(
  http: HttpClient,
  id: string,
  action: string,
  input: object = {},
): Promise<Order> {
  return http
    .post(`/orders/${encodeURIComponent(id)}/actions/${action}`, input)
    .then((body) => parseBody(orderSchema, body, 'order'));
}

export interface ReviewInput {
  /** The product to send, an active product of the category the district requested. */
  condom_id: string;
  /** Leave out to approve the full quantity ordered. */
  quantity_approved?: number;
}

/** Approves the order for a product: all of it, or `quantity_approved`. Nothing is reserved yet. */
export function reviewOrder(http: HttpClient, id: string, input: ReviewInput): Promise<Order> {
  return orderAction(http, id, 'review', input);
}

/**
 * Reserves the approved quantity when enough unexpired stock is on hand (the order becomes
 * confirmed), or holds the order until stock arrives (on_hold).
 */
export function checkOrderStock(http: HttpClient, id: string): Promise<Order> {
  return orderAction(http, id, 'check-stock');
}

/** Rejects the order before dispatch with the reason the district reads; any reservation is released. */
export function rejectOrder(http: HttpClient, id: string, reason: string): Promise<Order> {
  return orderAction(http, id, 'reject', { reason });
}

export interface DispatchInput {
  /** Leave out to send everything reserved; less releases the rest. */
  quantity_issued?: number;
  /** Required when a batch with under one month left would go (first expiry first out). */
  expiry_exception_reason?: string;
  waybill_number?: string;
  vehicle_registration?: string;
  driver_name?: string;
  driver_phone?: string;
}

/** Sends a confirmed order; batches leave first expiry first out, expired ones never. */
export function dispatchOrder(http: HttpClient, id: string, input: DispatchInput): Promise<Order> {
  return orderAction(http, id, 'dispatch', input);
}

export interface DistrictDispatchInput {
  /** The sending warehouse, NMS or JMS. */
  warehouse_store_id: string;
  district_store_id: string;
  /** One per product, each counted in the product's catalogue unit. */
  lines: { condom_id: string; quantity: number }[];
  /** The warehouse's word to the district; it is quoted in the district's notification. */
  note?: string;
  /** Needed when a batch with under one month left would go. */
  expiry_exception_reason?: string;
  waybill_number?: string;
  vehicle_registration?: string;
  driver_name?: string;
  driver_phone?: string;
}

/**
 * Sends stock to a district store before it orders any. Each line becomes an order created
 * dispatched, first expiry first out; the lines go together or not at all.
 */
export async function dispatchToDistrict(
  http: HttpClient,
  input: DistrictDispatchInput,
): Promise<Order[]> {
  return parseList(orderSchema, await http.post('/orders/district-dispatches', input), 'orders');
}
