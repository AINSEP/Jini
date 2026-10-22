import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useResourceBoard, useWiredResourceBoard } from './useResourceBoard.js';
import type { ResourceBoardPort, ResourceViewModeStoragePort } from '../../ports.js';
import type { ResourceBoardItem, ResourceBoardViewMode } from '../../types.js';

// A handful of tests below deliberately omit `viewModeStorage` to exercise
// the hook's real default (`createLocalStorageViewModeStorage`), which reads
// and writes actual `window.localStorage` under the shared default scope
// key. Without resetting it between tests, one test's persisted 'kanban'
// leaks into every later test in this file that also uses the default
// storage path — exactly the bug a first pass of this suite caught (see
// `packages/ui/archived provenance ledger`).
beforeEach(() => {
  window.localStorage.clear();
});

function fakePort(overrides: Partial<ResourceBoardPort> = {}): ResourceBoardPort {
  return {
    fetchItems: vi.fn().mockResolvedValue([]),
    deleteItem: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function memoryViewModeStorage(): ResourceViewModeStoragePort {
  const store = new Map<string, ResourceBoardViewMode>();
  return {
    getViewMode: (key) => store.get(key) ?? null,
    setViewMode: (key, mode) => {
      store.set(key, mode);
    },
  };
}

const ITEM_A: ResourceBoardItem = { id: 'a', title: 'Alpha', status: 'running' };
const ITEM_B: ResourceBoardItem = { id: 'b', title: 'Beta', status: 'succeeded' };

describe('useResourceBoard', () => {
  it('loads items on mount', async () => {
    const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A]) });
    const { result } = renderHook(() => useResourceBoard({ port }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visibleItems).toEqual([ITEM_A]);
    expect(result.current.error).toBeNull();
  });

  it('sets an error when the initial load rejects', async () => {
    const port = fakePort({ fetchItems: vi.fn().mockRejectedValue(new Error('down')) });
    const { result } = renderHook(() => useResourceBoard({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load items.');
    expect(result.current.visibleItems).toEqual([]);
  });

  it('reload() re-fetches and clears a prior error', async () => {
    const fetchItems = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([ITEM_A]);
    const port = fakePort({ fetchItems });
    const { result } = renderHook(() => useResourceBoard({ port }));
    await waitFor(() => expect(result.current.error).toBe('Failed to load items.'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.visibleItems).toEqual([ITEM_A]);
  });

  it('re-fetches when refreshToken changes', async () => {
    const fetchItems = vi.fn().mockResolvedValue([ITEM_A]);
    const port = fakePort({ fetchItems });
    const { rerender } = renderHook(({ refreshToken }) => useResourceBoard({ port, refreshToken }), {
      initialProps: { refreshToken: 1 },
    });
    await waitFor(() => expect(fetchItems).toHaveBeenCalledTimes(1));
    rerender({ refreshToken: 2 });
    await waitFor(() => expect(fetchItems).toHaveBeenCalledTimes(2));
  });

  it('exposes totalCount as the raw (pre-filter) item count', async () => {
    const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A, ITEM_B]) });
    const { result } = renderHook(() => useResourceBoard({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalCount).toBe(2);
    act(() => result.current.setQuery('no-such-match'));
    expect(result.current.visibleItems).toEqual([]);
    expect(result.current.totalCount).toBe(2);
  });

  it('filters visibleItems by the search query', async () => {
    const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A, ITEM_B]) });
    const { result } = renderHook(() => useResourceBoard({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setQuery('alpha'));
    expect(result.current.visibleItems.map((i) => i.id)).toEqual(['a']);
  });

  it('sorts visibleItems by the active sort option', async () => {
    const items: ResourceBoardItem[] = [
      { id: 'a', title: 'A', sortValues: { recent: 1 } },
      { id: 'b', title: 'B', sortValues: { recent: 2 } },
    ];
    const port = fakePort({ fetchItems: vi.fn().mockResolvedValue(items) });
    const { result } = renderHook(() => useResourceBoard({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setSort('recent'));
    expect(result.current.visibleItems.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('groups visibleItems into kanban columns using statusOrder/defaultStatus/normalizeStatus', async () => {
    const items: ResourceBoardItem[] = [{ id: 'a', title: 'A', status: 'queued' }, { id: 'b', title: 'B' }];
    const port = fakePort({ fetchItems: vi.fn().mockResolvedValue(items) });
    const { result } = renderHook(() =>
      useResourceBoard({
        port,
        statusOrder: ['not_started', 'running'],
        defaultStatus: 'not_started',
        normalizeStatus: (status) => (status === 'queued' ? 'running' : status),
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kanbanColumns.get('running')?.map((i) => i.id)).toEqual(['a']);
    expect(result.current.kanbanColumns.get('not_started')?.map((i) => i.id)).toEqual(['b']);
  });

  describe('view mode', () => {
    it('defaults to grid with no storage/stored preference', async () => {
      const { result } = renderHook(() => useResourceBoard({ port: fakePort() }));
      expect(result.current.viewMode).toBe('grid');
    });

    it('reads an initial view mode from the given storage, scoped by storageScopeKey', () => {
      const storage = memoryViewModeStorage();
      storage.setViewMode('scope-a', 'kanban');
      const { result } = renderHook(() => useResourceBoard({ port: fakePort(), viewModeStorage: storage, storageScopeKey: 'scope-a' }));
      expect(result.current.viewMode).toBe('kanban');
    });

    it('honors an explicit defaultViewMode when nothing is stored', () => {
      const { result } = renderHook(() =>
        useResourceBoard({ port: fakePort(), viewModeStorage: memoryViewModeStorage(), defaultViewMode: 'kanban' }),
      );
      expect(result.current.viewMode).toBe('kanban');
    });

    it('setViewMode updates state and persists through the storage port', () => {
      const storage = memoryViewModeStorage();
      const { result } = renderHook(() => useResourceBoard({ port: fakePort(), viewModeStorage: storage, storageScopeKey: 'scope-a' }));
      act(() => result.current.setViewMode('kanban'));
      expect(result.current.viewMode).toBe('kanban');
      expect(storage.getViewMode('scope-a')).toBe('kanban');
    });

    it('leaving grid view exits select mode and clears the selection', async () => {
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A]) });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.enterSelectMode());
      act(() => result.current.toggleSelected('a'));
      expect(result.current.selectMode).toBe(true);
      expect(result.current.selected.has('a')).toBe(true);
      act(() => result.current.setViewMode('kanban'));
      expect(result.current.selectMode).toBe(false);
      expect(result.current.selected.size).toBe(0);
    });
  });

  describe('select mode', () => {
    it('enterSelectMode/exitSelectMode/toggleSelected', async () => {
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A, ITEM_B]) });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.selectMode).toBe(false);
      act(() => result.current.enterSelectMode());
      expect(result.current.selectMode).toBe(true);
      act(() => result.current.toggleSelected('a'));
      act(() => result.current.toggleSelected('b'));
      expect([...result.current.selected].sort()).toEqual(['a', 'b']);
      act(() => result.current.toggleSelected('a'));
      expect([...result.current.selected]).toEqual(['b']);
      act(() => result.current.exitSelectMode());
      expect(result.current.selectMode).toBe(false);
      expect(result.current.selected.size).toBe(0);
    });

    it('prunes a selected id that disappears from a reload', async () => {
      const fetchItems = vi.fn().mockResolvedValueOnce([ITEM_A, ITEM_B]).mockResolvedValueOnce([ITEM_B]);
      const port = fakePort({ fetchItems });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.toggleSelected('a'));
      expect(result.current.selected.has('a')).toBe(true);
      await act(async () => {
        await result.current.reload();
      });
      expect(result.current.selected.has('a')).toBe(false);
    });
  });

  describe('kebab menu', () => {
    it('toggleMenu opens then closes the same id, and switches to a different id', () => {
      const { result } = renderHook(() => useResourceBoard({ port: fakePort() }));
      act(() => result.current.toggleMenu('a'));
      expect(result.current.openMenuId).toBe('a');
      act(() => result.current.toggleMenu('a'));
      expect(result.current.openMenuId).toBeNull();
      act(() => result.current.toggleMenu('a'));
      act(() => result.current.toggleMenu('b'));
      expect(result.current.openMenuId).toBe('b');
    });

    it('closeMenu closes it directly', () => {
      const { result } = renderHook(() => useResourceBoard({ port: fakePort() }));
      act(() => result.current.toggleMenu('a'));
      act(() => result.current.closeMenu());
      expect(result.current.openMenuId).toBeNull();
    });

    it('closes on Escape while open', () => {
      const { result } = renderHook(() => useResourceBoard({ port: fakePort() }));
      act(() => result.current.toggleMenu('a'));
      expect(result.current.openMenuId).toBe('a');
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(result.current.openMenuId).toBeNull();
    });

    it('closes on an outside mousedown while open', () => {
      const { result } = renderHook(() => useResourceBoard({ port: fakePort() }));
      act(() => result.current.toggleMenu('a'));
      act(() => {
        window.dispatchEvent(new MouseEvent('mousedown'));
      });
      expect(result.current.openMenuId).toBeNull();
    });

    it('stays open on a mousedown INSIDE menuContainerRef (e.g. clicking a menu item) — regression for a real bug caught while wiring ResourceBoard', () => {
      const { result } = renderHook(() => useResourceBoard({ port: fakePort() }));
      const container = document.createElement('div');
      document.body.appendChild(container);
      act(() => {
        result.current.menuContainerRef.current = container;
      });
      act(() => result.current.toggleMenu('a'));
      expect(result.current.openMenuId).toBe('a');
      act(() => {
        container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(result.current.openMenuId).toBe('a');
      document.body.removeChild(container);
    });

    it('does not throw dispatching keydown/mousedown while no menu is open', () => {
      renderHook(() => useResourceBoard({ port: fakePort() }));
      expect(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        window.dispatchEvent(new MouseEvent('mousedown'));
      }).not.toThrow();
    });
  });

  describe('remove', () => {
    it('removes the item from visibleItems on success and closes its menu', async () => {
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A, ITEM_B]) });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.toggleMenu('a'));
      await act(async () => {
        await result.current.remove('a');
      });
      expect(result.current.visibleItems.map((i) => i.id)).toEqual(['b']);
      expect(result.current.openMenuId).toBeNull();
    });

    it('leaves the item in place when the port reports failure', async () => {
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A]), deleteItem: vi.fn().mockResolvedValue(false) });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.remove('a');
      });
      expect(result.current.visibleItems.map((i) => i.id)).toEqual(['a']);
    });

    it('tracks busy for exactly the id being removed, and only for the duration of the call', async () => {
      let resolveDelete!: (ok: boolean) => void;
      const deleteItem = vi.fn().mockReturnValue(new Promise<boolean>((resolve) => (resolveDelete = resolve)));
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A, ITEM_B]), deleteItem });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      let removePromise!: Promise<void>;
      act(() => {
        removePromise = result.current.remove('a');
      });
      expect(result.current.isItemBusy('a')).toBe(true);
      expect(result.current.isItemBusy('b')).toBe(false);
      await act(async () => {
        resolveDelete(true);
        await removePromise;
      });
      expect(result.current.isItemBusy('a')).toBe(false);
    });

    /**
     * Regression: a rejected `deleteItem` used to propagate all the way out
     * of `remove()` uncaught — `ResourceBoard.tsx` then discarded that
     * promise with `void`, so the failure was both an unhandled rejection
     * AND invisible to the user (the item just silently stayed put with no
     * explanation). `remove()` must now resolve (never reject) and surface
     * the failure via `actionError` instead.
     */
    it('sets actionError and does not throw when deleteItem rejects', async () => {
      const port = fakePort({
        fetchItems: vi.fn().mockResolvedValue([ITEM_A]),
        deleteItem: vi.fn().mockRejectedValue(new Error('network down')),
      });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.remove('a');
      });
      expect(result.current.actionError).toBe('Failed to delete item.');
      // The item is genuinely still there — the rejection means the delete
      // never actually happened, so it must not be optimistically removed.
      expect(result.current.visibleItems.map((i) => i.id)).toEqual(['a']);
    });

    it('clears a prior actionError at the start of the next remove() call', async () => {
      const deleteItem = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true);
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A, ITEM_B]), deleteItem });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.remove('a');
      });
      expect(result.current.actionError).toBe('Failed to delete item.');
      await act(async () => {
        await result.current.remove('b');
      });
      expect(result.current.actionError).toBeNull();
    });
  });

  describe('duplicate', () => {
    it('is a no-op when the port has no duplicateItem', async () => {
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A]) });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.duplicate('a');
      });
      expect(result.current.visibleItems).toHaveLength(1);
    });

    it('appends the duplicated item and closes its menu when the port returns one', async () => {
      const duplicated: ResourceBoardItem = { id: 'a-copy', title: 'Alpha copy' };
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A]), duplicateItem: vi.fn().mockResolvedValue(duplicated) });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.toggleMenu('a'));
      await act(async () => {
        await result.current.duplicate('a');
      });
      expect(result.current.visibleItems.map((i) => i.id)).toEqual(['a', 'a-copy']);
      expect(result.current.openMenuId).toBeNull();
    });

    it('does not append anything when the port returns null', async () => {
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A]), duplicateItem: vi.fn().mockResolvedValue(null) });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.duplicate('a');
      });
      expect(result.current.visibleItems).toHaveLength(1);
    });

    /** Regression, same shape as `remove()`'s: `DesignsTab.tsx`'s real `handleDuplicateProject` catches a duplicate failure into a toast; this port-level equivalent must not reject uncaught nor stay silent. */
    it('sets actionError and does not throw when duplicateItem rejects', async () => {
      const port = fakePort({
        fetchItems: vi.fn().mockResolvedValue([ITEM_A]),
        duplicateItem: vi.fn().mockRejectedValue(new Error('network down')),
      });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.duplicate('a');
      });
      expect(result.current.actionError).toBe('Failed to duplicate item.');
      expect(result.current.visibleItems).toHaveLength(1);
    });

    it('clears a prior actionError at the start of the next duplicate() call', async () => {
      const duplicated: ResourceBoardItem = { id: 'a-copy', title: 'Alpha copy' };
      const duplicateItem = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(duplicated);
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A]), duplicateItem });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await result.current.duplicate('a');
      });
      expect(result.current.actionError).toBe('Failed to duplicate item.');
      await act(async () => {
        await result.current.duplicate('a');
      });
      expect(result.current.actionError).toBeNull();
    });
  });

  describe('bulkDelete', () => {
    it('is a no-op returning zero counts when nothing is selected', async () => {
      const port = fakePort();
      const { result } = renderHook(() => useResourceBoard({ port }));
      const outcome = await act(async () => result.current.bulkDelete());
      expect(outcome).toEqual({ deleted: 0, failed: 0 });
      expect(port.deleteItem).not.toHaveBeenCalled();
    });

    it('deletes every selected id, removes them from visibleItems, and exits select mode', async () => {
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A, ITEM_B]) });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.enterSelectMode());
      act(() => result.current.toggleSelected('a'));
      act(() => result.current.toggleSelected('b'));
      const outcome = await act(async () => result.current.bulkDelete());
      expect(outcome).toEqual({ deleted: 2, failed: 0 });
      expect(result.current.visibleItems).toEqual([]);
      expect(result.current.selectMode).toBe(false);
    });

    it('reports mixed success/failure without removing the failed id', async () => {
      const deleteItem = vi.fn().mockImplementation((id: string) => Promise.resolve(id === 'a'));
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A, ITEM_B]), deleteItem });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.enterSelectMode());
      act(() => result.current.toggleSelected('a'));
      act(() => result.current.toggleSelected('b'));
      const outcome = await act(async () => result.current.bulkDelete());
      expect(outcome).toEqual({ deleted: 1, failed: 1 });
      expect(result.current.visibleItems.map((i) => i.id)).toEqual(['b']);
    });

    it('treats a rejected per-item delete as a failure rather than throwing', async () => {
      const deleteItem = vi.fn().mockImplementation((id: string) => (id === 'a' ? Promise.reject(new Error('boom')) : Promise.resolve(true)));
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A, ITEM_B]), deleteItem });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.enterSelectMode());
      act(() => result.current.toggleSelected('a'));
      act(() => result.current.toggleSelected('b'));
      const outcome = await act(async () => result.current.bulkDelete());
      expect(outcome).toEqual({ deleted: 1, failed: 1 });
    });

    it('tracks bulkDeleteBusy only for the duration of the call', async () => {
      let resolveDelete!: (ok: boolean) => void;
      const deleteItem = vi.fn().mockReturnValue(new Promise<boolean>((resolve) => (resolveDelete = resolve)));
      const port = fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A]), deleteItem });
      const { result } = renderHook(() => useResourceBoard({ port }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.enterSelectMode());
      act(() => result.current.toggleSelected('a'));
      let outcomePromise!: Promise<{ deleted: number; failed: number }>;
      act(() => {
        outcomePromise = result.current.bulkDelete();
      });
      expect(result.current.bulkDeleteBusy).toBe(true);
      await act(async () => {
        resolveDelete(true);
        await outcomePromise;
      });
      expect(result.current.bulkDeleteBusy).toBe(false);
    });
  });
});

describe('useWiredResourceBoard', () => {
  it('binds port and viewModeStorage from dependencies', async () => {
    const storage = memoryViewModeStorage();
    storage.setViewMode('scope-a', 'kanban');
    // Constructed once, outside the renderHook callback: an inline `{ port:
    // fakePort() }` re-created on every render would give the `reload`
    // effect (which depends on `port` referentially) a new identity every
    // render, causing an infinite refetch loop — a standard hooks-testing
    // pitfall, not a hook design flaw (a real host supplies a stable
    // `dependencies` object).
    const dependencies = { port: fakePort({ fetchItems: vi.fn().mockResolvedValue([ITEM_A]) }), viewModeStorage: storage };
    const { result } = renderHook(() => useWiredResourceBoard({ dependencies, storageScopeKey: 'scope-a' }));
    expect(result.current.viewMode).toBe('kanban');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visibleItems).toEqual([ITEM_A]);
  });

  it('falls back to the default localStorage-backed view-mode storage when dependencies omits one', () => {
    const dependencies = { port: fakePort() };
    const { result } = renderHook(() => useWiredResourceBoard({ dependencies }));
    expect(result.current.viewMode).toBe('grid');
  });
});
