import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAxiosError } from "axios";
import { api } from "./api";
import type { Hotspot } from "./types";

/**
 * Hotspot submission against the Go API (docs/api/openapi.json, `HotspotSubmissionRequest`,
 * and docs/modules/hotspots.md). A VHT submits; the hotspot starts inactive with review status
 * `submitted` until the district's DCFP activates or rejects it.
 */

/** `HotspotPlace`: a region, district or sub-county. */
export interface Place {
  id: string;
  name: string;
}

/** `HotspotSubmissionRequest`. */
export interface HotspotSubmission {
  name: string;
  type: string;
  region_id: string;
  district_id: string;
  subcounty_id: string;
  village: string | null;
  latitude: number;
  longitude: number;
  contact_person_name: string;
  contact_person_phone: string;
  has_condom_dispenser: boolean;
  dispenser_condition: string | null;
  comment: string | null;
}

export type ReviewStatus = "submitted" | "rejected" | "active" | "deactivated";

/** `HotspotDetail`, the fields the app reads. */
export interface ApiHotspot {
  id: string;
  name: string | null;
  type: string | null;
  village: string | null;
  region: Place | null;
  district: Place | null;
  subcounty: Place | null;
  latitude: number | null;
  longitude: number | null;
  has_condom_dispenser: boolean | null;
  dispenser_condition: string | null;
  status: "active" | "inactive";
  review_status: ReviewStatus;
  submitted_by_id: string | null;
  contact_person: { id: string; name: string | null; phone_number: string | null } | null;
  created_at: string;
}

/** Common hotspot types; the API stores free text, so "Other" lets the VHT type one. */
export const HOTSPOT_TYPES = [
  "Bar",
  "Lodge",
  "Guest house",
  "Landing site",
  "Taxi park",
  "Market",
  "Car wash",
  "Construction site",
] as const;
export const OTHER_TYPE = "Other";

/** Same options as the web app's hotspot form. */
export const DISPENSER_CONDITIONS = ["Good", "Poor", "Broken"] as const;

export const LIMITS = { name: 100, type: 100, village: 100, contact: 100, comment: 2000 };

/** The API strips spaces, dashes and parentheses, then wants 9 to 15 digits with an optional +. */
export const normalizePhone = (p: string) => p.trim().replace(/[\s\-()]/g, "");

/** A contact phone has exactly this many digits: a Ugandan mobile written locally, 0708832767. */
export const PHONE_DIGITS = 10;

/** A Ugandan mobile number written locally: 10 digits starting 07, e.g. 0708832767. */
export const phoneOk = (p: string) => /^07[0-9]{8}$/.test(normalizePhone(p));

/**
 * What the phone field keeps of what is typed or pasted: digits only, at most PHONE_DIGITS. An
 * international +256 number (as accounts often store it) becomes the local 07… form.
 */
export function toLocalPhone(p: string): string {
  let digits = p.replace(/[^0-9]/g, "");
  if (digits.startsWith("256") && digits.length === 12) digits = `0${digits.slice(3)}`;
  return digits.slice(0, PHONE_DIGITS);
}

/** What the map form collects. */
export interface MapForm {
  regionId: string;
  districtId: string;
  subcountyId: string;
  village: string;
  lat: number | null;
  lng: number | null;
  name: string;
  type: string;
  otherType: string;
  dispenser: "yes" | "no" | "";
  condition: string;
  comment: string;
  contactName: string;
  contactPhone: string;
}

export type MapField = keyof MapForm | "gps";

const tooLong = (v: string, n: number) => v.trim().length > n;

/** Field errors, keyed by the form field to show them on. Empty when the form can be sent. */
export function validateMapForm(f: MapForm): Partial<Record<MapField, string>> {
  const e: Partial<Record<MapField, string>> = {};
  if (f.lat == null || f.lng == null) e.gps = "Capture the GPS location.";
  if (!f.regionId) e.regionId = "Choose the region.";
  if (!f.districtId) e.districtId = "Choose the district.";
  if (!f.subcountyId) e.subcountyId = "Choose the sub-county.";
  if (tooLong(f.village, LIMITS.village)) e.village = `Use at most ${LIMITS.village} characters.`;

  if (!f.name.trim()) e.name = "Enter the hotspot name.";
  else if (tooLong(f.name, LIMITS.name)) e.name = `Use at most ${LIMITS.name} characters.`;
  if (!f.type) e.type = "Choose the type.";
  else if (f.type === OTHER_TYPE && !f.otherType.trim())
    e.otherType = "Say what kind of place it is.";
  else if (f.type === OTHER_TYPE && tooLong(f.otherType, LIMITS.type))
    e.otherType = `Use at most ${LIMITS.type} characters.`;
  if (!f.dispenser) e.dispenser = "Say whether there is a condom dispenser.";
  else if (f.dispenser === "yes" && !f.condition) e.condition = "Choose the dispenser condition.";
  if (tooLong(f.comment, LIMITS.comment)) e.comment = `Use at most ${LIMITS.comment} characters.`;

  if (!f.contactName.trim()) e.contactName = "Enter the hotspot manager's name.";
  else if (tooLong(f.contactName, LIMITS.contact))
    e.contactName = `Use at most ${LIMITS.contact} characters.`;
  if (!f.contactPhone.trim()) e.contactPhone = "Enter the hotspot manager's phone number.";
  else if (!phoneOk(f.contactPhone))
    e.contactPhone = "Enter a 10-digit number starting with 07, e.g. 0708832767.";
  return e;
}

/** The request body for POST /hotspots. Call only once `validateMapForm` returns no errors. */
export function toSubmission(f: MapForm): HotspotSubmission {
  const blank = (v: string) => v.trim() || null;
  return {
    name: f.name.trim().replace(/\s+/g, " "),
    type: f.type === OTHER_TYPE ? f.otherType.trim() : f.type,
    region_id: f.regionId,
    district_id: f.districtId,
    subcounty_id: f.subcountyId,
    village: blank(f.village),
    latitude: f.lat!,
    longitude: f.lng!,
    contact_person_name: f.contactName.trim(),
    contact_person_phone: normalizePhone(f.contactPhone),
    has_condom_dispenser: f.dispenser === "yes",
    dispenser_condition: f.dispenser === "yes" ? f.condition : null,
    comment: blank(f.comment),
  };
}

/** POST /hotspots. */
export async function submitHotspot(body: HotspotSubmission): Promise<ApiHotspot> {
  const { data } = await api.post<{ data: ApiHotspot }>("/hotspots", body);
  return data.data;
}

/** Hotspots per page. The API allows up to 100; 50 keeps the first screen quick on slow networks. */
export const PAGE_SIZE = 50;

/** One page of GET /hotspots, and whether another page may follow. */
export interface HotspotPage {
  items: ApiHotspot[];
  hasMore: boolean;
}

/**
 * GET /hotspots, one page at a time, most recently updated first.
 * - `submittedBy`: only that user's submissions (the VHT's Hotspots tab).
 * - `status: "active"`: the hotspots stock can be requested for. Today the API shows a VHT only their
 *   own submissions; with district access (hotspots:read_district) it shows their district's active ones.
 */
export async function listHotspotsPage(opts: {
  offset: number;
  limit?: number;
  submittedBy?: string;
  status?: "active" | "inactive";
}): Promise<HotspotPage> {
  const limit = opts.limit ?? PAGE_SIZE;
  const { data } = await api.get<{ data: ApiHotspot[] }>("/hotspots", {
    params: {
      limit,
      offset: opts.offset,
      ...(opts.submittedBy ? { submitted_by_id: opts.submittedBy } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
  });
  return { items: data.data, hasMore: data.data.length === limit };
}

/** True when the request never got an answer, so it is worth retrying later. */
export const isNetworkError = (err: unknown) => isAxiosError(err) && !err.response;

/** A sentence a VHT can act on, from a failed submission. */
export function submitErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const s = err.response?.status;
    if (s === 409)
      return "A hotspot with this name is already registered in this village. Use the name people there know it by, or check your hotspots list.";
    if (s === 422)
      return "The region, district and sub-county don't match. Choose them again on the Location step.";
    if (s === 400) return "Some details weren't accepted. Check each step and try again.";
    if (s === 403) return "Your account can't map hotspots. Call your district focal person.";
    if (!err.response)
      return "Can't reach CLIMS. Your hotspot will be sent when you're back online.";
  }
  return "Something went wrong. Try again.";
}

// ---- Location lookups ----------------------------------------------------------------------

const CACHE = "clims.places.v1.";

/**
 * GET a lookup list from the shared location API (GET /locations/*), falling back to the last copy
 * saved on this phone when offline. `cacheAs` keeps the key lists were saved under before the
 * /hotspots/* lookups were removed, so places already on the phone still work offline.
 */
async function places(
  path: string,
  cacheAs: string,
  params?: Record<string, string>,
): Promise<Place[]> {
  const key = CACHE + cacheAs + (params ? `?${new URLSearchParams(params)}` : "");
  try {
    const { data } = await api.get<{ data: Place[] }>(path, { params });
    const list = [...data.data].sort((a, b) => a.name.localeCompare(b.name));
    AsyncStorage.setItem(key, JSON.stringify(list)).catch(() => {});
    return list;
  } catch (err) {
    const saved = await AsyncStorage.getItem(key).catch(() => null);
    if (saved) return JSON.parse(saved) as Place[];
    throw err;
  }
}

export const listRegions = () => places("/locations/regions", "/hotspots/regions");
export const listDistricts = (regionId: string) =>
  places("/locations/districts", "/hotspots/districts", { region_id: regionId });
export const listSubcounties = (districtId: string) =>
  places("/locations/subcounties", "/hotspots/subcounties", { district_id: districtId });

/** Sample places for demo sign-ins, which have no API session. */
export const DEMO_PLACES = {
  regions: [{ id: "demo-central", name: "Central" }],
  districts: { "demo-central": [{ id: "demo-wakiso", name: "Wakiso" }] } as Record<string, Place[]>,
  subcounties: {
    "demo-wakiso": [
      "Entebbe Municipality",
      "Kajjansi TC",
      "Katabi TC",
      "Kira Municipality",
      "Nansana Municipality",
    ].map((name) => ({ id: `demo-${name}`, name })),
  } as Record<string, Place[]>,
};

/** The app's local copy of a hotspot the API accepted. */
export function toLocalHotspot(h: ApiHotspot, vht: string, comment: string | null): Hotspot {
  return {
    id: h.id,
    source: "api",
    name: h.name ?? "Unnamed hotspot",
    type: h.type ?? "",
    village: h.village ?? "",
    subcounty: h.subcounty?.name ?? "",
    district: h.district?.name ?? "",
    region: h.region?.name ?? "",
    status: h.status === "active" ? "Active" : "Inactive",
    reviewStatus: h.review_status,
    contact: h.contact_person?.name ?? "",
    phone: h.contact_person?.phone_number ?? "",
    vhts: [vht],
    stock: { male: 0, female: 0 },
    lat: h.latitude ?? undefined,
    lng: h.longitude ?? undefined,
    dispenser: !!h.has_condom_dispenser,
    dispCond: h.dispenser_condition ?? undefined,
    comment: comment ?? undefined,
    mappedAt: Date.parse(h.created_at) || Date.now(),
  };
}

/** A local copy for a submission not yet accepted (demo sign-ins, or queued offline). */
export function draftHotspot(
  b: HotspotSubmission,
  names: { region: string; district: string; subcounty: string },
  vht: string,
): Omit<Hotspot, "id"> {
  return {
    name: b.name,
    type: b.type,
    village: b.village ?? "",
    ...names,
    status: "Inactive",
    reviewStatus: "submitted",
    contact: b.contact_person_name,
    phone: b.contact_person_phone,
    vhts: [vht],
    stock: { male: 0, female: 0 },
    lat: b.latitude,
    lng: b.longitude,
    dispenser: b.has_condom_dispenser,
    dispCond: b.dispenser_condition ?? undefined,
    comment: b.comment ?? undefined,
  };
}
