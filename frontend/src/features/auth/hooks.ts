import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useHttp } from '@/lib/api';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

import { signIn, signOut, type Credentials } from './api';
import {
  selectCurrentUser,
  selectSession,
  selectSignedOut,
  sessionEnded,
  sessionStarted,
} from './authSlice';

/** The current session, or `null` when signed out. */
export function useSession() {
  return useAppSelector(selectSession);
}

/** Whether the last session ended because the user signed out, rather than expiring. */
export function useSignedOut() {
  return useAppSelector(selectSignedOut);
}

/** The signed-in user, or `null` when signed out. */
export function useCurrentUser() {
  return useAppSelector(selectCurrentUser);
}

/** Signs in. The sign-in form renders the failure itself, next to the fields. */
export function useSignIn() {
  const http = useHttp();
  const dispatch = useAppDispatch();
  return useMutation({
    mutationFn: (credentials: Credentials) => signIn(http, credentials),
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
    dispatch(sessionEnded({ signedOut: true }));
    // Cached responses belong to the user who fetched them.
    queryClient.clear();
  }, [dispatch, queryClient, http]);
}
