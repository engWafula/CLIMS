import { Ban, CircleCheck, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { DetailList } from '@/components/DetailList';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useStores } from '@/features/geography/queries';
import { formatDate, formatNumber, formatSince, formatTimestamp, initialsOf } from '@/lib/format';

import type { User } from './api';
import {
  groupPermissions,
  isActive,
  permissionLabel,
  roleDescription,
  userStatusLabel,
} from './access';
import { effectivePermissions } from './insights';
import { RoleBadge } from './RoleBadge';
import { storeLabel, storeNeedOf } from './stores';
import { userDisplayName } from './userForm';
import { WebAccessList } from './WebAccessList';

interface UserProfileSheetProps {
  user: User;
  /** Whether the viewer is looking at their own account. */
  isSelf: boolean;
  canAssignRoles: boolean;
  canUpdate: boolean;
  onClose: () => void;
  onEditRoles: () => void;
  onShowDevices: () => void;
  onChangeStore: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Everything about one account on one panel: who they are, the roles they
 * hold and what those let them open and do, and how much they use CLIMS. The
 * actions at the foot are the row menu's, for whoever may take them.
 */
export function UserProfileSheet({
  user,
  isSelf,
  canAssignRoles,
  canUpdate,
  onClose,
  onEditRoles,
  onShowDevices,
  onChangeStore,
  onDeactivate,
  onReactivate,
}: UserProfileSheetProps) {
  const stores = useStores();
  const store = stores.data?.find((candidate) => candidate.id === user.store_id);
  const storeNeed = storeNeedOf(user.roles.map((role) => role.name));
  let storeText = 'No store';
  if (store) storeText = storeLabel(store);
  else if (user.store_id)
    storeText = stores.isError ? 'Could not load the store' : 'A store no longer listed';
  const name = userDisplayName(user);
  const permissions = effectivePermissions(user);
  const devices = user.active_sessions ?? 0;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b pr-12">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="bg-secondary text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
            >
              {initialsOf(name)}
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-lg font-semibold" title={name}>
                {name}
              </SheetTitle>
              <SheetDescription className="truncate">
                {user.username ? `@${user.username}` : 'No username'}
              </SheetDescription>
            </div>
            <StatusBadge
              status={userStatusLabel(user.status)}
              tone={isActive(user) ? 'positive' : 'neutral'}
            />
          </div>
        </SheetHeader>

        <div className="gap-section flex flex-1 flex-col overflow-y-auto overscroll-contain p-4">
          <Section title="Contact">
            <DetailList
              items={[
                { label: 'Email', value: user.email ?? '—' },
                { label: 'Phone', value: user.phone_number ?? '—' },
              ]}
            />
          </Section>

          <Section title={`Roles (${formatNumber(user.roles.length)})`}>
            {user.roles.length === 0 ? (
              <p className="text-muted-foreground text-sm">No roles yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {user.roles.map((role) => (
                  <li key={role.id} className="flex flex-col items-start gap-1">
                    <RoleBadge role={role} />
                    {roleDescription(role) ? (
                      <span className="text-muted-foreground text-xs">{roleDescription(role)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Store">
            {user.store_id && stores.isPending ? (
              <div role="status" aria-busy="true">
                <span className="sr-only">Loading store…</span>
                <Skeleton aria-hidden="true" className="h-4 w-1/2" />
              </div>
            ) : (
              <p className="text-sm">{storeText}</p>
            )}
            {storeNeed && !user.store_id ? (
              <p className="text-muted-foreground text-xs">
                Their role works at a store. Until one is set they see no orders or stock.
              </p>
            ) : null}
            {canUpdate ? (
              <Button variant="link" className="h-auto self-start p-0" onClick={onChangeStore}>
                Change store
              </Button>
            ) : null}
          </Section>

          <Section title="What they can open">
            <WebAccessList roleNames={user.roles.map((role) => role.name ?? '')} />
          </Section>

          <Section title={`Permissions (${formatNumber(permissions.length)})`}>
            {permissions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Their roles grant no permissions, so the server refuses their requests. Grant some
                on Roles &amp; permissions.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {groupPermissions(permissions).map((group) => (
                  <div key={group.label} className="flex flex-col gap-1">
                    <p className="text-sm font-medium">{group.label}</p>
                    <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                      {group.codes.map((code) => (
                        <li key={code}>{permissionLabel(code)}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Activity">
            <DetailList
              items={[
                {
                  label: 'Last sign-in',
                  value: user.last_login_at ? (
                    <span title={formatTimestamp(user.last_login_at)}>
                      {formatSince(user.last_login_at)}
                    </span>
                  ) : (
                    'Never'
                  ),
                },
                { label: 'Sign-ins', value: formatNumber(user.login_count ?? 0) },
                {
                  label: 'Signed in on',
                  value: (
                    <Button variant="link" className="h-auto p-0" onClick={onShowDevices}>
                      {formatNumber(devices)} device{devices === 1 ? '' : 's'}
                    </Button>
                  ),
                },
                { label: 'Account created', value: formatDate(user.created_at) },
              ]}
            />
          </Section>
        </div>

        <SheetFooter className="flex-row flex-wrap border-t">
          {canAssignRoles ? (
            <Button variant="outline" onClick={onEditRoles}>
              <ShieldCheck data-icon="inline-start" aria-hidden="true" />
              Edit roles
            </Button>
          ) : null}
          <Button variant="outline" onClick={onShowDevices}>
            <MonitorSmartphone data-icon="inline-start" aria-hidden="true" />
            Devices
          </Button>
          {canUpdate && !isSelf ? (
            isActive(user) ? (
              <Button variant="destructive" className="sm:ml-auto" onClick={onDeactivate}>
                <Ban data-icon="inline-start" aria-hidden="true" />
                Deactivate
              </Button>
            ) : (
              <Button className="sm:ml-auto" onClick={onReactivate}>
                <CircleCheck data-icon="inline-start" aria-hidden="true" />
                Reactivate
              </Button>
            )
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
