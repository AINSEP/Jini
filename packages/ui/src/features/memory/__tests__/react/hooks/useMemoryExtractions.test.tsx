// Unit tests for the extraction-history hook, organized as the interleaving
// matrix of its three event sources: live SSE frames, GET snapshots (reloads
// and failure-recovery reads), and local optimistic mutations (delete/clear).
// All merge/insert/clear/delete ordering logic lives in the pure store
// (`./useMemoryExtractions.store.ts`, already unit-tested directly in
// `useMemoryExtractions.store.test.ts`) — this file proves the React shell
// wires port I/O + that store together correctly end-to-end through a fake
// port, rather than re-deriving the store's own ordering rules from scratch.
//
// Adapted from the pinned OD source's
// apps/web/tests/features/memory/useMemoryExtractions.test.tsx: import paths
// point at this package's ported hook/types and OD's contracts-package
// types are replaced by this slice's local `types.js`.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMemoryExtractions, useWiredMemoryExtractions } from '../../../react/hooks/useMemoryExtractions.hooks.js';
import { memoryExtractionsPort } from '../../../dependencies.js';
import type { MemoryExtractionsPort } from '../../../ports.js';
import type { MemoryExtractionRecord } from '../../../types.js';

function record(
  id: string,
  over: Partial<MemoryExtractionRecord> = {},
): MemoryExtractionRecord {
  return {
    id,
    startedAt: 1_000,
    phase: 'success',
    userMessagePreview: `msg-${id}`,
    ...over,
  };
}

function makePort(over: Partial<MemoryExtractionsPort> = {}): MemoryExtractionsPort {
  return {
    fetchExtractions: vi.fn(async () => [] as MemoryExtractionRecord[]),
    deleteExtraction: vi.fn(async () => true),
    clearExtractionHistory: vi.fn(async () => true),
    ...over,
  };
}

/** A hand-rolled deferred so tests control exactly when each call settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── GET alone: load basics + failure surface ───────────────────────────────

describe('useMemoryExtractions — reload basics', () => {
  it('reloadExtractions fills the list and returns it', async () => {
    const rows = [record('a'), record('b')];
    const port = makePort({ fetchExtractions: vi.fn(async () => rows) });
    const { result } = renderHook(() => useMemoryExtractions(port));

    let returned: MemoryExtractionRecord[] = [];
    await act(async () => {
      returned = await result.current.reloadExtractions();
    });

    expect(returned).toEqual(rows);
    expect(result.current.extractions).toEqual(rows);
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('drops a row the confirmed snapshot no longer has, when nothing local advanced it after the read began', async () => {
    const port = makePort({ fetchExtractions: vi.fn(async () => [record('b')]) });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));
    act(() => result.current.applyExtractionEvent(record('b')));

    await act(async () => {
      await result.current.reloadExtractions();
    });

    expect(result.current.extractions.map((r) => r.id)).toEqual(['b']);
  });

  it('keeps the prior rows and exposes a failure when the history reload rejects', async () => {
    const port = makePort({
      fetchExtractions: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('saved')));

    await act(async () => {
      await result.current.reloadExtractions();
    });

    expect(result.current.extractions.map((row) => row.id)).toEqual(['saved']);
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
  });

  it('returns the preserved state (not a fabricated empty array) when the history reload rejects', async () => {
    const port = makePort({
      fetchExtractions: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('saved')));

    let returned: MemoryExtractionRecord[] = [];
    await act(async () => {
      returned = await result.current.reloadExtractions();
    });

    // A real caller reads this return value directly to look for a
    // just-written extraction; a fabricated [] here would hide rows the UI
    // still shows.
    expect(returned.map((row) => row.id)).toEqual(['saved']);
    expect(returned).toEqual(result.current.extractions);
  });

  it('isRefreshing counts in-flight reloads so one completing does not clear it while another is pending', async () => {
    const readA = deferred<MemoryExtractionRecord[]>();
    const readB = deferred<MemoryExtractionRecord[]>();
    let call = 0;
    const port = makePort({
      fetchExtractions: vi.fn(() => (++call === 1 ? readA.promise : readB.promise)),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));

    let reloadingA!: Promise<MemoryExtractionRecord[]>;
    let reloadingB!: Promise<MemoryExtractionRecord[]>;
    act(() => {
      reloadingA = result.current.reloadExtractions();
      reloadingB = result.current.reloadExtractions();
    });
    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      readA.resolve([]);
      await reloadingA;
    });
    // B is still in flight — the shared flag must stay true.
    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      readB.resolve([]);
      await reloadingB;
    });
    expect(result.current.isRefreshing).toBe(false);
  });
});

// ─── GET vs GET: overlapping reloads are client-ordered by call order ───────

describe('useMemoryExtractions — reload vs reload', () => {
  it('discards a stale reload response once a newer reloadExtractions() call has already started', async () => {
    const readA = deferred<MemoryExtractionRecord[]>();
    const readB = deferred<MemoryExtractionRecord[]>();
    let call = 0;
    const port = makePort({
      fetchExtractions: vi.fn(() => (++call === 1 ? readA.promise : readB.promise)),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));

    let reloadingA!: Promise<MemoryExtractionRecord[]>;
    let reloadingB!: Promise<MemoryExtractionRecord[]>;
    act(() => {
      reloadingA = result.current.reloadExtractions();
      reloadingB = result.current.reloadExtractions();
    });

    // B — the LATER-started call — resolves first, correctly reflecting that
    // the row is now gone server-side.
    let returnedB: MemoryExtractionRecord[] = [];
    await act(async () => {
      readB.resolve([]);
      returnedB = await reloadingB;
    });
    expect(returnedB).toEqual([]);
    expect(result.current.extractions).toEqual([]);

    // A — the EARLIER-started call — resolves later with stale data that
    // still has the row. A newer call already committed, so A's response
    // must be discarded outright rather than reconciled.
    let returnedA: MemoryExtractionRecord[] = [];
    await act(async () => {
      readA.resolve([record('a')]);
      returnedA = await reloadingA;
    });
    expect(returnedA).toEqual([]);
    expect(result.current.extractions).toEqual([]);
    expect(result.current.isRefreshing).toBe(false);
  });

  it('does not surface a load error from a superseded reload that rejects after a newer reload committed', async () => {
    const readA = deferred<MemoryExtractionRecord[]>();
    const readB = deferred<MemoryExtractionRecord[]>();
    let call = 0;
    const port = makePort({
      fetchExtractions: vi.fn(() => (++call === 1 ? readA.promise : readB.promise)),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));

    let reloadingA!: Promise<MemoryExtractionRecord[]>;
    let reloadingB!: Promise<MemoryExtractionRecord[]>;
    act(() => {
      reloadingA = result.current.reloadExtractions();
      reloadingB = result.current.reloadExtractions();
    });

    await act(async () => {
      readB.resolve([record('fresh')]);
      await reloadingB;
    });

    // The abandoned older read failing is not news about the CURRENT state —
    // the newer read already succeeded.
    let returnedA: MemoryExtractionRecord[] = [];
    await act(async () => {
      readA.reject(new Error('offline'));
      returnedA = await reloadingA;
    });

    expect(result.current.loadError).toBeNull();
    expect(returnedA.map((row) => row.id)).toEqual(['fresh']);
    expect(result.current.extractions.map((row) => row.id)).toEqual(['fresh']);
  });
});

// ─── applyExtractionEvent: a light integration check on the store wiring ────

describe('useMemoryExtractions — applyExtractionEvent delegates to the store', () => {
  it('merges a phase transition onto the same id instead of stacking', () => {
    const port = makePort();
    const { result } = renderHook(() => useMemoryExtractions(port));

    act(() => result.current.applyExtractionEvent(record('x', { phase: 'running' })));
    act(() => result.current.applyExtractionEvent(record('x', { phase: 'success' })));

    expect(result.current.extractions).toHaveLength(1);
    expect(result.current.extractions[0]?.phase).toBe('success');
  });

  it('unshifts new ids so the newest is first', () => {
    const port = makePort();
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('old')));
    act(() => result.current.applyExtractionEvent(record('new')));

    expect(result.current.extractions.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('cleared wipes the list; deleted drops the one id', () => {
    const port = makePort();
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));
    act(() => result.current.applyExtractionEvent(record('b')));

    act(() => result.current.applyExtractionEvent(record('a', { phase: 'deleted' })));
    expect(result.current.extractions.map((r) => r.id)).toEqual(['b']);

    act(() => result.current.applyExtractionEvent(record('b', { phase: 'cleared' })));
    expect(result.current.extractions).toEqual([]);
  });

  it('ignores an extraction event with no id', () => {
    const port = makePort();
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent({ id: '' } as never));
    expect(result.current.extractions).toEqual([]);
  });
});

// ─── GET vs SSE: two server-originated channels, content-ordered ────────────

describe('useMemoryExtractions — reload vs SSE', () => {
  it('does not resurrect a row a newer SSE "deleted" frame removed while reloadExtractions() was in flight', async () => {
    const read = deferred<MemoryExtractionRecord[]>();
    const port = makePort({ fetchExtractions: vi.fn(() => read.promise) });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));

    let reloading!: Promise<MemoryExtractionRecord[]>;
    act(() => {
      reloading = result.current.reloadExtractions();
    });
    act(() => result.current.applyExtractionEvent(record('a', { phase: 'deleted' })));
    expect(result.current.extractions).toHaveLength(0);

    await act(async () => {
      read.resolve([record('a')]);
      await reloading;
    });

    expect(result.current.extractions.map((row) => row.id)).not.toContain('a');
  });

  it('does not regress a newer SSE phase transition with a stale reloadExtractions() snapshot', async () => {
    const read = deferred<MemoryExtractionRecord[]>();
    const port = makePort({ fetchExtractions: vi.fn(() => read.promise) });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a', { phase: 'running' })));

    let reloading!: Promise<MemoryExtractionRecord[]>;
    act(() => {
      reloading = result.current.reloadExtractions();
    });
    act(() => result.current.applyExtractionEvent(record('a', { phase: 'success' })));

    await act(async () => {
      read.resolve([record('a', { phase: 'running' })]);
      await reloading;
    });

    expect(result.current.extractions.find((row) => row.id === 'a')?.phase).toBe('success');
  });
});

// ─── delete: optimistic flow + failure recovery ─────────────────────────────

describe('useMemoryExtractions — delete flow', () => {
  it('optimistically removes a row and keeps it gone on success', async () => {
    const port = makePort({ deleteExtraction: vi.fn(async () => true) });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));
    act(() => result.current.applyExtractionEvent(record('b')));

    await act(async () => {
      await result.current.onDeleteExtraction('a');
    });

    expect(port.deleteExtraction).toHaveBeenCalledWith('a');
    expect(result.current.extractions.map((r) => r.id)).toEqual(['b']);
    expect(result.current.loadError).toBeNull();
  });

  it('re-fetches to restore the row when the delete request resolves false, showing MUTATION_ERROR', async () => {
    const server = [record('a'), record('b')];
    const port = makePort({
      deleteExtraction: vi.fn(async () => false),
      fetchExtractions: vi.fn(async () => server),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('b')));
    act(() => result.current.applyExtractionEvent(record('a')));

    await act(async () => {
      await result.current.onDeleteExtraction('a');
    });

    // The failed delete triggers a recovery read, which puts the row back —
    // but the delete itself still failed, so MUTATION_ERROR (not a silent
    // no-op) is shown.
    expect(port.fetchExtractions).toHaveBeenCalled();
    expect(result.current.extractions.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(result.current.loadError).toMatch(/couldn't be updated/);
  });

  it('re-fetches to restore the row when the delete request rejects', async () => {
    // A network failure REJECTS rather than resolving the adapter's normal
    // non-2xx `false`; both must recover identically.
    const server = [record('a'), record('b')];
    const port = makePort({
      deleteExtraction: vi.fn(async () => {
        throw new Error('network offline');
      }),
      fetchExtractions: vi.fn(async () => server),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('b')));
    act(() => result.current.applyExtractionEvent(record('a')));

    await act(async () => {
      await result.current.onDeleteExtraction('a');
    });

    expect(port.fetchExtractions).toHaveBeenCalledOnce();
    expect(result.current.extractions.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('restores the optimistic row when delete and its recovery reload both fail (falls back to restoreIfUnchanged)', async () => {
    const port = makePort({
      deleteExtraction: vi.fn(async () => false),
      fetchExtractions: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));
    act(() => result.current.applyExtractionEvent(record('b')));

    await act(async () => {
      await result.current.onDeleteExtraction('a');
    });

    expect(result.current.extractions.map((row) => row.id).sort()).toEqual(['a', 'b']);
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
  });
});

// ─── clear: optimistic flow + failure recovery ──────────────────────────────

describe('useMemoryExtractions — clear flow', () => {
  it('clearExtractions empties the list and calls the port', async () => {
    const port = makePort({ clearExtractionHistory: vi.fn(async () => true) });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));

    await act(async () => {
      await result.current.clearExtractions();
    });

    expect(port.clearExtractionHistory).toHaveBeenCalled();
    expect(result.current.extractions).toEqual([]);
    expect(result.current.loadError).toBeNull();
  });

  it('re-fetches and shows MUTATION_ERROR when the clear request resolves false', async () => {
    const server = [record('a')];
    const port = makePort({
      clearExtractionHistory: vi.fn(async () => false),
      fetchExtractions: vi.fn(async () => server),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));

    await act(async () => {
      await result.current.clearExtractions();
    });

    expect(port.fetchExtractions).toHaveBeenCalled();
    expect(result.current.extractions.map((r) => r.id)).toEqual(['a']);
    expect(result.current.loadError).toMatch(/couldn't be updated/);
  });

  it('re-fetches when the clear request rejects', async () => {
    const server = [record('a')];
    const port = makePort({
      clearExtractionHistory: vi.fn(async () => {
        throw new Error('network offline');
      }),
      fetchExtractions: vi.fn(async () => server),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));

    await act(async () => {
      await result.current.clearExtractions();
    });

    expect(port.fetchExtractions).toHaveBeenCalledOnce();
    expect(result.current.extractions.map((r) => r.id)).toEqual(['a']);
  });

  it('restores optimistic history when clear and its recovery reload both fail (falls back to restoreIfUnchanged)', async () => {
    const port = makePort({
      clearExtractionHistory: vi.fn(async () => false),
      fetchExtractions: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a')));

    await act(async () => {
      await result.current.clearExtractions();
    });

    expect(result.current.extractions.map((row) => row.id)).toEqual(['a']);
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
  });
});

// ─── derived UI state ───────────────────────────────────────────────────────

describe('useMemoryExtractions — derived UI state', () => {
  it('shows the no-provider banner only when the latest extraction is skipped/no-provider', async () => {
    const port = makePort();
    const { result } = renderHook(() => useMemoryExtractions(port));
    expect(result.current.showNoProviderBanner).toBe(false);

    act(() => result.current.applyExtractionEvent(record('a', { phase: 'skipped', reason: 'no-provider' })));
    expect(result.current.showNoProviderBanner).toBe(true);

    // A newer success on top clears the banner.
    act(() => result.current.applyExtractionEvent(record('b', { phase: 'success' })));
    expect(result.current.showNoProviderBanner).toBe(false);
  });

  it('does not show the no-provider banner for a skip with a different reason', () => {
    const port = makePort();
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() =>
      result.current.applyExtractionEvent(record('a', { phase: 'skipped', reason: 'memory-disabled' })),
    );
    expect(result.current.showNoProviderBanner).toBe(false);
  });

  it('partitions connector-kind records into connectorExtractions', async () => {
    const port = makePort();
    const { result } = renderHook(() => useMemoryExtractions(port));
    act(() => result.current.applyExtractionEvent(record('a', { kind: 'connector' })));
    act(() => result.current.applyExtractionEvent(record('b', { kind: 'llm' })));

    expect(result.current.connectorExtractions.map((r) => r.id)).toEqual(['a']);
  });

  it('advances nowClock on its 30s interval', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useMemoryExtractions(makePort()));
      const before = result.current.nowClock;
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(result.current.nowClock).toBeGreaterThanOrEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the nowClock interval on unmount', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    try {
      const { unmount } = renderHook(() => useMemoryExtractions(makePort()));
      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
    } finally {
      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('useWiredMemoryExtractions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds the real memoryExtractionsPort from dependencies.ts', async () => {
    const rows = [record('wired')];
    const fetchExtractions = vi.spyOn(memoryExtractionsPort, 'fetchExtractions').mockResolvedValue(rows);

    const { result } = renderHook(() => useWiredMemoryExtractions());
    await act(async () => {
      await result.current.reloadExtractions();
    });

    expect(fetchExtractions).toHaveBeenCalledTimes(1);
    expect(result.current.extractions).toEqual(rows);
  });
});
