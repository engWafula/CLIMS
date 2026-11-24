import { MutationCache, QueryClient, type Query } from '@tanstack/react-query';

import { toApiError, type ApiError, type ApiErrorKind } from '@/lib/api';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Set when the calling screen shows the failure itself (e.g. inline in a form). */
      handlesOwnErrors?: boolean;
    };
  }
}

/** Failures worth retrying: the request may succeed if simply sent again. */
const TRANSIENT_KINDS: ReadonlySet<ApiErrorKind> = new Set(['network', 'timeout', 'server']);
const MAX_QUERY_RETRIES = 2;

/** Whether a failed read should be retried. Exported for tests. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && TRANSIENT_KINDS.has(toApiError(error).kind);
}

// Poll only data that changes during normal operations. Expensive complete-map and
// paginated ledger reads are refreshed on demand or when revisited instead.
const LIVE_ROOTS = new Set([
  'dcfp',
  'warehouse-orders',
  'warehouse-stock',
  'national',
  'fulfilment',
  'hotspots',
  'catalogue',
  'users',
  'reports',
]);
const SLOW_ROOTS = new Set([
  'access',
  'geography',
  'stores',
  'organization-units',
  'locations',
  'programme-reports',
]);
const LIVE_REFRESH_MS = 60_000;
const SLOW_REFRESH_MS = 5 * 60_000;

function refreshInterval(query: Query): number | false {
  const [root, kind] = query.queryKey;
  if (typeof root !== 'string') return false;
  // Repeated permission and validation failures cannot be fixed by polling.
  if (query.state.error && !TRANSIENT_KINDS.has(toApiError(query.state.error).kind)) return false;
  if ((root === 'auth' && kind === 'me') || (root === 'hotspots' && kind === 'all'))
    return SLOW_REFRESH_MS;
  if (
    (root === 'hotspots' && kind === 'map') ||
    (root === 'reports' && kind === 'report') ||
    ((root === 'dcfp' || root === 'warehouse-orders') && kind === 'warehouses') ||
    (root === 'warehouse-stock' && query.queryKey.includes('ledger'))
  )
    return false;
  if (LIVE_ROOTS.has(root)) return LIVE_REFRESH_MS;
  if (SLOW_ROOTS.has(root)) return SLOW_REFRESH_MS;
  return false;
}

interface CreateQueryClientOptions {
  /**
   * Called for every failed mutation, so no write can fail silently. Individual
   * mutations do not need their own `onError` for the user to be told.
   */
  onMutationError: (error: ApiError) => void;
}

export function createQueryClient({ onMutationError }: CreateQueryClientOptions): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.handlesOwnErrors) return;
        const apiError = toApiError(error);
        // A cancelled write was the user's choice; nothing to report.
        if (apiError.kind !== 'cancelled') onMutationError(apiError);
      },
    }),
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        refetchInterval: refreshInterval,
      },
      mutations: {
        // Writes are never retried automatically: a create that timed out may
        // have succeeded, and sending it again would duplicate the record.
        retry: false,
      },
    },
  });
}
