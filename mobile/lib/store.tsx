import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { items as fmtItems } from "./format";
import { isAxiosError } from "axios";
import {
  isNetworkError,
  listHotspotsPage,
  type ApiHotspot,
  submitErrorMessage,
  submitHotspot,
  toLocalHotspot,
} from "./hotspots";
import {
  acknowledgeErrorMessage,
  acknowledgeStockout,
  currentStockoutRequest,
  reportStockout,
  stockoutErrorMessage,
  toLocalOrder,
} from "./orders";
import { listMyDeliveries } from "./deliveries";
import {
  isUnread,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  toInboxEvent,
} from "./notifications";
import { createSeed, DEFAULT_PERSONAS, HM_HOTSPOT } from "./seed";
import { useMe } from "./session";
import type {
  ActionType,
  AppEvent,
  AppRole,
  DomainState,
  EventRole,
  Hotspot,
  OutboxItem,
  Qty,
} from "./types";

/**
 * Offline-first store for the field app.
 *
 * Every write goes through `send`. Online, it applies straight away; offline, it is saved to the
 * outbox and applied when the phone reconnects. Today "applying" updates the local copy only,
 * because the API has no domain endpoints yet. When they land, `apply` becomes the place that
 * calls them, and the outbox already gives you retry-on-reconnect.
 */

export interface SendResult {
  queued: boolean;
  /** ID of a created record (new order or hotspot) when sent online. */
  id?: string;
}

interface StoreCtx {
  s: DomainState;
  ready: boolean;
  offline: boolean;
  send: (type: ActionType, payload: any, label: string) => SendResult;
  /**
   * Reload the first page of the signed-in VHT's submitted hotspots, replacing the phone's list.
   * `status` is "ok", "offline", "forbidden" (the vht role lacks hotspots:read) or "error";
   * `hasMore` says whether loadMoreHotspots can fetch another page. Demo sign-ins resolve "ok".
   */
  refreshHotspots: () => Promise<PageResult>;
  /** Append the next page of submitted hotspots, starting at `offset` (the number already loaded). */
  loadMoreHotspots: (offset: number) => Promise<PageResult>;
  /** Replace the phone's copies of API orders with a fresh list from GET /orders. */
  syncApiOrders: (orders: DomainState["orders"]) => void;
  /**
   * Replace the phone's copy of one API order with a fresher one (from toLocalOrder), e.g. when its
   * page loads, so lists show its current status. An order the phone does not hold is left out.
   */
  updateApiOrder: (order: DomainState["orders"][number]) => void;
  /** Save an action to the outbox even when online, e.g. after a request failed on the network. */
  queue: (type: ActionType, payload: any, label: string) => void;
  /** Mark every notification read: local ones up to now, and the API's on the server. */
  markRead: (role: AppRole) => void;
  /** Mark one API notification read, e.g. when it is opened. */
  readNotice: (e: AppEvent) => void;
  /** Reload the signed-in user's notifications from the API; resolves false when it could not. */
  refreshNotices: () => Promise<boolean>;
  /**
   * Reload a signed-in delivery agent's deliveries (GET /orders/deliveries). Resolves "ok", or why
   * the phone's copy is still shown; other roles and demo sign-ins resolve "ok" with nothing to do.
   */
  refreshDeliveries: () => Promise<RefreshResult>;
  reset: () => void;
}

export type RefreshResult = "ok" | "offline" | "forbidden" | "error";
export interface PageResult {
  status: RefreshResult;
  hasMore: boolean;
}

const failure = (err: unknown): PageResult => ({
  status: isNetworkError(err)
    ? "offline"
    : isAxiosError(err) && err.response?.status === 403
      ? "forbidden"
      : "error",
  hasMore: false,
});

const Ctx = createContext<StoreCtx | null>(null);

/**
 * Whether a queued send may work later, so it stays in the outbox: no answer, a timeout, a busy or
 * failing server (a restart behind the gateway answers 502), or a session that needs signing in
 * again. Only a definite refusal (400, 403, 404, 409, 422…) drops it with a notice.
 */
function retryLater(err: unknown): boolean {
  if (isNetworkError(err)) return true;
  if (err instanceof Error && err.name === "SessionEndedError") return true;
  if (!isAxiosError(err)) return false;
  const status = err.response?.status ?? 0;
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

/** How often a waiting outbox is retried while the phone thinks it is online. */
const OUTBOX_RETRY_MS = 60_000;

/** How often the inbox checks the API for new notifications while the app is open. */
const NOTICE_POLL_MS = 60_000;

const roleOfEvent: Record<string, EventRole> = {
  VHT: "VHT",
  "Hotspot manager": "Hotspot manager",
};

type Applied = { next: DomainState; id?: string };

function apply(
  s: DomainState,
  type: ActionType,
  p: any,
  role: AppRole,
  me: string,
  now: number,
): Applied {
  const ev = (e: Omit<AppEvent, "id" | "t">): AppEvent => ({
    id: `EV-${now}-${Math.random().toString(36).slice(2, 7)}`,
    t: now,
    ...e,
  });
  const setOrder = (
    id: string,
    f: (o: DomainState["orders"][number]) => DomainState["orders"][number],
  ) => s.orders.map((o) => (o.id === id ? f(o) : o));
  const setHotspot = (id: string, f: (h: Hotspot) => Hotspot) =>
    s.hotspots.map((h) => (h.id === id ? f(h) : h));

  switch (type) {
    case "notify": {
      const seq = s.seq + 1;
      const id = `ORD-${seq}`;
      const h = s.hotspots.find((x) => x.id === p.hotspotId);
      if (!h) return { next: s };
      const items: Qty = p.items;
      const order = {
        id,
        hotspotId: h.id,
        hotspot: h.name,
        status: "queued" as const,
        items,
        approved: items,
        remaining: p.remaining,
        reason: p.reason,
        note: p.note || "",
        by: me,
        byRole: p.byRole,
        createdAt: now,
      };
      const to: AppRole[] = role === "vht" ? (h.id === HM_HOTSPOT ? ["hm"] : []) : ["vht"];
      const events = to.length
        ? [
            ev({
              ref: id,
              role: roleOfEvent[p.byRole] ?? "System",
              actor: me,
              text: `${p.reason} at ${h.name} · asked for ${fmtItems(items)}`,
              to,
            }),
            ...s.events,
          ]
        : s.events;
      return {
        id,
        next: {
          ...s,
          seq,
          orders: [order, ...s.orders],
          hotspots: setHotspot(h.id, (x) => ({ ...x, stock: p.remaining })),
          events,
        },
      };
    }
    case "stockout":
    case "acknowledge": {
      // `p.order` comes from toLocalOrder: the API's copy of the notification, by its UUID.
      const order = p.order as DomainState["orders"][number];
      return {
        id: order.id,
        next: {
          ...s,
          orders: [order, ...s.orders.filter((o) => o.id !== order.id)],
        },
      };
    }
    case "mapHotspot": {
      // `p.hotspot` comes from toLocalHotspot (the API's copy, with its UUID) or draftHotspot
      // (demo sign-ins). New hotspots wait inactive for the DCFP's review either way.
      const nums = s.hotspots.map((h) => parseInt(h.id.replace(/\D/g, ""), 10) || 0);
      const id: string = p.hotspot.id ?? `HS-${String(Math.max(0, ...nums) + 1).padStart(4, "0")}`;
      const h: Hotspot = {
        status: "Inactive",
        reviewStatus: "submitted",
        stock: { male: 0, female: 0 },
        mappedAt: now,
        ...p.hotspot,
        id,
      };
      return {
        id,
        next: { ...s, hotspots: [h, ...s.hotspots.filter((x) => x.id !== id)] },
      };
    }
    case "confirmReceipt": {
      const o = s.orders.find((x) => x.id === p.id);
      if (!o) return { next: s };
      const qty: Qty = p.qty;
      return {
        next: {
          ...s,
          orders: setOrder(o.id, (x) => ({
            ...x,
            status: "received",
            receipt: { at: now, qty, issue: p.issue || "", by: me },
          })),
          hotspots: setHotspot(o.hotspotId, (h) => ({
            ...h,
            stock: {
              male: h.stock.male + qty.male,
              female: h.stock.female + qty.female,
            },
            lastDelivery: now,
          })),
          events: [
            ev({
              ref: o.id,
              role: "Hotspot manager",
              actor: me,
              text: `Confirmed receipt at ${o.hotspot} · ${p.issue ? `reported: ${p.issue}` : "counts matched"}`,
              to: ["rider", "vht"],
            }),
            ...s.events,
          ],
        },
      };
    }
    case "pickup": {
      const o = s.orders.find((x) => x.id === p.id);
      if (!o?.delivery) return { next: s };
      return {
        next: {
          ...s,
          orders: setOrder(o.id, (x) => ({
            ...x,
            status: "in_transit",
            delivery: { ...x.delivery!, pickedAt: now },
          })),
          events: [
            ev({
              ref: o.id,
              role: "Rider",
              actor: me,
              text: "Collected the stock at the district store and is on the way",
              to: ["hm", "vht"],
            }),
            ...s.events,
          ],
        },
      };
    }
    case "deliver": {
      const o = s.orders.find((x) => x.id === p.id);
      if (!o?.delivery) return { next: s };
      return {
        next: {
          ...s,
          orders: setOrder(o.id, (x) => ({
            ...x,
            status: "delivered",
            delivery: {
              ...x.delivery!,
              deliveredAt: now,
              qty: p.qty,
              found: p.found,
              recipient: p.recipient,
              photo: p.photo,
              sig: p.sig,
            },
          })),
          hotspots: setHotspot(o.hotspotId, (h) => ({ ...h, stock: p.found })),
          events: [
            ev({
              ref: o.id,
              role: "Rider",
              actor: me,
              text: `Delivered to ${o.hotspot}. ${p.recipient} needs to confirm receipt`,
              to: ["hm", "vht"],
            }),
            ...s.events,
          ],
        },
      };
    }
  }
  return { next: s };
}

/**
 * Monthly reporting was removed from the field app. Drop what older versions saved for it:
 * the reports, their MOH notifications, and report saves still waiting in the outbox.
 */
export function withoutReports(saved: DomainState & { reports?: unknown }): DomainState {
  const { reports: _reports, ...rest } = saved;
  return {
    ...rest,
    events: rest.events.filter((e) => !e.ref.startsWith("RPT-")),
    outbox: rest.outbox.filter((it) => !String(it.type).startsWith("rpt")),
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const key = `clims.domain.v1.${me.id}`;
  const personas = useMemo(() => ({ ...DEFAULT_PERSONAS, [me.role]: me.name }), [me.role, me.name]);
  const [s, setS] = useState<DomainState>(() => createSeed(personas));
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  // Latest state for callbacks; `commit` is the only writer, so it never lags behind `s`.
  const ref = useRef(s);

  const commit = useCallback((next: DomainState) => {
    ref.current = next;
    setS(next);
  }, []);

  // Load this user's saved copy, or start from the seed.
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!live) return;
        if (raw) commit(withoutReports(JSON.parse(raw)));
        else commit(createSeed(personas));
      })
      .catch(() => {})
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [key, personas, commit]);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(key, JSON.stringify(s)).catch(() => {});
  }, [s, key, ready]);

  const flushing = useRef(false);

  /**
   * Send the outbox in order. Hotspot submissions (payloads with a `request`) go to the API and
   * stop the flush if the network drops again; everything else still applies locally.
   */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (;;) {
        const it = ref.current.outbox[0];
        if (!it) break;
        const drop = (st: DomainState) => ({
          ...st,
          outbox: st.outbox.filter((x) => x.id !== it.id),
        });
        if (it.type === "mapHotspot" && it.payload?.request) {
          try {
            const res = await submitHotspot(it.payload.request);
            const hotspot = toLocalHotspot(res, me.name, it.payload.request.comment);
            commit(
              apply(drop(ref.current), it.type, { hotspot }, it.role, me.name, Date.now()).next,
            );
          } catch (err) {
            if (retryLater(err)) break;
            // Refused (duplicate name, mismatched place…): tell the VHT so they can map it again.
            const cur = drop(ref.current);
            const now = Date.now();
            commit({
              ...cur,
              events: [
                {
                  id: `EV-${now}-${it.id}`,
                  t: now,
                  ref: `MAP-${it.id}`,
                  role: "System",
                  actor: "CLIMS",
                  text: `Couldn't submit ${it.payload.request.name}. ${submitErrorMessage(err)}`,
                  to: [it.role],
                },
                ...cur.events,
              ],
            });
          }
          continue;
        }
        if (it.type === "stockout" && it.payload?.request) {
          const { request, hotspot, product } = it.payload;
          try {
            const { report } = await reportStockout(currentStockoutRequest(request, product));
            const order = toLocalOrder(
              report,
              me.name,
              it.role === "hm" ? "Hotspot manager" : "VHT",
            );
            commit(apply(drop(ref.current), it.type, { order }, it.role, me.name, Date.now()).next);
          } catch (err) {
            if (retryLater(err)) break;
            const cur = drop(ref.current);
            const now = Date.now();
            commit({
              ...cur,
              events: [
                {
                  id: `EV-${now}-${it.id}`,
                  t: now,
                  ref: `REQ-${it.id}`,
                  role: "System",
                  actor: "CLIMS",
                  text: `Couldn't send the stock request for ${hotspot}. ${stockoutErrorMessage(err)}`,
                  to: [it.role],
                },
                ...cur.events,
              ],
            });
          }
          continue;
        }
        if (it.type === "acknowledge" && it.payload?.request) {
          const { id, request, hotspot } = it.payload;
          try {
            const d = await acknowledgeStockout(id, request);
            const order = toLocalOrder(d, me.name, "Hotspot manager");
            commit(apply(drop(ref.current), it.type, { order }, it.role, me.name, Date.now()).next);
          } catch (err) {
            if (retryLater(err)) break;
            const cur = drop(ref.current);
            const now = Date.now();
            commit({
              ...cur,
              events: [
                {
                  id: `EV-${now}-${it.id}`,
                  t: now,
                  ref: id,
                  role: "System",
                  actor: "CLIMS",
                  text: `Couldn't record what arrived at ${hotspot}. ${acknowledgeErrorMessage(err)}`,
                  to: [it.role],
                },
                ...cur.events,
              ],
            });
          }
          continue;
        }
        commit(apply(drop(ref.current), it.type, it.payload, it.role, me.name, Date.now()).next);
      }
    } finally {
      flushing.current = false;
    }
  }, [commit, me.name]);

  // Anything queued in an earlier session goes out as soon as this one has loaded.
  useEffect(() => {
    if (ready && !offline) flush();
  }, [ready, offline, flush]);

  useEffect(
    () =>
      NetInfo.addEventListener((n) => {
        const off = n.isConnected === false;
        setOffline(off);
        if (!off) flush();
      }),
    [flush],
  );

  // NetInfo can report "connected" on a link where every request times out, and a send can stop on a
  // server error, so neither brings a connectivity change. A waiting outbox is also retried every
  // minute and whenever the app comes back to the front.
  const waiting = s.outbox.length > 0;
  useEffect(() => {
    if (!ready || offline || !waiting) return;
    const timer = setInterval(flush, OUTBOX_RETRY_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") flush();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [ready, offline, waiting, flush]);

  const queue = useCallback(
    (type: ActionType, payload: any, label: string) => {
      const cur = ref.current;
      const item: OutboxItem = {
        id: `OB-${Date.now()}`,
        type,
        payload,
        label,
        role: me.role,
        at: Date.now(),
      };
      commit({ ...cur, outbox: [...cur.outbox, item] });
    },
    [commit, me.role],
  );

  const send = useCallback(
    (type: ActionType, payload: any, label: string): SendResult => {
      const cur = ref.current;
      if (offline) {
        queue(type, payload, label);
        return { queued: true };
      }
      const { next, id } = apply(cur, type, payload, me.role, me.name, Date.now());
      commit(next);
      return { queued: false, id };
    },
    [offline, commit, queue, me.role, me.name],
  );

  /** API notifications are the signed-in user's own; sample sign-ins have none. */
  const liveNotices = !me.demo;

  const refreshNotices = useCallback(async (): Promise<boolean> => {
    if (!liveNotices) return true;
    try {
      const list = await listNotifications();
      const cur = ref.current;
      commit({ ...cur, notices: list.map((n) => toInboxEvent(n, me.role)) });
      return true;
    } catch {
      // Offline or refused: keep the phone's copy.
      return false;
    }
  }, [liveNotices, commit, me.role]);

  const liveDeliveries = liveNotices && me.role === "rider";

  const refreshDeliveries = useCallback(async (): Promise<RefreshResult> => {
    if (!liveDeliveries) return "ok";
    try {
      const list = await listMyDeliveries();
      commit({ ...ref.current, riderDeliveries: list });
      return "ok";
    } catch (err) {
      return failure(err).status;
    }
  }, [liveDeliveries, commit]);

  const markRead = useCallback(
    (role: AppRole) => {
      const cur = ref.current;
      const now = Date.now();
      const unread = (cur.notices ?? []).some((e) => !e.readAt);
      commit({
        ...cur,
        read: { ...cur.read, [role]: now },
        notices: cur.notices?.map((e) => (e.readAt ? e : { ...e, readAt: now })),
      });
      // Offline, the next refresh brings back the server's view, and the inbox marks them again.
      if (unread && liveNotices) markAllNotificationsRead().catch(() => {});
    },
    [commit, liveNotices],
  );

  const readNotice = useCallback(
    (e: AppEvent) => {
      if (!e.serverId || e.readAt) return;
      const cur = ref.current;
      const now = Date.now();
      commit({
        ...cur,
        notices: cur.notices?.map((x) => (x.serverId === e.serverId ? { ...x, readAt: now } : x)),
      });
      if (liveNotices) markNotificationRead(e.serverId).catch(() => {});
    },
    [commit, liveNotices],
  );

  // New notifications (and a delivery agent's deliveries, for the tab badge) arrive while the app is
  // open (every minute) and whenever it comes back to the front, as well as right after sign-in.
  useEffect(() => {
    if (!ready || offline || !liveNotices) return;
    const refresh = () => {
      refreshNotices();
      refreshDeliveries();
    };
    refresh();
    const timer = setInterval(refresh, NOTICE_POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [ready, offline, liveNotices, refreshNotices, refreshDeliveries]);

  /** Store one page of API hotspots: the API's copy wins, keeping what only the phone knows. */
  const storePage = useCallback(
    (page: ApiHotspot[], replace: boolean) => {
      const cur = ref.current;
      const prev = new Map(cur.hotspots.map((h) => [h.id, h]));
      const fresh = page.map((a) => {
        const h = toLocalHotspot(a, me.name, null);
        const p = prev.get(h.id);
        return p
          ? {
              ...h,
              stock: p.stock,
              lastDelivery: p.lastDelivery,
              comment: p.comment,
              vhts: p.vhts,
            }
          : h;
      });
      const ids = new Set(fresh.map((h) => h.id));
      const rest = cur.hotspots.filter((h) => h.source !== "api");
      // A refresh replaces the API list with page one; later pages append in the API's order.
      const earlier = replace
        ? []
        : cur.hotspots.filter((h) => h.source === "api" && !ids.has(h.id));
      commit({ ...cur, hotspots: [...earlier, ...fresh, ...rest] });
    },
    [commit, me.name],
  );

  const refreshHotspots = useCallback(async (): Promise<PageResult> => {
    if (me.demo) return { status: "ok", hasMore: false };
    try {
      const page = await listHotspotsPage({ offset: 0, submittedBy: me.id });
      storePage(page.items, true);
      return { status: "ok", hasMore: page.hasMore };
    } catch (err) {
      return failure(err);
    }
  }, [me.demo, me.id, storePage]);

  const loadMoreHotspots = useCallback(
    async (offset: number): Promise<PageResult> => {
      if (me.demo) return { status: "ok", hasMore: false };
      try {
        const page = await listHotspotsPage({ offset, submittedBy: me.id });
        storePage(page.items, false);
        return { status: "ok", hasMore: page.hasMore };
      } catch (err) {
        return failure(err);
      }
    },
    [me.demo, me.id, storePage],
  );

  const syncApiOrders = useCallback(
    (orders: DomainState["orders"]) => {
      const cur = ref.current;
      commit({
        ...cur,
        orders: [...orders, ...cur.orders.filter((o) => o.source !== "api")],
      });
    },
    [commit],
  );

  const updateApiOrder = useCallback(
    (order: DomainState["orders"][number]) => {
      const cur = ref.current;
      if (!cur.orders.some((o) => o.id === order.id)) return;
      commit({ ...cur, orders: cur.orders.map((o) => (o.id === order.id ? order : o)) });
    },
    [commit],
  );

  const reset = useCallback(() => commit(createSeed(personas)), [commit, personas]);

  const value = useMemo(
    () => ({
      s,
      ready,
      offline,
      send,
      queue,
      refreshHotspots,
      loadMoreHotspots,
      syncApiOrders,
      updateApiOrder,
      markRead,
      readNotice,
      refreshNotices,
      refreshDeliveries,
      reset,
    }),
    [
      s,
      ready,
      offline,
      send,
      queue,
      refreshHotspots,
      loadMoreHotspots,
      syncApiOrders,
      updateApiOrder,
      markRead,
      readNotice,
      refreshNotices,
      refreshDeliveries,
      reset,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore must be used inside StoreProvider");
  return c;
}

/** Notifications for the signed-in role, newest first: the API's, and the app's own. */
export function useNotes() {
  const { s } = useStore();
  const me = useMe();
  return useMemo(() => {
    // Signed-in VHTs and hotspot managers only hear about their own hotspots and orders (and the app's own alerts),
    // not the sample data the phone starts with.
    // Every real sign-in, riders too: the seed's sample events are for demo accounts only.
    const ownOnly = !me.demo;
    const hotspots = new Set(s.hotspots.filter((h) => h.source === "api").map((h) => h.id));
    const refs = new Set([
      ...hotspots,
      ...s.orders.filter((o) => o.source === "api" || hotspots.has(o.hotspotId)).map((o) => o.id),
    ]);
    const local = s.events
      .filter((e) => e.to.includes(me.role) && e.actor !== me.name)
      .filter(
        (e) => !ownOnly || refs.has(e.ref) || e.ref.startsWith("MAP-") || e.ref.startsWith("REQ-"),
      );
    // API notifications are already the signed-in user's own.
    const server = me.demo ? [] : (s.notices ?? []);
    return [...server, ...local].sort((a, b) => b.t - a.t);
  }, [s.events, s.notices, s.hotspots, s.orders, me.role, me.name, me.demo]);
}

/** Unread notifications for the signed-in role. */
export function useUnread() {
  const { s } = useStore();
  const me = useMe();
  const notes = useNotes();
  const read = s.read[me.role] ?? 0;
  return notes.filter((e) => isUnread(e, read)).length;
}

/** The outbox entry still waiting for this record, if any. */
export function usePending(id?: string) {
  const { s } = useStore();
  return id
    ? s.outbox.find((it) => it.payload?.id === id || it.payload?.hotspotId === id)
    : undefined;
}
