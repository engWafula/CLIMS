import { WAREHOUSES, type WarehouseCode } from '@/features/fulfilment/api';

import type { NavItem, NavPage, NavSection, Workspace } from './navigation';

/*
 * Who may open what on the web. The API authorises every request by
 * permission; this decides which workspaces a signed-in person sees, so a JMS
 * user lands in the warehouse screens for JMS and is not shown the DCFP queue.
 * It is a view decision only: a tampered client still gets the API's 403s.
 *
 * Workspaces follow the role (the CLIMS roles are organisational: a DCFP runs a
 * district store, JMS a national warehouse). Within a workspace, actions follow
 * permissions (see `useCan`), because administrators tune those per role.
 */

export type WorkspaceId = 'moh' | 'dcfp' | 'warehouse';

/** `full` can act; `read` can look but every action is turned off. */
export type AccessLevel = 'full' | 'read';

export type WorkspaceAccess = Readonly<Partial<Record<WorkspaceId, AccessLevel>>>;

/** Why someone with a role has no web workspace at all. */
export type NoWorkspaceReason = 'mobile' | 'unassigned';

export interface WebAccess {
  workspaces: WorkspaceAccess;
  /** The warehouses the warehouse workspace may show, in switch order. */
  warehouses: readonly WarehouseCode[];
  /** Set when `workspaces` is empty: the mobile app is their tool, or no role opens the web. */
  noWorkspace: NoWorkspaceReason | null;
}

const ALL_FULL: WorkspaceAccess = { moh: 'full', dcfp: 'full', warehouse: 'full' };

interface RoleAccess {
  workspaces: WorkspaceAccess;
  warehouses?: readonly WarehouseCode[];
  /** The role works only in the field app: web sign-in refuses it and points it there. */
  mobile?: boolean;
}

/**
 * What each CLIMS role opens. Names are the server's, lower-cased; `dcfp` and
 * `dfcp` are both in use for the district focal person. A role missing here
 * (one added on the server later) opens nothing until it is added.
 */
const ROLE_ACCESS: Readonly<Record<string, RoleAccess>> = {
  admin: { workspaces: ALL_FULL, warehouses: WAREHOUSES },
  // MOH oversees the whole programme and changes nothing: every workspace opens read-only, its
  // own included (decided 2026-11-24; migration 39 grants it every read permission and no write).
  moh: {
    workspaces: { moh: 'read', dcfp: 'read', warehouse: 'read' },
    warehouses: WAREHOUSES,
  },
  dfcp: { workspaces: { dcfp: 'full' } },
  dcfp: { workspaces: { dcfp: 'full' } },
  nms: { workspaces: { warehouse: 'full' }, warehouses: ['NMS'] },
  jms: { workspaces: { warehouse: 'full' }, warehouses: ['JMS'] },
  // Field roles have no web access: they map hotspots, report stockouts and carry stock in the
  // mobile app.
  vht: { workspaces: {}, mobile: true },
  'hotspot manager': { workspaces: {}, mobile: true },
  'delivery agent': { workspaces: {}, mobile: true },
};

/** The order workspaces are offered in, and the first one a person can act in is their home. */
export const WORKSPACE_ORDER: readonly WorkspaceId[] = ['moh', 'dcfp', 'warehouse'];

const rank = (level: AccessLevel | undefined) => (level === 'full' ? 2 : level === 'read' ? 1 : 0);

/**
 * The web access of someone holding `roleNames`: the widest access any of their
 * roles gives, workspace by workspace. `null` (roles not known yet, as for a
 * session saved before roles were kept) keeps every workspace open until the
 * server says otherwise; the API still refuses what they may not do.
 */
export function webAccessFor(roleNames: readonly string[] | null): WebAccess {
  if (roleNames === null)
    return { workspaces: ALL_FULL, warehouses: WAREHOUSES, noWorkspace: null };

  const workspaces: Partial<Record<WorkspaceId, AccessLevel>> = {};
  const warehouses = new Set<WarehouseCode>();
  let mobile = false;
  for (const name of roleNames) {
    const access = ROLE_ACCESS[name.trim().toLowerCase()];
    if (!access) continue;
    mobile ||= access.mobile === true;
    for (const id of WORKSPACE_ORDER) {
      const level = access.workspaces[id];
      if (rank(level) > rank(workspaces[id])) workspaces[id] = level;
    }
    for (const code of access.warehouses ?? []) warehouses.add(code);
  }

  const hasWorkspace = Object.keys(workspaces).length > 0;
  return {
    workspaces,
    warehouses: WAREHOUSES.filter((code) => warehouses.has(code)),
    noWorkspace: hasWorkspace ? null : mobile ? 'mobile' : 'unassigned',
  };
}

/** The access to `workspace`, or `null` when it is not theirs to open. */
export function accessTo(access: WebAccess, workspace: string): AccessLevel | null {
  return access.workspaces[workspace as WorkspaceId] ?? null;
}

/**
 * Where someone lands after signing in: the first workspace they can act in,
 * else the first they can look at, else null (they have no web workspace).
 */
export function homeWorkspace(access: WebAccess): WorkspaceId | null {
  return (
    WORKSPACE_ORDER.find((id) => access.workspaces[id] === 'full') ??
    WORKSPACE_ORDER.find((id) => access.workspaces[id] === 'read') ??
    null
  );
}

/** A warehouse the person may see: the requested one if allowed, else their first. */
export function allowedWarehouse(
  access: WebAccess,
  requested: WarehouseCode,
): WarehouseCode | null {
  if (access.warehouses.includes(requested)) return requested;
  return access.warehouses[0] ?? null;
}

/**
 * The navigation as one person sees it: only the workspaces their roles open
 * (those they may only look at marked `readOnly`), and within them only the
 * pages whose permission they hold. Items and sections left empty are dropped.
 */
export function navigationFor(
  workspaces: readonly Workspace[],
  access: WebAccess,
  can: (code: string) => boolean,
): Workspace[] {
  const allowed = (page: NavPage) => page.permission === undefined || can(page.permission);
  return workspaces.flatMap((workspace) => {
    const level = accessTo(access, workspace.id);
    if (!level) return [];
    const sections = workspace.sections.flatMap((section): NavSection[] => {
      const items = section.items.flatMap((item): NavItem[] => {
        const [first, ...rest] = item.pages.filter(allowed);
        return first ? [{ ...item, pages: [first, ...rest] }] : [];
      });
      return items.length > 0 ? [{ ...section, items }] : [];
    });
    return [{ ...workspace, sections, readOnly: level === 'read' }];
  });
}
