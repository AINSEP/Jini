// Unit tests for the config hook (master switch + the four per-hook flags).
// The wire-body rules are already characterized in rules.test.ts; this pins
// the hook's OWN behavior: optimistic toggle, rollback on a failed/rejected
// PATCH, the per-setting write-queue coalescing, and hydrate()'s interaction
// with the async-commit-guard (captureHydrationRevision / invalidate-at-both-
// start-and-settle — see async-commit-guard.ts's doc comment for the exact
// regression this is guarding against).
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMemoryConfig, useWiredMemoryConfig } from '../../../react/hooks/useMemoryConfig.hooks.js';
import { useMemoryEntries } from '../../../react/hooks/useMemoryEntries.hooks.js';
import type { MemoryConfigPort, MemoryEntriesPort } from '../../../ports.js';
import type { MemoryConfigFlagKey } from '../../../rules.js';
import type { MemoryListResponse, MemoryTreeNode } from '../../../types.js';

const SAVE_ERROR_MESSAGE = "Memory settings couldn't be saved. Try again shortly.";

function makePort(patchConfig = vi.fn(async () => true)): MemoryConfigPort {
  return { patchConfig };
}

/** A promise plus its own resolve/reject, so a test can control exactly when
 *  a PATCH settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function listResponse(over: Partial<MemoryListResponse> = {}): MemoryListResponse {
  return {
    enabled: true,
    chatExtractionEnabled: true,
    profileEnabled: true,
    rewriteEnabled: true,
    verifyEnabled: true,
    rootDir: '',
    index: '',
    entries: [],
    ...over,
  };
}

function makeEntriesPort(overrides: Partial<MemoryEntriesPort> = {}): MemoryEntriesPort {
  return {
    fetchMemoryList: vi.fn(async () => listResponse()),
    fetchMemoryTree: vi.fn(async () => [] as MemoryTreeNode[]),
    fetchMemoryEntry: vi.fn(async () => null),
    saveMemoryEntry: vi.fn(async () => null),
    deleteMemoryEntry: vi.fn(async () => true),
    saveMemoryIndex: vi.fn(async () => true),
    ...overrides,
  };
}

/** Wires config + entries together the way a host orchestrator would, so
 *  reload()'s captureConfigHydrationRevision/hydrateConfig coordination can be
 *  exercised the same way the real app drives it. */
function renderWired(configPort: MemoryConfigPort, entriesPort: MemoryEntriesPort) {
  return renderHook(() => {
    const config = useMemoryConfig(configPort);
    const entries = useMemoryEntries(entriesPort, {
      fireFlash: vi.fn(),
      captureConfigHydrationRevision: config.captureHydrationRevision,
      hydrateConfig: config.hydrate,
      openEditor: vi.fn(),
      closeEditor: vi.fn(),
    });
    return { config, entries };
  });
}

const hookFlagKeys: MemoryConfigFlagKey[] = [
  'chatExtractionEnabled',
  'profileEnabled',
  'rewriteEnabled',
  'verifyEnabled',
];

describe('useMemoryConfig', () => {
  describe('initial state', () => {
    it('defaults every flag to enabled with no error', () => {
      const { result } = renderHook(() => useMemoryConfig(makePort()));
      expect(result.current.enabled).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.hookFlags).toEqual({
        chatExtractionEnabled: true,
        profileEnabled: true,
        rewriteEnabled: true,
        verifyEnabled: true,
      });
    });
  });

  describe('master switch', () => {
    it('toggles optimistically and PATCHes the wire body', async () => {
      const patchConfig = vi.fn(async () => true);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      let toggle!: Promise<void>;
      act(() => {
        toggle = result.current.onToggleEnabled(false);
      });
      // The flip is visible immediately, before the PATCH resolves.
      expect(result.current.enabled).toBe(false);

      await act(async () => {
        await toggle;
      });
      expect(result.current.enabled).toBe(false);
      expect(result.current.error).toBeNull();
      expect(patchConfig).toHaveBeenCalledWith({ enabled: false });
    });

    it('clears a prior error on a new toggle attempt', async () => {
      const patchConfig = vi.fn(async () => false);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      await act(async () => {
        await result.current.onToggleEnabled(false);
      });
      expect(result.current.error).toBe(SAVE_ERROR_MESSAGE);

      patchConfig.mockResolvedValueOnce(true);
      await act(async () => {
        await result.current.onToggleEnabled(false);
      });
      expect(result.current.error).toBeNull();
    });

    it('rolls back to the confirmed value when the PATCH resolves false', async () => {
      const patchConfig = vi.fn(async () => false);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      expect(result.current.enabled).toBe(true);
      await act(async () => {
        await result.current.onToggleEnabled(false);
      });

      expect(result.current.enabled).toBe(true);
      expect(result.current.error).toBe(SAVE_ERROR_MESSAGE);
      expect(patchConfig).toHaveBeenCalledWith({ enabled: false });
    });

    it('rolls back and rejects when the PATCH throws', async () => {
      const patchConfig = vi.fn(async () => {
        throw new Error('network down');
      });
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      await act(async () => {
        await expect(result.current.onToggleEnabled(false)).rejects.toThrow('network down');
      });

      expect(result.current.enabled).toBe(true);
      expect(result.current.error).toBe(SAVE_ERROR_MESSAGE);
    });

    it('settles at the confirmed value when two overlapping PATCHes both fail, regardless of resolution order', async () => {
      const first = deferred<boolean>();
      const second = deferred<boolean>();
      const patchConfig = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      let toggleA!: Promise<void>;
      let toggleB!: Promise<void>;
      act(() => {
        toggleA = result.current.onToggleEnabled(false);
      });
      act(() => {
        toggleB = result.current.onToggleEnabled(true);
      });
      expect(result.current.enabled).toBe(true);

      await act(async () => {
        first.resolve(false);
        await toggleA;
      });
      // The stale request must not clobber the still-pending optimistic value.
      expect(result.current.enabled).toBe(true);

      await act(async () => {
        second.resolve(false);
        await toggleB;
      });
      expect(result.current.enabled).toBe(true);
    });

    it('serializes a fast true -> false -> true sequence so the last PATCH on the wire carries the latest intent', async () => {
      const first = deferred<boolean>();
      const second = deferred<boolean>();
      const patchConfig = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      let toggleA!: Promise<void>;
      let toggleB!: Promise<void>;
      act(() => {
        toggleA = result.current.onToggleEnabled(false);
      });
      act(() => {
        toggleB = result.current.onToggleEnabled(true);
      });
      // Only one PATCH is on the wire; B is queued behind it.
      expect(patchConfig).toHaveBeenCalledTimes(1);
      expect(patchConfig).toHaveBeenCalledWith({ enabled: false });

      // B's response is "ready" before A even settles — the reverse-completion
      // order that would let the server persist the stale `false` if writes
      // weren't serialized.
      second.resolve(true);
      await act(async () => {
        first.resolve(true);
        await toggleA;
        await toggleB;
      });

      expect(patchConfig).toHaveBeenCalledTimes(2);
      expect(patchConfig).toHaveBeenLastCalledWith({ enabled: true });
      expect(result.current.enabled).toBe(true);
    });

    it('coalesces toggles queued behind an in-flight PATCH down to the latest intent', async () => {
      const first = deferred<boolean>();
      const second = deferred<boolean>();
      const patchConfig = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      // Three rapid flips: the two issued while the first PATCH is in flight
      // collapse into ONE follow-up write carrying only the final value.
      let toggleA!: Promise<void>;
      let toggleB!: Promise<void>;
      let toggleC!: Promise<void>;
      act(() => {
        toggleA = result.current.onToggleEnabled(false);
      });
      act(() => {
        toggleB = result.current.onToggleEnabled(true);
      });
      act(() => {
        toggleC = result.current.onToggleEnabled(false);
      });
      expect(patchConfig).toHaveBeenCalledTimes(1);

      await act(async () => {
        first.resolve(true);
        second.resolve(true);
        await Promise.all([toggleA, toggleB, toggleC]);
      });

      expect(patchConfig).toHaveBeenCalledTimes(2);
      expect(patchConfig).toHaveBeenLastCalledWith({ enabled: false });
      expect(result.current.enabled).toBe(false);
      // The stale intent's own promise still resolves (it never rejects the
      // caller just because a newer intent superseded it).
      await expect(toggleA).resolves.toBeUndefined();
    });

    it('a stale queued write whose superseding PATCH fails still resolves its own promise (no rollback, since a newer intent is queued)', async () => {
      const first = deferred<boolean>();
      const second = deferred<boolean>();
      const patchConfig = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      let toggleA!: Promise<void>;
      let toggleB!: Promise<void>;
      act(() => {
        toggleA = result.current.onToggleEnabled(false);
      });
      act(() => {
        toggleB = result.current.onToggleEnabled(true);
      });

      await act(async () => {
        first.resolve(true);
        await toggleA;
      });
      // A's own value was superseded by B before A settled, so A's failure or
      // success must not roll the switch back to A's confirmed value.
      expect(result.current.enabled).toBe(true);

      await act(async () => {
        second.resolve(false);
        await toggleB;
      });
      // B (the latest intent) failed, so it rolls back to the LAST confirmed
      // value — which A's own successful PATCH just set to `false`.
      expect(result.current.enabled).toBe(false);
      expect(result.current.error).toBe(SAVE_ERROR_MESSAGE);
    });
  });

  describe('per-hook flags', () => {
    it.each(hookFlagKeys)('%s toggles optimistically and PATCHes just that key', async (key) => {
      const patchConfig = vi.fn(async () => true);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      expect(result.current.hookFlags[key]).toBe(true);
      await act(async () => {
        await result.current.onToggleHook(key, false);
      });

      expect(result.current.hookFlags[key]).toBe(false);
      expect(patchConfig).toHaveBeenCalledWith({ [key]: false });
      // No other flag was touched by this toggle.
      for (const other of hookFlagKeys) {
        if (other !== key) expect(result.current.hookFlags[other]).toBe(true);
      }
    });

    it.each(hookFlagKeys)('%s rolls back when the PATCH resolves false', async (key) => {
      const patchConfig = vi.fn(async () => false);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      await act(async () => {
        await result.current.onToggleHook(key, false);
      });

      expect(result.current.hookFlags[key]).toBe(true);
      expect(result.current.error).toBe(SAVE_ERROR_MESSAGE);
    });

    it('rolls a per-hook flag back and rejects when the PATCH throws', async () => {
      const patchConfig = vi.fn(async () => {
        throw new Error('network down');
      });
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      expect(result.current.hookFlags.profileEnabled).toBe(true);
      await act(async () => {
        await expect(result.current.onToggleHook('profileEnabled', false)).rejects.toThrow('network down');
      });

      expect(result.current.hookFlags.profileEnabled).toBe(true);
      expect(result.current.error).toBe(SAVE_ERROR_MESSAGE);
    });

    it('serializes a fast per-hook toggle sequence so the last PATCH on the wire carries the latest intent', async () => {
      const first = deferred<boolean>();
      const second = deferred<boolean>();
      const patchConfig = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      let toggleA!: Promise<void>;
      let toggleB!: Promise<void>;
      act(() => {
        toggleA = result.current.onToggleHook('profileEnabled', false);
      });
      act(() => {
        toggleB = result.current.onToggleHook('profileEnabled', true);
      });
      expect(patchConfig).toHaveBeenCalledTimes(1);
      expect(patchConfig).toHaveBeenCalledWith({ profileEnabled: false });

      second.resolve(true);
      await act(async () => {
        first.resolve(true);
        await toggleA;
        await toggleB;
      });

      expect(patchConfig).toHaveBeenCalledTimes(2);
      expect(patchConfig).toHaveBeenLastCalledWith({ profileEnabled: true });
      expect(result.current.hookFlags.profileEnabled).toBe(true);
    });

    it('toggling two different hook flags concurrently PATCHes each on its own independent queue', async () => {
      const patchConfig = vi.fn(async () => true);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      await act(async () => {
        await Promise.all([
          result.current.onToggleHook('profileEnabled', false),
          result.current.onToggleHook('rewriteEnabled', false),
        ]);
      });

      // Both PATCHes went out independently — neither queue blocked the other.
      expect(patchConfig).toHaveBeenCalledTimes(2);
      expect(patchConfig).toHaveBeenCalledWith({ profileEnabled: false });
      expect(patchConfig).toHaveBeenCalledWith({ rewriteEnabled: false });
      expect(result.current.hookFlags.profileEnabled).toBe(false);
      expect(result.current.hookFlags.rewriteEnabled).toBe(false);
    });
  });

  describe('hydrate()', () => {
    it('maps a list response onto every flag (missing per-hook flag => true, legacy default)', () => {
      const { result } = renderHook(() => useMemoryConfig(makePort()));
      act(() =>
        result.current.hydrate(
          listResponse({ enabled: false, profileEnabled: false }),
          result.current.captureHydrationRevision(),
        ),
      );

      expect(result.current.enabled).toBe(false);
      expect(result.current.hookFlags.profileEnabled).toBe(false);
      expect(result.current.hookFlags.verifyEnabled).toBe(true);
      expect(result.current.hookFlags.rewriteEnabled).toBe(true);
      expect(result.current.hookFlags.chatExtractionEnabled).toBe(true);
    });

    it('ignores a stale revision (captured before a local write invalidated it)', () => {
      const { result } = renderHook(() => useMemoryConfig(makePort()));

      const staleRevision = result.current.captureHydrationRevision();
      act(() => {
        // A local write (even one that never resolves in this test) invalidates
        // every revision captured before it.
        void result.current.onToggleEnabled(false);
      });

      act(() => result.current.hydrate(listResponse({ enabled: true }), staleRevision));
      // The stale-revision hydrate must be dropped entirely — the optimistic
      // `false` from the toggle above survives.
      expect(result.current.enabled).toBe(false);
    });

    it('applies a hydrate captured at the current revision with no pending write', () => {
      const { result } = renderHook(() => useMemoryConfig(makePort()));
      const revision = result.current.captureHydrationRevision();
      act(() => result.current.hydrate(listResponse({ enabled: false }), revision));
      expect(result.current.enabled).toBe(false);
    });

    it('does not let hydration overwrite an in-flight optimistic master toggle', async () => {
      const patch = deferred<boolean>();
      const patchConfig = vi.fn().mockReturnValueOnce(patch.promise);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      let toggle!: Promise<void>;
      act(() => {
        toggle = result.current.onToggleEnabled(false);
      });
      expect(result.current.enabled).toBe(false);

      // Represents a list GET that observed the old server state before the
      // PATCH above was applied.
      act(() => {
        result.current.hydrate(listResponse({ enabled: true }), result.current.captureHydrationRevision());
      });
      expect(result.current.enabled).toBe(false);

      await act(async () => {
        patch.resolve(true);
        await toggle;
      });
      expect(result.current.enabled).toBe(false);
    });

    it('does not let hydration overwrite an in-flight optimistic hook toggle', async () => {
      const patch = deferred<boolean>();
      const patchConfig = vi.fn().mockReturnValueOnce(patch.promise);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      let toggle!: Promise<void>;
      act(() => {
        toggle = result.current.onToggleHook('profileEnabled', false);
      });
      expect(result.current.hookFlags.profileEnabled).toBe(false);

      act(() => {
        result.current.hydrate(listResponse({ profileEnabled: true }), result.current.captureHydrationRevision());
      });
      expect(result.current.hookFlags.profileEnabled).toBe(false);

      await act(async () => {
        patch.resolve(true);
        await toggle;
      });
      expect(result.current.hookFlags.profileEnabled).toBe(false);
    });

    // REGRESSION: async-commit-guard.ts's doc comment describes a bug that
    // shipped once — invalidate() was only called at the toggle's optimistic
    // START, not again in the write's onSettled callback. That left a window
    // open: a reload's read that BEGINS after the toggle starts but RESOLVES
    // after the toggle's PATCH has already settled would still carry a
    // revision captured before the settle-time invalidate, so hydrate() would
    // wrongly treat it as current and apply stale, pre-write server data.
    // Exercise exactly that ordering: capture the reload's revision while the
    // toggle's PATCH is still in flight, let the toggle settle FIRST, and only
    // then resolve the reload's read.
    it('hydrate() ignores a stale revision even when a reload capture happens mid-flight and its read resolves AFTER the toggle settles', async () => {
      const patch = deferred<boolean>();
      const patchConfig = vi.fn().mockReturnValueOnce(patch.promise);
      const { result } = renderHook(() => useMemoryConfig(makePort(patchConfig)));

      let toggle!: Promise<void>;
      act(() => {
        toggle = result.current.onToggleEnabled(false);
      });

      // The "reload" captures its revision WHILE the PATCH is still in flight
      // — i.e. after onToggleEnabled's start-time invalidate() already ran,
      // so this revision looks current at the moment it's captured.
      const midFlightRevision = result.current.captureHydrationRevision();

      // The toggle's PATCH now settles (successfully) — the buggy version
      // never invalidated again here, so `midFlightRevision` would remain
      // "current" from hydrate()'s point of view.
      await act(async () => {
        patch.resolve(true);
        await toggle;
      });
      expect(result.current.enabled).toBe(false);

      // Only now does the reload's own read "resolve" with what it actually
      // observed on the wire: stale, pre-write server data.
      act(() => {
        result.current.hydrate(listResponse({ enabled: true }), midFlightRevision);
      });

      // The settle-time invalidate() must have moved the guard forward, so
      // this hydrate is rejected as stale — the confirmed `false` must survive.
      expect(result.current.enabled).toBe(false);
    });

    it('does not let a reload begun before a successful toggle hydrate its stale server snapshot afterward', async () => {
      const list = deferred<MemoryListResponse>();
      const patch = deferred<boolean>();
      const configPort = makePort(vi.fn().mockReturnValueOnce(patch.promise));
      const entriesPort = makeEntriesPort({ fetchMemoryList: vi.fn().mockReturnValueOnce(list.promise) });
      const { result } = renderWired(configPort, entriesPort);

      let reload!: Promise<void>;
      act(() => {
        reload = result.current.entries.reload();
      });

      let toggle!: Promise<void>;
      act(() => {
        toggle = result.current.config.onToggleEnabled(false);
      });
      await act(async () => {
        patch.resolve(true);
        await toggle;
      });
      expect(result.current.config.enabled).toBe(false);

      // The list request started first and observed the old value. Its
      // response must not regress the now-confirmed toggle merely because the
      // PATCH has already settled by the time it arrives.
      await act(async () => {
        list.resolve(listResponse({ enabled: true }));
        await reload;
      });
      expect(result.current.config.enabled).toBe(false);
    });

    it('does not let a reload begun during an in-flight toggle hydrate its stale server snapshot after the toggle succeeds', async () => {
      const list = deferred<MemoryListResponse>();
      const patch = deferred<boolean>();
      const configPort = makePort(vi.fn().mockReturnValueOnce(patch.promise));
      const entriesPort = makeEntriesPort({ fetchMemoryList: vi.fn().mockReturnValueOnce(list.promise) });
      const { result } = renderWired(configPort, entriesPort);

      // The toggle starts first...
      let toggle!: Promise<void>;
      act(() => {
        toggle = result.current.config.onToggleEnabled(false);
      });
      // ...then the reload starts WHILE the PATCH is still in flight, capturing
      // the guard's revision from during that in-flight window (not before the
      // toggle began).
      let reload!: Promise<void>;
      act(() => {
        reload = result.current.entries.reload();
      });

      await act(async () => {
        patch.resolve(true);
        await toggle;
      });
      expect(result.current.config.enabled).toBe(false);

      // The reload's own read resolves AFTER the toggle settled, but with
      // stale, pre-write server data — its GET raced ahead of the PATCH.
      await act(async () => {
        list.resolve(listResponse({ enabled: true }));
        await reload;
      });
      expect(result.current.config.enabled).toBe(false);
    });

    it.each(hookFlagKeys)(
      'a hydrate arriving while %s has an unsettled write skips only that flag',
      async (flagKey) => {
        const list = deferred<MemoryListResponse>();
        const patch = deferred<boolean>();
        const configPort = makePort(vi.fn().mockReturnValueOnce(patch.promise));
        const entriesPort = makeEntriesPort({ fetchMemoryList: vi.fn().mockReturnValueOnce(list.promise) });
        const { result } = renderWired(configPort, entriesPort);

        // The toggle starts FIRST. reload() then captures its hydration
        // revision AFTER that start-time invalidate, so the coarse
        // `hydrationGuardRef` check at the top of hydrate() does not
        // short-circuit it — hydrate() reaches the per-flag
        // `hasUnsettledConfigWrite()` checks, with this flag's write still
        // genuinely unsettled (the PATCH has not resolved yet).
        let toggle!: Promise<void>;
        act(() => {
          toggle = result.current.config.onToggleHook(flagKey, false);
        });

        let reload!: Promise<void>;
        act(() => {
          reload = result.current.entries.reload();
        });

        // The list response arrives while the toggle's PATCH is still pending.
        await act(async () => {
          list.resolve(listResponse({ [flagKey]: true, enabled: false }));
          await reload;
        });

        // This flag's optimistic value survives the hydrate (its write hasn't
        // settled), but the master flag DOES get hydrated normally — proving
        // the skip is scoped to just this flag's own queue.
        expect(result.current.config.hookFlags[flagKey]).toBe(false);
        expect(result.current.config.enabled).toBe(false);

        await act(async () => {
          patch.resolve(true);
          await toggle;
        });
        expect(result.current.config.hookFlags[flagKey]).toBe(false);
      },
    );
  });
});

describe('useWiredMemoryConfig', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('binds the real memoryConfigPort from dependencies.ts and PATCHes /api/memory/config', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWiredMemoryConfig());

    await act(async () => {
      await result.current.onToggleEnabled(false);
    });

    expect(result.current.enabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/memory/config',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      }),
    );
  });
});
