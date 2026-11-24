'use client';

import { Eye, KeyRound, LogOut, ShieldAlert, Smartphone, UserRoundX } from 'lucide-react';
import Link from 'next/link';

import { Brand } from '@/components/layout/Brand';
import { EmptyState } from '@/components/states/EmptyState';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useCurrentUser, useSignOut } from '@/features/auth/hooks';
import { permissionLabel, roleLabel } from '@/features/users/access';

import type { NoWorkspaceReason } from './access';
import type { NavPage, Workspace } from './navigation';

/** The person's roles as people say them, e.g. "Hotspot manager and VHT". */
function useRoleList(): string {
  const names = useCurrentUser()?.roleNames ?? [];
  const labels = names.map((name) => roleLabel({ id: name, name }));
  if (labels.length <= 1) return labels[0] ?? 'no role';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
}

const NO_WORKSPACE_COPY: Record<
  NoWorkspaceReason,
  { title: string; body: (roles: string) => string }
> = {
  mobile: {
    title: 'Use the CLIMS mobile app',
    body: (roles) =>
      `Your role (${roles}) works in the field app, not on the web: mapping hotspots, reporting stockouts, confirming deliveries and recording drops. Sign in on your phone with this same account.`,
  },
  unassigned: {
    title: 'Your account has no web workspace yet',
    body: (roles) =>
      `Your role (${roles}) does not open any screen on the web. Ask an administrator to give you a role that does, such as District focal person, NMS or JMS.`,
  },
};

/**
 * Shown instead of the app to someone signed in whose roles open no web
 * workspace. There is nothing to navigate to, so it stands alone, with the way out.
 */
export function NoWebAccessPage({ reason }: { reason: NoWorkspaceReason }) {
  const signOut = useSignOut();
  const roles = useRoleList();
  const copy = NO_WORKSPACE_COPY[reason];
  const Icon = reason === 'mobile' ? Smartphone : UserRoundX;

  return (
    <main className="bg-canvas flex min-h-dvh items-center justify-center p-4">
      <div className="bg-card rounded-card flex w-full max-w-md flex-col gap-6 border p-6">
        <Brand />
        <div className="flex flex-col gap-3">
          <span
            aria-hidden="true"
            className="bg-secondary text-muted-foreground flex size-10 items-center justify-center rounded-lg"
          >
            <Icon className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-balance">{copy.title}</h1>
          <p className="text-muted-foreground text-sm text-pretty">{copy.body(roles)}</p>
        </div>
        <Button variant="outline" className="self-start" onClick={signOut}>
          <LogOut data-icon="inline-start" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </main>
  );
}

interface NotYourWorkspaceProps {
  workspace: Workspace;
  home: Workspace | null;
}

/** In place of a page from a workspace the person's roles do not open. */
export function NotYourWorkspace({ workspace, home }: NotYourWorkspaceProps) {
  const roles = useRoleList();
  return (
    <div className="bg-card rounded-card border">
      <EmptyState
        icon={ShieldAlert}
        title={`This page is in the ${workspace.label} workspace`}
        description={`Your role (${roles}) does not open it. ${home ? `Your work is in the ${home.label} workspace.` : ''}`}
        action={
          home ? (
            <Button asChild>
              <Link href={home.basePath}>Go to {home.label}</Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

interface NoPermissionProps {
  page: NavPage;
  home: Workspace | null;
}

/** In place of a page whose data needs a permission the person does not hold. */
export function NoPermission({ page, home }: NoPermissionProps) {
  return (
    <div className="bg-card rounded-card border">
      <EmptyState
        icon={KeyRound}
        title={`You cannot open ${page.title}`}
        description={
          page.permission
            ? `It needs the “${permissionLabel(page.permission)}” permission. An administrator can grant it to your role on Roles & permissions.`
            : 'Your role does not include this page.'
        }
        action={
          home ? (
            <Button asChild variant="outline">
              <Link href={home.basePath}>Go to {home.label}</Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/** Above the page in a workspace opened read-only, so the missing buttons are not a mystery. */
export function ReadOnlyNotice({ workspace }: { workspace: Workspace }) {
  return (
    <Alert variant="info" role="note">
      <Eye aria-hidden="true" />
      {workspace.id === 'moh' ? (
        <>
          <AlertTitle>Oversight view: read-only</AlertTitle>
          <AlertDescription>
            You can open every page, filter it and download what you see. Changes are made by
            administrators and by the teams that do the work.
          </AlertDescription>
        </>
      ) : (
        <>
          <AlertTitle>You are viewing the {workspace.label} workspace read-only</AlertTitle>
          <AlertDescription>
            You can open every page and export what you see. Actions such as confirming, dispatching
            or submitting are for the team that works here.
          </AlertDescription>
        </>
      )}
    </Alert>
  );
}

/** Shown when the server says the person's roles grant nothing, which makes every request fail. */
export function NoPermissionsNotice() {
  return (
    <Alert variant="warning" role="note">
      <KeyRound aria-hidden="true" />
      <AlertTitle>Your role has no permissions yet</AlertTitle>
      <AlertDescription>
        The server will refuse most of what this page asks for until an administrator grants your
        role some permissions on Roles & permissions.
      </AlertDescription>
    </Alert>
  );
}
