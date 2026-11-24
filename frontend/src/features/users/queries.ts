import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { authKeys } from '@/features/auth/queries';
import { toApiError, useApiQuery, useHttp, type ApiError } from '@/lib/api';

import {
  createUser,
  listPermissions,
  listRoles,
  listUserSessions,
  listUsers,
  revokeUserSessions,
  setRolePermissions,
  setUserRoles,
  setUserStore,
  setUserStatus,
  type NewUserInput,
  type User,
  type UserStatus,
} from './api';

export const accessKeys = {
  users: ['users'] as const,
  roles: ['access', 'roles'] as const,
  permissions: ['access', 'permissions'] as const,
  userSessions: (userId: string) => ['users', userId, 'sessions'] as const,
};

/** Roles and permissions change rarely; keep them for a few minutes rather than refetching per page. */
const ROLES_STALE_TIME = 5 * 60_000;

export function useUsers() {
  return useApiQuery(accessKeys.users, listUsers);
}

export function useAccessRoles() {
  return useApiQuery(accessKeys.roles, listRoles, { staleTime: ROLES_STALE_TIME });
}

export function usePermissions() {
  return useApiQuery(accessKeys.permissions, listPermissions, { staleTime: ROLES_STALE_TIME });
}

export function useCreateUser() {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewUserInput) => createUser(http, input),
    onSuccess: async () => {
      toast.success('User created');
      await queryClient.invalidateQueries({ queryKey: accessKeys.users });
    },
    // The form places field-level messages itself; see NewUserDialog.
    meta: { handlesOwnErrors: true },
  });
}

export function useSetUserRoles(userId: string) {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roleIds: string[]) => setUserRoles(http, userId, roleIds),
    onSuccess: async () => {
      toast.success('Roles updated');
      await queryClient.invalidateQueries({ queryKey: accessKeys.users });
      // Administrators can edit their own roles; their permissions follow.
      await queryClient.invalidateQueries({ queryKey: authKeys.me });
    },
    meta: { handlesOwnErrors: true },
  });
}

/** Sets or clears a user's store. The dialog places a refusal beside the store field. */
export function useSetUserStore(userId: string) {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (storeId: string | null) => setUserStore(http, userId, storeId),
    onSuccess: async () => {
      toast.success('Store updated');
      await queryClient.invalidateQueries({ queryKey: accessKeys.users });
      // Someone changing their own store sees a different set of orders and stock.
      await queryClient.invalidateQueries({ queryKey: authKeys.me });
    },
    meta: { handlesOwnErrors: true },
  });
}

/**
 * Deactivates or reactivates a user. `handlesOwnErrors` is set by the caller's
 * screen: the deactivate confirmation shows the failure itself.
 */
export function useSetUserStatus() {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      setUserStatus(http, id, status),
    onSuccess: async (_data, { status }) => {
      toast.success(status === 'active' ? 'User reactivated' : 'User deactivated');
      await queryClient.invalidateQueries({ queryKey: accessKeys.users });
    },
    meta: { handlesOwnErrors: true },
  });
}

export function useSetRolePermissions() {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, permissions }: { roleId: string; permissions: string[] }) =>
      setRolePermissions(http, roleId, permissions),
    onSuccess: async () => {
      toast.success('Permissions updated');
      await queryClient.invalidateQueries({ queryKey: accessKeys.roles });
      // A user's role objects carry the role's permissions too, the signed-in user's included.
      await queryClient.invalidateQueries({ queryKey: accessKeys.users });
      await queryClient.invalidateQueries({ queryKey: authKeys.me });
    },
    // The roles page shows the failure next to the switches.
    meta: { handlesOwnErrors: true },
  });
}

/** Where a user is signed in. Read only while `enabled`, e.g. while its dialog is open. */
export function useUserSessions(userId: string, enabled = true) {
  return useApiQuery(
    accessKeys.userSessions(userId),
    (http, signal) => listUserSessions(http, userId, signal),
    { enabled, staleTime: 0 },
  );
}

/** Signs a user out everywhere. The confirmation shows a failure itself. */
export function useRevokeUserSessions(userId: string) {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revokeUserSessions(http, userId),
    // ['users'] also covers this user's sessions and the list's device counts.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: accessKeys.users });
    },
    meta: { handlesOwnErrors: true },
  });
}

/** A change applied to several users at once from the users list. */
export type BulkUserAction = 'deactivate' | 'reactivate' | 'sign-out';

export interface BulkUserResult {
  done: User[];
  failed: { user: User; error: ApiError }[];
}

/**
 * Applies one change to several users, one request at a time, so a failure
 * names the user it is about and the rest still go through. `progress` counts
 * the requests answered while it runs. The caller reports the outcome.
 */
export function useBulkUserAction() {
  const http = useHttp();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const mutation = useMutation({
    mutationFn: async ({
      action,
      users,
    }: {
      action: BulkUserAction;
      users: readonly User[];
    }): Promise<BulkUserResult> => {
      const result: BulkUserResult = { done: [], failed: [] };
      setProgress({ done: 0, total: users.length });
      for (const [index, user] of users.entries()) {
        try {
          if (action === 'sign-out') await revokeUserSessions(http, user.id);
          else await setUserStatus(http, user.id, action === 'deactivate' ? 'disabled' : 'active');
          result.done.push(user);
        } catch (error) {
          result.failed.push({ user, error: toApiError(error) });
        }
        setProgress({ done: index + 1, total: users.length });
      }
      return result;
    },
    onSettled: async () => {
      setProgress(null);
      await queryClient.invalidateQueries({ queryKey: accessKeys.users });
    },
    meta: { handlesOwnErrors: true },
  });
  return { ...mutation, progress };
}
