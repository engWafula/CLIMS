'use client';

import { CircleAlert, Eye, Lock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { PageSkeleton } from '@/components/states/PageSkeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/features/auth/queries';
import { getErrorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { Role } from './api';
import {
  groupPermissions,
  isAdminRole,
  isSignUpRole,
  permissionLabel,
  roleDescription,
  roleLabel,
  usersPerRole,
} from './access';
import { useAccessRoles, usePermissions, useSetRolePermissions, useUsers } from './queries';
import { usersHref } from './UsersPage';
import { WebAccessList } from './WebAccessList';

export const ROLES_PATH = '/moh/users/roles';

const plural = (count: number, noun: string) =>
  `${formatNumber(count)} ${noun}${count === 1 ? '' : 's'}`;

/**
 * What each role can do. Pick a role on the left (kept in the address as
 * `?role=<id>`); each switch grants or revokes one permission straight away
 * through `PUT /roles/:id/permissions`.
 */
export default function RolesPage() {
  const roles = useAccessRoles();
  const permissions = usePermissions();
  const users = useUsers();
  const roleParam = useSearchParams().get('role');

  if (roles.isPending || permissions.isPending) return <PageSkeleton layout="detail" />;

  const failed = roles.isError ? roles : permissions.isError ? permissions : null;
  if (failed) {
    return (
      <ErrorState
        title="Could not load roles"
        error={failed.error}
        onRetry={() => void failed.refetch()}
        isRetrying={failed.isRefetching}
      />
    );
  }

  const list = roles.data ?? [];
  const selected = list.find((role) => role.id === roleParam) ?? list[0];
  if (!selected) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No roles yet"
        description="Roles are set up on the server. Once there are some, their permissions appear here."
      />
    );
  }

  const counts = users.data ? usersPerRole(users.data) : null;
  // Permissions a role holds that the server no longer lists are still shown, so none is hidden.
  const allCodes = [
    ...(permissions.data ?? []),
    ...selected.permissions.filter((code) => !(permissions.data ?? []).includes(code)),
  ];

  return (
    <div className="gap-section grid lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <nav aria-label="Roles">
        <ul className="bg-card flex flex-col gap-1 rounded-xl border p-2">
          {list.map((role) => {
            const isCurrent = role.id === selected.id;
            const userCount = counts?.get(role.id) ?? 0;
            return (
              <li key={role.id}>
                <Link
                  href={`${ROLES_PATH}?role=${encodeURIComponent(role.id)}`}
                  scroll={false}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={cn(
                    'focus-visible:ring-ring flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2',
                    isCurrent ? 'bg-primary/10 font-semibold' : 'hover:bg-secondary font-medium',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{roleLabel(role)}</span>
                    <span className="text-muted-foreground block text-xs font-normal">
                      {plural(role.permissions.length, 'permission')}
                    </span>
                  </span>
                  {counts ? (
                    <span className="text-muted-foreground shrink-0 text-xs font-normal">
                      {plural(userCount, 'user')}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <RolePermissions
        key={selected.id}
        role={selected}
        codes={allCodes}
        memberCount={counts?.get(selected.id) ?? null}
      />
    </div>
  );
}

interface RolePermissionsProps {
  role: Role;
  codes: readonly string[];
  /** How many users hold the role; null while the users are loading. */
  memberCount: number | null;
}

function RolePermissions({ role, codes, memberCount }: RolePermissionsProps) {
  const save = useSetRolePermissions();
  const can = useCan();
  const admin = isAdminRole(role);
  // Permissions it somehow holds can still be taken away; nothing can be granted.
  const locked = admin || (isSignUpRole(role) && role.permissions.length === 0);
  // Without `roles:manage` the API refuses every change, so the switches only show the state.
  const readOnly = !locked && !can('roles:manage');
  const description = roleDescription(role);

  function toggle(code: string, granted: boolean) {
    const next = granted
      ? role.permissions.filter((held) => held !== code)
      : [...role.permissions, code];
    save.mutate({ roleId: role.id, permissions: next });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{roleLabel(role)}</CardTitle>
        <CardDescription>
          {description ? `${description.replace(/\.$/, '')}. ` : ''}
          {formatNumber(role.permissions.filter((code) => codes.includes(code)).length)} of{' '}
          {formatNumber(codes.length)} permissions.
        </CardDescription>
        {memberCount !== null && memberCount > 0 ? (
          <Link
            href={usersHref({ status: 'all', role: role.id })}
            className="text-success focus-visible:ring-ring w-fit rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            See the {plural(memberCount, 'user')} who {memberCount === 1 ? 'holds' : 'hold'} it
          </Link>
        ) : null}
      </CardHeader>
      <CardContent className="gap-section flex flex-col">
        <section aria-label="What this role opens" className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            What this role opens on the web
          </h3>
          <WebAccessList roleNames={[role.name ?? '']} />
        </section>
        {locked ? (
          <Alert variant="info">
            <Lock aria-hidden="true" />
            <AlertTitle>This role cannot be changed</AlertTitle>
            <AlertDescription>
              {admin
                ? 'The administrator role always holds every permission, so someone can always manage access.'
                : 'Anyone can create an account with this role, so it holds no permissions. Give each new account the role it needs instead.'}
            </AlertDescription>
          </Alert>
        ) : null}
        {readOnly ? (
          <Alert variant="info">
            <Eye aria-hidden="true" />
            <AlertTitle>You can view these permissions but not change them</AlertTitle>
            <AlertDescription>
              Changing them needs the “{permissionLabel('roles:manage')}” permission.
            </AlertDescription>
          </Alert>
        ) : null}
        {save.isError ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Could not change the permission</AlertTitle>
            <AlertDescription>{getErrorMessage(save.error)}</AlertDescription>
          </Alert>
        ) : null}
        {groupPermissions(codes).map((group) => (
          <section key={group.label} aria-label={group.label} className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              {group.label}
            </h3>
            <ul className="divide-border flex flex-col divide-y rounded-lg border">
              {group.codes.map((code) => {
                const granted = role.permissions.includes(code);
                const id = `permission-${role.id}-${code}`;
                return (
                  <li key={code} className="flex items-center justify-between gap-4 px-3 py-2.5">
                    <Label htmlFor={id} className="min-w-0 flex-col items-start gap-0.5">
                      <span className="text-sm font-medium">{permissionLabel(code)}</span>
                      <span className="text-muted-foreground font-mono text-xs font-normal">
                        {code}
                      </span>
                    </Label>
                    <Switch
                      id={id}
                      checked={granted}
                      disabled={locked || readOnly || save.isPending}
                      onCheckedChange={() => {
                        toggle(code, granted);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {readOnly ? null : (
          <p className="text-muted-foreground text-sm">
            Changes apply as soon as you switch them, for everyone who holds this role.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
