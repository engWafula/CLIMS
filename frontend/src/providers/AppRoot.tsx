'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PageLoader } from '@/components/states/PageLoader';
import { applyTheme, loadTheme } from '@/components/theme/theme';
import { ConfigError, parseConfig, type AppConfig } from '@/config/env';
import {
  selectCurrentUser,
  selectSession,
  selectToken,
  sessionEnded,
} from '@/features/auth/authSlice';
import { createSessionRefresher } from '@/features/auth/refresh';
import { createSessionStore } from '@/features/auth/session';
import { createHttpClient, type HttpClient } from '@/lib/api';
import { createQueryClient } from '@/lib/query/queryClient';
import { getBrowserStorage } from '@/lib/storage/browserStorage';
import type { StorageLike } from '@/lib/storage/jsonStorage';
import { createAppStore, syncSessionAcrossTabs, type AppStore } from '@/store/store';

import { AppProviders } from './AppProviders';

interface App {
  config: AppConfig;
  storage: StorageLike;
  store: AppStore;
  queryClient: ReturnType<typeof createQueryClient>;
  http: HttpClient;
}

/*
 * The composition root: the one place where the app's long-lived objects are
 * created and wired together. Nothing below this file reaches for a global.
 *
 * The session, the theme and the sidebar state live in the browser's storage,
 * so none of this can exist on the server. It is built once, in the browser.
 */
function createApp(): App {
  // Next.js inlines each NEXT_PUBLIC_* value where it is named in full, so
  // these must be spelled out rather than read from `process.env` as a whole.
  const config = parseConfig({
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_MAP_TILES: process.env.NEXT_PUBLIC_MAP_TILES,
    NEXT_PUBLIC_MAP_ATTRIBUTION: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION,
  });
  const storage = getBrowserStorage();
  // Before the app renders, so a dark-theme user never sees it in light.
  applyTheme(document.documentElement, loadTheme(storage));
  const sessionStore = createSessionStore(storage);
  const store = createAppStore({ sessionStore });
  syncSessionAcrossTabs(store, sessionStore, window);

  const queryClient = createQueryClient({
    onMutationError: (error) => {
      // An expired session is announced once, below, not once per failed write.
      if (error.kind !== 'unauthorized') toast.error(error.message);
    },
  });

  // Cached responses belong to the user who fetched them. Signing out or in here
  // clears them too, but another tab's sign-out or sign-in only reaches this one
  // through the store.
  let cachedFor = selectCurrentUser(store.getState())?.id ?? null;
  let sessionGeneration = 0;
  store.subscribe(() => {
    const userId = selectCurrentUser(store.getState())?.id ?? null;
    if (userId === cachedFor) return;
    sessionGeneration += 1;
    if (cachedFor !== null) queryClient.clear();
    cachedFor = userId;
  });

  const http: HttpClient = createHttpClient({
    baseUrl: config.apiBaseUrl,
    getToken: () => selectToken(store.getState()),
    getSessionGeneration: () => sessionGeneration,
    // Access tokens last minutes; an expired one is renewed quietly before giving up.
    refresh: createSessionRefresher(
      store,
      () => http,
      () => sessionStore.load(),
    ),
    onUnauthorized: (rejectedToken) => {
      const session = selectSession(store.getState());
      // Several requests can be rejected together; only the first ends the session.
      if (!session) return;
      // Sent with a token the session has since replaced: the newer one still works.
      if (rejectedToken !== null && rejectedToken !== session.token) return;
      store.dispatch(sessionEnded());
      queryClient.clear();
      toast.info('Your session has expired. Sign in again.');
    },
  });

  return { config, storage, store, queryClient, http };
}

type AppResult = { app: App; error: null } | { app: null; error: ConfigError };

let created: AppResult | undefined;

/** The one app instance for this page load, or the reason it could not be built. */
function getApp(): AppResult {
  if (created) return created;
  try {
    created = { app: createApp(), error: null };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error);
    created = { app: null, error };
  }
  return created;
}

const subscribeToNothing = () => () => undefined;

interface AppRootProps {
  children: ReactNode;
}

/**
 * Wraps every route in the app's providers.
 *
 * The server render and the hydration pass show a loader; the app itself
 * starts on the first render after that, when the browser's storage can be
 * read. Rendering it any earlier would mean guessing whether the visitor is
 * signed in, and showing the wrong screen when the guess is wrong.
 */
export function AppRoot({ children }: AppRootProps) {
  const pathname = usePathname();
  const isInBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  if (!isInBrowser) return <PageLoader pathname={pathname} />;
  return <BrowserApp>{children}</BrowserApp>;
}

function BrowserApp({ children }: AppRootProps) {
  const [{ app, error }] = useState(getApp);

  if (error) {
    // A misconfigured build cannot run. Say so plainly instead of showing a blank page.
    return (
      <p role="alert" className="max-w-2xl p-8 font-sans">
        CLIMS is not configured correctly and cannot start. {error.message}
      </p>
    );
  }

  return (
    <ErrorBoundary>
      <AppProviders
        config={app.config}
        store={app.store}
        queryClient={app.queryClient}
        http={app.http}
        storage={app.storage}
      >
        {children}
      </AppProviders>
    </ErrorBoundary>
  );
}
