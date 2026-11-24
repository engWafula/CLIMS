import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useHttp, type HttpClient } from '@/lib/api';
import { webAccessFor } from '@/navigation/access';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

import { signIn, signOut, type Credentials } from './api';
import type { Session } from './session';
import { selectCurrentUser, selectSession, sessionSignedOut, sessionStarted } from './authSlice';

/** The current session, or `null` when signed out. */
export function useSession() {
  return useAppSelector(selectSession);
}

/** The signed-in user, or `null` when signed out. */
export function useCurrentUser() {
  return useAppSelector(selectCurrentUser);
}

/**
 * Thrown in place of a session for an account whose roles work only in the
 * field app (VHT, hotspot manager, delivery agent): they have no web access.
 */
export class FieldAppOnlyError extends Error {
  constructor() {
    super('VHTs, hotspot managers and delivery agents use the CLIMS mobile app, not the web.');
    this.name = 'FieldAppOnlyError';
  }
}

/**
 * Passes `session` through, unless its roles open nothing on the web and work in
 * the field app. Then the session the API just opened is ended, so the account
 * leaves no web sign-in behind, and {@link FieldAppOnlyError} is thrown.
 */
export async function refuseFieldAccount(http: HttpClient, session: Session): Promise<Session> {
  if (webAccessFor(session.user.roleNames).noWorkspace !== 'mobile') return session;
  // An unreachable server leaves the session to expire on its own; it is never kept here.
  await signOut(http, session.token).catch(() => undefined);
  throw new FieldAppOnlyError();
}

/** Signs in. The sign-in form renders the failure itself, next to the fields. */
export function useSignIn() {
  const http = useHttp();
  const dispatch = useAppDispatch();
  return useMutation({
    mutationFn: async (credentials: Credentials) =>
      refuseFieldAccount(http, await signIn(http, credentials)),
    onSuccess: (session) => {
      dispatch(sessionStarted(session));
    },
    meta: { handlesOwnErrors: true },
  });
}

/**
 * Returns a function that signs out.
 *
 * It asks the API to end the server session, then forgets the token here
 * without waiting, so signing out is immediate and works offline. The request
 * captures the token as it starts, before the local session is cleared.
 */
export function useSignOut() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const http = useHttp();

  return useCallback(() => {
    // An unreachable server leaves the session to expire on its own.
    signOut(http).catch(() => undefined);
    dispatch(sessionSignedOut());
    // Cached responses belong to the user who fetched them.
    queryClient.clear();
  }, [dispatch, queryClient, http]);
}
