import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { isAxiosError } from "axios";
import type { ScrollViewInstance } from "react-native";
import * as Location from "expo-location";
import { useT } from "@/lib/theme";
import Screen from "@/components/m/Screen";
import {
  Banner,
  Btn,
  Btns,
  Check,
  Done,
  Fields,
  Hero,
  Input,
  List,
  Note,
  Pick,
  Progress,
  Row,
  Search,
  Seg,
  Select,
  Sheet,
  SkeletonList,
  Stepper,
  Txt,
} from "@/components/m/kit";
import { MapCard } from "@/components/m/media";
import {
  DEMO_PLACES,
  DISPENSER_CONDITIONS,
  draftHotspot,
  HOTSPOT_TYPES,
  isNetworkError,
  LIMITS,
  listDistricts,
  listRegions,
  listSubcounties,
  OTHER_TYPE,
  PHONE_DIGITS,
  submitErrorMessage,
  submitHotspot,
  toLocalHotspot,
  toLocalPhone,
  toSubmission,
  validateMapForm,
  type MapField,
  type MapForm,
  type Place,
} from "@/lib/hotspots";
import { ago, chip, items, orderChip, PRODUCTS, toInt } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { useMe } from "@/lib/session";
import { isClosedOrder } from "@/lib/orders";
import { useStore, type RefreshResult } from "@/lib/store";
import type { Order, Qty } from "@/lib/types";
import { call, firstName, hotspotChip, inactiveNote, matches, shortId, stockStats } from "./common";
import { TYPE } from "@/lib/fonts";

export function useMine() {
  const { s } = useStore();
  const me = useMe();
  // Signed-in VHTs see the hotspots they submitted (from the API); demo sign-ins see samples.
  const mine = me.demo
    ? s.hotspots.filter((h) => h.vhts.includes(me.name) || h.contact === me.name)
    : s.hotspots.filter((h) => h.source === "api");
  const openOf = (hid: string): Order | undefined =>
    s.orders.find((o) => o.hotspotId === hid && !isClosedOrder(o.status));
  return { mine, openOf };
}

/* ───────── Hotspots tab ───────── */

export function VhtHotspots() {
  const T = useT();
  const nav = useNav();
  const me = useMe();
  const { refreshHotspots, loadMoreHotspots } = useStore();
  const { mine, openOf } = useMine();
  const [q, setQ] = useState("");
  const [sync, setSync] = useState<RefreshResult | "loading">("loading");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Reload page one whenever the tab is shown, so DCFP decisions appear.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      refreshHotspots().then((r) => {
        if (!live) return;
        setSync(r.status);
        setHasMore(r.hasMore);
      });
      return () => {
        live = false;
      };
    }, [refreshHotspots]),
  );

  // Fetch the next page near the end of the list; one request at a time.
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || me.demo) return;
    setLoadingMore(true);
    loadMoreHotspots(mine.length)
      .then((r) => {
        setHasMore(r.status === "ok" && r.hasMore);
        if (r.status !== "ok") setSync(r.status);
      })
      .finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, me.demo, loadMoreHotspots, mine.length]);

  const list = mine.filter((h) => matches(q, h.name, h.id, h.village, h.subcounty, h.contact));
  const areas = [...new Set(mine.map((h) => h.subcounty.replace(/ TC$/, "")).filter(Boolean))];
  const count = `${mine.length} hotspot${mine.length === 1 ? "" : "s"}`;
  const foot = me.demo
    ? `${count} in ${areas.join(" and ")}`
    : hasMore
      ? `Showing your ${count} most recently updated. Scroll for more.`
      : `${count} you submitted${areas.length ? ` in ${areas.slice(0, 3).join(", ")}${areas.length > 3 ? "…" : ""}` : ""}`;
  const firstLoad = sync === "loading" && !mine.length;
  return (
    <Screen
      title="Hotspots"
      root
      fab={{ label: "Map hotspot", icon: "plus", onPress: () => nav.go("map") }}
      onEndReached={loadMore}
    >
      {sync === "forbidden" ? (
        <Banner
          tone="warning"
          title="Can't load your hotspots"
          body="Your account can't view hotspots yet. Ask your district focal person to give VHTs hotspot access."
        />
      ) : sync === "offline" && mine.length ? (
        <Banner tone="neutral" title="Offline" body="Showing your hotspots as last loaded." />
      ) : sync === "error" ? (
        <Banner tone="warning" title="Couldn't refresh your hotspots" body="Try again shortly." />
      ) : null}
      {mine.length ? <Search value={q} onChangeText={setQ} ph="Search hotspots" /> : null}
      {firstLoad ? <SkeletonList rows={6} /> : null}
      <List
        empty={
          firstLoad
            ? undefined
            : q
              ? hasMore
                ? `No loaded hotspots match “${q}”. Scroll to the end to load more, then search again.`
                : `No hotspots match “${q}”.`
              : sync === "offline"
                ? "Connect to the internet to load your hotspots."
                : "You haven't mapped any hotspots yet. Tap Map hotspot to add one."
        }
        f={q || !mine.length ? "" : foot}
      >
        {list.map((h) => {
          const o = openOf(h.id);
          const out = h.stock.male === 0 || h.stock.female === 0;
          const left = items(h.stock);
          const api = h.source === "api";
          return (
            <Row
              key={h.id}
              t={h.name}
              s={
                api
                  ? [h.village, h.subcounty].filter(Boolean).join(", ") || h.type
                  : `${h.village} · ${left === "—" ? "out of stock" : `${left} left`}`
              }
              ic="pin"
              icBg={h.status !== "Active" ? T.inactiveIcBg : out && !api ? T.dangerIcBg : undefined}
              icFg={out && !api && h.status === "Active" ? T.dangerIcFg : undefined}
              chip={
                o && h.status === "Active"
                  ? orderChip(o.status)
                  : api || h.status !== "Active"
                    ? hotspotChip(h)
                    : null
              }
              chev
              onPress={() => nav.go(`hotspot/${h.id}`)}
            />
          );
        })}
      </List>
      {loadingMore ? (
        <SkeletonList rows={2} />
      ) : hasMore && !q ? (
        <Btns>
          <Btn label="Load more hotspots" kind="secondary" onPress={loadMore} />
        </Btns>
      ) : null}
    </Screen>
  );
}

export function VhtHotspot({ id }: { id: string }) {
  const T = useT();
  const nav = useNav();
  const me = useMe();
  const { s } = useStore();
  const { mine, openOf } = useMine();
  // Only the hotspot asked for: a notification can name one this phone hasn't loaded.
  const h = s.hotspots.find((x) => x.id === id);
  if (!h)
    return (
      <Screen title="Hotspot" backLabel="Hotspots">
        <Banner tone="neutral" title="That hotspot isn't available" />
      </Screen>
    );
  const o = openOf(h.id);
  const active = h.status === "Active";
  const ords = s.orders
    .filter((x) => x.hotspotId === h.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Screen title={h.name} backLabel="Hotspots">
      {h.lat != null ? (
        <MapCard
          lat={h.lat}
          lng={h.lng}
          cap={`${h.village}, ${h.subcounty}`}
          cap2={`GPS ${h.lat.toFixed(5)}, ${h.lng!.toFixed(5)}`}
          link={T.ios ? "Open in Maps" : "Directions"}
        />
      ) : null}
      <Hero
        title={h.name}
        sub={[shortId(h.id), h.type, h.subcounty].filter(Boolean).join(" · ")}
        chip={hotspotChip(h)}
        // The API has no stock figures yet; sample hotspots show the phone's copy.
        stats={h.source === "api" ? undefined : stockStats(T, h)}
        msg={`Last delivery ${h.lastDelivery != null ? ago(h.lastDelivery) : "none yet"}`}
      >
        {active ? (
          <Btn label="Request stock" icon="megaphone" onPress={() => nav.go(`request/${h.id}`)} />
        ) : null}
        {h.contact !== me.name ? (
          <Btn
            label={`Call ${firstName(h.contact)}`}
            icon="phone"
            kind="secondary"
            onPress={() => call(h.phone)}
          />
        ) : null}
      </Hero>
      {o ? (
        <Banner
          tone="info"
          title="Open order"
          body={`${orderChip(o.status).label} · ${items(o.approved)} · raised ${ago(o.createdAt)}`}
          act={{ label: "View order", onPress: () => nav.go(`order/${o.id}`) }}
        />
      ) : null}
      {!active ? <Banner tone="neutral" {...inactiveNote(h)} /> : null}
      <List h="Contact person">
        <Row
          t={h.contact}
          s={h.phone}
          ic="phone"
          v={h.contact === me.name ? "You" : ""}
          onPress={() => call(h.phone)}
        />
      </List>
      <List h="Details" f={h.comment}>
        <Row t="Type" v={h.type || "—"} />
        <Row t="Dispenser" v={h.dispenser ? h.dispCond || "Yes" : "None"} />
        <Row t="VHTs" v={h.vhts.map((n) => (n === me.name ? "You" : n)).join(", ") || "—"} />
        <Row t="Mapped" v={h.mappedAt != null ? ago(h.mappedAt) : "—"} />
      </List>
      <List h="Past orders" empty="No orders yet.">
        {ords.map((x) => (
          <Row
            key={x.id}
            t={items(x.items)}
            s={`Sent ${ago(x.createdAt)}`}
            chip={orderChip(x.status)}
            chev
            onPress={() => nav.go(`order/${x.id}`)}
          />
        ))}
      </List>
    </Screen>
  );
}

/* ───────── Requests tab ───────── */

export function VhtRequests() {
  const nav = useNav();
  const me = useMe();
  const { s } = useStore();
  const { mine } = useMine();
  const ids = mine.map((h) => h.id);
  // Signed-in VHTs see the stockout alerts they sent to the API; demo sign-ins see sample orders.
  const rows = s.orders
    .filter((o) => (me.demo ? ids.includes(o.hotspotId) : o.source === "api"))
    .sort((a, b) => b.createdAt - a.createdAt);
  const q0 = s.outbox.filter((it) =>
    me.demo ? it.type === "notify" && ids.includes(it.payload.hotspotId) : it.type === "stockout",
  );
  return (
    <Screen
      title="Requests"
      root
      fab={{ label: "New request", icon: "plus", onPress: () => nav.go("request") }}
    >
      {q0.length ? (
        <List h="Waiting to send">
          {q0.map((it) => (
            <Row
              key={it.id}
              t={
                it.type === "stockout"
                  ? it.payload.hotspot
                  : (s.hotspots.find((h) => h.id === it.payload.hotspotId)?.name ??
                    it.payload.hotspotId)
              }
              s={`${it.type === "stockout" ? it.payload.product : items(it.payload.items)} · saved ${ago(it.at)}`}
              chip={chip("Offline", "warning")}
              ic="upload"
            />
          ))}
        </List>
      ) : null}
      <List h={q0.length ? "Sent" : undefined} empty="No stock requests yet.">
        {rows.map((o) => (
          <Row
            key={o.id}
            t={o.hotspot}
            s={
              o.source === "api"
                ? `${o.product ?? "Condoms"} · sent ${ago(o.createdAt)}`
                : `${items(o.items)} · ${ago(o.createdAt)}`
            }
            chip={orderChip(o.status)}
            chev
            // A request sent to the API opens its notification: what was sent and what arrived.
            onPress={() => nav.go(o.source === "api" ? `stockout/${o.id}` : `order/${o.id}`)}
          />
        ))}
      </List>
    </Screen>
  );
}

/* ───────── Stock request (VHT on behalf of a hotspot, or the hotspot manager) ───────── */

export function RequestForm({ hotspotId, fixed }: { hotspotId?: string; fixed?: boolean }) {
  const nav = useNav();
  const me = useMe();
  const { s, send } = useStore();
  const { mine, openOf } = useMine();
  const isHm = me.role === "hm";
  const active = fixed
    ? s.hotspots.filter((h) => h.id === hotspotId)
    : mine.filter((h) => h.status === "Active");
  const [selId, setSel] = useState<string | undefined>(
    hotspotId && active.some((h) => h.id === hotspotId) ? hotspotId : active[0]?.id,
  );
  const sel = active.find((h) => h.id === selId);
  const [reason, setReason] = useState<"Out of stock" | "Running low">("Out of stock");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [pick, setPick] = useState(false);
  const [pq, setPq] = useState("");

  const left = {} as Qty;
  const need = {} as Qty;
  const val = (k: string, def: string) => vals[`${selId}:${k}`] ?? def;
  const set = (k: string) => (v: string) => setVals((x) => ({ ...x, [`${selId}:${k}`]: v }));
  PRODUCTS.forEach((p) => {
    left[p.k] = toInt(val(`l_${p.k}`, String(sel?.stock[p.k] ?? 0)));
    need[p.k] = toInt(
      val(`n_${p.k}`, p.k === "male" ? (isHm ? "2000" : "1000") : isHm ? "100" : "50"),
    );
  });
  const open = selId ? openOf(selId) : undefined;

  const submit = () => {
    if (!sel) return;
    const r = send(
      "notify",
      {
        hotspotId: sel.id,
        items: need,
        remaining: left,
        reason,
        note: isHm ? note.trim() : `Raised by VHT on behalf of ${sel.contact}`,
        byRole: isHm ? "Hotspot manager" : "VHT",
      },
      isHm ? "Stockout notification" : `Stock request · ${sel.name}`,
    );
    if (isHm) {
      if (!r.queued && r.id) nav.replace(`order/${r.id}`);
      else {
        nav.back();
        nav.toTab("orders");
      }
    } else {
      nav.back();
      if (nav.tab !== "requests") nav.toTab("requests");
    }
  };

  return (
    <Screen title={isHm ? "Report stockout" : "Request stock"} backLabel={isHm ? "Home" : "Back"}>
      {!fixed ? (
        <Fields h="Hotspot">
          <Pick
            label="Hotspot"
            value={sel?.name ?? "Choose a hotspot"}
            sub={sel ? `${sel.contact} · ${sel.village}, ${sel.subcounty}` : ""}
            onPress={() => setPick(true)}
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
        </Fields>
      ) : (
        <Fields
          f={
            reason === "Out of stock"
              ? "Nothing left in the dispenser or store."
              : "You will run out within a few days."
          }
        >
          <Seg
            label="What's happening?"
            options={[
              ["Out of stock", "Out of stock"],
              ["Running low", "Running low"],
            ]}
            value={reason}
            onChange={setReason}
          />
        </Fields>
      )}
      {open ? (
        <Banner
          tone="info"
          title={isHm ? "You already have an open order" : `${sel?.name} already has an open order`}
          body={`It is ${orderChip(open.status).label.toLowerCase()}.${isHm ? "" : " Only send another if more stock is needed."}`}
          act={
            isHm ? { label: "View order", onPress: () => nav.go(`order/${open.id}`) } : undefined
          }
        />
      ) : null}
      <Fields
        h={isHm ? "Left now" : "Left at the hotspot"}
        f={isHm ? undefined : "Count with the contact person if you are at the hotspot."}
      >
        {PRODUCTS.map((p) => (
          <Stepper
            key={p.k}
            label={`${p.short} condoms`}
            sub={p.brand}
            value={val(`l_${p.k}`, String(sel?.stock[p.k] ?? 0))}
            onChange={set(`l_${p.k}`)}
            step={p.k === "male" ? 50 : 10}
          />
        ))}
      </Fields>
      <Fields h="Quantity needed">
        {PRODUCTS.map((p) => (
          <Stepper
            key={p.k}
            label={`${p.short} condoms`}
            sub="Pieces"
            value={String(need[p.k])}
            onChange={set(`n_${p.k}`)}
            step={p.k === "male" ? 100 : 10}
          />
        ))}
      </Fields>
      {isHm ? (
        <Fields>
          <Input
            label="Note for the district (optional)"
            value={note}
            onChangeText={setNote}
            ph="e.g. Busy weekend coming"
            multiline
          />
        </Fields>
      ) : null}
      <Btns>
        <Btn
          label={isHm ? "Send to Wakiso district" : "Send stockout notification"}
          onPress={submit}
          dis={!sel || need.male + need.female === 0}
        />
      </Btns>
      <Note
        center
        text={
          isHm
            ? "The district reviews your notification and assigns a rider. You get a notification at each step."
            : `${sel?.contact ?? "The contact person"} is notified too and confirms receipt when the rider arrives.`
        }
      />
      {!fixed ? (
        <Sheet
          visible={pick}
          title="Choose hotspot"
          onClose={() => setPick(false)}
          header={<Search value={pq} onChangeText={setPq} ph="Search name, village or contact" />}
        >
          <List empty={`No hotspots match “${pq}”.`}>
            {active
              .filter((h) => matches(pq, h.name, h.id, h.village, h.subcounty, h.contact))
              .map((h) => (
                <Row
                  key={h.id}
                  t={h.name}
                  s={`${h.contact} · ${h.village}, ${h.subcounty}`}
                  ic={h.id === selId ? "check" : "pin"}
                  fw={h.id === selId ? "600" : "400"}
                  onPress={() => {
                    setSel(h.id);
                    setPq("");
                    setPick(false);
                  }}
                />
              ))}
          </List>
        </Sheet>
      ) : null}
    </Screen>
  );
}

/* ───────── Map a hotspot (4 steps) ───────── */

const STEPS = ["Location", "Details", "Contact person", "Review"];

/** Which form fields each step owns, so Continue checks only that step. */
const STEP_FIELDS: MapField[][] = [
  ["gps", "regionId", "districtId", "subcountyId", "village"],
  ["name", "type", "otherType", "dispenser", "condition", "comment"],
  ["contactName", "contactPhone"],
  [],
];

export function VhtMapDone({ id }: { id: string }) {
  const nav = useNav();
  const me = useMe();
  const { s } = useStore();
  if (id === "queued")
    return (
      <Screen title="Hotspot saved" backLabel="Hotspots">
        <Done
          tone="info"
          icon="wifiOff"
          title="Saved on this phone"
          body="It goes to the district for review as soon as you are back online. You don't need to map it again."
        />
        <Btns>
          <Btn label="Map another hotspot" kind="secondary" onPress={() => nav.replace("map")} />
          <Btn label="Back to hotspots" kind="text" onPress={nav.back} />
        </Btns>
      </Screen>
    );
  const h = s.hotspots.find((x) => x.id === id);
  if (!h)
    return (
      <Screen title="Hotspot submitted" backLabel="Hotspots">
        <Banner tone="neutral" title="That hotspot isn't available" />
      </Screen>
    );
  return (
    <Screen title="Hotspot submitted" backLabel="Hotspots">
      <Done
        title={`${h.name} sent for review`}
        body={`The ${h.district || "district"} focal person checks new hotspots before they can get stock. ${h.contact === me.name ? "You are its contact person." : `${h.contact} is its contact person.`}`}
      />
      <Btns>
        <Btn label="View hotspot" onPress={() => nav.replace(`hotspot/${h.id}`)} />
        <Btn label="Map another hotspot" kind="secondary" onPress={() => nav.replace("map")} />
        <Btn label="Back to hotspots" kind="text" onPress={nav.back} />
      </Btns>
    </Screen>
  );
}

/** The only choice in a list, if there is exactly one: most VHTs work in one region and district. */
const onlyId = (list: Place[] | null) => (list?.length === 1 ? list[0].id : "");

/**
 * Region, district and sub-county lists for the form, from the API (or demo samples). Region and
 * district fall back to the only choice when the VHT hasn't picked one; they can still change it.
 */
function usePlaces(demo: boolean, pickedRegion: string, pickedDistrict: string) {
  // Loaded lists keyed by what they belong to, so changing a parent needs no reset.
  const [lists, setLists] = useState<Record<string, Place[]>>({});
  const [err, setErr] = useState("");
  const get = (key: string): Place[] | null =>
    demo
      ? key === "regions"
        ? DEMO_PLACES.regions
        : key.startsWith("d:")
          ? (DEMO_PLACES.districts[key.slice(2)] ?? [])
          : (DEMO_PLACES.subcounties[key.slice(2)] ?? [])
      : (lists[key] ?? null);

  const regions = get("regions");
  const regionId = pickedRegion || onlyId(regions);
  const districts = regionId ? get(`d:${regionId}`) : null;
  const districtId = pickedDistrict || onlyId(districts);
  const subcounties = districtId ? get(`s:${districtId}`) : null;

  useEffect(() => {
    if (demo) return;
    const wanted: [string, () => Promise<Place[]>][] = [["regions", listRegions]];
    if (regionId) wanted.push([`d:${regionId}`, () => listDistricts(regionId)]);
    if (districtId) wanted.push([`s:${districtId}`, () => listSubcounties(districtId)]);
    let live = true;
    for (const [key, load] of wanted)
      load()
        .then((list) => live && setLists((x) => (x[key] ? x : { ...x, [key]: list })))
        .catch(
          (e: unknown) =>
            live &&
            setErr(
              isAxiosError(e) && e.response?.status === 403
                ? "Your account can't map hotspots yet. Ask your district focal person to give VHTs hotspot access."
                : "Couldn't load the place lists. Connect to the internet once, then try again.",
            ),
        );
    return () => {
      live = false;
    };
  }, [demo, regionId, districtId]);

  return { regions, districts, subcounties, regionId, districtId, err: demo ? "" : err };
}

const opts = (list: Place[] | null) => (list ?? []).map((p) => ({ v: p.id, l: p.name }));
const nameIn = (list: Place[] | null, id: string) => list?.find((p) => p.id === id)?.name ?? "";

export function VhtMap() {
  const T = useT();
  const nav = useNav();
  const me = useMe();
  const { send, queue, offline } = useStore();
  const scroll = useRef<ScrollViewInstance>(null);
  const [step, setStep] = useState(0);
  const [gpsAcc, setGpsAcc] = useState<number | null>(null);
  const [gpsWait, setGpsWait] = useState(false);
  const [gpsErr, setGpsErr] = useState("");
  const [f, setF] = useState<MapForm>({
    regionId: "",
    districtId: "",
    subcountyId: "",
    village: "",
    lat: null,
    lng: null,
    name: "",
    type: "",
    otherType: "",
    dispenser: "",
    condition: "",
    comment: "",
    contactName: "",
    contactPhone: "",
  });
  const [who, setWho] = useState<"other" | "me">("other");
  const [visited, setVisited] = useState(false);
  const [shown, setShown] = useState<boolean[]>([false, false, false, false]);
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const up =
    <K extends keyof MapForm>(k: K) =>
    (v: MapForm[K]) =>
      setF((x) => ({ ...x, [k]: v }));

  const places = usePlaces(!!me.demo, f.regionId, f.districtId);
  const form: MapForm = { ...f, regionId: places.regionId, districtId: places.districtId };

  const errs = validateMapForm(form);
  const errOf = (k: MapField) => (shown[step] ? errs[k] : undefined) ?? "";
  const stepOk = (n: number) => (n === 3 ? visited : STEP_FIELDS[n].every((k) => !errs[k]));

  const capture = async () => {
    setGpsErr("");
    setGpsWait(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setGpsErr("Allow location access in Settings to capture the hotspot's GPS.");
        return;
      }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setF((x) => ({ ...x, lat: p.coords.latitude, lng: p.coords.longitude }));
      setGpsAcc(Math.round(p.coords.accuracy ?? 0));
    } catch {
      setGpsErr("Couldn't get a GPS fix. Move into the open and try again.");
    } finally {
      setGpsWait(false);
    }
  };

  const chooseWho = (w: "other" | "me") => {
    setWho(w);
    setF((x) =>
      w === "me"
        ? { ...x, contactName: me.name, contactPhone: toLocalPhone(me.phone) }
        : { ...x, contactName: "", contactPhone: "" },
    );
  };

  const goTo = (n: number) => {
    setStep(n);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const submit = async () => {
    const body = toSubmission(form);
    const label = `Map hotspot · ${body.name}`;
    setSendErr("");
    if (me.demo) {
      const names = {
        region: nameIn(places.regions, form.regionId),
        district: nameIn(places.districts, form.districtId),
        subcounty: nameIn(places.subcounties, form.subcountyId),
      };
      const r = send("mapHotspot", { hotspot: draftHotspot(body, names, me.name) }, label);
      nav.replace(r.queued || !r.id ? "map/queued" : `map/${r.id}`);
      return;
    }
    if (offline) {
      queue("mapHotspot", { request: body }, label);
      nav.replace("map/queued");
      return;
    }
    setBusy(true);
    try {
      const res = await submitHotspot(body);
      const r = send("mapHotspot", { hotspot: toLocalHotspot(res, me.name, body.comment) }, label);
      nav.replace(`map/${r.id ?? res.id}`);
    } catch (e) {
      if (isNetworkError(e)) {
        queue("mapHotspot", { request: body }, label);
        nav.replace("map/queued");
        return;
      }
      setSendErr(submitErrorMessage(e));
      const st = isAxiosError(e) ? e.response?.status : undefined;
      if (st === 409) goTo(1);
      else if (st === 422) goTo(0);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (!stepOk(step)) {
      setShown((x) => x.map((v, i) => (i === step ? true : v)));
      return;
    }
    if (step < 3) goTo(step + 1);
    else submit();
  };

  const typeLabel = f.type === OTHER_TYPE ? f.otherType.trim() : f.type;
  const dispLabel =
    f.dispenser === "yes" ? `Yes, ${f.condition.toLowerCase()}` : f.dispenser === "no" ? "No" : "";

  return (
    <Screen title="Map a hotspot" backLabel="Hotspots" scrollRef={scroll}>
      <Progress count={4} step={step} label={`Step ${step + 1} of 4 · ${STEPS[step]}`} />
      {sendErr ? <Banner tone="danger" title="Couldn't submit the hotspot" body={sendErr} /> : null}
      {step === 0 ? (
        <>
          {gpsWait ? (
            <MapCard h="Where is the hotspot?" cap="Capturing GPS…" wait />
          ) : f.lat != null && f.lng != null ? (
            <MapCard
              h="Where is the hotspot?"
              lat={f.lat}
              lng={f.lng}
              cap="Location captured"
              cap2={`${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}${gpsAcc != null ? ` · accuracy ±${gpsAcc} m` : ""}`}
              act={{ label: "Capture again", onPress: capture }}
            />
          ) : (
            <>
              <Banner
                h="Where is the hotspot?"
                tone={gpsErr || errOf("gps") ? "warning" : "info"}
                title={gpsErr || errOf("gps") ? "No location yet" : "Stand at the hotspot entrance"}
                body={gpsErr || "Then capture the GPS location. It works without network."}
              />
              <Btns>
                <Btn label="Capture GPS location" icon="gps" kind="secondary" onPress={capture} />
              </Btns>
            </>
          )}
          {places.err ? <Banner tone="warning" title="No place lists" body={places.err} /> : null}
          <Fields h="Address">
            <Select
              label="Region"
              value={form.regionId}
              options={opts(places.regions)}
              loading={places.regions === null && !places.err}
              onChange={(v) =>
                setF((x) => ({ ...x, regionId: v, districtId: "", subcountyId: "" }))
              }
              err={errOf("regionId")}
            />
            <Select
              label="District"
              value={form.districtId}
              options={opts(places.districts)}
              loading={!!form.regionId && places.districts === null && !places.err}
              onChange={(v) =>
                setF((x) => ({ ...x, regionId: form.regionId, districtId: v, subcountyId: "" }))
              }
              err={errOf("districtId")}
            />
            <Select
              label="Sub-county"
              value={f.subcountyId}
              options={opts(places.subcounties)}
              loading={!!form.districtId && places.subcounties === null && !places.err}
              onChange={up("subcountyId")}
              err={errOf("subcountyId")}
            />
            <Input
              label="Village (optional)"
              max={LIMITS.village}
              value={f.village}
              onChangeText={up("village")}
              ph="e.g. Kigungu"
              autoCapitalize="words"
              err={errOf("village")}
            />
          </Fields>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <Fields h="About the hotspot">
            <Input
              label="Hotspot name"
              max={LIMITS.name}
              value={f.name}
              onChangeText={up("name")}
              ph="Name people in the area use"
              autoCapitalize="words"
              err={errOf("name")}
            />
            <Select
              label="Type"
              value={f.type}
              options={[...HOTSPOT_TYPES, OTHER_TYPE].map((t) => ({ v: t, l: t }))}
              onChange={up("type")}
              err={errOf("type")}
            />
            {f.type === OTHER_TYPE ? (
              <Input
                label="What kind of place?"
                max={LIMITS.type}
                value={f.otherType}
                onChangeText={up("otherType")}
                ph="e.g. Hair salon"
                autoCapitalize="sentences"
                err={errOf("otherType")}
              />
            ) : null}
          </Fields>
          <Fields h="Condom dispenser">
            <Seg
              label="Is there a condom dispenser?"
              options={[
                ["yes", "Yes"],
                ["no", "No"],
              ]}
              value={f.dispenser}
              onChange={(v) => setF((x) => ({ ...x, dispenser: v, condition: "" }))}
            />
            {f.dispenser === "yes" ? (
              <Seg
                label="Condition"
                options={DISPENSER_CONDITIONS.map((c) => [c, c] as [string, string])}
                value={f.condition}
                onChange={up("condition")}
              />
            ) : null}
          </Fields>
          {errOf("dispenser") || errOf("condition") ? (
            <Txt
              accessibilityRole="alert"
              style={{
                marginHorizontal: 32,
                marginTop: -12,
                marginBottom: 16,
                ...TYPE.footnote,
                color: T.danger,
              }}
            >
              {errOf("dispenser") || errOf("condition")}
            </Txt>
          ) : null}
          <Fields f="Sent to the district focal person with the hotspot.">
            <Input
              label="Comment (optional)"
              max={LIMITS.comment}
              value={f.comment}
              onChangeText={up("comment")}
              ph="e.g. Busy on weekends"
              multiline
              err={errOf("comment")}
            />
          </Fields>
        </>
      ) : null}
      {step === 2 ? (
        <Fields
          h="Contact person"
          f="The hotspot manager on site. They receive deliveries and report stockouts."
        >
          <Seg
            label="Who manages the hotspot?"
            options={[
              ["other", "Someone there"],
              ["me", "Me"],
            ]}
            value={who}
            onChange={chooseWho}
          />
          <Input
            label="Full name"
            max={LIMITS.contact}
            value={f.contactName}
            onChangeText={up("contactName")}
            ph="e.g. Sarah Nakirya"
            autoCapitalize="words"
            err={errOf("contactName")}
          />
          <Input
            label="Phone number"
            value={f.contactPhone}
            onChangeText={(v) => up("contactPhone")(toLocalPhone(v))}
            keyboardType="number-pad"
            max={PHONE_DIGITS}
            ph="e.g. 0708832767"
            err={
              errOf("contactPhone") ||
              (f.contactPhone.trim() && errs.contactPhone ? errs.contactPhone : "")
            }
          />
        </Fields>
      ) : null}
      {step === 3 ? (
        <>
          <List h="Review">
            <Row t="Name" v={f.name.trim()} />
            <Row t="Type" v={typeLabel} />
            <Row
              t="Location"
              v={[
                f.village.trim(),
                nameIn(places.subcounties, f.subcountyId),
                nameIn(places.districts, form.districtId),
              ]
                .filter(Boolean)
                .join(", ")}
            />
            <Row
              t="GPS"
              v={f.lat != null && f.lng != null ? `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}` : "—"}
            />
            <Row t="Dispenser" v={dispLabel} />
            <Row
              t="Contact"
              v={`${who === "me" ? "You" : f.contactName.trim()} · ${f.contactPhone.trim()}`}
            />
          </List>
          <Fields
            f={
              offline
                ? "You're offline. It's saved on this phone and sent when you're back online."
                : "The district focal person reviews it before it can get stock."
            }
          >
            <Check
              label="I visited this hotspot and the details are correct"
              value={visited}
              onChange={setVisited}
            />
          </Fields>
        </>
      ) : null}
      <Btns>
        <Btn
          label={step === 3 ? (busy ? "Submitting…" : "Submit for review") : "Continue"}
          onPress={next}
          dis={busy || (step === 3 && !visited)}
        />
        {step > 0 ? (
          <Btn label="Back" kind="text" onPress={() => goTo(step - 1)} dis={busy} />
        ) : null}
      </Btns>
    </Screen>
  );
}
