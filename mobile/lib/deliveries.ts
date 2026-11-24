import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

/**
 * Hotspot deliveries named for the signed-in delivery agent (rider), from the Go API
 * (`GET /orders/deliveries`, docs/modules/orders.md). The district names the agent when it records
 * a delivery against a hotspot's stockout; the agent carries it and the hotspot's manager confirms
 * what arrived. The last list is kept on the phone for offline use.
 */

/** A line of a delivery: a product, in its catalogue unit and in pieces. */
export interface DeliveryLine {
  id: string;
  category: "male" | "female";
  product: string;
  quantity: number;
  pieces: number;
  /** Pieces the hotspot confirmed; null until it does. */
  acknowledged_pieces: number | null;
}

/** `RiderDelivery`, the fields the app reads. */
export interface RiderDelivery {
  id: string;
  stockout_report_id: string;
  hot_spot_id: string;
  hot_spot: {
    name: string;
    village: string | null;
    subcounty: string | null;
    district: string | null;
    contact_name: string | null;
    contact_phone: string | null;
  };
  note: string | null;
  created_at: string;
  lines: DeliveryLine[];
  /** True once the hotspot's manager has confirmed every line. */
  acknowledged: boolean;
}

const CACHE = "clims.rider-deliveries.v1";

/** GET /orders/deliveries: newest first. Saves the list for when the phone is offline. */
export async function listMyDeliveries(limit = 100): Promise<RiderDelivery[]> {
  const { data } = await api.get<{ data: RiderDelivery[] }>("/orders/deliveries", {
    params: { limit, offset: 0 },
  });
  AsyncStorage.setItem(CACHE, JSON.stringify(data.data)).catch(() => {});
  return data.data;
}

/** Forget the saved list when the rider signs out: it holds hotspot contacts' phone numbers. */
export async function forgetSavedDeliveries(): Promise<void> {
  await AsyncStorage.removeItem(CACHE).catch(() => {});
}

/** The last list saved on this phone, or null. */
export async function savedDeliveries(): Promise<RiderDelivery[] | null> {
  const raw = await AsyncStorage.getItem(CACHE).catch(() => null);
  return raw ? (JSON.parse(raw) as RiderDelivery[]) : null;
}

/** "Kisenyi, Katabi, Wakiso": the parts of a hotspot's place that are known. */
export function placeOf(d: Pick<RiderDelivery, "hot_spot">): string {
  const { village, subcounty, district } = d.hot_spot;
  return [village, subcounty, district].filter((part) => part?.trim()).join(", ");
}

/** "300 male · 100 female pieces": what a delivery carries, by category. */
export function piecesOf(d: Pick<RiderDelivery, "lines">): string {
  const total = { male: 0, female: 0 };
  for (const line of d.lines) total[line.category] += line.pieces;
  const parts = (["male", "female"] as const)
    .filter((category) => total[category] > 0)
    .map((category) => `${total[category].toLocaleString("en-US")} ${category}`);
  return parts.length ? `${parts.join(" · ")} pieces` : "No lines";
}
