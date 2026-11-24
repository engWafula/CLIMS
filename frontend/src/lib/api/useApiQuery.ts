import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query';

import type { ApiError } from './errors';
import type { HttpClient } from './http';
import { useHttp } from './HttpProvider';

export interface ApiQueryOptions {
  /** How long a result is served from cache before it is refetched. */
  staleTime?: number;
  /** False holds the request back, e.g. until the screen that needs it is open. Defaults to true. */
  enabled?: boolean;
  /** Refetch this often, in ms, while the query is in use, e.g. to check for new notifications. */
  refetchInterval?: number | false;
  /** Keep an in-progress editor stable until its own writes complete. */
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
  /**
   * Keep showing the previous result while a new key loads (a changed filter),
   * so a chart dims instead of flashing back to its skeleton.
   */
  keepPrevious?: boolean;
}

/**
 * Reads from the API through the app's HTTP client, cancelling the request if
 * the component that asked for it goes away.
 */
export function useApiQuery<Data>(
  queryKey: QueryKey,
  fetcher: (http: HttpClient, signal: AbortSignal) => Promise<Data>,
  { keepPrevious = false, ...options }: ApiQueryOptions = {},
) {
  const http = useHttp();
  // `http` is deliberately not part of the key: it is the one client for the
  // provider's lifetime, and a key must be serialisable data.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return useQuery<Data, ApiError>({
    queryKey,
    queryFn: ({ signal }) => fetcher(http, signal),
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
    ...options,
  });
}
