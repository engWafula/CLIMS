import React, { useCallback, useState } from "react";
import { isAxiosError } from "axios";
import { useFocusedRefresh } from "@/hooks/useFocusedRefresh";
import Screen from "@/components/m/Screen";
import { Banner, Btn, Hero, List, Row, SkeletonList } from "@/components/m/kit";
import { isNetworkError } from "@/lib/hotspots";
import {
  getStockout,
  isClosedOrder,
  listStockouts,
  savedStockout,
  toLocalOrder,
  unacknowledged,
  type StockoutDetail,
} from "@/lib/orders";
import { useT } from "@/lib/theme";
import { ago, chip, items, num, orderChip } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { HM_HOTSPOT } from "@/lib/seed";
import { useMe } from "@/lib/session";
import { useStore } from "@/lib/store";
import { stockStats } from "./common";
import { orderMsg, orderSteps } from "./order";
import { stockoutMessage, stockoutSteps } from "./stockoutDetail";

/** Hotspot manager home: sample data for demo sign-ins, the API for signed-in managers. */
export function HmHome() {
  const me = useMe();
  return me.demo ? <HmHomeSample /> : <HmHomeLive />;
}

/** Hotspot manager orders: sample data for demo sign-ins, the API for signed-in managers. */
export function HmOrders() {
  const me = useMe();
  return me.demo ? <HmOrdersSample /> : <HmOrdersLive />;
}

function HmHomeSample() {
  const T = useT();
  const nav = useNav();
  const me = useMe();
  const { s } = useStore();
  const h = s.hotspots.find((x) => x.id === HM_HOTSPOT);
  if (!h)
    return (
      <Screen title="Home" root>
        <Banner
          tone="neutral"
          title="No hotspot linked to your account"
          body="Call your district focal person."
        />
      </Screen>
    );
  const mine = s.orders
    .filter((o) => o.hotspotId === h.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const o = mine.find((x) => !isClosedOrder(x.status));
  const queued = s.outbox.some((it) => it.type === "notify" && it.payload.hotspotId === h.id);
  return (
    <Screen title="Home" root>
      <Hero
        title={h.name}
        sub={`${h.id} · ${h.village}, ${h.subcounty}`}
        chip={chip(h.status, "success")}
        stats={stockStats(T, h)}
        msg={`Last delivery ${h.lastDelivery != null ? ago(h.lastDelivery) : "none yet"}`}
      >
        {!o ? (
          <Btn label="Report stockout" icon="megaphone" onPress={() => nav.go("request")} />
        ) : null}
      </Hero>
      {queued ? (
        <Banner
          tone="warning"
          title="Stockout saved on this phone"
          body="It sends to the district when you are back online."
        />
      ) : null}
      {o ? (
        <Hero
          h="Current order"
          title={items(o.approved)}
          sub={`Sent ${ago(o.createdAt)}`}
          chip={orderChip(o.status)}
          steps={orderSteps(o, true)}
          msg={orderMsg(o, true, me.name)}
        >
          {o.status === "delivered" ? (
            <Btn label="Confirm receipt" onPress={() => nav.go(`order/${o.id}`)} />
          ) : (
            <Btn label="View order" kind="secondary" onPress={() => nav.go(`order/${o.id}`)} />
          )}
        </Hero>
      ) : null}
    </Screen>
  );
}

function HmOrdersSample() {
  const nav = useNav();
  const { s } = useStore();
  const mine = s.orders
    .filter((o) => o.hotspotId === HM_HOTSPOT)
    .sort((a, b) => b.createdAt - a.createdAt);
  const q0 = s.outbox.filter((it) => it.type === "notify" && it.payload.hotspotId === HM_HOTSPOT);
  return (
    <Screen
      title="Orders"
      root
      fab={{
        label: "Report stockout",
        icon: "megaphone",
        onPress: () => nav.go("request"),
      }}
    >
      {q0.length ? (
        <List h="Waiting to send">
          {q0.map((it) => (
            <Row
              key={it.id}
              t="Stockout notification"
              s={`${items(it.payload.items)} · saved ${ago(it.at)}`}
              chip={chip("Offline", "warning")}
              ic="upload"
            />
          ))}
        </List>
      ) : null}
      <List h={q0.length ? "Sent" : undefined} empty="No orders yet.">
        {mine.map((o) => (
          <Row
            key={o.id}
            t={items(o.items)}
            s={`Sent ${ago(o.createdAt)}`}
            chip={orderChip(o.status)}
            chev
            fw={o.status === "delivered" ? "600" : "400"}
            onPress={() => nav.go(`order/${o.id}`)}
          />
        ))}
      </List>
    </Screen>
  );
}

/* ───────── Signed-in hotspot manager (API) ───────── */

type Load = "loading" | "ok" | "offline" | "forbidden" | "error";

/**
 * The manager's hotspot stockout notifications from GET /orders/stockouts, reloaded whenever the
 * screen is shown. The phone's copy stays on screen while offline.
 */
function useApiOrders() {
  const me = useMe();
  const { s, syncApiOrders, offline } = useStore();
  const [load, setLoad] = useState<Load>("loading");
  useFocusedRefresh(
    useCallback(
      async (isCurrent) => {
        try {
          const reports = await listStockouts();
          if (!isCurrent()) return;
          syncApiOrders(reports.map((r) => toLocalOrder(r, me.name, "Hotspot manager")));
          setLoad("ok");
        } catch (e: unknown) {
          if (!isCurrent()) return;
          setLoad(
            isNetworkError(e)
              ? "offline"
              : isAxiosError(e) && e.response?.status === 403
                ? "forbidden"
                : "error",
          );
        }
      },
      [me.name, syncApiOrders],
    ),
    offline,
  );
  const orders = s.orders
    .filter((o) => o.source === "api")
    .sort((a, b) => b.createdAt - a.createdAt);
  const queued = s.outbox.filter((it) => it.type === "stockout");
  return { orders, queued, load };
}

function LoadBanner({ load, any }: { load: Load; any: boolean }) {
  if (load === "forbidden")
    return (
      <Banner
        tone="warning"
        title="Can't load your orders"
        body="Your account can't view orders yet. Call your district focal person."
      />
    );
  if (load === "offline" && any)
    return <Banner tone="neutral" title="Offline" body="Showing your orders as last loaded." />;
  if (load === "error")
    return <Banner tone="warning" title="Couldn't refresh your orders" body="Try again shortly." />;
  return null;
}

/**
 * The newest requests' details (deliveries and confirmations), reloaded whenever the home screen is
 * shown; offline, the copies saved on this phone.
 */
function useRecentDetails(ids: string[]) {
  const [details, setDetails] = useState<Record<string, StockoutDetail>>({});
  const key = ids.join(",");
  const { offline } = useStore();
  useFocusedRefresh(
    useCallback(
      async (isCurrent) => {
        await Promise.all(
          (key ? key.split(",") : []).map(async (id) => {
            try {
              const detail = await getStockout(id).catch(() => savedStockout(id));
              if (isCurrent() && detail) setDetails((cur) => ({ ...cur, [id]: detail }));
            } catch (error) {
              console.error("Could not load saved request details", error);
            }
          }),
        );
      },
      [key],
    ),
    offline,
  );
  return details;
}

/** Male and female pieces the hotspot confirmed receiving for a request, and when it last did. */
function received(d: StockoutDetail) {
  const pieces = { male: 0, female: 0 };
  let at = 0;
  for (const delivery of d.deliveries)
    for (const line of delivery.lines) {
      if (line.acknowledged_pieces === null) continue;
      pieces[line.category] += line.acknowledged_pieces;
      at = Math.max(at, Date.parse(line.acknowledged_at ?? "") || 0);
    }
  return { pieces, at };
}

/**
 * As the sample home: the hotspot with its most recent received order and the quantities that
 * arrived, then the current order while one is not yet confirmed.
 */
function HmHomeLive() {
  const nav = useNav();
  const me = useMe();
  const { orders, queued, load } = useApiOrders();
  // A delivered notification stays open until the manager acknowledges what arrived; a rejected
  // one is closed, so the manager can report again.
  const open = orders.find((o) => !isClosedOrder(o.status));
  const newest = orders[0];
  const rejected = !open && newest?.status === "rejected" ? newest : undefined;
  const lastReceived = orders.find((o) => o.status === "received");
  const details = useRecentDetails(
    [open?.id, lastReceived?.id].filter((id): id is string => Boolean(id)),
  );
  const current = open ? details[open.id] : undefined;
  const done = lastReceived ? details[lastReceived.id] : undefined;
  const got = done ? received(done) : null;
  const hotspot = (done ?? current)?.hot_spot;
  const place = [hotspot?.village, hotspot?.subcounty, hotspot?.district]
    .filter((part) => part?.trim())
    .join(", ");

  if (!me.hotspotId)
    return (
      <Screen title="Home" root>
        <Banner
          tone="neutral"
          title="No hotspot linked to your account"
          body="Call your district focal person to link your hotspot."
        />
      </Screen>
    );
  const waiting = current ? unacknowledged(current).length : 0;
  return (
    <Screen title="Home" root>
      <LoadBanner load={load} any={orders.length > 0} />
      <Hero
        title={hotspot?.name ?? (open ?? lastReceived)?.hotspot ?? "Your hotspot"}
        sub={place || "Your hotspot"}
        chip={chip("Active", "success")}
        stats={
          got
            ? [
                { label: "Male condoms", value: num(got.pieces.male), note: "received" },
                { label: "Female condoms", value: num(got.pieces.female), note: "received" },
              ]
            : undefined
        }
        msg={
          lastReceived
            ? `Last received ${ago(got?.at || lastReceived.createdAt)} · ${lastReceived.product ?? "condoms"}`
            : "No order received yet"
        }
      >
        {!open ? (
          <Btn label="Report stockout" icon="megaphone" onPress={() => nav.go("request")} />
        ) : null}
      </Hero>
      {queued.length ? (
        <Banner
          tone="warning"
          title="Stockout saved on this phone"
          body="It sends to the district when you are back online."
        />
      ) : null}
      {rejected && !queued.length ? (
        <Banner
          tone="danger"
          title="The district rejected your last request"
          body="Open it to read their reason. Report the stockout again if you still need stock."
          act={{ label: "See why", onPress: () => nav.go(`stockout/${rejected.id}`) }}
        />
      ) : null}
      {load === "loading" && !orders.length ? (
        <SkeletonList h="Current order" rows={3} />
      ) : open ? (
        <Hero
          h="Current order"
          title={open.product ?? "Condoms"}
          sub={`Sent ${ago(open.createdAt)}`}
          chip={orderChip(open.status)}
          steps={current ? stockoutSteps(current, true) : undefined}
          msg={current ? stockoutMessage(current, true, waiting) : undefined}
        >
          {waiting > 0 ? (
            <Btn label="Confirm receipt" onPress={() => nav.go(`stockout/${open.id}`)} />
          ) : (
            <Btn
              label="View order"
              kind="secondary"
              onPress={() => nav.go(`stockout/${open.id}`)}
            />
          )}
        </Hero>
      ) : null}
    </Screen>
  );
}

function HmOrdersLive() {
  const nav = useNav();
  const { orders, queued, load } = useApiOrders();
  return (
    <Screen
      title="Orders"
      root
      fab={{
        label: "Report stockout",
        icon: "megaphone",
        onPress: () => nav.go("request"),
      }}
    >
      <LoadBanner load={load} any={orders.length > 0} />
      {queued.length ? (
        <List h="Waiting to send">
          {queued.map((it) => (
            <Row
              key={it.id}
              t={it.payload.product ?? "Stockout"}
              s={`Saved ${ago(it.at)}`}
              chip={chip("Offline", "warning")}
              ic="upload"
            />
          ))}
        </List>
      ) : null}
      {load === "loading" && !orders.length ? (
        <SkeletonList rows={5} />
      ) : (
        <List h={queued.length ? "Sent" : undefined} empty="No orders yet.">
          {orders.map((o) => (
            <Row
              key={o.id}
              t={o.product ?? "Condoms"}
              s={`${o.note ? `${o.note} · ` : ""}${ago(o.createdAt)}`}
              chip={orderChip(o.status)}
              chev
              onPress={() => nav.go(`stockout/${o.id}`)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
