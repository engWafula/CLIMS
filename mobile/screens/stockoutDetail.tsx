import React, { useCallback, useState } from "react";
import { isAxiosError } from "axios";
import { useFocusEffect } from "expo-router";
import Screen from "@/components/m/Screen";
import {
  Banner,
  Btn,
  Btns,
  Check,
  Fields,
  Hero,
  List,
  Row,
  SkeletonList,
  Stepper,
  type StepItem,
} from "@/components/m/kit";
import { ago, num, orderChip, toInt } from "@/lib/format";
import { isNetworkError } from "@/lib/hotspots";
import { TAB_LABEL, useNav } from "@/lib/nav";
import {
  acknowledgeErrorMessage,
  acknowledgeStockout,
  getStockout,
  savedStockout,
  CATEGORY_LABEL,
  stockoutProduct,
  toLocalOrder,
  unacknowledged,
  type DeliveryLine,
  type StockoutDetail,
  type StockoutEvent,
} from "@/lib/orders";
import { useMe } from "@/lib/session";
import { usePending, useStore } from "@/lib/store";

type Load = "loading" | "ok" | "offline" | "forbidden" | "missing" | "error";

const EVENT_TEXT: Record<StockoutEvent["action"], (e: StockoutEvent) => string> = {
  raised: (e) => `Reported out of ${CATEGORY_LABEL[e.selection].toLowerCase()}`,
  repeated: () => "Reported again",
  selection_changed: (e) => `Now asking for ${CATEGORY_LABEL[e.selection].toLowerCase()}`,
  delivered: () => "District recorded a delivery",
  acknowledged: () => "Hotspot manager confirmed what arrived",
  rejected: () => "District rejected the request",
};

/** The request's progress, for its page and the hotspot manager's home. */
export function stockoutSteps(d: StockoutDetail, you: boolean): StepItem[] {
  if (d.status === "rejected") {
    return [
      { label: "Sent to district", st: "done", sub: ago(Date.parse(d.created_at)) },
      {
        label: "Rejected",
        st: "warn",
        sub: d.rejected_at ? ago(Date.parse(d.rejected_at)) : "",
      },
    ];
  }
  const delivered = d.deliveries.length > 0;
  const firstDelivery = d.deliveries.map((x) => Date.parse(x.created_at)).sort()[0];
  return [
    { label: "Sent to district", st: "done", sub: ago(Date.parse(d.created_at)) },
    {
      label: "Delivered",
      st: delivered ? "done" : "cur",
      sub: firstDelivery ? ago(firstDelivery) : "",
    },
    {
      label: you ? "You confirmed" : "Receipt confirmed",
      st:
        d.status === "fulfilled"
          ? "done"
          : d.status === "partly_received"
            ? "warn"
            : delivered
              ? "cur"
              : "todo",
      sub: d.status === "partly_received" ? "Part received" : "",
    },
  ];
}

/** What the request is waiting for, in a sentence. */
export function stockoutMessage(d: StockoutDetail, you: boolean, waiting: number): string {
  switch (d.status) {
    case "awaiting_supply":
      return "The district focal person has the notification and decides what to send.";
    case "awaiting_acknowledgement":
      return you
        ? "The district has sent stock. Count what arrived and confirm it below."
        : "The district has sent stock. The hotspot manager needs to confirm what arrived.";
    case "partly_received":
      return waiting && you
        ? "Some stock has been confirmed. Count the rest of what arrived and confirm it below."
        : "Part of the request has arrived. The district can send more for what's still missing.";
    case "fulfilled":
      return `Closed${d.fulfilled_at ? ` ${ago(Date.parse(d.fulfilled_at))}` : ""}.`;
    case "rejected":
      return `The district rejected this request${
        d.rejection_reason ? `: “${d.rejection_reason}”` : "."
      } Report the stockout again if ${you ? "you still need" : "the hotspot still needs"} stock.`;
  }
}

/**
 * The hotspot manager's count of what arrived (POST /orders/stockouts/{id}/acknowledgements). Counts
 * can't be changed once CLIMS has them, so the manager confirms they counted first.
 */
function AcknowledgeForm({
  d,
  lines,
  onDone,
}: {
  d: StockoutDetail;
  lines: DeliveryLine[];
  onDone: (d: StockoutDetail | null) => void;
}) {
  const me = useMe();
  const { send, queue, offline } = useStore();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [counted, setCounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const got = (l: DeliveryLine) => toInt(vals[l.id] ?? String(l.pieces));
  const short = lines.some((l) => got(l) !== l.pieces);
  const request = { lines: lines.map((l) => ({ line_id: l.id, pieces: got(l) })) };
  const hotspot = d.hot_spot?.name || "your hotspot";
  const label = `Confirm what arrived · ${hotspot}`;

  const submit = async () => {
    setErr("");
    const saveForLater = () => {
      queue("acknowledge", { id: d.id, request, hotspot }, label);
      onDone(null);
    };
    if (offline) return saveForLater();
    setBusy(true);
    try {
      const next = await acknowledgeStockout(d.id, request);
      send("acknowledge", { order: toLocalOrder(next, me.name, "Hotspot manager") }, label);
      onDone(next);
    } catch (e) {
      if (isNetworkError(e)) saveForLater();
      else setErr(acknowledgeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {err ? <Banner tone="danger" title="Couldn't confirm" body={err} /> : null}
      <Fields
        h="Count what arrived"
        f="Count single condoms (pieces). Enter 0 for anything that didn't come."
      >
        {lines.map((l) => (
          <Stepper
            key={l.id}
            label={l.product}
            sub={`District sent ${num(l.pieces)} pieces`}
            value={vals[l.id] ?? String(l.pieces)}
            onChange={(v) => setVals((x) => ({ ...x, [l.id]: v }))}
            step={10}
          />
        ))}
      </Fields>
      {short ? (
        <Banner
          tone="warning"
          title="Counts differ from what was sent"
          body="The district sees both numbers and can follow up."
        />
      ) : null}
      <Fields>
        <Check
          label="I counted the stock. These numbers can't be changed later."
          value={counted}
          onChange={setCounted}
        />
      </Fields>
      <Btns>
        <Btn
          label={
            busy ? "Confirming…" : offline ? "Save and send when online" : "Confirm what arrived"
          }
          dis={!counted || busy}
          onPress={submit}
        />
      </Btns>
    </>
  );
}

/** A stockout notification sent to the API: its progress, deliveries and history. */
export function StockoutScreen({ id }: { id: string }) {
  const nav = useNav();
  const me = useMe();
  const { s, updateApiOrder } = useStore();
  const pend = usePending(id);
  const [d, setD] = useState<StockoutDetail | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [confirmed, setConfirmed] = useState<"sent" | "queued" | null>(null);
  const backLabel = TAB_LABEL[nav.tab];

  useFocusEffect(
    useCallback(() => {
      let live = true;
      savedStockout(id).then((saved) => live && saved && setD((cur) => cur ?? saved));
      getStockout(id)
        .then((fresh) => {
          if (!live) return;
          setD(fresh);
          setLoad("ok");
          // The phone's copy (and its chip in the request lists) follows what the district did.
          updateApiOrder(
            toLocalOrder(fresh, me.name, me.role === "hm" ? "Hotspot manager" : "VHT"),
          );
        })
        .catch((e: unknown) => {
          if (!live) return;
          const st = isAxiosError(e) ? e.response?.status : undefined;
          setLoad(
            isNetworkError(e)
              ? "offline"
              : st === 403
                ? "forbidden"
                : st === 404
                  ? "missing"
                  : "error",
          );
        });
      return () => {
        live = false;
      };
    }, [id, me.name, me.role, updateApiOrder]),
  );

  if (!d) {
    const local = s.orders.find((o) => o.id === id);
    return (
      <Screen title="Request" backLabel={backLabel}>
        {load === "loading" ? (
          <SkeletonList rows={4} />
        ) : (
          <Banner
            tone="neutral"
            title={
              load === "missing" || load === "forbidden"
                ? "That request isn't available"
                : load === "offline"
                  ? "Connect to see this request"
                  : "Couldn't load this request"
            }
            body={
              load === "missing" || load === "forbidden"
                ? "It may belong to another hotspot."
                : load === "offline"
                  ? local
                    ? `${local.product ?? "Stock request"} for ${local.hotspot}, sent ${ago(local.createdAt)}. Its details load once you're online.`
                    : "Its details load once you're online."
                  : "Try again shortly."
            }
          />
        )}
      </Screen>
    );
  }

  // Only the hotspot's manager can confirm; the API refuses anyone else.
  const you = me.role === "hm";
  const waiting = unacknowledged(d);
  const canConfirm = you && waiting.length > 0 && !pend && confirmed !== "queued";
  const status = toLocalOrder(d, me.name).status;
  const events = [...d.events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return (
    <Screen title="Request" backLabel={backLabel}>
      {load === "offline" ? (
        <Banner tone="neutral" title="Offline" body="Showing this request as last loaded." />
      ) : null}
      {confirmed === "sent" ? (
        <Banner
          tone="success"
          title="Thanks, CLIMS has your count"
          body={
            d.status === "fulfilled"
              ? "The request is closed and the district is notified."
              : "The district is notified and can send what's still missing."
          }
        />
      ) : null}
      {pend || confirmed === "queued" ? (
        <Banner
          tone="warning"
          title="Saved on this phone"
          body="Your count sends when you are back online. You don't need to enter it again."
        />
      ) : null}
      <Hero
        title={stockoutProduct(d)}
        sub={`${d.hot_spot?.name ?? ""} · sent ${ago(Date.parse(d.created_at))}`}
        chip={orderChip(status)}
        steps={stockoutSteps(d, you)}
        msg={stockoutMessage(d, you, waiting.length)}
      />
      {canConfirm ? (
        <AcknowledgeForm
          key={waiting.map((l) => l.id).join()}
          d={d}
          lines={waiting}
          onDone={(next) => {
            if (next) setD(next);
            setConfirmed(next ? "sent" : "queued");
          }}
        />
      ) : null}
      {d.deliveries.map((dl, i) => (
        <List
          key={dl.id}
          h={d.deliveries.length > 1 ? `Delivery ${i + 1}` : "Delivery"}
          f={dl.note ? `Note from the district: ${dl.note}` : undefined}
        >
          {dl.lines.map((l) => (
            <Row
              key={l.id}
              t={l.product}
              s={
                l.acknowledged_pieces == null
                  ? `Sent ${num(l.pieces)} pieces · not confirmed yet`
                  : `Sent ${num(l.pieces)} · received ${num(l.acknowledged_pieces)}`
              }
              ic={l.acknowledged_pieces == null ? "clock" : "check"}
            />
          ))}
          <Row t="Recorded" v={ago(Date.parse(dl.created_at))} />
        </List>
      ))}
      <List h="Request">
        <Row t="Out of" v={CATEGORY_LABEL[d.selection]} />
        <Row t="Raised by" v={d.reported_by === me.name ? "You" : d.reported_by} />
        {d.repeat_count > 0 ? (
          <Row
            t="Reported again"
            v={`${d.repeat_count} ${d.repeat_count === 1 ? "time" : "times"}`}
          />
        ) : null}
        {d.comment ? <Row t="Message" s={d.comment} /> : null}
      </List>
      {events.length ? (
        <List h="History">
          {events.map((e) => (
            <Row
              key={e.id}
              t={EVENT_TEXT[e.action]?.(e) ?? e.action}
              v={ago(Date.parse(e.created_at))}
            />
          ))}
        </List>
      ) : null}
    </Screen>
  );
}
