import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { AuthUser, RefreshedTokens, Session } from './session';

export interface AuthState {
  session: Session | null;
  /** Explicit sign-out should not carry one person's page into the next sign-in. */
  signedOut: boolean;
}

const initialState: AuthState = { session: null, signedOut: false };

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
    sessionEnded(state) {
      state.session = null;
      state.signedOut = false;
    },
    sessionSignedOut(state) {
      state.session = null;
      state.signedOut = true;
    },
    signOutAcknowledged(state) {
      state.signedOut = false;
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
     * signing in again. Ignored once signed out, and when the copy is another
     * account's (a response cached before another tab signed in as someone else).
     */
    userRefreshed(state, action: PayloadAction<AuthUser>) {
      if (state.session?.user.id !== action.payload.id) return;
      state.session.user = action.payload;
    },
  },
  selectors: {
    selectSession: (state) => state.session,
    selectCurrentUser: (state) => state.session?.user ?? null,
    selectToken: (state) => state.session?.token ?? null,
    selectSignedOut: (state) => state.signedOut,
  },
});

export const {
  sessionStarted,
  sessionEnded,
  sessionSignedOut,
  signOutAcknowledged,
  tokensRefreshed,
  userRefreshed,
} = authSlice.actions;
export const { selectSession, selectCurrentUser, selectToken, selectSignedOut } =
  authSlice.selectors;
