import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";
import {
  configureAuth,
  endRemoteSession,
  getTokens,
  login,
  setTokens,
  toStoredTokens,
  type ApiUser,
  type StoredTokens,
} from "./api";
import { DEFAULT_PERSONAS } from "./seed";
import { clearShownNotifications, stopPush } from "./push";
import { forgetSavedDeliveries } from "./deliveries";
import type { AppRole } from "./types";

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  role: AppRole;
  /** Hotspot managers: the hotspot assigned to them (`hot_spot_id`), which their alerts are for. */
  hotspotId?: string | null;
  hotspot?: ApiUser["hot_spot"];
  location?: ApiUser["location"];
  organisationUnit?: ApiUser["organisation_unit"];
  subcounty?: ApiUser["subcounty"];
  store?: ApiUser["store"];
  demo?: boolean;
}

interface SessionCtx {
  user: SessionUser | null;
  restoring: boolean;
  /** `identifier` is an email address, username or phone number. */
  signIn: (identifier: string, password: string) => Promise<void>;
  signInDemo: (role: AppRole) => Promise<void>;
  signOut: () => Promise<void>;
}

// v3 adds the refresh token; v2 sessions held only a 15-minute access token and are dropped.
const KEY = "clims.session.v3";
const OLD_KEYS = ["clims.session.v2"];

interface Persisted {
  user: SessionUser;
  tokens: StoredTokens | null;
}
const Ctx = createContext<SessionCtx | null>(null);

/** Backend role names (RBAC catalog) that this app serves. */
const ROLE_MAP: Record<string, AppRole> = {
  vht: "vht",
  "hotspot manager": "hm",
  "delivery agent": "rider",
  rider: "rider",
};

export const ROLE_LABEL: Record<AppRole, string> = {
  vht: "Village health team",
  hm: "Hotspot manager",
  rider: "Delivery rider",
};

export function appRoleOf(u: ApiUser): AppRole | null {
  const names = [u.role?.name, ...(u.roles || []).map((r) => r.name)].filter(Boolean) as string[];
  for (const n of names) {
    const r = ROLE_MAP[n.trim().toLowerCase()];
    if (r) return r;
  }
  return null;
}

function toSessionUser(u: ApiUser, role: AppRole): SessionUser {
  const name =
    [u.first_name || u.firstname, u.last_name || u.lastname].filter(Boolean).join(" ").trim() ||
    u.username;
  return {
    id: u.id,
    hotspotId: u.hot_spot_id ?? null,
    hotspot: u.hot_spot,
    location: u.location,
    organisationUnit: u.organisation_unit,
    subcounty: u.subcounty,
    store: u.store,
    name,
    username: u.username,
    email: u.email,
    phone: u.phone_number || "",
    role,
  };
}

const WRONG_ROLE =
  "This app is for VHTs, hotspot managers and riders. Use the CLIMS website for your role.";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  const userRef = useRef<SessionUser | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const write = useCallback(async (p: Persisted | null) => {
    if (p) await SecureStore.setItemAsync(KEY, JSON.stringify(p)).catch(() => {});
    else await SecureStore.deleteItemAsync(KEY).catch(() => {});
  }, []);

  const clearLocal = useCallback(async () => {
    setTokens(null);
    setUser(null);
    await Promise.all([write(null), forgetSavedDeliveries()]);
  }, [write]);

  // Rotated tokens are persisted so a restart resumes the same session; a refused refresh
  // token signs the user out.
  useEffect(() => {
    configureAuth({
      tokensChanged: (t) => {
        const u = userRef.current;
        if (u && !u.demo) write({ user: u, tokens: t });
      },
      sessionEnded: () => {
        clearLocal();
      },
    });
  }, [write, clearLocal]);

  // The profile saved at sign-in is the one the app uses until the user signs out; it is not
  // reloaded from the server. Profile changes made on the server reach the phone at the next
  // sign-in. A revoked session still signs out via sessionEnded on the next API call.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        for (const k of OLD_KEYS) SecureStore.deleteItemAsync(k).catch(() => {});
        const raw = await SecureStore.getItemAsync(KEY);
        const s = raw ? (JSON.parse(raw) as Persisted) : null;
        if (s?.user && (s.user.demo || (s.tokens && s.tokens.refreshExp > Date.now()))) {
          setTokens(s.tokens);
          if (live) setUser(s.user);
        } else if (s) {
          await write(null);
        }
      } catch {
        // A corrupt or unreadable session just means signing in again.
      } finally {
        if (live) setRestoring(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [write]);

  const persist = useCallback(
    async (u: SessionUser, t: StoredTokens | null) => {
      setTokens(t);
      setUser(u);
      await write({ user: u, tokens: t });
    },
    [write],
  );

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const res = await login(identifier, password);
      const t = toStoredTokens(res);
      const role = appRoleOf(res.user);
      if (!role) {
        // Don't leave a session open on the server for an account this app can't serve.
        endRemoteSession(t);
        throw new Error(WRONG_ROLE);
      }
      await persist(toSessionUser(res.user, role), t);
    },
    [persist],
  );

  const signInDemo = useCallback(
    async (role: AppRole) => {
      const name = DEFAULT_PERSONAS[role];
      const username = name.toLowerCase().replace(/\s+/g, ".");
      const phone = { vht: "+256 776 902 331", hm: "+256 772 418 903", rider: "+256 701 334 920" }[
        role
      ];
      await persist(
        { id: `demo-${role}`, name, username, email: "", phone, role, demo: true },
        null,
      );
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    const t = getTokens();
    // Ending the session below stops this phone's pushes, but only once it reaches the server, so the
    // token is given up here too; clear the ones already shown as well.
    stopPush();
    clearShownNotifications();
    await clearLocal();
    // Revoke the session on the server without making the user wait for the network.
    if (t) endRemoteSession(t);
  }, [clearLocal]);

  const value = useMemo(
    () => ({ user, restoring, signIn, signInDemo, signOut }),
    [user, restoring, signIn, signInDemo, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession must be used inside SessionProvider");
  return c;
}

/** The signed-in user; only call below the signed-in layout. */
export function useMe() {
  const { user } = useSession();
  if (!user) throw new Error("useMe called while signed out");
  return user;
}
