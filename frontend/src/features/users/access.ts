import type { Role, User } from './api';

/*
 * How roles and permissions read on screen. The API stores the original
 * CLIMS role names (`dfcp`, `store incharge`, …) and permission codes
 * (`users:read`); people see the names below. Anything not listed is shown
 * as stored, so a role or permission added on the server still appears.
 */

const ROLE_NAMES: Readonly<Record<string, { label: string; description: string }>> = {
  admin: {
    label: 'Administrator',
    description: 'System administration. Its permissions cannot be changed.',
  },
  moh: { label: 'MOH', description: 'National oversight of condom supply and use' },
  nms: { label: 'NMS', description: 'Fulfils district orders at National Medical Stores' },
  jms: { label: 'JMS', description: 'Fulfils district orders at Joint Medical Store' },
  dfcp: {
    label: 'District focal person',
    description: 'Runs a district store and its hotspot orders',
  },
  dcfp: {
    label: 'District focal person',
    description: 'Runs a district store and its hotspot orders',
  },
  'store incharge': {
    label: 'Store in charge',
    description: 'Receives and issues stock at a facility store',
  },
  'hotspot manager': {
    label: 'Hotspot manager',
    description: 'Reports stockouts and confirms deliveries',
  },
  'delivery agent': {
    label: 'Delivery agent',
    description: 'Carries stock and delivery notes to hotspots',
  },
  'other supplier': { label: 'Other supplier', description: 'Submits donated or procured stock' },
  'healthy facility': { label: 'Health facility', description: 'A facility that holds stock' },
  vht: { label: 'VHT', description: 'Maps hotspots and requests stock for them' },
};

/** The role the API refuses to change the permissions of. */
export const ADMIN_ROLE_NAME = 'admin';

function known(name: string | null) {
  return name ? ROLE_NAMES[name.trim().toLowerCase()] : undefined;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A role's display name. */
export function roleLabel(role: Pick<Role, 'id' | 'name'>): string {
  return known(role.name)?.label ?? (role.name ? capitalise(role.name) : `Role ${role.id}`);
}

/** One line on what a role is for, or null when there is nothing to say. */
export function roleDescription(role: Pick<Role, 'name'>): string | null {
  return known(role.name)?.description ?? null;
}

export function isAdminRole(role: Pick<Role, 'name'>): boolean {
  return role.name?.trim().toLowerCase() === ADMIN_ROLE_NAME;
}

/** The role public sign-up gives; the API refuses to grant it anything (anyone can register). */
export function isSignUpRole(role: Pick<Role, 'name'>): boolean {
  return role.name?.trim().toLowerCase() === 'registered user';
}

/** The names of every role a user holds, falling back to their primary role. */
export function userRoleLabels(user: Pick<User, 'roles' | 'role'>): string[] {
  if (user.roles.length > 0) return user.roles.map(roleLabel);
  return user.role ? [roleLabel({ id: '', name: user.role })] : [];
}

/*
 * Every permission the Go API defines (its migrations 2, 6, 8, 13, 18 and 29), worded
 * from the server's own descriptions. "Assigned" store, hotspot or district
 * means the one on the user's account; the `all_*` codes lift that limit.
 */
const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'catalogue:manage':
    'Create, edit and retire condom products, product types, brands and units of measure',
  'users:read': 'List users and view user accounts',
  'users:create': 'Create user accounts',
  'users:update': 'Activate or disable user accounts',
  'users:district_read': 'List the field users in their district',
  'users:district_create':
    'Create VHT, hotspot manager and delivery agent accounts in their district',
  'roles:read': 'List roles and their permissions',
  'roles:assign': 'Assign roles to users',
  'roles:manage': 'Change the permissions of roles',
  'orders:read': 'View orders involving their store',
  'orders:stockout': 'Report stockouts at their hotspot',
  'orders:process': 'Approve, reject, check and dispatch orders placed with their warehouse',
  'orders:replenish': 'Order stock from NMS or JMS for their district store',
  'orders:receive': 'Check and record stock their store received',
  'orders:all_stores': 'Use their order permissions for every store',
  'inventory:read': 'View stock balances, movements and hotspot deliveries',
  'inventory:manage': 'Record stock received and stock adjustments at their store',
  'hotspots:read': 'View hotspots they submitted or in their district',
  'hotspots:submit': 'Submit newly identified hotspots for activation',
  'hotspots:activate': 'Verify and activate hotspots in their district',
  'hotspots:all_districts': 'Use their hotspot permissions in every district',
  'orders:supply_hotspots': 'Deliver stock to hotspots in their district',
  'orders:deliver': 'Carry hotspot deliveries named for them, and see those deliveries',
  'reports:read': 'View programme reports and download them',
  'reports:configure': "Set their store's review cycle, receipt deadline and on-time target",
  'reports:approve': 'Approve report versions and record corrections',
  'audit:read': 'Search the audit log of sign-ins and changes',
};

const GROUP_LABELS: Readonly<Record<string, string>> = {
  catalogue: 'Catalogue',
  users: 'Users',
  roles: 'Roles',
  orders: 'Orders',
  inventory: 'Inventory',
  hotspots: 'Hotspots',
  reports: 'Reports',
  audit: 'Audit log',
};

export function permissionLabel(code: string): string {
  return PERMISSION_LABELS[code] ?? code;
}

export interface PermissionGroup {
  label: string;
  codes: string[];
}

/** Permissions grouped by the part before the colon (`users:read` → Users), in the order given. */
export function groupPermissions(codes: readonly string[]): PermissionGroup[] {
  const groups = new Map<string, string[]>();
  for (const code of codes) {
    const key = code.includes(':') ? (code.split(':')[0] ?? code) : 'other';
    groups.set(key, [...(groups.get(key) ?? []), code]);
  }
  return [...groups].map(([key, list]) => ({
    label: GROUP_LABELS[key] ?? capitalise(key),
    codes: list,
  }));
}

/** How many users hold each role, by role id. */
export function usersPerRole(users: readonly Pick<User, 'roles'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const user of users) {
    for (const role of user.roles) counts.set(role.id, (counts.get(role.id) ?? 0) + 1);
  }
  return counts;
}

/** The status word for a user: the API's `disabled` reads as "Deactivated", as in the design. */
export function userStatusLabel(status: string | null): string | null {
  if (!status) return null;
  const key = status.toLowerCase();
  if (key === 'active') return 'Active';
  if (key === 'disabled') return 'Deactivated';
  return capitalise(status);
}

export function isActive(user: Pick<User, 'status'>): boolean {
  return user.status?.toLowerCase() === 'active';
}
