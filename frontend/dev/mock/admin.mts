/**
 * MOH administration resources for the mock API: users, roles and
 * permissions, the product catalogue, stores, geography and the audit log.
 *
 * Users, roles, permissions and the catalogue mirror the Go API exactly
 * (`backend/internal/features/{users,rbac,catalogue}`): the same paths, UUID ids,
 * the `{ users, limit, offset }` page, role objects with permission codes, and
 * validation failures under JSON field names with the validator's messages
 * (`{ "username": "Use at least 3 characters." }`).
 *
 * The audit log mirrors the Go API too (`backend/internal/features/audit`):
 * `GET /audit` with its filters, entries in the same shape, newest first.
 * Stores mirror the live endpoint.
 *
 * Geography is NOT YET IN THE GO API.
 * Its path and shape are the contract in `src/features/stores/api.ts`
 * (Phase 7 of `design/IMPLEMENTATION_PLAN.md`). Replies use the Go API's
 * `{ success, data }` envelope and `{ success: false, message, error }` failures.
 */

import { MOCK_STORES, mockDistrictStoreId } from './hotspots.mts';

export interface Reply {
  status: number;
  body: unknown;
}

type Body = Record<string, unknown>;

interface Role {
  id: string;
  name: string;
  permissions: string[];
}

interface User {
  id: string;
  username: string;
  email: string;
  firstname: string;
  lastname: string;
  phone_number: string;
  status: string;
  role_ids: string[];
  /** When they last signed in; null for an account never used. */
  last_login_at: string | null;
  login_count: number;
  created_at: string;
  /** The store whose orders and stock they work with. */
  store_id: string | null;
}

/** A product type, a brand or a unit of measure (`catalogue.Lookup` in the Go API). */
interface Lookup {
  id: string;
  name: string;
  note: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

type ProductCategory = 'male' | 'female';

/** A product as stored. Legacy products may lack any of the nullable fields. */
interface Product {
  id: string;
  category: ProductCategory | null;
  type_id: string | null;
  brand_id: string | null;
  unit_id: string | null;
  pieces_per_unit: number | null;
  active: boolean;
  /** Stands in for orders and stock records that reference the product. */
  referenced: boolean;
  created_at: string;
  updated_at: string;
}

interface Store {
  id: string;
  name: string;
  kind: 'national' | 'district';
  region: string | null;
  district: string | null;
  code: string;
  user_count: number;
  on_hand: {
    category: 'male' | 'female' | null;
    unit_id: string;
    unit: string;
    quantity: number;
  }[];
}

interface Subcounty {
  id: string;
  name: string;
  facility_count: number;
  hotspot_count: number;
}
interface District {
  id: string;
  name: string;
  store_count: number;
  hotspot_count: number;
  subcounties: Subcounty[];
}
interface Region {
  id: string;
  name: string;
  district_count: number;
  districts: District[];
}
interface Geography {
  synced_at: string | null;
  counts: { regions: number; districts: number; subcounties: number; facilities: number };
  regions: Region[];
}

interface AuditSubject {
  type: string;
  id: string;
}
interface AuditActor {
  id: string;
  username: string | null;
  roles: string[];
}
type AuditChanges = Record<string, { before: unknown; after: unknown }>;
interface AuditEntry {
  id: string;
  occurred_at: string;
  action: string;
  outcome: 'success' | 'failure';
  reason: string | null;
  actor: AuditActor | null;
  system_actor: string | null;
  target: AuditSubject | null;
  subjects: AuditSubject[];
  changes: AuditChanges | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  session_id: string | null;
}

/** Who the mock says made a change; the mock sign-in is always this person. */
const ACTOR: AuditActor = {
  id: '00000000-0000-4000-8002-000000000999',
  username: 'sarah.nakato',
  roles: ['admin'],
};
const MOCK_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const ok = (data: unknown, status = 200): Reply => ({ status, body: { success: true, data } });
const fail = (status: number, message: string, error?: Record<string, string>): Reply => ({
  status,
  body: error ? { success: false, message, error } : { success: false, message },
});

/** A stable UUID-shaped id, so links and tests can refer to records across restarts. */
function uuid(prefix: number, n: number): string {
  return `00000000-0000-4000-${String(8000 + prefix)}-${String(n).padStart(12, '0')}`;
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** The Go API's permission catalogue, in the order `GET /permissions` lists it. */
export const PERMISSIONS = [
  'catalogue:manage',
  'hotspots:activate',
  'hotspots:all_districts',
  'hotspots:read',
  'hotspots:submit',
  'inventory:manage',
  'inventory:read',
  'orders:all_stores',
  'orders:process',
  'orders:read',
  'orders:receive',
  'orders:replenish',
  'orders:stockout',
  'orders:supply_hotspots',
  'audit:read',
  'reports:approve',
  'reports:configure',
  'reports:read',
  'roles:assign',
  'roles:manage',
  'roles:read',
  'users:create',
  'users:read',
  'users:update',
];

const ROLE_SEED: readonly [string, string[]][] = [
  ['admin', PERMISSIONS],
  // Migration 39: MOH reads everything and changes nothing; the warehouses read their reports.
  [
    'moh',
    [
      'audit:read',
      'hotspots:all_districts',
      'hotspots:read',
      'inventory:read',
      'orders:all_stores',
      'orders:read',
      'reports:read',
      'roles:read',
      'users:read',
    ],
  ],
  ['nms', ['catalogue:manage', 'reports:read']],
  ['jms', ['catalogue:manage', 'reports:read']],
  ['dfcp', ['users:read']],
  ['store incharge', []],
  ['hotspot manager', []],
  ['delivery agent', []],
  ['other supplier', []],
  ['healthy facility', []],
  ['vht', []],
];

function seedRoles(): Role[] {
  return ROLE_SEED.map(([name, permissions], index) => ({
    id: uuid(1, index + 1),
    name,
    permissions: [...permissions],
  }));
}

const roleId = (name: string) =>
  uuid(1, ROLE_SEED.findIndex(([candidate]) => candidate === name) + 1);

/** first, last, email, phone, roles, status */
const DEMO_USERS: readonly [string, string, string, string, string[], string][] = [
  ['Sarah', 'Nakato', 's.nakato@health.go.ug', '+256772100200', ['admin'], 'active'],
  ['Ruth', 'Akello', 'r.akello@health.go.ug', '+256772100201', ['moh'], 'active'],
  ['Sarah', 'Namubiru', 's.namubiru@wakiso.go.ug', '+256701220415', ['dfcp'], 'active'],
  ['Harriet', 'Achieng', 'h.achieng@mukono.go.ug', '+256782330118', ['dfcp'], 'active'],
  ['Denis', 'Okot', 'd.okot@gulu.go.ug', '+256772451090', ['dfcp'], 'active'],
  ['Daniel', 'Ochieng', 'd.ochieng@nms.go.ug', '+256772600118', ['nms'], 'active'],
  ['Paul', 'Ssekandi', 'p.ssekandi@jms.co.ug', '+256752118334', ['jms'], 'active'],
  [
    'Joseph',
    'Ssemwogerere',
    'j.ssemwogerere@example.org',
    '+256776902331',
    ['vht', 'hotspot manager'],
    'active',
  ],
  ['Grace', 'Nakato', 'g.nakato@example.org', '+256772418903', ['hotspot manager'], 'active'],
  ['Ronald', 'Kizza', 'r.kizza@example.org', '+256754220118', ['hotspot manager'], 'active'],
  ['Musa', 'Kato', 'm.kato@example.org', '+256701334920', ['delivery agent'], 'active'],
  ['Peter', 'Okello', 'p.okello@example.org', '+256782105447', ['delivery agent'], 'active'],
  ['Brian', 'Mugisha', 'b.mugisha@example.org', '+256759440812', ['delivery agent'], 'disabled'],
];

/** Days since each demo user last signed in, in `DEMO_USERS` order; null: never. */
const LAST_SEEN_DAYS: readonly (number | null)[] = [
  0,
  1,
  3,
  12,
  40,
  2,
  130,
  null,
  5,
  0,
  200,
  null,
  60,
];

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();

/** A demo account's store, as migration 20 assigns it: DCFPs at Wakiso's, warehouse staff at theirs. */
function seedStoreFor(roles: readonly string[]): string | null {
  if (roles.includes('dfcp')) return mockDistrictStoreId('Wakiso');
  const warehouse = roles.find((role) => role === 'jms' || role === 'nms');
  return MOCK_STORES.find((store) => store.code === warehouse)?.id ?? null;
}

function seedUsers(dataset: string): User[] {
  if (dataset === 'empty') return [];
  const rows = DEMO_USERS.map(
    ([firstname, lastname, email, phone_number, roles, status], index) => ({
      last_login_at:
        LAST_SEEN_DAYS[index] === null ? null : daysAgo((LAST_SEEN_DAYS[index] ?? 0) + 0.2),
      login_count: LAST_SEEN_DAYS[index] === null ? 0 : 7 + ((index * 37) % 400),
      created_at: daysAgo(420 - index * 25),
      id: uuid(2, index + 1),
      username: `${firstname}.${lastname}`.toLowerCase(),
      email,
      firstname,
      lastname,
      phone_number,
      status,
      role_ids: roles.map(roleId),
      store_id: seedStoreFor(roles),
    }),
  );
  if (dataset !== 'worst') return rows;
  return [
    {
      id: uuid(2, 900),
      username: 'averyveryveryverylongusernamethatdoesnotbreak',
      email:
        'an.unbreakably.long.email.address.for.testing.overflow@regional-referral-hospital.example.org',
      firstname: 'Wolfeschlegelstei',
      lastname: 'Kyomuhendo-Tibamwe',
      phone_number: '',
      status: 'disabled',
      role_ids: ROLE_SEED.map(([name]) => roleId(name)),
      last_login_at: daysAgo(3650),
      login_count: 1_234_567,
      created_at: daysAgo(4000),
      store_id: null,
    },
    {
      id: uuid(2, 901),
      username: 'x',
      email: 'x@example.org',
      firstname: '',
      lastname: '',
      phone_number: '+256700000000',
      status: 'active',
      role_ids: [],
      last_login_at: null,
      login_count: 0,
      created_at: daysAgo(0),
      store_id: null,
    },
    ...rows,
  ];
}

const BRAND = (n: number) => uuid(21, n);
const UNIT = (n: number) => uuid(22, n);
const TYPE = (n: number) => uuid(23, n);

/** A seeded catalogue product's or unit's id, for other mocks that refer to them. */
export const mockProductId = (n: number) => uuid(20, n);
export const mockUnitId = UNIT;

/** A catalogue product's category, unit and pack size, for mocks that send it; null when unknown. */
export function mockProductFacts(productId: string) {
  const found = state.products.find((product) => product.id === productId);
  return found
    ? {
        category: found.category,
        unit_id: found.unit_id,
        pieces_per_unit: found.pieces_per_unit,
        active: found.active,
      }
    : null;
}

function lookup(id: string, name: string, note: string | null, active = true, age = 400): Lookup {
  return { id, name, note, active, created_at: daysAgo(age), updated_at: daysAgo(age / 2) };
}

/** The three distribution channels migration 23 seeds, and a retired one. */
function seedTypes(dataset: string): Lookup[] {
  if (dataset === 'empty') return [];
  const rows = [
    lookup(TYPE(1), 'Free', 'Public sector, free to the user'),
    lookup(TYPE(2), 'Socially marketed', 'Subsidised and sold through social marketing'),
    lookup(TYPE(3), 'Commercial', 'Sold at full price by the private sector'),
    lookup(TYPE(4), 'Workplace', 'Given out by employers; no longer tracked', false),
  ];
  if (dataset === 'worst') {
    rows.unshift(lookup(TYPE(99), 'Donated through implementing partners', 'x'.repeat(120)));
  }
  return rows;
}

function seedBrands(dataset: string): Lookup[] {
  if (dataset === 'empty') return [];
  const rows = [
    lookup(BRAND(1), 'Engabu', 'Free public-sector brand'),
    lookup(BRAND(2), 'FC2', 'Female condom'),
    lookup(BRAND(3), 'Protector Plus', 'Socially marketed'),
    lookup(BRAND(4), 'Trust', null),
    lookup(BRAND(5), 'Lifeguard', 'No longer supplied', false),
  ];
  if (dataset === 'worst') {
    rows.unshift(
      lookup(
        BRAND(99),
        'A brand name long enough to fill the whole sixty-character li',
        'x'.repeat(120),
      ),
    );
  }
  return rows;
}

function seedUnits(dataset: string): Lookup[] {
  if (dataset === 'empty') return [];
  return [
    lookup(UNIT(1), 'Piece', 'A single condom. Every order and stock count uses this.'),
    lookup(UNIT(2), 'Box', 'Retail box'),
    lookup(UNIT(3), 'Carton', 'Shipping carton from the warehouse'),
    lookup(UNIT(4), 'Strip', 'Retired in favour of boxes', false),
  ];
}

function seedProducts(dataset: string): Product[] {
  if (dataset === 'empty') return [];
  const product = (
    n: number,
    category: ProductCategory | null,
    type: number | null,
    brand: number | null,
    unit: number | null,
    pieces_per_unit: number | null,
    { active = true, referenced = false } = {},
  ): Product => ({
    id: uuid(20, n),
    category,
    type_id: type === null ? null : TYPE(type),
    brand_id: brand === null ? null : BRAND(brand),
    unit_id: unit === null ? null : UNIT(unit),
    pieces_per_unit,
    active,
    referenced,
    created_at: daysAgo(300 - n),
    updated_at: daysAgo(100 - n),
  });
  const rows = [
    product(1, 'male', 1, 1, 1, 1, { referenced: true }),
    product(2, 'male', 1, 1, 2, 144, { referenced: true }),
    product(3, 'male', 1, 1, 3, 4320),
    product(4, 'female', 1, 2, 1, 1, { referenced: true }),
    product(5, 'female', 1, 2, 2, 100),
    product(6, 'male', 2, 3, 1, 1, { active: false }),
    // Converted from the legacy system: no unit or pack size, so it must be completed.
    product(7, 'male', 3, 4, null, null, { referenced: true }),
    // Legacy with an unrecognised category and type, so it was deactivated.
    product(8, null, null, 4, null, null, { active: false, referenced: true }),
  ];
  if (dataset === 'worst') {
    rows.unshift(product(99, 'female', 99, 99, 3, 99_999));
  }
  return rows;
}

function seedStores(dataset: string): Store[] {
  if (dataset === 'empty') return [];
  const district = (
    id: string,
    name: string,
    region: string,
    code: string,
    user_count: number,
    male: number,
    female: number,
  ): Store => ({
    id,
    name: `${name} district store`,
    kind: 'district',
    region,
    district: name,
    code,
    user_count,
    on_hand: [
      { category: 'male', unit_id: 'piece', unit: 'pieces', quantity: male },
      { category: 'female', unit_id: 'piece', unit: 'pieces', quantity: female },
    ],
  });
  return [
    {
      id: 'store-jms',
      name: 'JMS · Kampala',
      kind: 'national',
      region: 'Central',
      district: 'Kampala',
      code: 'jms',
      user_count: 1,
      on_hand: [
        { category: 'male', unit_id: 'piece', unit: 'pieces', quantity: 1_840_000 },
        { category: 'female', unit_id: 'piece', unit: 'pieces', quantity: 52_000 },
      ],
    },
    {
      id: 'store-nms',
      name: 'NMS · Entebbe',
      kind: 'national',
      region: 'Central',
      district: 'Wakiso',
      code: 'nms',
      user_count: 1,
      on_hand: [
        { category: 'male', unit_id: 'piece', unit: 'pieces', quantity: 2_960_000 },
        { category: 'female', unit_id: 'piece', unit: 'pieces', quantity: 118_000 },
      ],
    },
    district('store-wakiso', 'Wakiso', 'Central', 'aXmBzv61LbM', 4, 14_400, 600),
    district('store-mukono', 'Mukono', 'Central', 'ccs8Ldr4qRf', 1, 3_900, 210),
    district('store-gulu', 'Gulu', 'Northern', 'x75Yh65MaUa', 1, 7_250, 0),
    district('store-mbarara', 'Mbarara', 'Western', 'ztIyIYAzFKp', 0, 11_600, 540),
  ];
}

function seedGeography(dataset: string): Geography {
  if (dataset === 'empty') {
    return {
      synced_at: null,
      counts: { regions: 0, districts: 0, subcounties: 0, facilities: 0 },
      regions: [],
    };
  }
  const sub = (id: string, name: string, facility_count: number, hotspot_count = 0): Subcounty => ({
    id,
    name,
    facility_count,
    hotspot_count,
  });
  const today6am = new Date();
  today6am.setUTCHours(3, 0, 0, 0); // 06:00 in Kampala
  return {
    synced_at: today6am.toISOString(),
    counts: { regions: 4, districts: 146, subcounties: 2184, facilities: 7412 },
    regions: [
      {
        id: 'region-central',
        name: 'Central',
        district_count: 27,
        districts: [
          {
            id: 'district-wakiso',
            name: 'Wakiso',
            store_count: 1,
            hotspot_count: 9,
            subcounties: [
              sub('sc-katabi', 'Katabi TC', 14, 3),
              sub('sc-kajjansi', 'Kajjansi TC', 11, 2),
              sub('sc-nansana', 'Nansana Municipality', 22, 2),
              sub('sc-kira', 'Kira Municipality', 19, 1),
              sub('sc-ssisa', 'Ssisa', 9, 1),
              sub('sc-busukuma', 'Busukuma', 7),
            ],
          },
          {
            id: 'district-kampala',
            name: 'Kampala',
            store_count: 0,
            hotspot_count: 0,
            subcounties: [
              sub('sc-central', 'Central Division', 41),
              sub('sc-kawempe', 'Kawempe Division', 58),
            ],
          },
          {
            id: 'district-mukono',
            name: 'Mukono',
            store_count: 1,
            hotspot_count: 0,
            subcounties: [sub('sc-mukono', 'Mukono Municipality', 18), sub('sc-goma', 'Goma', 12)],
          },
        ],
      },
      {
        id: 'region-eastern',
        name: 'Eastern',
        district_count: 43,
        districts: [
          {
            id: 'district-mbale',
            name: 'Mbale',
            store_count: 0,
            hotspot_count: 0,
            subcounties: [sub('sc-industrial', 'Industrial Division', 16)],
          },
        ],
      },
      {
        id: 'region-northern',
        name: 'Northern',
        district_count: 41,
        districts: [
          {
            id: 'district-gulu',
            name: 'Gulu',
            store_count: 1,
            hotspot_count: 0,
            subcounties: [sub('sc-bardege', 'Bardege-Layibi Division', 13)],
          },
        ],
      },
      {
        id: 'region-western',
        name: 'Western',
        district_count: 35,
        districts: [
          {
            id: 'district-mbarara',
            name: 'Mbarara',
            store_count: 1,
            hotspot_count: 0,
            subcounties: [sub('sc-kakoba', 'Kakoba Division', 15)],
          },
        ],
      },
    ],
  };
}

function seedAudit(dataset: string): AuditEntry[] {
  if (dataset === 'empty') return [];
  let n = 0;
  const people: Record<string, AuditActor> = {
    sarah: ACTOR,
    grace: { id: uuid(2, 3), username: 'grace.nakato', roles: ['dfcp'] },
    ruth: { id: uuid(2, 5), username: 'ruth.akello', roles: ['nms'] },
  };
  const entry = (
    minutes: number,
    who: keyof typeof people | null,
    action: string,
    target: AuditSubject | null,
    extra: {
      related?: AuditSubject[];
      changes?: AuditChanges;
      details?: Record<string, unknown>;
      reason?: string;
    } = {},
  ): AuditEntry => {
    n += 1;
    return {
      id: uuid(90, n),
      occurred_at: minutesAgo(minutes),
      action,
      outcome: extra.reason ? 'failure' : 'success',
      reason: extra.reason ?? null,
      actor: who ? (people[who] ?? null) : null,
      system_actor: null,
      target,
      subjects: [...(target ? [target] : []), ...(extra.related ?? [])],
      changes: extra.changes ?? null,
      details: extra.details ?? null,
      ip_address: `41.210.${(n * 7) % 255}.${(n * 13) % 255}`,
      user_agent:
        who === 'grace'
          ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'
          : MOCK_AGENT,
      request_id: `req-${String(n).padStart(6, '0')}`,
      session_id: who ? uuid(91, n) : null,
    };
  };
  const user = (n: number): AuditSubject => ({ type: 'user', id: uuid(2, n) });
  const hotspot: AuditSubject = { type: 'hotspot', id: uuid(40, 7) };
  const district: AuditSubject = { type: 'district', id: uuid(41, 2) };
  const order: AuditSubject = { type: 'order', id: uuid(42, 1042) };
  const store = (n: number): AuditSubject => ({ type: 'store', id: uuid(43, n) });
  const product: AuditSubject = { type: 'product', id: uuid(20, 1) };
  const entries = [
    entry(
      4,
      'sarah',
      'auth.login_succeeded',
      { type: 'session', id: uuid(91, 1) },
      {
        related: [user(999)],
      },
    ),
    entry(9, null, 'auth.login_failed', null, {
      reason: 'wrong_password',
      related: [user(3)],
      details: { identifier: 'grace.nakato' },
    }),
    entry(12, 'ruth', 'order.dispatched', order, {
      related: [store(1), store(4), product],
      changes: {
        status: { before: 'approved', after: 'dispatched' },
        quantity_issued: { before: null, after: 1200 },
      },
    }),
    entry(25, 'grace', 'hotspot.activated', hotspot, {
      related: [district],
      changes: {
        review_status: { before: 'pending', after: 'approved' },
        status: { before: 'inactive', after: 'active' },
      },
      details: { comment: 'Visited on Monday; the lodge owner agreed to stock condoms.' },
    }),
    entry(31, 'grace', 'access.denied', null, {
      reason: 'missing_permission',
      details: { permission: 'users:update', method: 'PATCH', path: '/api/v1/users/x/status' },
    }),
    entry(48, 'sarah', 'user.roles_changed', user(3), {
      changes: { roles: { before: ['vht'], after: ['dfcp'] } },
    }),
    entry(
      70,
      'ruth',
      'inventory.movement_recorded',
      { type: 'inventory_movement', id: uuid(44, 1) },
      {
        related: [store(1), product],
        details: { reason: 'damaged', quantity: -40, on_hand_after: 9560 },
      },
    ),
    entry(
      95,
      'sarah',
      'role.permissions_changed',
      { type: 'role', id: uuid(1, 2) },
      {
        changes: { permissions: { before: ['users:read'], after: ['users:read', 'roles:read'] } },
        details: { role: 'moh' },
      },
    ),
    entry(130, 'sarah', 'product.updated', product, {
      changes: { pieces_per_unit: { before: 100, after: 144 } },
    }),
    entry(
      180,
      'grace',
      'stockout.reported',
      { type: 'stockout_report', id: uuid(45, 3) },
      {
        related: [hotspot, store(4)],
        details: { selection: 'male', comment: 'Out since Friday' },
      },
    ),
    entry(240, 'sarah', 'user.disabled', user(6), {
      changes: { status: { before: 'active', after: 'inactive' } },
      details: { sessions_revoked: 2 },
    }),
    entry(300, 'sarah', 'audit.searched', null, { details: { filters: {}, limit: 50, offset: 0 } }),
  ];
  return dataset === 'worst'
    ? entries.concat(entries.map((e, i) => ({ ...e, id: uuid(92, i) })))
    : entries;
}

/** One server session, in the shape `GET /auth/sessions` and `GET /users/:id/sessions` reply with. */
interface DeviceSession {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  refreshed_at: string | null;
  refresh_count: number;
  current: boolean;
}

const AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'okhttp/4.12.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
] as const;

const DAY_MS = 24 * 60 * 60_000;

function deviceSession(
  n: number,
  agent: string | null,
  ip: string | null,
  startedMinutesAgo: number,
  seenMinutesAgo: number,
  current = false,
): DeviceSession {
  const created = Date.now() - startedMinutesAgo * 60_000;
  return {
    id: uuid(3, n),
    user_agent: agent,
    ip_address: ip,
    created_at: new Date(created).toISOString(),
    last_seen_at: minutesAgo(seenMinutesAgo),
    expires_at: new Date(created + 30 * DAY_MS).toISOString(),
    revoked_at: null,
    refreshed_at: null,
    refresh_count: 0,
    current,
  };
}

/** The signed-in mock user's own devices: this browser, a phone, and one already signed out. */
function seedMySessions(dataset: string): DeviceSession[] {
  const current = deviceSession(1, null, '127.0.0.1', 5, 0, true);
  if (dataset === 'empty') return [current];
  const signedOut = deviceSession(3, AGENTS[2], '102.85.14.7', 4 * 1440, 3 * 1440);
  signedOut.revoked_at = minutesAgo(3 * 1440);
  return [current, deviceSession(2, AGENTS[1], '41.210.143.92', 2 * 1440, 95), signedOut];
}

/** Other users' devices: active accounts hold up to two, by position in the list. */
function seedUserSessions(users: readonly User[], dataset: string): Map<string, DeviceSession[]> {
  const sessions = new Map<string, DeviceSession[]>();
  users.forEach((user, index) => {
    if (user.status !== 'active' || index % 3 === 2) return;
    const count = index % 3 === 0 ? 2 : 1;
    const list = Array.from({ length: count }, (_, k) => {
      const n = 100 + index * 2 + k;
      const agent =
        dataset === 'worst' && k === 0 ? 'x'.repeat(300) : AGENTS[(index + k) % AGENTS.length];
      return deviceSession(
        n,
        agent ?? null,
        k === 0 ? `41.210.${index}.${k + 10}` : null,
        (index + 1) * 300,
        (index + 1) * 17,
      );
    });
    sessions.set(user.id, list);
  });
  return sessions;
}

const state = {
  roles: seedRoles(),
  users: [] as User[],
  mySessions: [] as DeviceSession[],
  userSessions: new Map<string, DeviceSession[]>(),
  types: [] as Lookup[],
  brands: [] as Lookup[],
  units: [] as Lookup[],
  products: [] as Product[],
  stores: [] as Store[],
  geography: seedGeography('demo'),
  audit: [] as AuditEntry[],
  nextId: 1000,
};

export function seedAdmin(dataset: string): void {
  state.roles = seedRoles();
  state.users = seedUsers(dataset);
  state.mySessions = seedMySessions(dataset);
  state.userSessions = seedUserSessions(state.users, dataset);
  state.types = seedTypes(dataset);
  state.brands = seedBrands(dataset);
  state.units = seedUnits(dataset);
  state.products = seedProducts(dataset);
  state.stores = seedStores(dataset);
  state.geography = seedGeography(dataset);
  state.audit = seedAudit(dataset);
}

/** Writes an entry as the mock's signed-in person, like the Go API's `Record`. */
function record(
  action: string,
  target: AuditSubject | null,
  {
    changes,
    details,
    related = [],
  }: {
    changes?: AuditChanges;
    details?: Record<string, unknown>;
    related?: AuditSubject[];
  } = {},
): void {
  state.nextId += 1;
  state.audit.unshift({
    id: uuid(93, state.nextId),
    occurred_at: new Date().toISOString(),
    action,
    outcome: 'success',
    reason: null,
    actor: ACTOR,
    system_actor: null,
    target,
    subjects: [...(target ? [target] : []), ...related],
    changes: changes ?? null,
    details: details ?? null,
    ip_address: '127.0.0.1',
    user_agent: MOCK_AGENT,
    request_id: `mock-${state.nextId}`,
    session_id: null,
  });
}

// ---------------------------------------------------------------- users & roles (Go shapes)

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isUuid = (value: unknown): boolean =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Mirrors the Go API's store_id checks: null clears; anything else must name a store. */
function checkStoreId(value: unknown): Reply | null {
  if (value === undefined || value === null) return null;
  if (!isUuid(value)) {
    return fail(422, 'validation failed', { store_id: 'Choose a valid item from the list.' });
  }
  if (!MOCK_STORES.some((store) => store.id === value)) {
    return fail(422, 'validation failed', { store_id: 'Choose an existing store.' });
  }
  return null;
}

function userView(user: User) {
  const roles = state.roles.filter((role) => user.role_ids.includes(role.id));
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    firstname: user.firstname,
    lastname: user.lastname,
    phone_number: user.phone_number,
    status: user.status,
    last_login_at: user.last_login_at,
    login_count: user.login_count,
    active_sessions: (state.userSessions.get(user.id) ?? []).filter(
      (session) => !session.revoked_at && session.expires_at > new Date().toISOString(),
    ).length,
    created_at: user.created_at,
    store_id: user.store_id,
    role: roles[0] ?? null,
    roles,
  };
}

const adminRoleId = () => state.roles.find((role) => role.name === 'admin')?.id ?? '';
const activeAdmins = () =>
  state.users.filter((user) => user.status === 'active' && user.role_ids.includes(adminRoleId()));

/** Mirrors `validator.Validate.Struct` on `CreateUserRequest` and its messages. */
function validateNewUser(body: Body): Record<string, string> {
  const errors: Record<string, string> = {};
  const report = (field: string, message: string) => {
    errors[field] ??= message;
  };
  const required = 'This field is required.';
  const username = text(body.username).trim();
  const email = text(body.email).trim();
  const password = text(body.password);
  if (!username) report('username', required);
  else if (username.length < 3) report('username', 'Use at least 3 characters.');
  else if (username.length > 50) report('username', 'Use at most 50 characters.');
  if (!email) report('email', required);
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    report('email', 'Enter a valid email address, e.g. name@example.org.');
  else if (email.length > 255) report('email', 'Use at most 255 characters.');
  if (!password) report('password', required);
  else if (password.length < 8) report('password', 'Use at least 8 characters.');
  else if (password.length > 72) report('password', 'Use at most 72 characters.');
  if (text(body.firstname).length > 20) report('firstname', 'Use at most 20 characters.');
  if (text(body.lastname).length > 20) report('lastname', 'Use at most 20 characters.');
  if (text(body.phone_number).length > 15) report('phone_number', 'Use at most 15 characters.');
  const roleIds = body.role_ids;
  if (roleIds !== undefined && roleIds !== null) {
    if (!Array.isArray(roleIds) || roleIds.length < 1) report('role_ids', 'Choose at least 1.');
    else if (!roleIds.every(isUuid)) report('role_ids', 'Choose a valid item from the list.');
  }
  return errors;
}

function handleUsers(
  method: string,
  id: string | undefined,
  sub: string | undefined,
  body: Body,
  query: URLSearchParams,
): Reply {
  if (!id) {
    if (method === 'GET') {
      const limit = Number(query.get('limit') ?? 50);
      const offset = Number(query.get('offset') ?? 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        return fail(400, 'limit must be between 1 and 100');
      if (!Number.isInteger(offset) || offset < 0) return fail(400, 'offset must be nonnegative');
      return ok({ users: state.users.slice(offset, offset + limit).map(userView), limit, offset });
    }
    if (method !== 'POST') return fail(405, 'Method not allowed');
    const errors = validateNewUser(body);
    if (Object.keys(errors).length > 0) return fail(422, 'validation failed', errors);
    const roleIds = Array.isArray(body.role_ids)
      ? body.role_ids.filter((value): value is string => typeof value === 'string')
      : body.role_id
        ? [text(body.role_id)]
        : null;
    if (!roleIds) return fail(422, 'provide either role_id or role_ids');
    if (!roleIds.every((roleIdValue) => state.roles.some((role) => role.id === roleIdValue))) {
      return fail(422, 'unknown role_id');
    }
    const storeProblem = checkStoreId(body.store_id);
    if (storeProblem) return storeProblem;
    const email = text(body.email).trim().toLowerCase();
    if (state.users.some((user) => user.email.toLowerCase() === email)) {
      return fail(409, 'email already exists');
    }
    state.nextId += 1;
    const user: User = {
      id: uuid(2, state.nextId),
      username: text(body.username).trim(),
      email,
      firstname: text(body.firstname),
      lastname: text(body.lastname),
      phone_number: text(body.phone_number),
      status: 'active',
      role_ids: roleIds,
      last_login_at: null,
      login_count: 0,
      created_at: new Date().toISOString(),
      store_id: typeof body.store_id === 'string' ? body.store_id : null,
    };
    state.users.push(user);
    const names = state.roles.filter((role) => roleIds.includes(role.id)).map((role) => role.name);
    record(
      'user.created',
      { type: 'user', id: user.id },
      {
        changes: {
          username: { before: null, after: user.username },
          roles: { before: null, after: names },
        },
      },
    );
    return ok({ user_id: user.id }, 201);
  }

  if (!isUuid(id)) return fail(400, 'invalid id');
  const user = state.users.find((candidate) => candidate.id === id);
  if (method === 'GET' && !sub)
    return user ? ok(userView(user)) : fail(404, 'user or role not found');
  if (!user) return fail(404, 'user or role not found');

  if (sub === 'roles' && method === 'PUT') {
    const roleIds = body.role_ids;
    if (!Array.isArray(roleIds))
      return fail(422, 'validation failed', { role_ids: 'This field is required.' });
    if (!roleIds.every(isUuid))
      return fail(422, 'validation failed', {
        role_ids: 'Choose a valid item from the list.',
      });
    const ids = roleIds.filter((value): value is string => typeof value === 'string');
    if (!ids.every((value) => state.roles.some((role) => role.id === value)))
      return fail(422, 'unknown role');
    const losesAdmin = user.role_ids.includes(adminRoleId()) && !ids.includes(adminRoleId());
    if (losesAdmin && user.status === 'active' && activeAdmins().length <= 1) {
      return fail(409, 'cannot disable or demote the last active admin');
    }
    const roleNames = (list: string[]) =>
      state.roles
        .filter((role) => list.includes(role.id))
        .map((role) => role.name)
        .join(', ') || null;
    record(
      'user.roles_changed',
      { type: 'user', id: user.id },
      {
        changes: { roles: { before: roleNames(user.role_ids), after: roleNames(ids) } },
      },
    );
    user.role_ids = ids;
    return ok(null);
  }

  if (sub === 'sessions') {
    const now = new Date().toISOString();
    const sessions = state.userSessions.get(user.id) ?? [];
    if (method === 'GET') return ok(sessions.filter((session) => session.expires_at > now));
    if (method !== 'DELETE') return fail(405, 'Method not allowed');
    const live = sessions.filter((session) => !session.revoked_at && session.expires_at > now);
    for (const session of live) session.revoked_at = now;
    if (live.length > 0) {
      record(
        'user.sessions_revoked',
        { type: 'user', id: user.id },
        {
          details: { sessions_revoked: live.length },
        },
      );
    }
    return ok({ revoked: live.length });
  }

  if (sub === 'store' && method === 'PATCH') {
    if (!('store_id' in body)) {
      return fail(422, 'validation failed', { store_id: 'This field is required.' });
    }
    const storeProblem = checkStoreId(body.store_id);
    if (storeProblem) return storeProblem;
    const next = typeof body.store_id === 'string' ? body.store_id : null;
    const storeName = (storeId: string | null) =>
      MOCK_STORES.find((store) => store.id === storeId)?.name ?? null;
    record(
      'user.store_assigned',
      { type: 'user', id: user.id },
      {
        changes: { store: { before: storeName(user.store_id), after: storeName(next) } },
        related: [user.store_id, next].flatMap((id) => (id ? [{ type: 'store', id }] : [])),
      },
    );
    user.store_id = next;
    return ok(null);
  }

  if (sub === 'status' && method === 'PATCH') {
    const status = body.status;
    if (status !== 'active' && status !== 'disabled') {
      return fail(422, 'validation failed', { status: 'Choose one of: active, disabled.' });
    }
    if (
      status === 'disabled' &&
      user.status === 'active' &&
      user.role_ids.includes(adminRoleId()) &&
      activeAdmins().length <= 1
    ) {
      return fail(409, 'cannot disable or demote the last active admin');
    }
    record(
      status === 'active' ? 'user.enabled' : 'user.disabled',
      { type: 'user', id: user.id },
      {
        changes: { status: { before: user.status, after: status } },
      },
    );
    user.status = status;
    return ok(null);
  }

  return fail(405, 'Method not allowed');
}

function handleRoles(
  method: string,
  id: string | undefined,
  sub: string | undefined,
  body: Body,
): Reply {
  if (!id) return method === 'GET' ? ok(state.roles) : fail(405, 'Method not allowed');
  if (sub !== 'permissions' || method !== 'PUT') return fail(405, 'Method not allowed');
  if (!isUuid(id)) return fail(400, 'invalid id');
  const role = state.roles.find((candidate) => candidate.id === id);
  if (!role) return fail(404, 'user or role not found');
  const permissions = body.permissions;
  if (!Array.isArray(permissions)) return fail(422, 'permissions must be an array');
  if (permissions.length > 100) return fail(422, 'too many permissions');
  if (role.name === 'admin') return fail(409, 'admin permissions cannot be changed');
  const codes = permissions.filter((value): value is string => typeof value === 'string');
  if (!codes.every((code) => PERMISSIONS.includes(code))) return fail(422, 'unknown permission');
  const granted = codes.filter((code) => !role.permissions.includes(code));
  const revoked = role.permissions.filter((code) => !codes.includes(code));
  if (granted.length > 0 || revoked.length > 0) {
    record(
      'role.permissions_changed',
      { type: 'role', id: role.id },
      {
        changes: { permissions: { before: role.permissions, after: [...new Set(codes)] } },
        details: { role: role.name },
      },
    );
  }
  role.permissions = [...new Set(codes)];
  return ok(null);
}

// ---------------------------------------------------------------- catalogue (Go shapes)

/** A success with only a message, as the Go API sends for a delete. */
const done = (message: string): Reply => ({ status: 200, body: { success: true, message } });

const LOOKUP_RULES = {
  types: {
    min: 2,
    max: 40,
    noun: 'type',
    title: 'Product type',
    inUse: 'This type is used by products. Deactivate it instead.',
    missing: 'Choose an existing type.',
    inactive: 'This type is inactive. Choose an active type.',
  },
  brands: {
    min: 1,
    max: 60,
    noun: 'brand',
    title: 'Brand',
    inUse: 'This brand is used by products. Deactivate it instead.',
    missing: 'Choose an existing brand.',
    inactive: 'This brand is inactive. Choose an active brand.',
  },
  units: {
    min: 2,
    max: 40,
    noun: 'unit of measure',
    title: 'Unit of measure',
    inUse: 'This unit of measure is used by products, stock or orders. Deactivate it instead.',
    missing: 'Choose an existing unit of measure.',
    inactive: 'This unit of measure is inactive. Choose an active unit.',
  },
} as const;

type LookupKind = keyof typeof LOOKUP_RULES;

/** The product field that names a row of each lookup. */
const LOOKUP_COLUMNS = { types: 'type_id', brands: 'brand_id', units: 'unit_id' } as const;

const ref = (list: readonly Lookup[], id: string | null) => {
  const found = id ? list.find((candidate) => candidate.id === id) : undefined;
  return found ? { id: found.id, name: found.name } : null;
};

function productView(product: Product) {
  const { type_id, brand_id, unit_id, referenced, ...rest } = product;
  return {
    ...rest,
    type: ref(state.types, type_id),
    brand: ref(state.brands, brand_id),
    unit: ref(state.units, unit_id),
    in_use: referenced,
  };
}

function lookupView(kind: LookupKind, row: Lookup) {
  const column = LOOKUP_COLUMNS[kind];
  const product_count = state.products.filter((product) => product[column] === row.id).length;
  return { ...row, in_use: product_count > 0, product_count };
}

const label = (value: string | null) => (value ?? '').toLowerCase();

function sortedProducts(rows: readonly Product[]) {
  return rows
    .map(productView)
    .sort(
      (a, b) =>
        label(a.category).localeCompare(label(b.category)) ||
        label(a.brand?.name ?? null).localeCompare(label(b.brand?.name ?? null)) ||
        label(a.type?.name ?? null).localeCompare(label(b.type?.name ?? null)),
    );
}

/** ?active=true|false, or null for everything; undefined when invalid. */
function activeParam(query: URLSearchParams): boolean | null | undefined {
  const value = query.get('active');
  if (value === null || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** True when the body carries only the given fields, as the Go decoder requires. */
const onlyFields = (body: Body, fields: readonly string[]) =>
  Object.keys(body).every((key) => fields.includes(key));

const PRODUCT_FIELDS = ['category', 'type_id', 'brand_id', 'unit_id', 'pieces_per_unit'] as const;

interface ProductFields {
  category: unknown;
  type_id: unknown;
  brand_id: unknown;
  unit_id: unknown;
  pieces_per_unit: unknown;
}

/** Mirrors `ProductFields.validate` and its messages. */
function validateProduct(fields: ProductFields): Record<string, string> {
  const errors: Record<string, string> = {};
  const isBlank = (value: unknown) => value === null || value === undefined || value === '';
  const lower = (value: unknown) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value;
  const category = lower(fields.category);
  if (isBlank(category)) errors.category = 'Choose a category.';
  else if (category !== 'male' && category !== 'female') errors.category = 'Choose male or female.';
  if (isBlank(fields.type_id)) errors.type_id = 'Choose a type.';
  else if (!isUuid(fields.type_id)) errors.type_id = 'Choose a type from the list.';
  if (isBlank(fields.brand_id)) errors.brand_id = 'Choose a brand.';
  else if (!isUuid(fields.brand_id)) errors.brand_id = 'Choose a brand from the list.';
  if (isBlank(fields.unit_id)) errors.unit_id = 'Choose a unit of measure.';
  else if (!isUuid(fields.unit_id)) errors.unit_id = 'Choose a unit of measure from the list.';
  const pieces = fields.pieces_per_unit;
  if (isBlank(pieces)) errors.pieces_per_unit = 'Enter how many condoms one unit holds.';
  else if (typeof pieces !== 'number' || !Number.isInteger(pieces))
    errors.pieces_per_unit = 'Check this value.';
  else if (pieces < 1) errors.pieces_per_unit = 'Must be at least 1.';
  else if (pieces > 100_000) errors.pieces_per_unit = 'Must be at most 100,000.';
  return errors;
}

/** Mirrors `checkReference`: a newly chosen type, brand or unit must exist and be active. */
function checkReference(
  kind: LookupKind,
  field: string,
  id: unknown,
  current: string | null,
  errors: Record<string, string>,
) {
  if (typeof id !== 'string' || id === current || errors[field]) return;
  const found = state[kind].find((candidate) => candidate.id === id);
  if (!found) errors[field] = LOOKUP_RULES[kind].missing;
  else if (!found.active) errors[field] = LOOKUP_RULES[kind].inactive;
}

function describeProduct(product: Product): string {
  const view = productView(product);
  return (
    [view.brand?.name, view.category, view.type?.name].filter(Boolean).join(' · ') || product.id
  );
}

function handleProducts(
  method: string,
  id: string | undefined,
  body: Body,
  query: URLSearchParams,
): Reply {
  if (!id) {
    if (method === 'GET') {
      const active = activeParam(query);
      if (active === undefined) return fail(400, 'active must be true or false');
      return ok(
        sortedProducts(state.products.filter((row) => active === null || row.active === active)),
      );
    }
    if (method !== 'POST') return fail(405, 'Method not allowed');
    if (!onlyFields(body, PRODUCT_FIELDS)) return fail(400, 'invalid request body');
    const errors = validateProduct(body as unknown as ProductFields);
    if (Object.keys(errors).length > 0) return fail(422, 'validation failed', errors);
    checkReference('types', 'type_id', body.type_id, null, errors);
    checkReference('brands', 'brand_id', body.brand_id, null, errors);
    checkReference('units', 'unit_id', body.unit_id, null, errors);
    if (Object.keys(errors).length > 0) return fail(422, 'validation failed', errors);
    state.nextId += 1;
    const now = new Date().toISOString();
    const product: Product = {
      id: uuid(20, state.nextId),
      category: text(body.category).trim().toLowerCase() as ProductCategory,
      type_id: text(body.type_id),
      brand_id: text(body.brand_id),
      unit_id: text(body.unit_id),
      pieces_per_unit: body.pieces_per_unit as number,
      active: true,
      referenced: false,
      created_at: now,
      updated_at: now,
    };
    state.products.push(product);
    record(
      'product.created',
      { type: 'product', id: product.id },
      {
        details: { name: describeProduct(product) },
      },
    );
    return ok(productView(product), 201);
  }

  const index = state.products.findIndex((candidate) => candidate.id === id);
  const product = state.products[index];
  if (!product) return fail(404, 'Product not found.');
  if (method === 'DELETE') {
    if (product.referenced)
      return fail(409, 'This product is used by stock or order records. Deactivate it instead.');
    state.products.splice(index, 1);
    record(
      'product.deleted',
      { type: 'product', id: product.id },
      {
        details: { name: describeProduct(product) },
      },
    );
    return done('product deleted');
  }
  if (method !== 'PATCH') return fail(405, 'Method not allowed');
  if (!onlyFields(body, [...PRODUCT_FIELDS, 'active'])) return fail(400, 'invalid request body');
  if (Object.keys(body).length === 0) return fail(400, 'Send at least one field to change.');
  const changesFields = PRODUCT_FIELDS.some(
    (field) => body[field] !== undefined && body[field] !== null,
  );
  const nextActive = typeof body.active === 'boolean' ? body.active : product.active;
  const merged: ProductFields = {
    category: body.category ?? product.category,
    type_id: body.type_id ?? product.type_id,
    brand_id: body.brand_id ?? product.brand_id,
    unit_id: body.unit_id ?? product.unit_id,
    pieces_per_unit: body.pieces_per_unit ?? product.pieces_per_unit,
  };
  // Deactivating alone is always allowed; anything else needs a complete product.
  if (changesFields || (nextActive && !product.active)) {
    const errors = validateProduct(merged);
    checkReference('types', 'type_id', body.type_id, product.type_id, errors);
    checkReference('brands', 'brand_id', body.brand_id, product.brand_id, errors);
    checkReference('units', 'unit_id', body.unit_id, product.unit_id, errors);
    if (Object.keys(errors).length > 0) return fail(422, 'validation failed', errors);
    product.category = text(merged.category).trim().toLowerCase() as ProductCategory;
    product.type_id = text(merged.type_id);
    product.brand_id = text(merged.brand_id);
    product.unit_id = text(merged.unit_id);
    product.pieces_per_unit = merged.pieces_per_unit as number;
  }
  if (product.active !== nextActive) {
    record(
      'product.updated',
      { type: 'product', id: product.id },
      {
        changes: { active: { before: product.active, after: nextActive } },
      },
    );
  } else if (changesFields) {
    record(
      'product.updated',
      { type: 'product', id: product.id },
      {
        details: { name: describeProduct(product) },
      },
    );
  }
  product.active = nextActive;
  product.updated_at = new Date().toISOString();
  return ok(productView(product));
}

/** Mirrors the Go lookup rules: a trimmed, unique name and an optional note. */
function validateLookup(
  kind: LookupKind,
  name: string,
  note: string | null,
): Record<string, string> {
  const { min, max } = LOOKUP_RULES[kind];
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Enter a name.';
  else if (name.length < min) errors.name = `Use at least ${String(min)} characters.`;
  else if (name.length > max) errors.name = `Use at most ${String(max)} characters.`;
  if (note !== null && note.length > 120) errors.note = 'Use at most 120 characters.';
  return errors;
}

const LOOKUP_ID_PREFIX = { types: 23, brands: 21, units: 22 } as const;
/** The audit log's name for each lookup, as in the Go catalogue. */
const LOOKUP_SUBJECT = {
  types: 'product_type',
  brands: 'brand',
  units: 'unit_of_measure',
} as const;

const collapse = (value: unknown) => text(value).trim().split(/\s+/).filter(Boolean).join(' ');

function duplicateName(kind: LookupKind, name: string, exceptId?: string): Reply | null {
  const taken = state[kind].some(
    (row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase(),
  );
  if (!taken) return null;
  const message = `A ${LOOKUP_RULES[kind].noun} with this name already exists.`;
  return fail(409, message, { name: message });
}

function handleLookups(
  kind: LookupKind,
  method: string,
  id: string | undefined,
  body: Body,
  query: URLSearchParams,
): Reply {
  const rules = LOOKUP_RULES[kind];
  const list = state[kind];
  if (!id) {
    if (method === 'GET') {
      const active = activeParam(query);
      if (active === undefined) return fail(400, 'active must be true or false');
      return ok(
        list
          .filter((row) => active === null || row.active === active)
          .map((row) => lookupView(kind, row))
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
      );
    }
    if (method !== 'POST') return fail(405, 'Method not allowed');
    if (!onlyFields(body, ['name', 'note'])) return fail(400, 'invalid request body');
    const name = collapse(body.name);
    const note = text(body.note).trim() || null;
    const errors = validateLookup(kind, name, note);
    if (Object.keys(errors).length > 0) return fail(422, 'validation failed', errors);
    const duplicate = duplicateName(kind, name);
    if (duplicate) return duplicate;
    state.nextId += 1;
    const row = lookup(uuid(LOOKUP_ID_PREFIX[kind], state.nextId), name, note, true, 0);
    row.created_at = row.updated_at = new Date().toISOString();
    list.push(row);
    record(
      `${LOOKUP_SUBJECT[kind]}.created`,
      { type: LOOKUP_SUBJECT[kind], id: row.id },
      {
        changes: { name: { before: null, after: name } },
      },
    );
    return ok(lookupView(kind, row), 201);
  }

  const index = list.findIndex((candidate) => candidate.id === id);
  const row = list[index];
  if (!row) return fail(404, `${rules.title} not found.`);
  if (method === 'DELETE') {
    if (lookupView(kind, row).in_use) return fail(409, rules.inUse);
    list.splice(index, 1);
    record(
      `${LOOKUP_SUBJECT[kind]}.deleted`,
      { type: LOOKUP_SUBJECT[kind], id: row.id },
      {
        changes: { name: { before: row.name, after: null } },
      },
    );
    return done(`${rules.noun} deleted`);
  }
  if (method !== 'PATCH') return fail(405, 'Method not allowed');
  if (!onlyFields(body, ['name', 'note', 'active'])) return fail(400, 'invalid request body');
  if (Object.keys(body).length === 0) return fail(400, 'Send at least one field to change.');
  const name = body.name === undefined ? row.name : collapse(body.name);
  const note = body.note === undefined ? row.note : text(body.note).trim() || null;
  if (body.name !== undefined || body.note !== undefined) {
    const errors = validateLookup(kind, name, note);
    if (Object.keys(errors).length > 0) return fail(422, 'validation failed', errors);
    const duplicate = duplicateName(kind, name, row.id);
    if (duplicate) return duplicate;
  }
  if (
    name !== row.name ||
    note !== row.note ||
    (typeof body.active === 'boolean' && body.active !== row.active)
  ) {
    record(
      `${LOOKUP_SUBJECT[kind]}.updated`,
      { type: LOOKUP_SUBJECT[kind], id: row.id },
      {
        changes: { name: { before: row.name, after: name } },
      },
    );
  }
  row.name = name;
  row.note = note;
  if (typeof body.active === 'boolean') row.active = body.active;
  row.updated_at = new Date().toISOString();
  return ok(lookupView(kind, row));
}

function handleCatalogue(
  method: string,
  kind: string | undefined,
  id: string | undefined,
  body: Body,
  query: URLSearchParams,
): Reply {
  if (kind === 'products') return handleProducts(method, id, body, query);
  if (kind === 'types' || kind === 'brands' || kind === 'units')
    return handleLookups(kind, method, id, body, query);
  return fail(404, 'Not found');
}

// ---------------------------------------------------------------- the signed-in user (Go shapes)

/**
 * The account every mock sign-in opens: an administrator holding every
 * permission, in the shape `POST /auth/login` and `GET /auth/me` send.
 * `email` is what the visitor typed when it looks like an address.
 */
export function signedInUser(email: string | null = null) {
  const admin = state.roles.find((role) => role.name === 'admin') ?? null;
  return {
    id: 1,
    username: 'sarah.nakato',
    firstname: 'Sarah',
    lastname: 'Nakato',
    email,
    status: 'active',
    role: admin,
    roles: admin ? [admin] : [],
    // `MOCK_STORE=Wakiso` assigns that district's store, for the screens that act from one
    // (sending stock to a hotspot); by default the user works across stores.
    ...(process.env.MOCK_STORE ? { store_id: mockDistrictStoreId(process.env.MOCK_STORE) } : {}),
  };
}

/**
 * `GET /auth/me`, `GET /auth/sessions` and `DELETE /auth/sessions/:id`; null for any other path.
 * `userAgent` is the request's, recorded on the current session as the server does at sign-in.
 */
export function handleAuth(
  method: string,
  parts: readonly string[],
  userAgent: string | null = null,
): Reply | null {
  const [resource, first, second] = parts;
  if (resource !== 'auth') return null;
  if (first === 'me' && method === 'GET') return ok(signedInUser());
  if (first !== 'sessions') return null;
  const now = new Date().toISOString();
  if (!second) {
    if (method !== 'GET') return fail(405, 'Method not allowed');
    const current = state.mySessions.find((session) => session.current);
    if (current && userAgent) current.user_agent = userAgent;
    return ok(state.mySessions.filter((session) => session.expires_at > now));
  }
  if (method !== 'DELETE') return fail(405, 'Method not allowed');
  if (!isUuid(second)) return fail(400, 'invalid id');
  const session = state.mySessions.find(
    (candidate) => candidate.id === second && !candidate.revoked_at && candidate.expires_at > now,
  );
  if (!session) return fail(404, 'session not found');
  session.revoked_at = now;
  return ok(null);
}

// ---------------------------------------------------------------- audit log (Go shapes)

const DOMAINS = /^[a-z][a-z0-9_]*(,[a-z][a-z0-9_]*)*$/;

/** Mirrors `GET /audit`: the same filters and validation, newest first, and the search is itself recorded. */
function searchAudit(query: URLSearchParams): Reply {
  const limit = Number(query.get('limit') ?? '50');
  const offset = Number(query.get('offset') ?? '0');
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    return fail(400, 'limit must be between 1 and 100 and offset must be nonnegative');
  const domainList = (name: string): string[] | null => {
    const raw = query.get(name) ?? '';
    if (raw === '') return [];
    return DOMAINS.test(raw) ? raw.split(',') : null;
  };
  const domains = domainList('domain');
  const excluded = domainList('exclude_domain');
  if (!domains || !excluded) return fail(400, 'domain must be action domains separated by commas');
  const outcome = query.get('outcome');
  if (outcome && outcome !== 'success' && outcome !== 'failure')
    return fail(400, 'outcome must be success or failure');
  const subjectType = query.get('subject_type') ?? '';
  const subjectId = query.get('subject_id') ?? '';
  if ((subjectType === '') !== (subjectId === ''))
    return fail(400, 'subject_type and subject_id go together');
  const actor = query.get('actor_id');
  const from = query.get('from');
  const to = query.get('to');

  record('audit.searched', null, {
    details: { filters: Object.fromEntries(query), limit, offset },
  });
  const domainOf = (action: string) => action.split('.')[0] ?? '';
  const matches = state.audit
    .filter(
      (entry) =>
        (domains.length === 0 || domains.includes(domainOf(entry.action))) &&
        !excluded.includes(domainOf(entry.action)) &&
        (!outcome || entry.outcome === outcome) &&
        (!actor || entry.actor?.id === actor) &&
        (!subjectType ||
          entry.subjects.some(
            (subject) => subject.type === subjectType && subject.id === subjectId,
          )) &&
        (!from || entry.occurred_at >= new Date(from).toISOString()) &&
        (!to || entry.occurred_at < new Date(to).toISOString()),
    )
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  // Like the Go search, user records carry the account's current username.
  const name = (subject: AuditSubject): AuditSubject & { name: string | null } => ({
    ...subject,
    name:
      subject.type !== 'user'
        ? null
        : subject.id === ACTOR.id
          ? ACTOR.username
          : (state.users.find((user) => user.id === subject.id)?.username ?? null),
  });
  return ok(
    matches.slice(offset, offset + limit).map((entry) => ({
      ...entry,
      target: entry.target && name(entry.target),
      subjects: entry.subjects.map(name),
    })),
  );
}

// ---------------------------------------------------------------- entry point

const RESOURCES = new Set([
  'users',
  'roles',
  'permissions',
  'catalogue',
  'stores',
  'geography',
  'audit',
]);

/**
 * Answers a request for one of the administration resources, or returns null
 * when the path is not one of them. `parts` is the path after `/api/v1`, split
 * on `/`; `query` is the request's query string.
 */
export function handleAdmin(
  method: string,
  parts: readonly string[],
  body: Body,
  query: URLSearchParams = new URLSearchParams(),
): Reply | null {
  const [resource = '', first, second] = parts;
  if (!RESOURCES.has(resource)) return null;
  switch (resource) {
    case 'users':
      return handleUsers(method, first, second, body, query);
    case 'roles':
      return handleRoles(method, first, second, body);
    case 'permissions':
      return method === 'GET' ? ok(PERMISSIONS) : fail(405, 'Method not allowed');
    case 'catalogue':
      return handleCatalogue(method, first, second, body, query);
    case 'stores':
      return method === 'GET' && !first ? ok(state.stores) : fail(405, 'Method not allowed');
    case 'geography':
      if (first === 'sync' && method === 'POST') {
        state.geography.synced_at = new Date().toISOString();
        return ok({ synced_at: state.geography.synced_at, changes: 0 });
      }
      return method === 'GET' && !first ? ok(state.geography) : fail(405, 'Method not allowed');
    default:
      return method === 'GET' && !first ? searchAudit(query) : fail(405, 'Method not allowed');
  }
}
