'use client';

import {
  Activity,
  Ban,
  CircleCheck,
  History,
  MonitorSmartphone,
  Plus,
  ShieldCheck,
  UserCheck,
  Warehouse,
  UserRound,
  UserRoundX,
  Users,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import {
  ROW_ACTION_SEPARATOR,
  RowActions,
  type RowActionItem,
} from '@/components/data-table/RowActions';
import { ExportButton } from '@/components/ExportButton';
import { FilterSelect } from '@/components/FilterSelect';
import { FilterTabs } from '@/components/FilterTabs';
import { PageActions } from '@/components/PageActions';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { auditHref } from '@/features/audit/links';
import { useCurrentUser } from '@/features/auth/hooks';
import { useCan } from '@/features/auth/queries';
import { getErrorMessage } from '@/lib/api';
import { formatDate, formatNumber, formatSince, formatTimestamp, initialsOf } from '@/lib/format';

import type { User } from './api';
import { isActive, roleLabel, userRoleLabels, userStatusLabel } from './access';
import { BulkUserActions } from './BulkUserActions';
import { EditRolesDialog } from './EditRolesDialog';
import { EditStoreDialog } from './EditStoreDialog';
import {
  ACTIVITY_FILTERS,
  activityFilterFrom,
  matchesActivity,
  userStats,
  type ActivityFilter,
} from './insights';
import { useAccessRoles, useSetUserStatus, useUsers } from './queries';
import { RoleBadge } from './RoleBadge';
import { UserFormDialog } from './UserFormDialog';
import { userDisplayName } from './userForm';
import { UserProfileSheet } from './UserProfileSheet';
import { UserSessionsDialog } from './UserSessionsDialog';

export const USERS_PATH = '/moh/users';

/** The status filters, in the order shown. `status` in the address picks one. */
const STATUS_FILTERS = [
  { value: 'all', label: 'All', keeps: () => true },
  { value: 'active', label: 'Active', keeps: (user) => isActive(user) },
  { value: 'disabled', label: 'Deactivated', keeps: (user) => !isActive(user) },
] as const satisfies readonly { value: string; label: string; keeps: (user: User) => boolean }[];

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

function statusFilterFrom(param: string | null): (typeof STATUS_FILTERS)[number] {
  return STATUS_FILTERS.find((filter) => filter.value === param) ?? STATUS_FILTERS[0];
}

interface UsersFilters {
  status: StatusFilter;
  role: string;
  activity?: ActivityFilter;
}

/** The users list address for a set of filters, leaving out the defaults. */
export function usersHref({ status, role, activity = 'all' }: UsersFilters): string {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (role !== 'all') params.set('role', role);
  if (activity !== 'all') params.set('activity', activity);
  const query = params.toString();
  return query ? `${USERS_PATH}?${query}` : USERS_PATH;
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'roles'; user: User }
  | { kind: 'store'; user: User }
  | { kind: 'sessions'; user: User }
  | null;

/** "Today", "3 weeks ago" or "Never", with the exact time on hover. */
function LastSignIn({ user, now }: { user: User; now: Date }) {
  if (!user.last_login_at) return <span className="text-muted-foreground">Never</span>;
  return (
    <span title={formatTimestamp(user.last_login_at)}>{formatSince(user.last_login_at, now)}</span>
  );
}

export default function UsersPage() {
  const users = useUsers();
  const roles = useAccessRoles();
  const currentUser = useCurrentUser();
  const can = useCan();
  const setStatus = useSetUserStatus();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [now] = useState(() => new Date());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [userToDeactivate, setUserToDeactivate] = useState<User | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // Each row's actions button, so a dialog opened from its menu can hand focus back to it.
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());

  /** Sends focus back to a row's actions button as a dialog closes, if the row is still shown. */
  function focusRowActions(userId: string, event: Event) {
    const button = actionButtons.current.get(userId);
    if (!button?.isConnected) return;
    event.preventDefault();
    button.focus();
  }

  const statusFilter = statusFilterFrom(searchParams.get('status'));
  const activityFilter = activityFilterFrom(searchParams.get('activity'));
  const roleParam = searchParams.get('role') ?? 'all';
  const role = roles.data?.some((candidate) => candidate.id === roleParam) ? roleParam : 'all';
  const filters = { status: statusFilter.value, role, activity: activityFilter.value };

  // Actions the API would refuse are left out, matching each endpoint's permission.
  const canCreate = can('users:create', 'roles:assign');
  const canAssignRoles = can('roles:assign');
  const canReadAudit = can('audit:read');
  const canUpdate = can('users:update');

  const columns = useMemo<DataTableColumn<User>[]>(
    () => [
      {
        id: 'name',
        header: 'User',
        value: userDisplayName,
        cell: (user) => (
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden="true"
              className="bg-secondary text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold"
            >
              {initialsOf(userDisplayName(user))}
            </div>
            <div className="min-w-0">
              <Button
                data-print-text
                variant="link"
                size="sm"
                type="button"
                onClick={() => {
                  setProfileId(user.id);
                }}
                className="text-foreground block h-auto max-w-full truncate rounded-sm p-0 text-left"
                title={userDisplayName(user)}
              >
                {userDisplayName(user)}
              </Button>
              <p className="text-muted-foreground truncate text-xs" title={user.email ?? undefined}>
                {user.email ?? user.username}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'roles',
        filter: 'select',
        header: 'Roles',
        value: (user) => userRoleLabels(user).join(', '),
        cell: (user) => {
          if (user.roles.length === 0) return <span className="text-muted-foreground">—</span>;
          return (
            <ul className="flex flex-wrap gap-1">
              {user.roles.map((held) => (
                <li key={held.id}>
                  <RoleBadge role={held} />
                </li>
              ))}
            </ul>
          );
        },
      },
      { id: 'phone', header: 'Phone', value: (user) => user.phone_number, hideable: true },
      {
        id: 'status',
        filter: 'select',
        header: 'Status',
        value: (user) => userStatusLabel(user.status),
        cell: (user) => (
          <StatusBadge
            status={userStatusLabel(user.status)}
            tone={isActive(user) ? 'positive' : 'neutral'}
          />
        ),
      },
      {
        id: 'last-sign-in',
        filter: 'date',
        header: 'Last sign-in',
        // ISO timestamps sort in time order as text; "never" sorts with the missing values.
        value: (user) => user.last_login_at,
        cell: (user) => <LastSignIn user={user} now={now} />,
        hideable: true,
      },
      {
        id: 'devices',
        header: 'Devices',
        value: (user) => user.active_sessions ?? 0,
        numeric: true,
        hideable: true,
      },
      {
        id: 'sign-ins',
        header: 'Sign-ins',
        value: (user) => user.login_count ?? 0,
        numeric: true,
        defaultHidden: true,
      },
      {
        id: 'created',
        filter: 'date',
        header: 'Created',
        value: (user) => user.created_at,
        cell: (user) => formatDate(user.created_at),
        defaultHidden: true,
      },
    ],
    [now],
  );

  const all = users.data;
  const byRole = all?.filter(
    (user) => role === 'all' || user.roles.some((held) => held.id === role),
  );
  const byActivity = byRole?.filter((user) => matchesActivity(user, activityFilter, now));
  const rows = byActivity?.filter(statusFilter.keeps);
  const isFiltered =
    statusFilter.value !== 'all' || role !== 'all' || activityFilter.value !== 'all';
  const stats = all ? userStats(all, now) : null;
  const selectedUsers = rows?.filter((user) => selected.has(user.id)) ?? [];
  const profileUser = profileId ? (all?.find((user) => user.id === profileId) ?? null) : null;

  const addButton = canCreate ? (
    <Button
      onClick={() => {
        setDialog({ kind: 'create' });
      }}
    >
      <Plus data-icon="inline-start" />
      Add user
    </Button>
  ) : null;

  function reactivate(user: User) {
    setStatus.mutate(
      { id: user.id, status: 'active' },
      {
        onError: (error) => {
          toast.error(getErrorMessage(error));
        },
      },
    );
  }

  const statValue = (value: number | undefined) => formatNumber(value ?? 0);

  return (
    <div className="gap-section flex flex-col">
      <PageActions>
        <ExportButton name="Users" columns={columns} rows={rows} />
        {addButton}
      </PageActions>

      {/* Each figure is also a shortcut to the list behind it. */}
      <StatCardGrid>
        <StatCard
          label="Accounts"
          value={statValue(stats?.total)}
          icon={Users}
          isLoading={users.isPending}
          href={usersHref({ status: 'all', role: 'all' })}
        />
        <StatCard
          label="Can sign in"
          value={statValue(stats?.active)}
          icon={UserCheck}
          accent="positive"
          isLoading={users.isPending}
          href={usersHref({ status: 'active', role: 'all' })}
        />
        <StatCard
          label="Signed in this month"
          value={statValue(stats?.recent)}
          icon={Activity}
          accent="info"
          isLoading={users.isPending}
          href={usersHref({ status: 'all', role: 'all', activity: 'month' })}
        />
        <StatCard
          label="Never signed in"
          value={statValue(stats?.never)}
          icon={UserRoundX}
          accent="caution"
          isLoading={users.isPending}
          href={usersHref({ status: 'all', role: 'all', activity: 'never' })}
        />
      </StatCardGrid>

      <FilterTabs
        label="Filter users by status"
        value={statusFilter.value}
        hrefFor={(value) => usersHref({ ...filters, status: value })}
        tabs={STATUS_FILTERS.map((option) => ({
          value: option.value,
          label: option.label,
          ...(byActivity ? { count: byActivity.filter(option.keeps).length } : {}),
        }))}
      />

      <DataTable
        label="Users"
        columns={columns}
        rows={rows}
        getRowId={(user) => user.id}
        isLoading={users.isPending}
        error={users.error}
        onRetry={() => void users.refetch()}
        isRetrying={users.isRefetching}
        searchPlaceholder="Search name, email or phone…"
        preferencesKey="users"
        // Most legacy accounts have never signed in; the people actually using CLIMS come first.
        defaultSort={{ columnId: 'last-sign-in', direction: 'desc' }}
        selection={{
          selected,
          onChange: setSelected,
          rowLabel: userDisplayName,
        }}
        toolbar={
          <>
            <FilterSelect
              label="Role"
              value={role}
              disabled={!roles.data}
              options={[
                { value: 'all', label: 'All roles' },
                ...(roles.data ?? []).map((option) => ({
                  value: option.id,
                  label: roleLabel(option),
                })),
              ]}
              onValueChange={(next) => {
                router.replace(usersHref({ ...filters, role: next }));
              }}
            />
            <FilterSelect
              label="Activity"
              value={activityFilter.value}
              options={ACTIVITY_FILTERS.map(({ value, label }) => ({ value, label }))}
              onValueChange={(next) => {
                router.replace(usersHref({ ...filters, activity: next }));
              }}
            />
          </>
        }
        emptyTitle={isFiltered ? 'No users match these filters' : 'No users yet'}
        emptyDescription={
          isFiltered
            ? 'Choose another status, role or activity to see the rest.'
            : canCreate
              ? 'Add the first account so someone else can sign in.'
              : 'Accounts appear here once an administrator adds them.'
        }
        emptyAction={isFiltered ? undefined : addButton}
        rowActions={(user) => {
          // Deactivating the account you are signed in with would lock you out mid-session.
          const isSelf = currentUser !== null && currentUser.id === user.id;
          return (
            <RowActions
              label={`Actions for ${userDisplayName(user)}`}
              triggerRef={(button) => {
                if (button) actionButtons.current.set(user.id, button);
                else actionButtons.current.delete(user.id);
              }}
              actions={[
                {
                  label: 'View profile',
                  icon: UserRound,
                  onSelect: () => {
                    setProfileId(user.id);
                  },
                },
                ...(canAssignRoles
                  ? ([
                      {
                        label: 'Edit roles',
                        icon: ShieldCheck,
                        onSelect: () => {
                          setDialog({ kind: 'roles', user });
                        },
                      },
                    ] satisfies RowActionItem[])
                  : []),
                ...(canUpdate
                  ? ([
                      {
                        label: 'Change store',
                        icon: Warehouse,
                        onSelect: () => {
                          setDialog({ kind: 'store', user });
                        },
                      },
                    ] satisfies RowActionItem[])
                  : []),
                {
                  label: 'Signed-in devices',
                  icon: MonitorSmartphone,
                  onSelect: () => {
                    setDialog({ kind: 'sessions', user });
                  },
                },
                ...(canReadAudit
                  ? ([
                      {
                        label: 'Audit history',
                        icon: History,
                        onSelect: () => {
                          router.push(auditHref({ subject: { type: 'user', id: user.id } }));
                        },
                      },
                    ] satisfies RowActionItem[])
                  : []),
                ...(isSelf || !canUpdate
                  ? []
                  : ([
                      ROW_ACTION_SEPARATOR,
                      isActive(user)
                        ? {
                            label: 'Deactivate user',
                            icon: Ban,
                            destructive: true,
                            onSelect: () => {
                              setUserToDeactivate(user);
                            },
                          }
                        : {
                            label: 'Reactivate user',
                            icon: CircleCheck,
                            onSelect: () => {
                              reactivate(user);
                            },
                          },
                    ] satisfies RowActionItem[])),
              ]}
            />
          );
        }}
      />

      <BulkUserActions
        selected={selectedUsers}
        selfId={currentUser?.id ?? null}
        canUpdate={canUpdate}
        exportColumns={columns}
        onClear={() => {
          setSelected(new Set());
        }}
      />

      {profileUser ? (
        <UserProfileSheet
          key={profileUser.id}
          user={profileUser}
          isSelf={currentUser?.id === profileUser.id}
          canAssignRoles={canAssignRoles}
          canUpdate={canUpdate}
          onClose={() => {
            setProfileId(null);
          }}
          onEditRoles={() => {
            setProfileId(null);
            setDialog({ kind: 'roles', user: profileUser });
          }}
          onShowDevices={() => {
            setProfileId(null);
            setDialog({ kind: 'sessions', user: profileUser });
          }}
          onChangeStore={() => {
            setProfileId(null);
            setDialog({ kind: 'store', user: profileUser });
          }}
          onDeactivate={() => {
            setProfileId(null);
            setUserToDeactivate(profileUser);
          }}
          onReactivate={() => {
            reactivate(profileUser);
          }}
        />
      ) : null}

      {dialog?.kind === 'create' ? (
        <UserFormDialog
          roles={roles.data}
          isLoadingRoles={roles.isPending}
          rolesError={roles.error}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'sessions' ? (
        <UserSessionsDialog
          key={dialog.user.id}
          user={dialog.user}
          // Signing yourself out everywhere is done from your own account menu, one device at a time.
          canSignOut={canUpdate && currentUser?.id !== dialog.user.id}
          onClose={() => {
            setDialog(null);
          }}
          onCloseAutoFocus={(event) => {
            focusRowActions(dialog.user.id, event);
          }}
        />
      ) : null}
      {dialog?.kind === 'store' ? (
        <EditStoreDialog
          key={dialog.user.id}
          user={dialog.user}
          onClose={() => {
            setDialog(null);
          }}
          onCloseAutoFocus={(event) => {
            focusRowActions(dialog.user.id, event);
          }}
        />
      ) : null}
      {dialog?.kind === 'roles' ? (
        <EditRolesDialog
          key={dialog.user.id}
          user={dialog.user}
          roles={roles.data}
          isLoadingRoles={roles.isPending}
          rolesError={roles.error}
          onClose={() => {
            setDialog(null);
          }}
          onCloseAutoFocus={(event) => {
            focusRowActions(dialog.user.id, event);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={userToDeactivate !== null}
        onOpenChange={(open) => {
          if (open) return;
          setUserToDeactivate(null);
          setStatus.reset();
        }}
        title={
          userToDeactivate ? `Deactivate ${userDisplayName(userToDeactivate)}?` : 'Deactivate user?'
        }
        description="They will no longer be able to sign in. You can reactivate the account later."
        confirmLabel="Deactivate user"
        isPending={setStatus.isPending}
        error={setStatus.error}
        onConfirm={() => {
          if (!userToDeactivate) return;
          setStatus.mutate(
            { id: userToDeactivate.id, status: 'disabled' },
            {
              onSuccess: () => {
                setUserToDeactivate(null);
              },
            },
          );
        }}
      />
    </div>
  );
}
