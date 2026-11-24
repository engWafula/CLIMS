'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { PageLoader } from '@/components/states/PageLoader';
import { useSession, useSignedOut } from '@/features/auth/hooks';
import { safeReturnPath } from '@/features/auth/returnPath';

import { accessTo, type WebAccess } from './access';
import { locate } from './navigation';
import { HOME_PATH, SIGN_IN_PATH } from './paths';
import { useWebAccess } from './useAccess';
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
  return <PageLoader />;
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
  const signedOut = useSignedOut();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  if (!session) {
    // After choosing to sign out, the page they were on is not remembered: the next person to
    // sign in in this browser may hold a different role, and it was not where they were headed.
    if (signedOut) return <Redirect to={SIGN_IN_PATH} />;
    return <Redirect to={signInHref(search ? `${pathname}?${search}` : pathname)} />;
  }
  return children;
}

/**
 * Whether `path` lies in a workspace `access` opens. The return path was recorded for whoever
 * was signed in before, so it is only followed when it is part of the new user's work.
 */
export function canReturnTo(path: string, access: WebAccess): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? path;
  return accessTo(access, locate(workspaces, pathname).workspace.id) !== null;
}

/** Sends an already signed-in user away from the sign-in page. */
export function RedirectIfSignedIn({ children }: GuardProps) {
  const session = useSession();
  const access = useWebAccess();
  const from = useSearchParams().get(RETURN_PARAM);

  if (session) {
    const target = safeReturnPath(from, HOME_PATH, SIGN_IN_PATH);
    return <Redirect to={canReturnTo(target, access) ? target : HOME_PATH} />;
  }
  return children;
}
