import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { AuthUser, RefreshedTokens, Session } from './session';

export interface AuthState {
  session: Session | null;
  /**
   * True when the last session ended because the user signed out. Sign-in then
   * starts fresh instead of returning to the page they left, which belonged to
   * them and may not be open to whoever signs in next.
   */
  signedOut?: boolean;
}

const initialState: AuthState = { session: null };

/**
 * Holds the current session. Reducers stay pure: persisting to storage is the
 * store's job (see `createAppStore`), not a side effect in here.
 */
export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionStarted(state, action: PayloadAction<Session>) {
      state.session = action.payload;
      state.signedOut = false;
    },
    /** Pass `{ signedOut: true }` when the user chose to sign out (not an expiry). */
    sessionEnded(state, action: PayloadAction<{ signedOut: boolean } | undefined>) {
      state.session = null;
      state.signedOut = action.payload?.signedOut ?? false;
    },
    /** Swaps in renewed tokens; the user is unchanged. Ignored once signed out. */
    tokensRefreshed(state, action: PayloadAction<RefreshedTokens>) {
      if (!state.session) return;
      state.session.token = action.payload.token;
      state.session.refresh_token = action.payload.refresh_token;
    },
    /**
     * Replaces the user with the server's current copy (`GET /auth/me`), so a
     * role or permission change made by an administrator applies without
     * signing in again. Ignored once signed out.
     */
    userRefreshed(state, action: PayloadAction<AuthUser>) {
      if (!state.session) return;
      state.session.user = action.payload;
    },
  },
  selectors: {
    selectSession: (state) => state.session,
    selectCurrentUser: (state) => state.session?.user ?? null,
    selectToken: (state) => state.session?.token ?? null,
    selectSignedOut: (state) => state.signedOut === true,
  },
});

export const { sessionStarted, sessionEnded, tokensRefreshed, userRefreshed } = authSlice.actions;
export const { selectSession, selectCurrentUser, selectToken, selectSignedOut } =
  authSlice.selectors;
