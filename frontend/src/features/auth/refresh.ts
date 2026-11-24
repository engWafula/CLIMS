import type { HttpClient } from '@/lib/api';
import type { AppStore } from '@/store/store';

import { refreshTokens } from './api';
import { selectSession, tokensRefreshed } from './authSlice';
import type { Session } from './session';

/** How long a refused refresh waits for another tab's renewed tokens to reach storage. */
export const OTHER_TAB_GRACE_MS = 1500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Builds the HTTP client's `refresh` hook. Requests rejected together share
 * one refresh, since each refresh token works only once. When the rejected
 * token is no longer current, another request or tab has already refreshed,
 * so the request is retried without spending the refresh token again.
 *
 * Two tabs can spend the same refresh token at once: the server renews one and
 * refuses the other. The refused tab then takes the winner's tokens from
 * storage (`storedSession`) instead of ending the session, which would also
 * sign the winning tab out.
 */
export function createSessionRefresher(
  store: AppStore,
  http: () => HttpClient,
  storedSession: () => Session | null = () => null,
  graceMs = OTHER_TAB_GRACE_MS,
) {
  let pending: { userId: string; refreshToken: string; promise: Promise<boolean> } | null = null;

  /** True when another tab has renewed `spent` for the same user; its tokens are adopted. */
  const renewedElsewhere = (spent: string, userId: string): boolean => {
    const current = selectSession(store.getState());
    if (current?.user.id !== userId) return false;
    // The other tab's storage event has already swapped the tokens in.
    if (current.refresh_token !== spent) return true;
    const stored = storedSession();
    if (!stored?.refresh_token || stored.refresh_token === spent) return false;
    if (stored.user.id !== current.user.id) return false;
    store.dispatch(tokensRefreshed({ token: stored.token, refresh_token: stored.refresh_token }));
    return true;
  };

  return (rejectedToken: string): Promise<boolean> => {
    const session = selectSession(store.getState());
    if (!session) return Promise.resolve(false);
    if (session.token !== rejectedToken) return Promise.resolve(true);
    const refreshToken = session.refresh_token;
    if (!refreshToken) return Promise.resolve(false);

    const userId = session.user.id;
    if (pending?.userId === userId && pending.refreshToken === refreshToken) return pending.promise;

    const promise = refreshTokens(http(), refreshToken)
      .then(
        (tokens) => {
          const current = selectSession(store.getState());
          // The response belongs to the session that spent this token, not a later login.
          if (current?.user.id !== userId) return false;
          if (current.refresh_token !== refreshToken) return renewedElsewhere(refreshToken, userId);
          store.dispatch(tokensRefreshed(tokens));
          return true;
        },
        async () => {
          if (renewedElsewhere(refreshToken, userId)) return true;
          // The winning tab may not have saved its tokens yet.
          await wait(graceMs);
          return renewedElsewhere(refreshToken, userId);
        },
      )
      .finally(() => {
        if (pending?.promise === promise) pending = null;
      });
    pending = { userId, refreshToken, promise };
    return promise;
  };
}
