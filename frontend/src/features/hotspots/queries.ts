import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { notificationKeys } from '@/features/notifications/queries';
import { useApiQuery, useHttp } from '@/lib/api';

import {
  commentOnHotspot,
  decideOnHotspot,
  getHotspot,
  listAllHotspots,
  listHotspotEvents,
  listLocationDistricts,
  type HotspotDecision,
  type HotspotFilter,
} from './api';

const hotspotsKey = ['hotspots'] as const;
export const hotspotKeys = {
  all: hotspotsKey,
  allPages: (filter: HotspotFilter) => [...hotspotsKey, 'all', filter] as const,
  detail: (id: string) => [...hotspotsKey, 'detail', id] as const,
  events: (id: string) => [...hotspotsKey, 'detail', id, 'events'] as const,
};

/** Every hotspot matching `filter` that the caller can see, read page by page. */
export function useAllHotspots(filter: HotspotFilter = {}, { enabled = true } = {}) {
  return useApiQuery(
    hotspotKeys.allPages(filter),
    (http, signal) => listAllHotspots(http, filter, signal),
    { enabled },
  );
}

export function useHotspot(id: string) {
  return useApiQuery(hotspotKeys.detail(id), (http, signal) => getHotspot(http, id, signal));
}

export function useHotspotEvents(id: string) {
  return useApiQuery(hotspotKeys.events(id), (http, signal) => listHotspotEvents(http, id, signal));
}

export function useLocationDistricts(enabled: boolean) {
  return useApiQuery(['locations', 'districts'], listLocationDistricts, { enabled });
}

/** Refetches every hotspot view, and the inbox the step notified. */
function useInvalidateHotspots() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hotspotsKey }),
      queryClient.invalidateQueries({ queryKey: notificationKeys.inbox }),
    ]);
}

export function useCommentOnHotspot(id: string) {
  const http = useHttp();
  const invalidate = useInvalidateHotspots();
  return useMutation({
    mutationFn: (comment: string) => commentOnHotspot(http, id, comment),
    onSuccess: async () => {
      toast.success('Comment added');
      await invalidate();
    },
    meta: { handlesOwnErrors: true },
  });
}

const DECISION_TOASTS: Record<HotspotDecision, string> = {
  activate: 'Hotspot activated',
  deactivate: 'Hotspot deactivated',
  reject: 'Hotspot rejected',
};

/** A DCFP's decision on any hotspot, so one list can act on each of its rows. */
export function useHotspotDecision() {
  const http = useHttp();
  const invalidate = useInvalidateHotspots();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      decision: HotspotDecision;
      comment: string;
    }) => decideOnHotspot(http, id, decision, comment),
    onSuccess: async (_, { decision }) => {
      toast.success(DECISION_TOASTS[decision]);
      await invalidate();
    },
    // The decision dialog shows a refusal next to the comment.
    meta: { handlesOwnErrors: true },
  });
}
