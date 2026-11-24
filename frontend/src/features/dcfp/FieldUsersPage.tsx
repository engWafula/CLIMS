'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { PageActions } from '@/components/PageActions';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { useCan } from '@/features/auth/queries';
import { isActive, roleLabel, userStatusLabel } from '@/features/users/access';
import { RoleBadge } from '@/features/users/RoleBadge';
import { userDisplayName } from '@/features/users/userForm';
import { ApiError, toApiError } from '@/lib/api';
import { EMPTY_VALUE } from '@/lib/format';
import { useReadOnly } from '@/navigation/useAccess';

import { FieldUserFormDialog } from './FieldUserFormDialog';
import { assignmentOf, type FieldUser } from './fieldUsers';
import { useFieldUsers } from './queries';

/**
 * The VHTs, hotspot managers and delivery agents in the DCFP's district, with
 * where each works. A DCFP who may create accounts adds new ones here.
 */
export default function FieldUsersPage() {
  const users = useFieldUsers();
  const can = useCan();
  const readOnly = useReadOnly();
  const canCreate = !readOnly && can('users:district_create');
  const [creating, setCreating] = useState(false);
  // A 403 here means the account has no district to list, not a missing permission.
  const noDistrict = users.error ? toApiError(users.error).kind === 'forbidden' : false;

  const columns = useMemo<DataTableColumn<FieldUser>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        value: (user) => `${userDisplayName(user)} ${user.username ?? ''}`,
        cell: (user) => (
          <div className="min-w-0">
            <div className="font-medium">{userDisplayName(user)}</div>
            {user.username ? (
              <div className="text-muted-foreground truncate text-xs">{user.username}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'role',
        filter: 'select',
        header: 'Role',
        value: (user) => user.roles.map(roleLabel).join(', '),
        cell: (user) =>
          user.roles.length === 0 ? (
            <span className="text-muted-foreground">{EMPTY_VALUE}</span>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <li key={role.id}>
                  <RoleBadge role={role} />
                </li>
              ))}
            </ul>
          ),
      },
      {
        id: 'assignment',
        header: 'Works at',
        value: (user) => {
          const place = assignmentOf(user);
          return place ? `${place.kind} ${place.name}` : '';
        },
        cell: (user) => {
          const place = assignmentOf(user);
          if (!place) return <span className="text-muted-foreground">Not assigned</span>;
          return (
            <div className="min-w-0">
              <div>{place.name}</div>
              <div className="text-muted-foreground text-xs">{place.kind}</div>
            </div>
          );
        },
      },
      {
        id: 'phone',
        header: 'Phone',
        hideable: true,
        value: (user) => user.phone_number,
        cell: (user) => user.phone_number ?? EMPTY_VALUE,
      },
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
    ],
    [],
  );

  return (
    <div className="gap-section flex flex-col">
      {canCreate ? (
        <PageActions>
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus data-icon="inline-start" />
            New user
          </Button>
        </PageActions>
      ) : null}
      <DataTable
        label="Field users"
        preferencesKey="dcfp-field-users"
        columns={columns}
        rows={users.data}
        getRowId={(user) => user.id}
        isLoading={users.isPending}
        error={
          noDistrict
            ? new ApiError({
                kind: 'forbidden',
                status: 403,
                message:
                  'Your account has no district store or subcounty, so there is no district to list. Ask an administrator to assign your district store.',
              })
            : users.error
        }
        onRetry={() => void users.refetch()}
        isRetrying={users.isRefetching}
        searchPlaceholder="Search name, username or phone…"
        emptyTitle="No field users yet"
        emptyDescription={
          canCreate
            ? 'Add the VHTs, hotspot managers and delivery agents who work in your district.'
            : 'VHTs, hotspot managers and delivery agents in your district appear here.'
        }
      />
      {creating ? (
        <FieldUserFormDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}
