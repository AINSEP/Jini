import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useBrowserHistory, useWiredBrowserHistory } from '../../../react/hooks/useBrowserHistory.js';
import type { BrowserHistoryEntry } from '../../../types.js';
import type { BrowserHistoryStoragePort } from '../../../ports.js';
import { DEFAULT_HISTORY_STORAGE_NAMESPACE } from '../../../constants.js';

function createInMemoryStorage(initial: Record<string, BrowserHistoryEntry[]> = {}): BrowserHistoryStoragePort {
  const store = new Map<string, BrowserHistoryEntry[]>(Object.entries(initial));
  return {
    loadHistory: (scopeKey) => store.get(scopeKey) ?? [],
    saveHistory: (scopeKey, history) => {
      store.set(scopeKey, history);
    },
  };
}

describe('useBrowserHistory', () => {
  it('loads the scope history on mount', () => {
    const seeded = [{ title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1 }];
    const historyStorage = createInMemoryStorage({ 'project-1': seeded });
    const { result } = renderHook(() => useBrowserHistory('project-1', { historyStorage }));
    expect(result.current.history).toEqual(seeded);
  });

  it('commitVisit merges a new entry into history', () => {
    const historyStorage = createInMemoryStorage();
    const { result } = renderHook(() => useBrowserHistory('project-1', { historyStorage }, { debounceMs: 1 }));

    act(() => result.current.commitVisit('https://a.com', { title: 'A Site' }));

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]).toMatchObject({ url: 'https://a.com', title: 'A Site' });
  });

  it('debounce-persists history changes to the storage port', async () => {
    const historyStorage = createInMemoryStorage();
    const { result } = renderHook(() => useBrowserHistory('project-1', { historyStorage }, { debounceMs: 5 }));

    act(() => result.current.commitVisit('https://a.com'));
    expect(historyStorage.loadHistory('project-1')).toEqual([]);

    await waitFor(() => expect(historyStorage.loadHistory('project-1')).toHaveLength(1));
  });

  it('clearHistory empties in-memory state and persists immediately', () => {
    const historyStorage = createInMemoryStorage({ 'project-1': [{ title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1 }] });
    const { result } = renderHook(() => useBrowserHistory('project-1', { historyStorage }));

    act(() => result.current.clearHistory());

    expect(result.current.history).toEqual([]);
    expect(historyStorage.loadHistory('project-1')).toEqual([]);
  });

  it('re-hydrates when scopeKey changes', () => {
    const historyStorage = createInMemoryStorage({
      'project-1': [{ title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1 }],
      'project-2': [{ title: 'B', url: 'https://b.com', lastVisitedAt: 2, visitCount: 1 }],
    });
    const { result, rerender } = renderHook(({ scopeKey }) => useBrowserHistory(scopeKey, { historyStorage }), {
      initialProps: { scopeKey: 'project-1' },
    });
    expect(result.current.history[0]?.url).toBe('https://a.com');

    rerender({ scopeKey: 'project-2' });
    expect(result.current.history[0]?.url).toBe('https://b.com');
  });
});

describe('useWiredBrowserHistory', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('binds the real localStorage-backed history port under the default namespace', async () => {
    const { result } = renderHook(() => useWiredBrowserHistory({ scopeKey: 'project-1', options: { debounceMs: 1 } }));
    expect(result.current.history).toEqual([]);

    act(() => result.current.commitVisit('https://a.com', { title: 'A Site' }));
    expect(result.current.history[0]).toMatchObject({ url: 'https://a.com', title: 'A Site' });

    await waitFor(() => {
      const raw = window.localStorage.getItem(`${DEFAULT_HISTORY_STORAGE_NAMESPACE}:project-1`);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toHaveLength(1);
    });
  });
});
