'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { PageLoader } from '@/components/states/PageLoader';
import { useSession } from '@/features/auth/hooks';
import { selectSignedOut, signOutAcknowledged } from '@/features/auth/authSlice';
import { hasPermissions } from '@/features/auth/session';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { safeReturnPath } from '@/features/auth/returnPath';

import { HOME_PATH, SIGN_IN_PATH } from './paths';
import { accessTo, homeWorkspace, navigationFor, webAccessFor } from './access';
import { locate } from './navigation';
import { workspaces } from './workspaces';

/** The query parameter that carries where a visitor was headed when the guard intercepted them. */
const RETURN_PARAM = 'from';

/** The sign-in address that returns the visitor to `from` once they have signed in. */
export function signInHref(from: string): string {
  if (from === HOME_PATH || from === '/') return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?${new URLSearchParams({ [RETURN_PARAM]: from }).toString()}`;
}

interface RedirectProps {
  to: string;
}

/** Replaces the current address with `to`, showing a loader for the moment that takes. */
export function Redirect({ to }: RedirectProps) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return <PageLoader pathname={to} />;
}

interface GuardProps {
  children: ReactNode;
}

/**
 * Renders its children only for a signed-in user; otherwise redirects to
 * sign-in, remembering where they were headed.
 *
 * This decides what the browser shows. It is not the access control: the API
 * authorises every request, and a page reached by tampering with storage
 * still gets a 401 for its data.
 */
export function RequireAuth({ children }: GuardProps) {
  const session = useSession();
  const signedOut = useAppSelector(selectSignedOut);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  if (!session)
    return (
      <Redirect
        to={signedOut ? SIGN_IN_PATH : signInHref(search ? `${pathname}?${search}` : pathname)}
      />
    );
  return children;
}

/** Sends an already signed-in user away from the sign-in page. */
export function RedirectIfSignedIn({ children }: GuardProps) {
  const session = useSession();
  const signedOut = useAppSelector(selectSignedOut);
  const dispatch = useAppDispatch();
  const from = useSearchParams().get(RETURN_PARAM);
  useEffect(() => {
    // Once sign-in is reached, a new protected link should be remembered normally.
    if (signedOut) dispatch(signOutAcknowledged());
  }, [dispatch, signedOut]);

  if (session) {
    const access = webAccessFor(session.user.roleNames);
    const home =
      workspaces.find((workspace) => workspace.id === homeWorkspace(access))?.basePath ?? HOME_PATH;
    const requested = safeReturnPath(from, home, SIGN_IN_PATH);
    const path = new URL(requested, 'https://clims.invalid').pathname;
    const target = locate(workspaces, path);
    const navigation = navigationFor(workspaces, access, (code) =>
      hasPermissions(session.user, [code]),
    );
    const visible = locate(navigation.length ? navigation : workspaces, path);
    const known = target.page !== null || target.detail !== null;
    const allowed =
      accessTo(access, target.workspace.id) !== null &&
      (visible.page !== null || visible.detail !== null);
    return <Redirect to={known && !allowed ? home : requested} />;
  }
  return children;
}
