import { useApiQuery } from '@/lib/api';

import {
  getBatchReport,
  getExpiryExceptions,
  getHmisReport,
  getHotspotReport,
  getNotificationReport,
  getStockReport,
  getSupplyReport,
  getTrends,
} from './api';

/*
 * One hook per report. Keys carry the API parameters, so every chart reading
 * the same report and filters shares one request, and a changed filter keeps
 * the previous figures on screen (dimmed) until the new ones arrive.
 */

const ROOT = 'analytics';
const MINUTE = 60_000;

type Params = Record<string, string>;

const options = { staleTime: MINUTE, keepPrevious: true } as const;

export function useTrends(params: Params, enabled = true) {
  return useApiQuery([ROOT, 'trends', params], (http, signal) => getTrends(http, params, signal), {
    ...options,
    enabled,
  });
}

export function useNotificationReport(params: Params, enabled = true) {
  return useApiQuery(
    [ROOT, 'notifications', params],
    (http, signal) => getNotificationReport(http, params, signal),
    { ...options, enabled },
  );
}

export function useSupplyReport(params: Params, enabled = true) {
  return useApiQuery(
    [ROOT, 'warehouse-requests', params],
    (http, signal) => getSupplyReport(http, params, signal),
    { ...options, enabled },
  );
}

export function useStockReport(params: Params, enabled = true) {
  return useApiQuery(
    [ROOT, 'stock', params],
    (http, signal) => getStockReport(http, params, signal),
    {
      ...options,
      enabled,
    },
  );
}

export function useBatchReport(params: Params, enabled = true) {
  return useApiQuery(
    [ROOT, 'batches', params],
    (http, signal) => getBatchReport(http, params, signal),
    {
      ...options,
      enabled,
    },
  );
}

export function useExpiryExceptions(params: Params, enabled = true) {
  return useApiQuery(
    [ROOT, 'expiry-exceptions', params],
    (http, signal) => getExpiryExceptions(http, params, signal),
    { ...options, enabled },
  );
}

export function useHmisReport(params: Params, enabled = true) {
  return useApiQuery(
    [ROOT, 'hmis-105', params],
    (http, signal) => getHmisReport(http, params, signal),
    {
      ...options,
      enabled,
    },
  );
}

export function useHotspotReport(params: Params, enabled = true) {
  return useApiQuery(
    [ROOT, 'hotspots', params],
    (http, signal) => getHotspotReport(http, params, signal),
    {
      ...options,
      enabled,
    },
  );
}
