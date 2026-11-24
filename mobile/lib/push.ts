import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";
import type { ApiNotification } from "./notifications";

/**
 * Push notifications through Firebase Cloud Messaging (docs/modules/notifications.md#push).
 *
 * The phone gives the API its FCM token (`POST /notifications/devices`) for the signed-in session;
 * the server then sends that user's field notifications as pushes too: a delivery agent's new
 * deliveries, a hotspot manager's incoming stock, a VHT's hotspot decisions and comments. Signing
 * out ends the session on the server, which stops them.
 *
 * Push is an extra: every step here fails quietly. A build without google-services.json, Expo Go,
 * a refused permission or no network leaves the app as it was, with the inbox checked every minute.
 */

type NotificationsModule = typeof import("expo-notifications");

let loaded: NotificationsModule | null | undefined;

/**
 * expo-notifications, or null where push cannot work: Expo Go (remote push was removed from it in
 * SDK 53, and importing the module there logs an error), web, and iOS until APNs is set up.
 */
export function notificationsModule(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  if (
    Platform.OS !== "android" ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ) {
    loaded = null;
    return loaded;
  }
  try {
    // Loaded lazily so Expo Go never imports it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require("expo-notifications") as NotificationsModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** The Android channel the server names in each push (`AndroidChannelID` in the Go API). */
export const PUSH_CHANNEL_ID = "default";

/** POST /notifications/devices: this phone's FCM token, for the signed-in session. */
export async function registerDevice(token: string): Promise<void> {
  await api.post("/notifications/devices", { token, platform: "android" });
}

/**
 * Ask for permission (Android 13 and later show a prompt), read the FCM token and give it to the
 * API. Resolves whether push is on; never throws. Without Firebase configuration in the build the
 * token request fails and push simply stays off.
 */
export async function enablePush(): Promise<boolean> {
  const N = notificationsModule();
  if (!N) return false;
  try {
    // The channel must exist before asking: Android 13 shows the prompt only once one does.
    await N.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name: "Deliveries and requests",
      importance: N.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#14532d",
    });
    let { status } = await N.getPermissionsAsync();
    if (status !== "granted") ({ status } = await N.requestPermissionsAsync());
    if (status !== "granted") return false;
    const { data } = await N.getDevicePushTokenAsync();
    if (typeof data !== "string" || !data) return false;
    await registerDevice(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop pushes reaching this phone by giving up its token: FCM then refuses it and the server drops the
 * device. A sign-out without signal cannot end the session on the server, so without this the
 * signed-out phone would keep showing that account's pushes. The next sign-in registers a new token.
 */
export function stopPush(): void {
  notificationsModule()
    ?.unregisterForNotificationsAsync()
    .catch(() => {});
}

/** Remove this phone's shown notifications, so the next person to sign in doesn't see them. */
export function clearShownNotifications(): void {
  notificationsModule()
    ?.dismissAllNotificationsAsync()
    .catch(() => {});
}

/**
 * Notifications that already reached the phone as a system push in this run of the app. The system
 * notification pops up with sound even while the app is open, so the in-app banner skips these
 * rather than announcing the same thing twice.
 */
export const shownAsPush = new Set<string>();

/** What a push carries besides its text: IDs for opening it (see `queuedPush.data` in the API). */
export interface PushData {
  notification_id: string;
  user_id?: string;
  type: string;
  resource_type?: string;
  resource_id?: string;
  report_id?: string;
  delivery_id?: string;
}

/**
 * A push's data, from `notification.request.content.data`. expo-notifications parses the JSON the
 * server sends as `body`; if it ever hands over the raw FCM data instead, `body` is parsed here.
 * Anything that is not a CLIMS push (no notification_id) gives null.
 */
export function pushDataOf(raw: unknown): PushData | null {
  let d: unknown = raw;
  if (d && typeof d === "object" && typeof (d as { body?: unknown }).body === "string") {
    try {
      d = JSON.parse((d as { body: string }).body);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : undefined);
  const id = str("notification_id");
  if (!id) return null;
  return {
    notification_id: id,
    user_id: str("user_id"),
    type: str("type") ?? "",
    resource_type: str("resource_type"),
    resource_id: str("resource_id"),
    report_id: str("report_id"),
    delivery_id: str("delivery_id"),
  };
}

/** A tapped push as the inbox's notification, so it opens the same screen an inbox tap would. */
export function toApiNotification(
  d: PushData,
  title: string | null | undefined,
  body: string | null | undefined,
): ApiNotification {
  const data: Record<string, unknown> = {};
  if (d.report_id) data.report_id = d.report_id;
  if (d.delivery_id) data.delivery_id = d.delivery_id;
  return {
    id: d.notification_id,
    type: d.type,
    title: title ?? "",
    body: body ?? "",
    resource_type: d.resource_type ?? null,
    resource_id: d.resource_id ?? null,
    data,
    read_at: null,
    created_at: new Date().toISOString(),
  };
}
