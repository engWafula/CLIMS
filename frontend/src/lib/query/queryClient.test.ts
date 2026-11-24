import { focusManager, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

import { createQueryClient, shouldRetryQuery } from './queryClient';

const errorOf = (kind: ApiError['kind']) => new ApiError({ kind, message: kind });

describe('shouldRetryQuery', () => {
  it.each(['network', 'timeout', 'server'] as const)('retries a %s failure', (kind) => {
    expect(shouldRetryQuery(0, errorOf(kind))).toBe(true);
    expect(shouldRetryQuery(1, errorOf(kind))).toBe(true);
  });

  it('gives up after two retries', () => {
    expect(shouldRetryQuery(2, errorOf('network'))).toBe(false);
  });

  it.each([
    'unauthorized',
    'forbidden',
    'not_found',
    'validation',
    'conflict',
    'rate_limited',
    'unexpected_response',
    'cancelled',
    'unknown',
  ] as const)('does not retry a %s failure, which would fail the same way', (kind) => {
    expect(shouldRetryQuery(0, errorOf(kind))).toBe(false);
  });
});

describe('createQueryClient', () => {
  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  it('refreshes active operational data in the foreground and pauses in the background', async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    const client = createQueryClient({ onMutationError: vi.fn() });
    const fetchOrders = vi.fn().mockResolvedValue([]);
    const observer = new QueryObserver(client, {
      queryKey: ['dcfp', 'orders'],
      queryFn: fetchOrders,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchOrders).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchOrders).toHaveBeenCalledTimes(2);
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchOrders).toHaveBeenCalledTimes(2);
    unsubscribe();
    client.clear();
  });

  it('keeps expensive map and ledger reads out of periodic polling', () => {
    const client = createQueryClient({ onMutationError: vi.fn() });
    const interval = client.getDefaultOptions().queries?.refetchInterval;
    expect(typeof interval).toBe('function');
    if (typeof interval !== 'function') throw new Error('Expected a refresh policy');
    const query = (queryKey: readonly unknown[]) =>
      client.getQueryCache().build(client, { queryKey });
    expect(interval(query(['hotspots', 'map', 'national']))).toBe(false);
    expect(interval(query(['warehouse-stock', 'store', 'movements', 'ledger', 'all']))).toBe(false);
    expect(interval(query(['dcfp', 'orders']))).toBe(60_000);
    expect(interval(query(['hotspots', 'all', {}]))).toBe(300_000);
    expect(interval(query(['access', 'roles']))).toBe(300_000);
  });

  it('reports a failed mutation that has no error handler of its own', async () => {
    const onMutationError = vi.fn();
    const client = createQueryClient({ onMutationError });
    const failure = errorOf('conflict');

    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(failure),
    });
    await expect(mutation.execute(undefined)).rejects.toBe(failure);

    expect(onMutationError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it('stays quiet about a cancelled mutation', async () => {
    const onMutationError = vi.fn();
    const client = createQueryClient({ onMutationError });

    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(errorOf('cancelled')),
    });
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(ApiError);

    expect(onMutationError).not.toHaveBeenCalled();
  });

  it('leaves a mutation alone when its screen shows the failure itself', async () => {
    const onMutationError = vi.fn();
    const client = createQueryClient({ onMutationError });

    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(errorOf('unauthorized')),
      meta: { handlesOwnErrors: true },
    });
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(ApiError);

    expect(onMutationError).not.toHaveBeenCalled();
  });

  it('never retries a mutation', async () => {
    const client = createQueryClient({ onMutationError: vi.fn() });
    const mutationFn = vi.fn(() => Promise.reject(errorOf('network')));

    const mutation = client.getMutationCache().build(client, { mutationFn });
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(ApiError);

    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});
