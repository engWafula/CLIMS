/**
 * Hotspots for the mock API, on the Go API's paths and shapes
 * (`backend/internal/features/hotspots`, `docs/modules/hotspots.md`): a VHT submits a
 * hotspot, and the district's DCFP activates or rejects it, and can later deactivate and
 * reactivate it. Every decision carries a comment, kept in the hotspot's comment thread.
 * Each step is recorded as an event: `GET /hotspots/:id/events` lists one hotspot's,
 * the deprecated `GET /hotspots/notifications` all of them, newest first.
 *
 * The signed-in user is not known here, so the VHT's own list and the DCFP's district queue
 * are the same list, and steps are recorded as the seeded VHT's or DCFP's. The real API scopes
 * both to the account. `PUT /hotspots/:id` (a VHT's edit) is not served: no web screen edits.
 *
 * Rules the real API enforces, mirrored here: the submission's required fields, a subcounty
 * that belongs to its district and a district to its region, unique names within a village,
 * decisions only from the review statuses in `DECISIONS` (409 otherwise), and a comment of
 * 1 to 2000 characters on every decision and comment (422 otherwise).
 *
 * Besides the demo hotspots, a few hundred generated ones around five towns feed the hotspot
 * map's clusters, heatmap and filters (`mapHotspots`).
 */

import type { Reply } from './fulfilment.mts';

type Body = Record<string, unknown>;
type ReviewStatus = 'submitted' | 'rejected' | 'active' | 'deactivated';
type CommentAction = 'comment' | 'activated' | 'deactivated' | 'rejected';

interface Place {
  id: string;
  name: string;
}

interface Comment {
  id: string;
  user_id: string | null;
  action: CommentAction;
  comment: string;
  created_at: string;
}

export interface Hotspot {
  id: string;
  name: string | null;
  type: string | null;
  village: string | null;
  region: Place | null;
  district: Place | null;
  subcounty: Place | null;
  latitude: number | null;
  longitude: number | null;
  has_condom_dispenser: boolean | null;
  dispenser_condition: string | null;
  status: 'active' | 'inactive';
  review_status: ReviewStatus;
  submitted_by_id: string | null;
  contact_person: { id: string; name: string | null; phone_number: string | null } | null;
  created_at: string;
  updated_at: string;
}

interface HotspotEvent {
  id: string;
  hot_spot_id: string;
  hot_spot_name: string | null;
  actor_id: string;
  action: string;
  status: ReviewStatus;
  created_at: string;
}

/** Each decision, the review statuses it may be taken from, and where it leads. */
const DECISIONS: Record<
  string,
  { from: ReviewStatus[]; to: ReviewStatus; recorded: CommentAction }
> = {
  activate: { from: ['submitted', 'deactivated'], to: 'active', recorded: 'activated' },
  deactivate: { from: ['active'], to: 'deactivated', recorded: 'deactivated' },
  reject: { from: ['submitted'], to: 'rejected', recorded: 'rejected' },
};

const WAKISO = '7f2c3c5e-1d4b-4c1a-9a51-2a8f6f0b9e11';
const MUKONO = '0d6c4b1e-5a3f-4e2b-8c7d-9f1a2b3c4d5e';
const KAMPALA = '3e8a9b7c-6d5f-4a1b-9c2d-1e0f9a8b7c6d';

/** A stable UUID-shaped id for the geography below: `g` names the level, `n` the place. */
const placeId = (g: number, n: number) =>
  `00000000-0000-4000-${String(8100 + g)}-${String(n).padStart(12, '0')}`;

/*
 * A slice of Uganda's regions, districts and subcounties, named as the Go API's
 * tables name them, for `GET /locations/regions`, `/districts?region_id=` and
 * `/subcounties?district_id=`. The three districts the hotspot screens have
 * always used keep their ids.
 */
export const REGIONS = [
  { id: placeId(1, 1), name: 'Acholi' },
  { id: placeId(1, 2), name: 'Busoga' },
  { id: placeId(1, 3), name: 'Kampala' },
  { id: placeId(1, 4), name: 'North Central' },
  { id: placeId(1, 5), name: 'South Central' },
  { id: placeId(1, 6), name: 'Ankole' },
  { id: placeId(1, 7), name: 'Lango' },
];

export const DISTRICTS_BY_REGION = [
  { id: WAKISO, name: 'Wakiso', region_id: placeId(1, 5) },
  { id: placeId(2, 1), name: 'Mpigi', region_id: placeId(1, 5) },
  { id: MUKONO, name: 'Mukono', region_id: placeId(1, 4) },
  { id: placeId(2, 2), name: 'Luwero', region_id: placeId(1, 4) },
  { id: KAMPALA, name: 'Kampala', region_id: placeId(1, 3) },
  { id: placeId(2, 3), name: 'Gulu', region_id: placeId(1, 1) },
  { id: placeId(2, 4), name: 'Jinja', region_id: placeId(1, 2) },
  // The warehouse requests in `warehouse.mts` also come from these three.
  { id: placeId(2, 5), name: 'Masaka', region_id: placeId(1, 5) },
  { id: placeId(2, 6), name: 'Mbarara', region_id: placeId(1, 6) },
  { id: placeId(2, 7), name: 'Lira', region_id: placeId(1, 7) },
];

const DISTRICTS = DISTRICTS_BY_REGION.map(({ id, name }) => ({ id, name }));

/**
 * Stock-holding points as `GET /locations/stores` lists them: the two national
 * warehouses, then one store per district, named after it as the Go API does.
 */
export const MOCK_STORES = [
  {
    id: placeId(9, 1),
    code: 'jms',
    name: 'Joint Medical Store',
    store_type: 'national' as const,
    district_id: null,
    district_name: null,
  },
  {
    id: placeId(9, 2),
    code: 'nms',
    name: 'National Medical Stores',
    store_type: 'national' as const,
    district_id: null,
    district_name: null,
  },
  ...[...DISTRICTS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((district, index) => ({
      id: placeId(9, 10 + index),
      code: district.name.toLowerCase(),
      name: district.name,
      store_type: 'district' as const,
      district_id: district.id,
      district_name: district.name,
    })),
];

/** The store of the district named `name`, for seeding accounts. */
export function mockDistrictStoreId(name: string): string | null {
  return MOCK_STORES.find((store) => store.district_name === name)?.id ?? null;
}

const SUBCOUNTIES = [
  { id: placeId(3, 1), name: 'Makindye Ssabagabo Municipality', district_id: WAKISO },
  { id: placeId(3, 2), name: 'Katabi Town Council', district_id: WAKISO },
  { id: placeId(3, 3), name: 'Nansana Division', district_id: WAKISO },
  { id: placeId(3, 4), name: 'Busukuma Subcounty', district_id: WAKISO },
  { id: placeId(3, 5), name: 'Buwama Subcounty', district_id: placeId(2, 1) },
  { id: placeId(3, 6), name: 'Goma Division', district_id: MUKONO },
  { id: placeId(3, 7), name: 'Kasawo Subcounty', district_id: MUKONO },
  { id: placeId(3, 8), name: 'Bombo Town Council', district_id: placeId(2, 2) },
  { id: placeId(3, 9), name: 'Central Division (Kampala CCA)', district_id: KAMPALA },
  { id: placeId(3, 10), name: 'Kawempe Division', district_id: KAMPALA },
  { id: placeId(3, 11), name: 'Makindye Division', district_id: KAMPALA },
  { id: placeId(3, 12), name: 'Bungatira Subcounty', district_id: placeId(2, 3) },
  { id: placeId(3, 13), name: 'Buwenge Subcounty', district_id: placeId(2, 4) },
];

const subcounty = (n: number) => {
  const place = SUBCOUNTIES[n - 1];
  return place ? { id: place.id, name: place.name } : null;
};
const VHT = '5b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
/** Who decides and comments in the mock: it does not know the signed-in user. */
const DCFP = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';

const ok = (data: unknown, status = 200): Reply => ({ status, body: { success: true, data } });
const fail = (status: number, message: string): Reply => ({
  status,
  body: { success: false, message },
});
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

let sequence = 0;
function uuid(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

/** The district, and its region, as the API nests them. */
function placesOf(districtId: string | null): Pick<Hotspot, 'region' | 'district'> {
  const district = DISTRICTS_BY_REGION.find((place) => place.id === districtId);
  const region = REGIONS.find((place) => place.id === district?.region_id);
  return {
    district: district ? { id: district.id, name: district.name } : null,
    region: region ?? null,
  };
}

/** Each hotspot's comment thread, by hotspot id; only `GET /hotspots/:id` serves it. */
const threads = new Map<string, Comment[]>();

function threadOf(target: Hotspot): Comment[] {
  const thread = threads.get(target.id) ?? [];
  threads.set(target.id, thread);
  return thread;
}

function hotspot(
  fields: Partial<Hotspot> &
    Pick<Hotspot, 'name' | 'review_status' | 'created_at'> & { comments?: Comment[] },
  districtId: string | null = WAKISO,
): Hotspot {
  const { comments = [], ...details } = fields;
  const made: Hotspot = {
    id: uuid(),
    type: null,
    village: null,
    ...placesOf(districtId),
    subcounty: null,
    latitude: null,
    longitude: null,
    has_condom_dispenser: null,
    dispenser_condition: null,
    status: fields.review_status === 'active' ? 'active' : 'inactive',
    submitted_by_id: VHT,
    contact_person: null,
    updated_at: fields.created_at,
    ...details,
  };
  threads.set(made.id, comments);
  return made;
}

const contact = (name: string, phone: string) => ({ id: uuid(), name, phone_number: phone });
const comment = (
  action: CommentAction,
  text: string,
  createdAt: string,
  userId: string = DCFP,
): Comment => ({ id: uuid(), user_id: userId, action, comment: text, created_at: createdAt });

function seedHotspots(dataset: string): Hotspot[] {
  if (dataset === 'empty') return [];
  const demo = [
    hotspot({
      name: 'Kajjansi Weekly Market',
      type: 'Market',
      village: 'Kajjansi',
      subcounty: subcounty(1),
      contact_person: contact('Nansubuga Aisha', '+256772555010'),
      has_condom_dispenser: false,
      latitude: 0.2167,
      longitude: 32.55,
      review_status: 'submitted',
      created_at: daysAgo(1),
      comments: [
        comment('comment', 'Stall owners asked for condoms on market day.', daysAgo(1), VHT),
      ],
    }),
    hotspot({
      name: 'Bwebajja Nite Spot',
      type: 'Bar',
      village: 'Bwebajja',
      subcounty: subcounty(1),
      contact_person: contact('Kato Musa', '+256701333444'),
      has_condom_dispenser: true,
      dispenser_condition: 'Poor',
      latitude: 0.2383,
      longitude: 32.5394,
      review_status: 'submitted',
      created_at: daysAgo(4),
      updated_at: daysAgo(2),
      comments: [comment('comment', 'Is the dispenser by the door or at the bar?', daysAgo(2))],
    }),
    hotspot({
      name: 'Kasenyi Landing Site',
      type: 'Landing site',
      village: 'Kasenyi',
      subcounty: subcounty(2),
      contact_person: contact('Okello James', '+256700000002'),
      has_condom_dispenser: true,
      dispenser_condition: 'Good',
      latitude: 0.0831,
      longitude: 32.5806,
      review_status: 'active',
      created_at: daysAgo(30),
      updated_at: daysAgo(28),
      comments: [
        comment('activated', 'Visited; the landing site is busy every night.', daysAgo(28)),
      ],
    }),
    hotspot({
      name: 'Nansana Taxi Park',
      type: 'Taxi park',
      village: 'Nansana',
      subcounty: subcounty(3),
      contact_person: contact('Ssali Peter', '+256752000111'),
      has_condom_dispenser: false,
      latitude: 0.3639,
      longitude: 32.5286,
      review_status: 'rejected',
      created_at: daysAgo(12),
      updated_at: daysAgo(10),
      comments: [comment('rejected', 'Already registered as Nansana Stage.', daysAgo(10))],
    }),
    // More active hotspots in Wakiso.
    hotspot({
      name: 'Kitende Trading Centre',
      type: 'Trading centre',
      village: 'Kitende',
      subcounty: subcounty(1),
      contact_person: contact('Namatovu Joan', '+256783410227'),
      has_condom_dispenser: true,
      dispenser_condition: 'Good',
      latitude: 0.1931,
      longitude: 32.5352,
      review_status: 'active',
      created_at: daysAgo(90),
      updated_at: daysAgo(88),
      comments: [comment('activated', 'Busy bars on both sides of the road.', daysAgo(88))],
    }),
    hotspot({
      name: 'Namasuba Lodge',
      type: 'Lodge',
      village: 'Namasuba',
      subcounty: subcounty(1),
      contact_person: contact('Mukasa Henry', '+256704118562'),
      has_condom_dispenser: false,
      latitude: 0.2764,
      longitude: 32.5661,
      review_status: 'active',
      created_at: daysAgo(70),
      updated_at: daysAgo(69),
      comments: [
        comment('activated', 'The owner agreed to keep condoms at reception.', daysAgo(69)),
      ],
    }),
    hotspot({
      name: 'Katabi Fish Market',
      type: 'Market',
      village: 'Katabi',
      subcounty: subcounty(2),
      contact_person: contact('Wasswa Robert', '+256775903114'),
      has_condom_dispenser: false,
      latitude: 0.0683,
      longitude: 32.4709,
      review_status: 'active',
      created_at: daysAgo(60),
      updated_at: daysAgo(59),
      comments: [
        comment('activated', 'Fishermen and traders from the islands stop here.', daysAgo(59)),
      ],
    }),
  ];
  if (dataset !== 'worst') return [...demo, ...mapHotspots()];
  // The values that break layouts come first, because the first rows are what is on screen.
  return [
    // A converted legacy hotspot: no place, no contact, no coordinates.
    hotspot({ name: 'Unplaced hotspot', review_status: 'submitted', created_at: daysAgo(0) }, null),
    hotspot({
      name: 'Null Island',
      latitude: 0,
      longitude: 0,
      review_status: 'active',
      created_at: daysAgo(2),
    }),
    hotspot({
      name: 'A hotspot name that runs on and on to show how a long name wraps in a table cell',
      type: 'Lodge with a long type of place',
      village: 'A village with a long name',
      subcounty: subcounty(4),
      contact_person: contact('Namubiru Christine Josephine Nakato', '+256772000000'),
      latitude: 89.9,
      longitude: 179.9,
      review_status: 'deactivated',
      created_at: daysAgo(3),
      comments: [comment('deactivated', 'x'.repeat(2000), daysAgo(3))],
    }),
    ...demo,
    ...mapHotspots(),
  ];
}

/*
 * A few hundred hotspots around five towns, for the map's clusters, heatmap and
 * filters. Generated from a fixed seed, so every run draws the same map. Wakiso
 * and Kampala are left alone: other screens' tests rely on what those hold.
 */
const MAP_TOWNS = [
  {
    district: placeId(2, 3),
    centre: [2.7746, 32.299],
    count: 90,
    villages: ['Laroo', 'Pece', 'Bardege', 'Layibi', 'Koro', 'Unyama', 'Awach', 'Bobi', 'Lalogi'],
  },
  {
    district: placeId(2, 4),
    centre: [0.4244, 33.2042],
    count: 110,
    villages: ['Bugembe', 'Walukuba', 'Masese', 'Mpumudde', 'Budondo', 'Kakira', 'Mafubira'],
  },
  {
    district: MUKONO,
    centre: [0.3533, 32.7553],
    count: 80,
    villages: ['Seeta', 'Namilyango', 'Goma', 'Kyetume', 'Nakisunga', 'Ntenjeru', 'Katosi'],
  },
  {
    district: placeId(2, 2),
    centre: [0.8492, 32.4731],
    count: 50,
    villages: ['Bombo', 'Wobulenzi', 'Kasana', 'Zirobwe', 'Kikyusa', 'Katikamu'],
  },
  {
    district: placeId(2, 1),
    centre: [0.225, 32.3136],
    count: 40,
    villages: ['Buwama', 'Kammengo', 'Nkozi', 'Kituntu', 'Muduuma'],
  },
] as const;

const VENUES = [
  'Bar',
  'Bar',
  'Lodge',
  'Guest House',
  'Boda Stage',
  'Landing Site',
  'Market',
  'Restaurant',
  'Massage Parlour',
  'Night Club',
  'New',
  'Old',
];
const CONTACTS = ['Achen Grace', 'Okot Denis', 'Nabirye Sarah', 'Waiswa Peter', 'Namubiru Joan'];

function mapHotspots(): Hotspot[] {
  // mulberry32: a tiny seeded generator.
  let seed = 20261121;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  // Points cluster around the town and a few trading centres near it.
  const spread = () => (random() + random() + random() - 1.5) * 0.09;

  // Two positions the map must not draw, as seen in real data: latitude and
  // longitude swapped, and a phone emulator's default location in California.
  const misplaced = [
    hotspot(
      {
        name: 'Walukuba Lodge 111',
        type: 'Lodge',
        village: 'Walukuba',
        latitude: 33.2042,
        longitude: 0.4244,
        review_status: 'active',
        created_at: daysAgo(90),
      },
      placeId(2, 4),
    ),
    hotspot(
      {
        name: 'Kakira Market 112',
        type: 'Market',
        village: 'Kakira',
        latitude: 37.4221,
        longitude: -122.0839,
        review_status: 'submitted',
        created_at: daysAgo(6),
      },
      placeId(2, 4),
    ),
  ];

  return MAP_TOWNS.flatMap((town) => {
    const centres = Array.from({ length: 4 }, () => [
      town.centre[0] + spread() * 2,
      town.centre[1] + spread() * 2,
    ]);
    return Array.from({ length: town.count }, (_, index) => {
      const village = pick(town.villages);
      const venue = pick(VENUES);
      const roll = random();
      const reviewStatus: ReviewStatus =
        roll < 0.78
          ? 'active'
          : roll < 0.88
            ? 'deactivated'
            : roll < 0.96
              ? 'submitted'
              : 'rejected';
      const has = random();
      const centre = index % 3 === 0 ? town.centre : pick(centres);
      const placed = random() > 0.08;
      // The draws below keep their order (contact, phone, dispenser condition, position), so
      // every run draws the same map.
      return hotspot(
        {
          name: `${village} ${venue === 'New' || venue === 'Old' ? 'Hotspot' : venue} ${String(index + 1)}`,
          type: venue,
          village,
          contact_person: contact(
            pick(CONTACTS),
            `+2567${String(Math.floor(10_000_000 + random() * 89_999_999))}`,
          ),
          has_condom_dispenser: has < 0.4 ? true : has < 0.9 ? false : null,
          dispenser_condition: has < 0.4 ? pick(['Good', 'Good', 'Good', 'Poor', 'Broken']) : null,
          latitude: placed ? Number((centre[0] + spread()).toFixed(5)) : null,
          longitude: placed ? Number((centre[1] + spread()).toFixed(5)) : null,
          review_status: reviewStatus,
          created_at: daysAgo(10 + Math.floor(random() * 700)),
        },
        town.district,
      );
    });
  }).concat(misplaced);
}

const state = { hotspots: [] as Hotspot[], events: [] as HotspotEvent[] };

function record(target: Hotspot, action: string, actorId: string, createdAt: string): void {
  state.events.unshift({
    id: uuid(),
    hot_spot_id: target.id,
    hot_spot_name: target.name,
    actor_id: actorId,
    action,
    status: target.review_status,
    created_at: createdAt,
  });
}

/** Seeds the hotspots. */
export function seedHotspotsMock(dataset: string): void {
  sequence = 0;
  threads.clear();
  state.hotspots = seedHotspots(dataset);
  state.events = [];
  for (const target of [...state.hotspots].reverse()) {
    record(target, 'submitted', VHT, target.created_at);
    for (const note of threadOf(target)) {
      const action = note.action === 'comment' ? 'commented' : note.action;
      record(target, action, note.user_id ?? DCFP, note.created_at);
    }
  }
  state.events.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const text = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= limit ? trimmed : null;
};
const inRange = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Math.abs(value) <= limit;
const sameName = (a: string | null, b: string | null) =>
  (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() ===
  (b ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** `POST /hotspots`, with the API's required fields and place checks. */
function submit(body: Body): Reply {
  const name = text(body.name, 100);
  const type = text(body.type, 100);
  const contactName = text(body.contact_person_name, 100);
  const phone = typeof body.contact_person_phone === 'string' ? body.contact_person_phone : '';
  const digits = phone.replace(/[\s()-]/g, '');
  const { latitude, longitude, has_condom_dispenser: hasDispenser } = body;
  if (
    !name ||
    !type ||
    !contactName ||
    !/^\+?\d{9,15}$/.test(digits) ||
    !inRange(latitude, 90) ||
    !inRange(longitude, 180) ||
    typeof hasDispenser !== 'boolean'
  ) {
    return fail(422, 'name, type, coordinates, contact person and dispenser answer are required');
  }
  const district = DISTRICTS_BY_REGION.find((place) => place.id === body.district_id);
  const place = SUBCOUNTIES.find((candidate) => candidate.id === body.subcounty_id);
  if (
    !district ||
    !place ||
    district.region_id !== body.region_id ||
    place.district_id !== district.id
  ) {
    return fail(422, 'the subcounty must belong to the district and the district to the region');
  }
  const village = text(body.village, 100);
  if (
    state.hotspots.some((other) => sameName(other.village, village) && sameName(other.name, name))
  ) {
    return fail(409, 'a hotspot with this name already exists in the village');
  }
  const now = new Date().toISOString();
  const first = text(body.comment, 2000);
  const created = hotspot(
    {
      name,
      type,
      village,
      subcounty: { id: place.id, name: place.name },
      latitude,
      longitude,
      contact_person: contact(contactName, digits),
      has_condom_dispenser: hasDispenser,
      dispenser_condition: hasDispenser ? text(body.dispenser_condition, 255) : null,
      review_status: 'submitted',
      created_at: now,
      comments: first ? [comment('comment', first, now, VHT)] : [],
    },
    district.id,
  );
  state.hotspots.unshift(created);
  record(created, 'submitted', VHT, now);
  return ok(created, 201);
}

function find(id: string): Hotspot | undefined {
  return state.hotspots.find((candidate) => candidate.id === id);
}

/** Moves a just-changed hotspot to the top, as the API orders by last update. */
function touch(target: Hotspot, at: string): void {
  target.updated_at = at;
  state.hotspots = [target, ...state.hotspots.filter((other) => other !== target)];
}

/** `POST /hotspots/:id/comments` and the decisions, each with a required comment. */
function commentOrDecide(id: string, step: string, body: Body): Reply {
  const decision = DECISIONS[step];
  if (step !== 'comments' && !decision) return fail(404, 'Not found');
  const note = text(body.comment, 2000);
  if (!note) return fail(422, 'comment is required and must be at most 2000 characters');
  const target = find(id);
  if (!target) return fail(404, 'hotspot not found');
  const now = new Date().toISOString();
  if (!decision) {
    threadOf(target).push(comment('comment', note, now));
    touch(target, now);
    record(target, 'commented', DCFP, now);
    return ok(target, 201);
  }
  if (!decision.from.includes(target.review_status)) {
    return fail(409, 'hotspot cannot take this decision in its current review status');
  }
  target.review_status = decision.to;
  target.status = decision.to === 'active' ? 'active' : 'inactive';
  threadOf(target).push(comment(decision.recorded, note, now));
  touch(target, now);
  record(target, decision.recorded, DCFP, now);
  return ok(target);
}

/** A page of hotspots as `GET /hotspots` filters them, most recently updated first. */
function listHotspots(query: URLSearchParams): Reply {
  const limit = Number(query.get('limit') ?? 50);
  const offset = Number(query.get('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || offset < 0) {
    return fail(400, 'limit must be between 1 and 100 and offset must be nonnegative');
  }
  const filters: [string, (target: Hotspot) => string | null | undefined][] = [
    ['district_id', (target) => target.district?.id],
    ['status', (target) => target.status],
    ['review_status', (target) => target.review_status],
    ['submitted_by_id', (target) => target.submitted_by_id],
  ];
  const matching = state.hotspots.filter((target) =>
    filters.every(([name, read]) => {
      const wanted = query.get(name);
      return !wanted || read(target) === wanted;
    }),
  );
  return ok(matching.slice(offset, offset + limit));
}

/** Answers `GET /locations/regions`, `/districts?region_id=`, `/subcounties?district_id=` and `/stores`. */
function lookupLocations(kind: string | undefined, query: URLSearchParams): Reply {
  if (kind === 'regions') return ok(REGIONS);
  if (kind === 'districts') {
    const regionId = query.get('region_id');
    if (!regionId) return ok(DISTRICTS);
    return ok(
      DISTRICTS_BY_REGION.filter((place) => place.region_id === regionId).map(({ id, name }) => ({
        id,
        name,
      })),
    );
  }
  if (kind === 'stores') {
    const storeType = query.get('store_type');
    const districtId = query.get('district_id');
    if (storeType && storeType !== 'national' && storeType !== 'district')
      return fail(400, 'store_type must be national or district');
    return ok(
      MOCK_STORES.filter(
        (store) =>
          (!storeType || store.store_type === storeType) &&
          (!districtId || store.district_id === districtId),
      ),
    );
  }
  if (kind === 'subcounties') {
    const districtId = query.get('district_id');
    if (!districtId) return fail(400, 'district_id is required and must be a nonzero UUID');
    return ok(SUBCOUNTIES.filter((place) => place.district_id === districtId));
  }
  return fail(404, 'Not found');
}

/** Answers `/hotspots…` and `/locations…`, or returns null for any other path. */
export function handleHotspots(
  method: string,
  parts: string[],
  body: Body,
  query: URLSearchParams,
): Reply | null {
  const [resource, id, step] = parts;
  if (resource === 'locations' && method === 'GET') return lookupLocations(id, query);
  if (resource !== 'hotspots') return null;
  if (method === 'GET' && id === undefined) return listHotspots(query);
  if (method === 'POST' && id === undefined) return submit(body);
  if (method === 'GET' && id === 'notifications') return ok(state.events);
  if (id === undefined) return fail(404, 'Not found');
  if (method === 'POST' && step) return commentOrDecide(id, step, body);
  const target = find(id);
  if (method === 'GET' && !target) return fail(404, 'hotspot not found');
  if (method === 'GET' && target && step === undefined) {
    return ok({ ...target, comments: threadOf(target) });
  }
  if (method === 'GET' && target && step === 'events') {
    return ok(state.events.filter((event) => event.hot_spot_id === target.id));
  }
  return fail(404, 'Not found');
}
