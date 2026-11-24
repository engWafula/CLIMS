import { describe, expect, it } from 'vitest';

import { createHttpClient, type HttpClient } from '@/lib/api';
import { createMemoryStorage } from '@/lib/storage/jsonStorage';
import { createAppStore } from '@/store/store';
import { createFakeAdapter } from '@/test/fakeAdapter';

import { selectSession, sessionStarted } from './authSlice';
import { createSessionRefresher } from './refresh';
import { createSessionStore, type Session } from './session';

const session: Session = {
  token: 'access-1',
  refresh_token: 'refresh-1',
  user: {
    id: 'c0784d50-241e-4164-97db-9314f5f17c33',
    username: 'snakato',
    role: 'dfcp',
    firstname: null,
    lastname: null,
    email: null,
    permissions: null,
    roleNames: ['dfcp'],
    store_id: null,
  },
};

function setup(saved: Session | null, ...replies: Parameters<typeof createFakeAdapter>) {
  const storage = createMemoryStorage(saved ? { 'clims.session': JSON.stringify(saved) } : {});
  const sessionStore = createSessionStore(storage);
  const store = createAppStore({ sessionStore });
  const { adapter, requests } = createFakeAdapter(...replies);
  const http = createHttpClient({
    baseUrl: '/api',
    getToken: () => null,
    onUnauthorized: () => undefined,
    adapter,
  });
  return {
    store,
    storage,
    sessionStore,
    requests,
    refresh: createSessionRefresher(
      store,
      () => http,
      () => sessionStore.load(),
      0,
    ),
  };
}

const renewed = {
  status: 200,
  body: { success: true, data: { token: 'access-2', refresh_token: 'refresh-2' } },
};

describe('createSessionRefresher', () => {
  it('spends the refresh token once for requests rejected together, and saves the new tokens', async () => {
    const { store, sessionStore, requests, refresh } = setup(session, renewed);

    await expect(Promise.all([refresh('access-1'), refresh('access-1')])).resolves.toEqual([
      true,
      true,
    ]);

    expect(requests).toEqual([
      expect.objectContaining({
        url: '/auth/refresh',
        body: { refresh_token: 'refresh-1' },
        authorization: null,
      }),
    ]);
    expect(selectSession(store.getState())).toMatchObject({
      token: 'access-2',
      refresh_token: 'refresh-2',
    });
    expect(sessionStore.load()).toMatchObject({ token: 'access-2', refresh_token: 'refresh-2' });
  });

  it('retries without refreshing when another tab already renewed the token', async () => {
    const { requests, refresh } = setup(session, renewed);

    await expect(refresh('access-0')).resolves.toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("takes another tab's renewed tokens when that tab spent the refresh token first", async () => {
    const { store, storage, refresh } = setup(session, { status: 401 });
    // The other tab's save, before its storage event reached this tab.
    const otherTab = createSessionStore(storage);
    otherTab.save({ ...session, token: 'access-2', refresh_token: 'refresh-2' });

    await expect(refresh('access-1')).resolves.toBe(true);
    expect(selectSession(store.getState())).toMatchObject({
      token: 'access-2',
      refresh_token: 'refresh-2',
    });
  });

  it('does not take a stored session that belongs to another user', async () => {
    const { store, storage, refresh } = setup(session, { status: 401 });
    createSessionStore(storage).save({
      ...session,
      token: 'access-9',
      refresh_token: 'refresh-9',
      user: { ...session.user, id: 'another-user' },
    });

    await expect(refresh('access-1')).resolves.toBe(false);
    expect(selectSession(store.getState())?.token).toBe('access-1');
  });

  it('does not apply a previous account’s late refresh to the new account', async () => {
    const { store } = setup(session, renewed);
    let resolve!: (value: unknown) => void;
    const post = () =>
      new Promise<unknown>((done) => {
        resolve = done;
      });
    const unexpected = () => Promise.reject(new Error('Unexpected request'));
    const http: HttpClient = {
      get: unexpected,
      post,
      put: unexpected,
      patch: unexpected,
      delete: unexpected,
    };
    const refresh = createSessionRefresher(
      store,
      () => http,
      () => null,
      0,
    );
    const result = refresh('access-1');
    const next = {
      ...session,
      token: 'new-access',
      refresh_token: 'new-refresh',
      user: { ...session.user, id: 'another-user' },
    };
    store.dispatch(sessionStarted(next));
    resolve({ token: 'old-renewed', refresh_token: 'old-renewed-refresh' });
    await expect(result).resolves.toBe(false);
    expect(selectSession(store.getState())).toEqual(next);
  });

  it('lets a new account refresh while the previous account’s request is still pending', async () => {
    const { store } = setup(session, renewed);
    let resolveOld!: (value: unknown) => void;
    const post: HttpClient['post'] = (_path, body) => {
      const { refresh_token } = body as { refresh_token: string };
      if (refresh_token === 'refresh-1')
        return new Promise<unknown>((done) => {
          resolveOld = done;
        });
      return Promise.resolve({ token: 'new-renewed', refresh_token: 'new-renewed-refresh' });
    };
    const unexpected = () => Promise.reject(new Error('Unexpected request'));
    const http: HttpClient = {
      get: unexpected,
      post,
      put: unexpected,
      patch: unexpected,
      delete: unexpected,
    };
    const refresh = createSessionRefresher(
      store,
      () => http,
      () => null,
      0,
    );
    const old = refresh('access-1');
    store.dispatch(
      sessionStarted({
        ...session,
        token: 'new-access',
        refresh_token: 'new-refresh',
        user: { ...session.user, id: 'another-user' },
      }),
    );
    await expect(refresh('new-access')).resolves.toBe(true);
    resolveOld({ token: 'old-renewed', refresh_token: 'old-renewed-refresh' });
    await expect(old).resolves.toBe(false);
    expect(selectSession(store.getState())).toMatchObject({
      token: 'new-renewed',
      user: { id: 'another-user' },
    });
  });

  it('gives up when the session has ended or cannot be refreshed', async () => {
    await expect(setup(null, renewed).refresh('access-1')).resolves.toBe(false);
    await expect(
      setup({ ...session, refresh_token: null }, renewed).refresh('access-1'),
    ).resolves.toBe(false);
    await expect(setup(session, { status: 401 }).refresh('access-1')).resolves.toBe(false);
  });
});
