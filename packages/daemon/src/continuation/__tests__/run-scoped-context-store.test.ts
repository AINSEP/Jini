import { describe, expect, it, vi } from 'vitest';
import type { RunStatus } from '@jini-ai/protocol';
import {
  createRunScopedContextStore,
  RunContextNotBoundError,
} from '../run-scoped-context-store.js';

/**
 * A lifecycle double exposing only `waitForTerminal`, with each run's terminal promise settled by the
 * test. Real terminal transitions are `RunLifecycle`'s own concern and tested there; what matters here
 * is that a binding is evicted when — and only when — its run ends.
 */
function fakeLifecycle() {
  const settle = new Map<string, { resolve: () => void; reject: (error: unknown) => void }>();
  return {
    lifecycle: {
      waitForTerminal: (runId: string) =>
        new Promise<RunStatus>((resolve, reject) => {
          settle.set(runId, { resolve: () => resolve({ id: runId } as RunStatus), reject });
        }),
    },
    finish: (runId: string) => settle.get(runId)!.resolve(),
    fail: (runId: string, error: unknown) => settle.get(runId)!.reject(error),
    subscriptions: () => settle.size,
  };
}

/** Lets a `void`-ed promise continuation run before assertions. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface HostContext {
  readonly principalId: string;
}

describe('createRunScopedContextStore', () => {
  it('resolves a bound value', () => {
    const { lifecycle } = fakeLifecycle();
    const store = createRunScopedContextStore<HostContext>({ lifecycle });
    store.bind('run-1', { principalId: 'user-1' });
    expect(store.resolve('run-1')).toEqual({ principalId: 'user-1' });
    expect(store.has('run-1')).toBe(true);
    expect(store.size).toBe(1);
  });

  // Fail-closed is the whole point: a store that returned a default for an unknown run would let an
  // unrecognized run id act with fabricated authority.
  it('throws RunContextNotBoundError for an unbound run rather than returning a default', () => {
    const { lifecycle } = fakeLifecycle();
    const store = createRunScopedContextStore<HostContext>({ lifecycle });
    expect(() => store.resolve('never-bound')).toThrow(RunContextNotBoundError);
    expect(() => store.resolve('never-bound')).toThrow('never-bound');
    expect(store.has('never-bound')).toBe(false);
  });

  it('carries the offending run id on the error for a caller to map', () => {
    const { lifecycle } = fakeLifecycle();
    const store = createRunScopedContextStore<HostContext>({ lifecycle });
    try {
      store.resolve('run-x');
      expect.unreachable('resolve must throw for an unbound run');
    } catch (error) {
      expect(error).toBeInstanceOf(RunContextNotBoundError);
      expect((error as RunContextNotBoundError).runId).toBe('run-x');
    }
  });

  it('evicts a binding once its run reaches a terminal state', async () => {
    const { lifecycle, finish } = fakeLifecycle();
    const store = createRunScopedContextStore<HostContext>({ lifecycle });
    store.bind('run-1', { principalId: 'user-1' });

    finish('run-1');
    await flush();

    expect(store.size).toBe(0);
    expect(() => store.resolve('run-1')).toThrow(RunContextNotBoundError);
  });

  // A rejecting `waitForTerminal` still means the run is over. Evicting on both settlements also
  // avoids an unhandled rejection from a `void`-ed promise, which could take the process down.
  it('evicts — and does not reject unhandled — when waitForTerminal rejects', async () => {
    const { lifecycle, fail } = fakeLifecycle();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const store = createRunScopedContextStore<HostContext>({ lifecycle });
      store.bind('run-1', { principalId: 'user-1' });

      fail('run-1', new Error('lifecycle exploded'));
      await flush();

      expect(store.size).toBe(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('keeps concurrent runs isolated and evicts only the one that finished', async () => {
    const { lifecycle, finish } = fakeLifecycle();
    const store = createRunScopedContextStore<HostContext>({ lifecycle });
    store.bind('run-1', { principalId: 'user-1' });
    store.bind('run-2', { principalId: 'user-2' });

    finish('run-1');
    await flush();

    expect(store.size).toBe(1);
    expect(() => store.resolve('run-1')).toThrow(RunContextNotBoundError);
    expect(store.resolve('run-2')).toEqual({ principalId: 'user-2' });
  });

  it('replaces the value on re-bind without adding a second eviction subscription', () => {
    const { lifecycle, subscriptions } = fakeLifecycle();
    const store = createRunScopedContextStore<HostContext>({ lifecycle });
    store.bind('run-1', { principalId: 'user-1' });
    store.bind('run-1', { principalId: 'user-2' });

    expect(store.resolve('run-1')).toEqual({ principalId: 'user-2' });
    expect(store.size).toBe(1);
    expect(subscriptions()).toBe(1);
  });

  // The store is deliberately generic: no principal, no session, no contextRef decoding. A host may
  // bind whatever it owns, including a primitive.
  it('stores any host-chosen type, including a primitive', () => {
    const { lifecycle } = fakeLifecycle();
    const store = createRunScopedContextStore<string>({ lifecycle });
    store.bind('run-1', 'opaque-host-token');
    expect(store.resolve('run-1')).toBe('opaque-host-token');
  });
});
