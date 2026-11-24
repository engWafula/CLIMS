import axios, { type AxiosAdapter, type Method } from 'axios';

import { ApiError, errorFromResponse, toApiError } from './errors';

export interface RequestOptions {
  /** Aborts the request, e.g. when the component that asked for it unmounts. */
  signal?: AbortSignal;
  /**
   * Send without the session token and without treating a 401 as an expired
   * session. Sign-in uses this: a 401 there means wrong credentials.
   */
  anonymous?: boolean;
  /**
   * Send with this token instead of the session's, for a session this browser
   * never kept (a field account refused at web sign-in). Like `anonymous`, a
   * 401 is then not an expired session.
   */
  token?: string;
}

/** The transport every feature talks through. Returns response bodies, throws `ApiError`. */
export interface HttpClient {
  get(path: string, options?: RequestOptions): Promise<unknown>;
  post(path: string, body?: unknown, options?: RequestOptions): Promise<unknown>;
  put(path: string, body?: unknown, options?: RequestOptions): Promise<unknown>;
  patch(path: string, body?: unknown, options?: RequestOptions): Promise<unknown>;
  delete(path: string, options?: RequestOptions): Promise<unknown>;
}

export interface HttpClientOptions {
  baseUrl: string;
  /** Read on every request so a sign-in or sign-out takes effect immediately. */
  getToken: () => string | null;
  /** Changes when the signed-in account changes, so old requests cannot affect a new session. */
  getSessionGeneration?: () => number;
  /**
   * Called when an authenticated request is rejected with 401 and could not be
   * refreshed, with the token it was sent with (`null` when it had none).
   */
  onUnauthorized: (rejectedToken: string | null) => void;
  /**
   * Renews the session after a 401 on `rejectedToken`, resolving `true` when
   * the request is worth retrying with the current token. Without it, a 401
   * ends the session at once.
   */
  refresh?: (rejectedToken: string) => Promise<boolean>;
  /** Upper bound on any one request. A hung connection must not hang the UI. */
  timeoutMs?: number;
  /** Replaces the network layer in tests. */
  adapter?: AxiosAdapter;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The legacy API reports some failures as HTTP 200 with the real status in a
 * `code` field (`{ "code": "401", "message": "…" }`). This is the one place
 * that knows about that; callers only ever see a thrown `ApiError`.
 */
function readEnvelopeStatus(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { code } = body as { code?: unknown };
  if (typeof code !== 'string' && typeof code !== 'number') return null;
  const status = Number(code);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

/**
 * The Go API wraps every body as `{ "success": true, "data": … }`. Features
 * only care about `data`, so it is unwrapped here. Bodies without that
 * envelope (the mock API, legacy endpoints) pass through unchanged.
 */
function unwrapEnvelope(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  const record = body as { success?: unknown; data?: unknown };
  return record.success === true && 'data' in record ? record.data : body;
}

/** Creates the app's HTTP client. Holds no state of its own beyond its options. */
export function createHttpClient({
  baseUrl,
  getToken,
  getSessionGeneration,
  onUnauthorized,
  refresh,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  adapter,
}: HttpClientOptions): HttpClient {
  const instance = axios.create({
    baseURL: baseUrl,
    timeout: timeoutMs,
    headers: { Accept: 'application/json' },
    ...(adapter ? { adapter } : {}),
  });

  async function request(
    method: Method,
    path: string,
    body: unknown,
    options: RequestOptions = {},
    isRetry = false,
    originalGeneration?: number,
  ): Promise<unknown> {
    const { signal, token: ownToken } = options;
    const anonymous = options.anonymous === true || ownToken !== undefined;
    const token = ownToken ?? (anonymous ? null : getToken());
    const generation = isRetry ? originalGeneration : getSessionGeneration?.();
    const sessionChanged = () =>
      !anonymous && generation !== undefined && getSessionGeneration?.() !== generation;
    const cancelled = () =>
      new ApiError({
        kind: 'cancelled',
        message: 'The session changed while the request was in progress.',
      });

    try {
      const response = await instance.request<unknown>({
        method,
        url: path,
        data: body,
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (sessionChanged()) throw cancelled();
      const envelopeStatus = readEnvelopeStatus(response.data);
      if (envelopeStatus !== null && envelopeStatus >= 400) {
        throw errorFromResponse(envelopeStatus, response.data);
      }
      return unwrapEnvelope(response.data);
    } catch (error) {
      if (sessionChanged()) throw cancelled();
      const apiError = toApiError(error);
      if (apiError.kind !== 'unauthorized' || anonymous) throw apiError;
      // An expired access token is renewed once and the request retried.
      if (!isRetry && token && refresh && (await refresh(token).catch(() => false))) {
        if (sessionChanged()) throw cancelled();
        return request(method, path, body, options, true, generation);
      }
      if (sessionChanged()) throw cancelled();
      onUnauthorized(token);
      throw apiError;
    }
  }

  return {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body, options) => request('POST', path, body, options),
    put: (path, body, options) => request('PUT', path, body, options),
    patch: (path, body, options) => request('PATCH', path, body, options),
    delete: (path, options) => request('DELETE', path, undefined, options),
  };
}
