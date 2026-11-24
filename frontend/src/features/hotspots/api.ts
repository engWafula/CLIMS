import { z } from 'zod';

import {
  optionalNumber,
  optionalText,
  parseBody,
  parseList,
  readAllPages,
  type AllPages,
  type HttpClient,
} from '@/lib/api';

/*
 * Hotspots on the Go API (`backend/internal/features/hotspots`, `docs/modules/hotspots.md`).
 * A VHT submits one; the district's DCFP activates or rejects it, and can
 * later deactivate and reactivate it. Every decision carries a comment.
 *
 *   GET  /hotspots?status=&review_status=&district_id=&limit=&offset=   Hotspot[], most recently updated first
 *   POST /hotspots                       (the mobile app's VHT submission; not used on the web)
 *   GET  /hotspots/:id                   Hotspot with its comment thread
 *   GET  /hotspots/:id/events            HotspotEvent[]
 *   POST /hotspots/:id/comments          { comment } → 201
 *   POST /hotspots/:id/{activate,deactivate,reject}   { comment }
 *   GET  /locations/districts            [{ id, name }]
 *
 * The server scopes lists to what the caller may see: a VHT their own
 * submissions, a DCFP their store's district, national users every district.
 */

const uuidSchema = z.string().min(1);
const locationSchema = z.object({ id: uuidSchema, name: z.string() });

export const HOTSPOT_STATUSES = ['active', 'inactive'] as const;
/** The workflow step; every value except `active` means the hotspot is inactive. */
export const REVIEW_STATUSES = ['submitted', 'rejected', 'active', 'deactivated'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// Converted legacy hotspots can lack fields that new submissions require, so most are nullable.
const hotspotSchema = z.object({
  id: uuidSchema,
  name: optionalText,
  type: optionalText,
  village: optionalText,
  region: locationSchema.nullable(),
  district: locationSchema.nullable(),
  subcounty: locationSchema.nullable(),
  latitude: optionalNumber,
  longitude: optionalNumber,
  has_condom_dispenser: z.boolean().nullable(),
  dispenser_condition: optionalText,
  /** Only an active hotspot is in use. */
  status: z.enum(HOTSPOT_STATUSES),
  review_status: z.enum(REVIEW_STATUSES),
  submitted_by_id: uuidSchema.nullable(),
  /** The hotspot manager on site. */
  contact_person: z
    .object({ id: uuidSchema, name: optionalText, phone_number: optionalText })
    .nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Hotspot = z.infer<typeof hotspotSchema>;

export const COMMENT_ACTIONS = ['comment', 'activated', 'deactivated', 'rejected'] as const;

const commentSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema.nullable(),
  /** `comment`, or the decision the comment was recorded with. */
  action: z.enum(COMMENT_ACTIONS),
  comment: z.string(),
  created_at: z.string(),
});

export type HotspotComment = z.infer<typeof commentSchema>;

const detailSchema = hotspotSchema.extend({ comments: z.array(commentSchema) });

export type HotspotDetail = z.infer<typeof detailSchema>;

const eventSchema = z.object({
  id: uuidSchema,
  hot_spot_id: uuidSchema,
  hot_spot_name: z.string().nullable(),
  actor_id: uuidSchema,
  /** submitted, updated, resubmitted, commented, activated, deactivated or rejected. */
  action: z.string(),
  /** The review status after the step. */
  status: z.string(),
  created_at: z.string(),
});

export type HotspotEvent = z.infer<typeof eventSchema>;

/** The DCFP's decisions on a hotspot. Each needs a comment. */
export type HotspotDecision = 'activate' | 'deactivate' | 'reject';

/** Which decisions each review status allows (`docs/modules/hotspots.md`, Rules). */
export const DECISIONS_FROM: Readonly<Record<ReviewStatus, readonly HotspotDecision[]>> = {
  submitted: ['activate', 'reject'],
  active: ['deactivate'],
  deactivated: ['activate'],
  rejected: [],
};

export interface HotspotFilter {
  review_status?: ReviewStatus;
  district_id?: string;
}

const districtSchema = z.object({ id: uuidSchema, name: z.string() });

export type District = z.infer<typeof districtSchema>;

const hotspotPath = (id: string) => `/hotspots/${encodeURIComponent(id)}`;

// shortcut: one page of the 100 most recently updated hotspots; listAllHotspots pages through them.
export async function listHotspots(
  http: HttpClient,
  signal?: AbortSignal,
  districtId: string | null = null,
): Promise<Hotspot[]> {
  const query = new URLSearchParams({ limit: '100' });
  if (districtId) query.set('district_id', districtId);
  return parseList(hotspotSchema, await http.get(`/hotspots?${query}`, { signal }), 'hotspots');
}

/** 2,000 hotspots; the busiest district has under half that today. */
const HOTSPOT_MAX_PAGES = 20;

/** Every hotspot the caller can see that matches `filter`; `complete` is false at the cap. */
export async function listAllHotspots(
  http: HttpClient,
  filter: HotspotFilter = {},
  signal?: AbortSignal,
): Promise<AllPages<Hotspot>> {
  return readAllPages(
    async (offset, limit) => {
      const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (filter.review_status) query.set('review_status', filter.review_status);
      if (filter.district_id) query.set('district_id', filter.district_id);
      return parseList(hotspotSchema, await http.get(`/hotspots?${query}`, { signal }), 'hotspots');
    },
    { pageSize: 100, maxPages: HOTSPOT_MAX_PAGES, pagesAtOnce: 2 },
  );
}

export async function getHotspot(
  http: HttpClient,
  id: string,
  signal?: AbortSignal,
): Promise<HotspotDetail> {
  return parseBody(detailSchema, await http.get(hotspotPath(id), { signal }), 'hotspot');
}

export async function listHotspotEvents(
  http: HttpClient,
  id: string,
  signal?: AbortSignal,
): Promise<HotspotEvent[]> {
  return parseList(
    eventSchema,
    await http.get(`${hotspotPath(id)}/events`, { signal }),
    'hotspot events',
  );
}

export async function commentOnHotspot(
  http: HttpClient,
  id: string,
  comment: string,
): Promise<void> {
  await http.post(`${hotspotPath(id)}/comments`, { comment });
}

/** Activates, deactivates or rejects a hotspot, with the comment that explains why. */
export async function decideOnHotspot(
  http: HttpClient,
  id: string,
  decision: HotspotDecision,
  comment: string,
): Promise<void> {
  await http.post(`${hotspotPath(id)}/${decision}`, { comment });
}

export async function listLocationDistricts(
  http: HttpClient,
  signal?: AbortSignal,
): Promise<District[]> {
  return parseList(districtSchema, await http.get('/locations/districts', { signal }), 'districts');
}
