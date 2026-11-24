import React, { useCallback, useEffect, useRef, useState } from "react";
import Screen from "@/components/m/Screen";
import {
  Banner,
  Btn,
  Btns,
  Done,
  Fields,
  Input,
  List,
  Note,
  Pick,
  Row,
  Search,
  Seg,
  Sheet,
  SkeletonList,
} from "@/components/m/kit";
import { isNetworkError, listHotspotsPage, toLocalHotspot } from "@/lib/hotspots";
import { useNav } from "@/lib/nav";
import {
  CATEGORY_LABEL,
  STOCKOUT_MESSAGE_MAX_BYTES,
  reportStockout,
  stockoutComment,
  stockoutErrorMessage,
  stockoutMessageFits,
  toLocalOrder,
  type Category,
} from "@/lib/orders";
import { useMe } from "@/lib/session";
import { useStore } from "@/lib/store";
import type { Hotspot } from "@/lib/types";
import { matches } from "./common";

type Reason = "Out of stock" | "Running low";

/**
 * A signed-in VHT's or hotspot manager's stock request: a stockout notification for a hotspot naming
 * Male, Female or Both (POST /orders/stockouts). The district's DCFP decides what and how much to send.
 */
export function StockoutForm({
  hotspotId,
  fixed,
}: {
  hotspotId?: string;
  /** A hotspot manager's own hotspot: no picker, and no hotspot list to load. */
  fixed?: Pick<Hotspot, "id" | "name"> &
    Partial<Pick<Hotspot, "village" | "subcounty" | "district">>;
}) {
  const nav = useNav();
  const me = useMe();
  const { s, send, queue, offline } = useStore();

  // Hotspots: the API's active list, a page at a time, falling back to what the phone already has.
  const cached = s.hotspots.filter((h) => h.source === "api" && h.status === "Active");
  const [hotspots, setHotspots] = useState<Hotspot[]>(cached);
  const [hasMore, setHasMore] = useState(false);
  const [loadingHotspots, setLoadingHotspots] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(
    async (offset: number) => {
      const page = await listHotspotsPage({ offset, status: "active" });
      const items = page.items.map((h) => toLocalHotspot(h, me.name, null));
      setHotspots((prev) => {
        const seen = new Set(prev.map((h) => h.id));
        return [...prev, ...items.filter((h) => !seen.has(h.id))];
      });
      setHasMore(page.hasMore);
      return { received: page.items.length, hasMore: page.hasMore };
    },
    [me.name],
  );

  // A search covers every hotspot, not only the pages shown so far: typing loads the remaining
  // pages, one after another, until there are no more or the search is cleared.
  const searching = useRef(false);
  const searchAll = () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    (async () => {
      let offset = hotspots.length;
      for (;;) {
        const page = await loadPage(offset);
        offset += page.received;
        if (!page.hasMore || !searching.current) break;
      }
    })()
      .catch(() => setHasMore(false))
      .finally(() => setLoadingMore(false));
  };

  const loadMore = () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    loadPage(hotspots.length)
      .catch(() => setHasMore(false))
      .finally(() => setLoadingMore(false));
  };

  useEffect(() => {
    let live = true;
    (fixed
      ? Promise.resolve({ items: [], hasMore: false })
      : listHotspotsPage({ offset: 0, status: "active" })
    )
      .then((page) => {
        if (fixed) return;
        if (!live) return;
        setHotspots(page.items.map((h) => toLocalHotspot(h, me.name, null)));
        setHasMore(page.hasMore);
      })
      .catch(() => {
        // Offline or refused: keep the phone's copy.
      })
      .finally(() => live && setLoadingHotspots(false));
    return () => {
      live = false;
    };
    // `fixed` is the signed-in manager's own hotspot and doesn't change while the form is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.name]);

  const [selId, setSel] = useState<string | undefined>(hotspotId);
  // Opened from a hotspot's page, it may not be in the pages loaded so far.
  const sel = hotspots.find((h) => h.id === selId) ?? s.hotspots.find((h) => h.id === selId);
  const [category, setCategory] = useState<Category | null>(null);
  const [reason, setReason] = useState<Reason>("Out of stock");
  const [comment, setComment] = useState("");
  const [pick, setPick] = useState(false);
  const [pq, setPq] = useState("");

  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");
  const [done, setDone] = useState<"sent" | "repeated" | "queued" | null>(null);

  // Pick the only choices for the VHT.
  const hotspot:
    Pick<Hotspot, "id" | "name" | "village" | "subcounty" | "district" | "contact"> | undefined =
    fixed
      ? { village: "", subcounty: "", district: "", ...fixed, contact: me.name }
      : (sel ?? (hotspots.length === 1 ? hotspots[0] : undefined));
  const message = stockoutComment(reason, comment);
  const tooLong = !stockoutMessageFits(message);
  const ready = !!hotspot && !!category && !tooLong && !busy;
  const what = category ? CATEGORY_LABEL[category].toLowerCase() : "condoms";

  const submit = async () => {
    if (!hotspot || !category || tooLong || busy) return;
    setRefused("");
    const request = {
      hot_spot_id: hotspot.id,
      condom_category: category,
      message,
    };
    const names = { hotspot: hotspot.name, product: CATEGORY_LABEL[category] };
    const label = `Stock request · ${hotspot.name}`;
    if (offline) {
      queue("stockout", { request, ...names }, label);
      setDone("queued");
      return;
    }
    setBusy(true);
    try {
      const { report, repeated } = await reportStockout(request);
      const byRole = fixed ? "Hotspot manager" : "VHT";
      send("stockout", { order: toLocalOrder(report, me.name, byRole) }, label);
      setDone(repeated ? "repeated" : "sent");
    } catch (e) {
      if (isNetworkError(e)) {
        queue("stockout", { request, ...names }, label);
        setDone("queued");
      } else {
        setRefused(stockoutErrorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Screen title="Request stock" backLabel="Back">
        {done === "sent" ? (
          <Done
            title="Stock request sent"
            body={`${hotspot?.district || "The district"} focal person is notified that ${hotspot?.name} needs ${what} and decides how much to send.`}
          />
        ) : done === "repeated" ? (
          <Done
            title="Added to the open request"
            body={`${hotspot?.name} already has a request the district hasn't fulfilled yet. Your message was added to it, so the focal person sees it's still needed.`}
          />
        ) : (
          <Done
            tone="info"
            icon="wifiOff"
            title="Saved on this phone"
            body="It goes to the district as soon as you are back online. You don't need to send it again."
          />
        )}
        <Btns>
          <Btn
            label="View requests"
            onPress={() => {
              nav.back();
              if (nav.tab !== "requests") nav.toTab("requests");
            }}
          />
          <Btn label="Back" kind="text" onPress={nav.back} />
        </Btns>
      </Screen>
    );

  return (
    <Screen title="Request stock" backLabel="Back">
      {refused ? <Banner tone="danger" title="Couldn't send" body={refused} /> : null}
      {fixed ? null : (
        <Fields h="Hotspot">
          <Pick
            label="Hotspot"
            value={
              hotspot?.name ??
              (hotspots.length
                ? "Choose a hotspot"
                : loadingHotspots
                  ? "Loading hotspots…"
                  : "No active hotspots")
            }
            sub={hotspot ? [hotspot.village, hotspot.subcounty].filter(Boolean).join(", ") : ""}
            onPress={() => setPick(true)}
          />
        </Fields>
      )}
      {!fixed && !hotspots.length && !loadingHotspots ? (
        <Note text="Only active hotspots can get stock. New hotspots become active when the district focal person approves them." />
      ) : null}
      <Fields h="What's needed" f="The district focal person decides how much to send.">
        <Seg
          label="Out of"
          options={[
            ["male", "Male"],
            ["female", "Female"],
            ["both", "Both"],
          ]}
          value={category ?? undefined}
          onChange={setCategory}
        />
        <Seg
          label="What's happening?"
          options={[
            ["Out of stock", "Out of stock"],
            ["Running low", "Running low"],
          ]}
          value={reason}
          onChange={setReason}
        />
        <Input
          label="Comment (optional)"
          max={STOCKOUT_MESSAGE_MAX_BYTES}
          value={comment}
          onChangeText={setComment}
          ph="e.g. Busy weekend coming"
          multiline
          err={tooLong ? "Shorten your comment so the stock request can be sent." : ""}
        />
      </Fields>
      <Btns>
        <Btn
          label={busy ? "Sending…" : offline ? "Save and send when online" : "Send stock request"}
          onPress={submit}
          dis={!ready}
        />
      </Btns>
      <Note
        center
        text={
          fixed
            ? "The district focal person is notified and decides how much to send."
            : hotspot?.contact
              ? `${hotspot.contact} confirms receipt when the rider arrives.`
              : "The hotspot manager confirms receipt when the rider arrives."
        }
      />
      <Sheet
        visible={pick}
        title="Choose hotspot"
        onClose={() => {
          searching.current = false;
          setPick(false);
        }}
        header={
          <Search
            value={pq}
            onChangeText={(v) => {
              setPq(v);
              searching.current = !!v.trim();
              if (searching.current) searchAll();
            }}
            ph="Search name, village or contact"
          />
        }
      >
        {loadingHotspots && !hotspots.length ? <SkeletonList rows={5} /> : null}
        <List
          empty={
            loadingHotspots && !hotspots.length
              ? undefined
              : hotspots.length
                ? hasMore || loadingMore
                  ? `Searching all hotspots for “${pq}”…`
                  : `No hotspots match “${pq}”.`
                : "No active hotspots yet."
          }
        >
          {hotspots
            .filter((h) => matches(pq, h.name, h.village, h.subcounty, h.contact))
            .map((h) => (
              <Row
                key={h.id}
                t={h.name}
                s={[h.village, h.subcounty].filter(Boolean).join(", ")}
                ic={h.id === hotspot?.id ? "check" : "pin"}
                fw={h.id === hotspot?.id ? "600" : "400"}
                onPress={() => {
                  setSel(h.id);
                  setRefused("");
                  searching.current = false;
                  setPq("");
                  setPick(false);
                }}
              />
            ))}
        </List>
        {loadingMore ? (
          <SkeletonList rows={2} />
        ) : hasMore ? (
          <Btns>
            <Btn label="Show more hotspots" kind="secondary" onPress={loadMore} />
          </Btns>
        ) : null}
      </Sheet>
    </Screen>
  );
}
