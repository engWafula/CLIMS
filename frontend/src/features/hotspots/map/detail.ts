import { z } from 'zod';

import { optionalText, parseBody, parseList, useApiQuery, type HttpClient } from '@/lib/api';

import { mapHotspotSchema } from './records';

/*
 * One hotspot's record and history, for the map's detail panel:
 *
 *   GET /hotspots/{id}         the hotspot with its comment thread (`comments`)
 *   GET /hotspots/{id}/events  every workflow step, oldest first
 *
 * Comments and events carry the acting user's id only, not their name.
 */

const commentSchema = z.object({
  id: z.string().min(1),
  action: z.string().catch('comment'),
  comment: z.string().catch(''),
  created_at: optionalText,
});

export type HotspotComment = z.infer<typeof commentSchema>;

const threadSchema = z.object({
  comments: z
    .array(commentSchema)
    .nullish()
    .transform((comments) => comments ?? []),
});

const eventSchema = z.object({
  id: z.string().min(1),
  action: z.string(),
  status: optionalText,
  created_at: optionalText,
});

export type HotspotHistoryEvent = z.infer<typeof eventSchema>;

export async function getHotspotDetail(http: HttpClient, id: string, signal?: AbortSignal) {
  const body = await http.get(`/hotspots/${encodeURIComponent(id)}`, { signal });
  return {
    hotspot: parseBody(mapHotspotSchema, body, 'hotspot'),
    comments: parseBody(threadSchema, body, 'hotspot comments').comments,
  };
}

export async function listHotspotEvents(
  http: HttpClient,
  id: string,
  signal?: AbortSignal,
): Promise<HotspotHistoryEvent[]> {
  return parseList(
    eventSchema,
    await http.get(`/hotspots/${encodeURIComponent(id)}/events`, { signal }),
    'hotspot events',
  );
}

export function useHotspotDetail(id: string | null) {
  return useApiQuery(
    // Not hotspotKeys.detail: that caches the flat hotspot, this caches { hotspot, comments }.
    ['hotspots', 'map-detail', id],
    (http, signal) => getHotspotDetail(http, id ?? '', signal),
    { enabled: id !== null },
  );
}

export function useHotspotEvents(id: string | null) {
  return useApiQuery(
    ['hotspots', 'events', id],
    (http, signal) => listHotspotEvents(http, id ?? '', signal),
    { enabled: id !== null },
  );
}

const EVENT_SENTENCES: Record<string, string> = {
  submitted: 'Submitted for review',
  updated: 'Details updated',
  resubmitted: 'Edited and sent back for review',
  commented: 'Comment added',
  activated: 'Activated',
  deactivated: 'Deactivated',
  rejected: 'Rejected',
};

/** "Activated", or the action as recorded when it is new to this screen. */
export function eventSentence(action: string): string {
  const sentence = EVENT_SENTENCES[action.trim().toLowerCase()];
  if (sentence) return sentence;
  const words = action.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Updated';
}
