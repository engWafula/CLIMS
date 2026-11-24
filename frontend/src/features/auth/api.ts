import type { HttpClient } from '@/lib/api';
import { parseBody, parseList } from '@/lib/api';

import { deviceSessionSchema, type DeviceSession } from './deviceSessions';
import {
  authUserSchema,
  refreshedTokensSchema,
  sessionSchema,
  type AuthUser,
  type RefreshedTokens,
  type Session,
} from './session';

/*
 * The Go API's `auth` feature (`backend/internal/features/auth/routes.go`):
 *
 *   POST   /auth/login          { login, password }  → { token, refresh_token, user }   anonymous
 *   POST   /auth/refresh        { refresh_token }    → { token, refresh_token }         anonymous
 *   GET    /auth/me             → the signed-in user, with every role and its permissions
 *   POST   /auth/logout         ends the session that made the request
 *   GET    /auth/sessions       → where the signed-in user is signed in
 *   DELETE /auth/sessions/:id   signs one of those sessions out
 *
 * `POST /auth/register` is deliberately not used: it opens an account with no
 * role. Accounts are created by an administrator, with their roles, through
 * `POST /users` (see `features/users/api.ts`).
 */

/** Exchanges the single-use refresh token for new tokens. Rejects when the session has ended. */
export async function refreshTokens(
  http: HttpClient,
  refreshToken: string,
): Promise<RefreshedTokens> {
  const body = await http.post(
    '/auth/refresh',
    { refresh_token: refreshToken },
    { anonymous: true },
  );
  return parseBody(refreshedTokensSchema, body, 'refresh');
}

export interface Credentials {
  /** An email address, username or phone number. */
  login: string;
  password: string;
}

/** Ends the server session behind the current token, so the token is rejected from then on. */
export async function signOut(http: HttpClient, token?: string): Promise<void> {
  await http.post('/auth/logout', undefined, token === undefined ? undefined : { token });
}

/** Exchanges credentials for a session. Wrong credentials reject with an `unauthorized` ApiError. */
export async function signIn(http: HttpClient, credentials: Credentials): Promise<Session> {
  const body = await http.post('/auth/login', credentials, { anonymous: true });
  return parseBody(sessionSchema, body, 'login');
}

/**
 * Claims the session that portal sign-in started. The API reads it from an
 * HttpOnly cookie it set on the callback, and the claim works once.
 */
export async function completePortalSignIn(http: HttpClient): Promise<Session> {
  const body = await http.post('/auth/sso/exchange', undefined, { anonymous: true });
  return parseBody(sessionSchema, body, 'portal sign-in');
}

/**
 * The signed-in user as the server has them now. A deactivated account
 * rejects with a `forbidden` ApiError ("account is disabled").
 */
export async function getCurrentUser(http: HttpClient, signal?: AbortSignal): Promise<AuthUser> {
  return parseBody(authUserSchema, await http.get('/auth/me', { signal }), 'current user');
}

/** Every unexpired session of the signed-in user, including ones already signed out. */
export async function listMySessions(
  http: HttpClient,
  signal?: AbortSignal,
): Promise<DeviceSession[]> {
  return parseList(deviceSessionSchema, await http.get('/auth/sessions', { signal }), 'sessions');
}

/** Signs one of the user's own devices out. Rejects `not_found` when it was already signed out. */
export async function revokeMySession(http: HttpClient, sessionId: string): Promise<void> {
  await http.delete(`/auth/sessions/${encodeURIComponent(sessionId)}`);
}
