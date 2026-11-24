'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { AppShell } from '@/components/layout/AppShell';
import { useCurrentUser } from '@/features/auth/hooks';
import { useCan, useCurrentUserSync } from '@/features/auth/queries';
import { DistrictContextProvider } from '@/features/district/DistrictContext';
import { useDcfpCounts } from '@/features/dcfp/useDcfpCounts';
import { useNotificationFeed } from '@/features/notifications/useNotificationFeed';
import { useWarehouseCounts } from '@/features/warehouse/useWarehouseCounts';
import { useAppStorage } from '@/lib/storage/StorageProvider';

import { accessTo, navigationFor } from './access';
import {
  NoPermission,
  NoPermissionsNotice,
  NotYourWorkspace,
  NoWebAccessPage,
  ReadOnlyNotice,
} from './AccessScreens';
import { Redirect, RequireAuth } from './guards';
import { locate } from './navigation';
import { HOME_PATH } from './paths';
import { ReadOnlyProvider, useHomeWorkspace, useWebAccess } from './useAccess';
import { workspaces } from './workspaces';

interface AppFrameProps {
  children: ReactNode;
}

/** Everything a signed-in screen sits inside: the guard, then the shell. */
export function AppFrame({ children }: AppFrameProps) {
  return (
    <RequireAuth>
      <SignedInShell>{children}</SignedInShell>
    </RequireAuth>
  );
}

const inside = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/**
 * The shell, cut to what the signed-in person may open. Their roles choose the
 * workspaces (`access.ts`); their permissions choose the pages within them. A
 * page outside that is replaced by a short explanation rather than left to
 * fail on the API's 403s, and a workspace opened read-only says so on top.
 *
 * It also keeps the user's roles and permissions current (`GET /auth/me`) and
 * fetches each workspace's badge counts only while that workspace is open.
 */
function SignedInShell({ children }: AppFrameProps) {
  useCurrentUserSync();
  const storage = useAppStorage();
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();
  const access = useWebAccess();
  const can = useCan();
  const home = useHomeWorkspace();
  const userId = user?.id;
  const previousUserId = useRef(userId);
  const previousAccess = useRef(access);
  useEffect(() => {
    const changedAccount = previousUserId.current !== userId;
    const currentWorkspace = locate(workspaces, pathname).workspace.id;
    const lostWorkspace =
      accessTo(previousAccess.current, currentWorkspace) !== null &&
      accessTo(access, currentWorkspace) === null;
    previousUserId.current = userId;
    previousAccess.current = access;
    // A changed account or role should not leave this tab in someone else's workspace.
    if (home && (changedAccount || lostWorkspace)) router.replace(home.basePath);
  }, [userId, access, home, pathname, router]);

  const canOpenDcfp = accessTo(access, 'dcfp') !== null;
  const canOpenWarehouse = accessTo(access, 'warehouse') !== null;
  const feed = useNotificationFeed({ dcfp: canOpenDcfp, warehouse: canOpenWarehouse });
  const dcfpCounts = useDcfpCounts(inside(pathname, '/dcfp') && canOpenDcfp, feed.inbox);
  const warehouseCounts = useWarehouseCounts(
    inside(pathname, '/warehouse') && accessTo(access, 'warehouse') !== null,
  );
  const navigation = useMemo(
    () => navigationFor(workspaces, access, (code) => can(code)),
    [access, can],
  );

  if (access.noWorkspace) return <NoWebAccessPage reason={access.noWorkspace} />;

  const target = locate(workspaces, pathname);
  const level = accessTo(access, target.workspace.id);
  // `/` and the sign-in page send everyone to MOH; anyone else starts in their own workspace.
  if (level === null && pathname === HOME_PATH && home) return <Redirect to={home.basePath} />;

  const visible = locate(navigation, pathname);
  const isScreen = target.page !== null || target.detail !== null;
  const blocked = !isScreen
    ? null
    : level === null
      ? 'workspace'
      : visible.page === null && visible.detail === null
        ? 'permission'
        : null;

  let content = children;
  let fallbackTitle: string | undefined;
  if (blocked === 'workspace') {
    content = <NotYourWorkspace workspace={target.workspace} home={home} />;
    fallbackTitle = 'Not part of your work';
  } else if (blocked === 'permission') {
    // A detail inherits the permission of its parent list, which may have been hidden entirely.
    const page = target.page ?? target.item?.pages[0];
    if (page) {
      content = <NoPermission page={page} home={home} />;
      fallbackTitle = target.detail?.label ?? page.title;
    }
  }

  const readOnly = level === 'read' && blocked === null;
  const hasNoPermissions = user?.permissions?.length === 0;

  return (
    <ReadOnlyProvider value={readOnly}>
      <AppShell
        workspaces={navigation}
        storage={storage}
        counts={dcfpCounts ?? warehouseCounts}
        notifications={feed.notifications}
        notificationActions={feed.actions}
        fallbackTitle={fallbackTitle}
      >
        {readOnly ? <ReadOnlyNotice workspace={target.workspace} /> : null}
        {hasNoPermissions && blocked === null ? <NoPermissionsNotice /> : null}
        {/* A blocked screen gets no district picker: its lookups would only 403. */}
        {blocked === null ? <DistrictContextProvider>{content}</DistrictContextProvider> : content}
      </AppShell>
    </ReadOnlyProvider>
  );
}
