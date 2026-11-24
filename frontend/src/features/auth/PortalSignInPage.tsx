'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { PageLoader } from '@/components/states/PageLoader';
import { useHttp } from '@/lib/api';
import { HOME_PATH, SIGN_IN_PATH, SSO_ERROR_PARAM } from '@/navigation/paths';
import { useAppDispatch } from '@/store/hooks';

import { completePortalSignIn } from './api';
import { sessionStarted } from './authSlice';
import { FieldAppOnlyError, refuseFieldAccount, useSession, useSignOut } from './hooks';

/**
 * Finishes sign-in from the MoH portal. The API has already checked the
 * Keycloak identity and the account link; this page claims the session and
 * replaces any session already in this browser, since the portal user is the
 * one at the keyboard. A field account (VHT, hotspot manager, delivery agent)
 * is not signed in: it is sent back to sign-in, pointed to the mobile app.
 */
export default function PortalSignInPage() {
  const http = useHttp();
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const router = useRouter();
  const signedIn = useSession() !== null;
  const signOut = useSignOut();
  const { mutate } = useMutation({
    mutationFn: async () => refuseFieldAccount(http, await completePortalSignIn(http)),
    onSuccess: (session) => {
      // Cached responses belong to whoever was signed in before.
      queryClient.clear();
      dispatch(sessionStarted(session));
      router.replace(HOME_PATH);
    },
    onError: (error) => {
      // A field account is pointed to the mobile app; any other failure is a stale handoff.
      const fieldAccount = error instanceof FieldAppOnlyError;
      // The portal user is at the keyboard, so whoever was signed in here before is signed out.
      if (fieldAccount && signedIn) signOut();
      const reason = fieldAccount ? 'mobile' : 'expired';
      router.replace(
        `${SIGN_IN_PATH}?${new URLSearchParams({ [SSO_ERROR_PARAM]: reason }).toString()}`,
      );
    },
    meta: { handlesOwnErrors: true },
  });
  // The claim works once, so it must not repeat when React re-runs effects.
  const claimed = useRef(false);
  useEffect(() => {
    if (claimed.current) return;
    claimed.current = true;
    mutate();
  }, [mutate]);

  return <PageLoader />;
}
