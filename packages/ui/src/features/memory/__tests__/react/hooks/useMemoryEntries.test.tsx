// Unit tests for the saved-memories hook. Transport is a hand-written fake
// port (never global `fetch` mocking); runtime coordination (flash pill,
// config hydrate, editor open/close) is a set of spies, so we assert the
// hook fires the right cross-boundary callbacks in isolation.
//
// Adapted from the pinned OD source's
// apps/web/tests/features/memory/useMemoryEntries.test.tsx: import paths
// point at this package's ported hook/types, OD's contracts-package types
// are replaced by this slice's local `types.js`, and the `onCopyPath` total-
// failure test asserts against this package's `copyToClipboard` (which
// resolves `false` on total failure) rather than the pinned source's
// rejecting clipboard helper.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useMemoryEntries,
  useWiredMemoryEntries,
  type MemoryEntriesCoordination,
} from '../../../react/hooks/useMemoryEntries.hooks.js';
import { memoryEntriesPort } from '../../../dependencies.js';
import type { MemoryEntriesPort } from '../../../ports.js';
import type {
  MemoryEntry,
  MemoryEntrySummary,
  MemoryListResponse,
  MemoryTreeNode,
} from '../../../types.js';

function summary(id: string, over: Partial<MemoryEntrySummary> = {}): MemoryEntrySummary {
  return {
    id,
    name: `name-${id}`,
    description: `desc-${id}`,
    type: 'user',
    ...over,
  };
}

function listResponse(over: Partial<MemoryListResponse> = {}): MemoryListResponse {
  return {
    enabled: true,
    chatExtractionEnabled: true,
    profileEnabled: true,
    rewriteEnabled: true,
    verifyEnabled: true,
    rootDir: '/memories',
    index: '- [name-a](a.md)',
    entries: [summary('a'), summary('b', { type: 'project' })],
    ...over,
  };
}

function makePort(over: Partial<MemoryEntriesPort> = {}): MemoryEntriesPort {
  return {
    fetchMemoryList: vi.fn(async () => listResponse()),
    fetchMemoryTree: vi.fn(async () => [] as MemoryTreeNode[]),
    fetchMemoryEntry: vi.fn(async () => null),
    saveMemoryEntry: vi.fn(async () => null),
    deleteMemoryEntry: vi.fn(async () => true),
    saveMemoryIndex: vi.fn(async () => true),
    ...over,
  };
}

function makeCoord(over: Partial<MemoryEntriesCoordination> = {}): MemoryEntriesCoordination {
  return {
    fireFlash: vi.fn(),
    captureConfigHydrationRevision: vi.fn(() => 0),
    hydrateConfig: vi.fn(),
    openEditor: vi.fn(),
    closeEditor: vi.fn(),
    ...over,
  };
}

function savedEntry(over: Partial<MemoryEntry> = {}): MemoryEntry {
  return { ...summary('saved'), body: 'body', ...over };
}

/** A promise plus its own resolve/reject, so a test can control exactly when and how a port call settles. */
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

describe('useMemoryEntries — reload', () => {
  it('reload hydrates config from the shared GET and fills list/tree state', async () => {
    const coord = makeCoord();
    const list = listResponse();
    const tree: MemoryTreeNode[] = [
      { id: 'f1', kind: 'folder', name: 'f1' },
    ];
    const port = makePort({
      fetchMemoryList: vi.fn(async () => list),
      fetchMemoryTree: vi.fn(async () => tree),
    });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    await act(async () => {
      await result.current.reload();
    });

    expect(coord.hydrateConfig).toHaveBeenCalledWith(list, 0);
    expect(result.current.rootDir).toBe('/memories');
    expect(result.current.index).toBe('- [name-a](a.md)');
    expect(result.current.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(result.current.memoryTree).toEqual(tree);
    expect(result.current.loadError).toBeNull();
  });

  it('a failed tree fetch does not hide an otherwise-successful list fetch', async () => {
    const coord = makeCoord();
    const list = listResponse();
    const port = makePort({
      fetchMemoryList: vi.fn(async () => list),
      fetchMemoryTree: vi.fn(async () => {
        throw new Error('tree unavailable');
      }),
    });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(result.current.memoryTree).toEqual([]);
    expect(result.current.loadError).toBeNull();
    expect(coord.hydrateConfig).toHaveBeenCalled();
  });

  it('keeps the last confirmed list and surfaces an error when the list fetch rejects', async () => {
    const coord = makeCoord();
    const list = listResponse();
    const port = makePort({ fetchMemoryList: vi.fn(async () => list) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.entries.map((e) => e.id)).toEqual(['a', 'b']);

    (port.fetchMemoryList as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.reload();
    });

    // The prior confirmed entries survive; the failure surfaces as loadError
    // instead of being papered over with an invented empty list.
    expect(result.current.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
  });

  it('filters entries by the active type filter', async () => {
    const { result } = renderHook(() => useMemoryEntries(makePort(), makeCoord()));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.filtered).toHaveLength(2);
    act(() => result.current.setFilter('project'));
    expect(result.current.filtered.map((e) => e.id)).toEqual(['b']);
  });

  it('ignores a stale reload() that resolves after a newer reload() already committed', async () => {
    const coord = makeCoord();
    const forA = deferred<MemoryListResponse>();
    const forB = deferred<MemoryListResponse>();
    const fetchMemoryList = vi.fn().mockReturnValueOnce(forA.promise).mockReturnValueOnce(forB.promise);
    const port = makePort({ fetchMemoryList, fetchMemoryTree: vi.fn(async () => []) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    let reloadA!: Promise<void>;
    act(() => {
      reloadA = result.current.reload();
    });
    let reloadB!: Promise<void>;
    act(() => {
      reloadB = result.current.reload();
    });

    // The newer request (B) resolves first and commits.
    await act(async () => {
      forB.resolve(listResponse({ rootDir: '/memories-b', entries: [summary('b-only')] }));
      await reloadB;
    });
    expect(result.current.rootDir).toBe('/memories-b');
    expect(coord.hydrateConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ rootDir: '/memories-b' }),
      0,
    );

    // The abandoned older request (A) resolves late; it must not overwrite the
    // newer snapshot or re-hydrate the config flags off stale data.
    await act(async () => {
      forA.resolve(listResponse({ rootDir: '/memories-a', entries: [summary('a-only')] }));
      await reloadA;
    });
    expect(result.current.rootDir).toBe('/memories-b');
    expect(result.current.entries.map((e) => e.id)).toEqual(['b-only']);
    expect(coord.hydrateConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ rootDir: '/memories-b' }),
      0,
    );
  });

  it('ignores a stale reload() that REJECTS after a newer reload() already committed successfully', async () => {
    const coord = makeCoord();
    const forA = deferred<MemoryListResponse>();
    const forB = deferred<MemoryListResponse>();
    const fetchMemoryList = vi.fn().mockReturnValueOnce(forA.promise).mockReturnValueOnce(forB.promise);
    const port = makePort({ fetchMemoryList, fetchMemoryTree: vi.fn(async () => []) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    let reloadA!: Promise<void>;
    act(() => {
      reloadA = result.current.reload();
    });
    let reloadB!: Promise<void>;
    act(() => {
      reloadB = result.current.reload();
    });

    await act(async () => {
      forB.resolve(listResponse({ rootDir: '/memories-b', entries: [summary('b-only')] }));
      await reloadB;
    });
    expect(result.current.loadError).toBeNull();

    // The abandoned older request (A) REJECTS late — its failure is stale and
    // must not clobber the newer, already-confirmed success with a loadError.
    await act(async () => {
      forA.reject(new Error('offline'));
      await reloadA;
    });
    expect(result.current.loadError).toBeNull();
    expect(result.current.rootDir).toBe('/memories-b');
  });

  it('groups tree entries under their parent folder, ignoring parentless entries', async () => {
    const tree: MemoryTreeNode[] = [
      { id: 'f1', parentId: undefined, path: 'f1/', name: 'f1', kind: 'folder' },
      { id: 'c1', parentId: 'f1', path: 'f1/c1', name: 'c1', kind: 'entry' },
      { id: 'orphan', parentId: undefined, path: 'orphan', name: 'orphan', kind: 'entry' },
    ];
    const port = makePort({ fetchMemoryTree: vi.fn(async () => tree) });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.treeFolders.map((f) => f.id)).toEqual(['f1']);
    expect(result.current.treeChildren.get('f1')?.map((c) => c.id)).toEqual(['c1']);
  });
});

describe('useMemoryEntries — preview', () => {
  it('opens a preview (fetching the body) then toggles it closed on the same id', async () => {
    const port = makePort({ fetchMemoryEntry: vi.fn(async () => savedEntry({ body: 'the body' })) });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    await act(async () => {
      await result.current.openPreview('a');
    });
    expect(result.current.previewId).toBe('a');
    expect(result.current.previewBody).toBe('the body');

    await act(async () => {
      await result.current.openPreview('a');
    });
    expect(result.current.previewId).toBeNull();
    expect(result.current.previewBody).toBeNull();
  });

  it('defaults the preview body to empty string when the entry is missing (a 404 is not a failure)', async () => {
    const port = makePort({ fetchMemoryEntry: vi.fn(async () => null) });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));
    await act(async () => {
      await result.current.openPreview('gone');
    });
    expect(result.current.previewBody).toBe('');
    expect(result.current.loadError).toBeNull();
  });

  it('surfaces a failed preview read as loadError instead of rendering an empty preview', async () => {
    const port = makePort({
      fetchMemoryEntry: vi.fn(async () => {
        throw new Error('Memory entry request failed (500)');
      }),
    });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));
    await act(async () => {
      await result.current.openPreview('a');
    });

    expect(result.current.previewId).toBeNull();
    expect(result.current.previewBody).toBeNull();
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
  });

  it("ignores a stale openPreview() failure once a newer preview took over (different id)", async () => {
    const forA = deferred<MemoryEntry | null>();
    const forB = deferred<MemoryEntry | null>();
    const fetchMemoryEntry = vi.fn((id: string) => (id === 'a' ? forA.promise : forB.promise));
    const port = makePort({ fetchMemoryEntry });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    let openA!: Promise<void>;
    let openB!: Promise<void>;
    act(() => {
      openA = result.current.openPreview('a');
    });
    act(() => {
      openB = result.current.openPreview('b');
    });

    await act(async () => {
      forB.resolve(savedEntry({ id: 'b', body: 'body b' }));
      await openB;
    });
    await act(async () => {
      forA.reject(new Error('Memory entry request failed (500)'));
      await openA;
    });

    expect(result.current.previewId).toBe('b');
    expect(result.current.previewBody).toBe('body b');
    expect(result.current.loadError).toBeNull();
  });

  it('ignores a stale openPreview() resolution when the user already moved on to a newer id', async () => {
    const forA = deferred<MemoryEntry | null>();
    const forB = deferred<MemoryEntry | null>();
    const fetchMemoryEntry = vi.fn((id: string) => (id === 'a' ? forA.promise : forB.promise));
    const port = makePort({ fetchMemoryEntry });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    let openA!: Promise<void>;
    let openB!: Promise<void>;
    act(() => {
      openA = result.current.openPreview('a');
    });
    act(() => {
      openB = result.current.openPreview('b');
    });
    expect(result.current.previewId).toBe('b');

    await act(async () => {
      forB.resolve(savedEntry({ id: 'b', body: 'body b' }));
      await openB;
    });
    expect(result.current.previewBody).toBe('body b');

    await act(async () => {
      forA.resolve(savedEntry({ id: 'a', body: 'body a' }));
      await openA;
    });
    expect(result.current.previewId).toBe('b');
    expect(result.current.previewBody).toBe('body b');
  });

  it('ignores a stale openPreview() resolution when the SAME id is closed then reopened before it settles', async () => {
    const first = deferred<MemoryEntry | null>();
    const second = deferred<MemoryEntry | null>();
    const fetchMemoryEntry = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const port = makePort({ fetchMemoryEntry });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    let openFirst!: Promise<void>;
    act(() => {
      openFirst = result.current.openPreview('a');
    });
    // Close before the first request settles (previewId === 'a' toggles it off).
    await act(async () => {
      await result.current.openPreview('a');
    });
    let openSecond!: Promise<void>;
    act(() => {
      openSecond = result.current.openPreview('a');
    });

    await act(async () => {
      first.resolve(savedEntry({ id: 'a', body: 'stale body' }));
      await openFirst;
    });
    expect(result.current.previewBody).toBeNull(); // still awaiting the second request

    await act(async () => {
      second.resolve(savedEntry({ id: 'a', body: 'fresh body' }));
      await openSecond;
    });
    expect(result.current.previewBody).toBe('fresh body');
  });
});

describe('useMemoryEntries — edit', () => {
  it('scrolls the editor into view and focuses the name field once an edit target is set', async () => {
    const coord = makeCoord();
    const port = makePort({ fetchMemoryEntry: vi.fn(async () => savedEntry({ id: 'a' })) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    const editorEl = document.createElement('div');
    const scrollIntoView = vi.fn();
    editorEl.scrollIntoView = scrollIntoView;
    const nameInput = document.createElement('input');
    const focus = vi.spyOn(nameInput, 'focus');
    // The hook only reads these refs' `.current` inside its effect (which
    // runs after render, using whatever a real caller attached them to by
    // then) — assigning them directly here reproduces exactly what a
    // mounted `MemoryManualEditor` would have done via `ref={editorRef}`.
    result.current.editorRef.current = editorEl;
    result.current.editorNameRef.current = nameInput;

    await act(async () => {
      await result.current.startEdit('a');
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does not touch the editor DOM refs when nothing is being edited', () => {
    const { result } = renderHook(() => useMemoryEntries(makePort(), makeCoord()));
    const editorEl = document.createElement('div');
    const scrollIntoView = vi.fn();
    editorEl.scrollIntoView = scrollIntoView;
    result.current.editorRef.current = editorEl;

    // No startEdit/startNew call — editingTarget stays null, so the effect's
    // early return means the ref is never touched.
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('surfaces a failed edit read as loadError instead of a silent no-op', async () => {
    const coord = makeCoord();
    const port = makePort({
      fetchMemoryEntry: vi.fn(async () => {
        throw new Error('Memory entry request failed (503)');
      }),
    });
    const { result } = renderHook(() => useMemoryEntries(port, coord));
    await act(async () => {
      await result.current.startEdit('a');
    });

    expect(coord.openEditor).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
  });

  it('clears a failed-read banner when a current preview or edit retry succeeds', async () => {
    const coord = makeCoord();
    const port = makePort({
      fetchMemoryEntry: vi
        .fn()
        .mockRejectedValueOnce(new Error('preview failed'))
        .mockResolvedValueOnce(savedEntry({ id: 'preview', body: 'preview body' }))
        .mockRejectedValueOnce(new Error('edit failed'))
        .mockResolvedValueOnce(savedEntry({ id: 'edit', name: 'Edit me' })),
    });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    await act(async () => {
      await result.current.openPreview('preview');
    });
    expect(result.current.loadError).toMatch(/couldn't be loaded/);

    await act(async () => {
      await result.current.openPreview('preview');
    });
    expect(result.current.previewBody).toBe('preview body');
    expect(result.current.loadError).toBeNull();

    await act(async () => {
      await result.current.startEdit('edit');
    });
    expect(result.current.loadError).toMatch(/couldn't be loaded/);

    await act(async () => {
      await result.current.startEdit('edit');
    });
    expect(result.current.editing?.name).toBe('Edit me');
    expect(result.current.loadError).toBeNull();
  });

  it("ignores a stale startEdit() failure once a newer edit took over (different id)", async () => {
    const forA = deferred<MemoryEntry | null>();
    const forB = deferred<MemoryEntry | null>();
    const fetchMemoryEntry = vi.fn((id: string) => (id === 'a' ? forA.promise : forB.promise));
    const port = makePort({ fetchMemoryEntry });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    let editA!: Promise<void>;
    let editB!: Promise<void>;
    act(() => {
      editA = result.current.startEdit('a');
    });
    act(() => {
      editB = result.current.startEdit('b');
    });

    await act(async () => {
      forB.resolve(savedEntry({ id: 'b', name: 'Entry B' }));
      await editB;
    });
    await act(async () => {
      forA.reject(new Error('Memory entry request failed (500)'));
      await editA;
    });

    expect(result.current.editing?.id).toBe('b');
    expect(result.current.loadError).toBeNull();
  });

  it('ignores a stale startEdit() resolution when the user already moved on to a newer id', async () => {
    const coord = makeCoord();
    const forA = deferred<MemoryEntry | null>();
    const forB = deferred<MemoryEntry | null>();
    const fetchMemoryEntry = vi.fn((id: string) => (id === 'a' ? forA.promise : forB.promise));
    const port = makePort({ fetchMemoryEntry });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    let editA!: Promise<void>;
    let editB!: Promise<void>;
    act(() => {
      editA = result.current.startEdit('a');
    });
    act(() => {
      editB = result.current.startEdit('b');
    });

    await act(async () => {
      forB.resolve(savedEntry({ id: 'b', name: 'Entry B' }));
      await editB;
    });
    expect(result.current.editing?.id).toBe('b');

    await act(async () => {
      forA.resolve(savedEntry({ id: 'a', name: 'Entry A' }));
      await editA;
    });
    expect(result.current.editing?.id).toBe('b');
  });

  it('ignores a stale startEdit() resolution when the SAME id is cancelled then restarted before it settles', async () => {
    const first = deferred<MemoryEntry | null>();
    const second = deferred<MemoryEntry | null>();
    const fetchMemoryEntry = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const port = makePort({ fetchMemoryEntry });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    let editFirst!: Promise<void>;
    act(() => {
      editFirst = result.current.startEdit('a');
    });
    act(() => result.current.cancelEdit());
    let editSecond!: Promise<void>;
    act(() => {
      editSecond = result.current.startEdit('a');
    });

    await act(async () => {
      first.resolve(savedEntry({ id: 'a', name: 'Stale name' }));
      await editFirst;
    });
    expect(result.current.editing).toBeNull(); // still awaiting the second request

    await act(async () => {
      second.resolve(savedEntry({ id: 'a', name: 'Fresh name' }));
      await editSecond;
    });
    expect(result.current.editing?.name).toBe('Fresh name');
  });

  it('startEdit opens the editor for a found entry and no-ops when missing', async () => {
    const coord = makeCoord();
    const port = makePort({ fetchMemoryEntry: vi.fn(async () => null) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    await act(async () => {
      await result.current.startEdit('missing');
    });
    expect(coord.openEditor).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
    expect(result.current.loadError).toBeNull(); // a 404 is a no-op, not a failure

    (port.fetchMemoryEntry as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      savedEntry({ id: 'a', name: 'Edit me' }),
    );
    await act(async () => {
      await result.current.startEdit('a');
    });
    expect(coord.openEditor).toHaveBeenCalled();
    expect(result.current.editing?.name).toBe('Edit me');
  });

  it('cancelEdit clears the draft', () => {
    const { result } = renderHook(() => useMemoryEntries(makePort(), makeCoord()));
    act(() => result.current.startNew());
    expect(result.current.editing).not.toBeNull();
    act(() => result.current.cancelEdit());
    expect(result.current.editing).toBeNull();
  });
});

describe('useMemoryEntries — onSave', () => {
  it('onSave for a new entry saves, reloads, closes the editor, and flashes "created"', async () => {
    const coord = makeCoord();
    const port = makePort({ saveMemoryEntry: vi.fn(async () => savedEntry()) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    act(() => result.current.startNew());
    act(() => result.current.setEditing({ name: 'Fresh', description: '', type: 'user', body: 'hi' }));
    await act(async () => {
      await result.current.onSave();
    });

    expect(port.saveMemoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Fresh', body: 'hi' }),
    );
    expect(port.fetchMemoryList).toHaveBeenCalled(); // reload
    expect(coord.closeEditor).toHaveBeenCalled();
    expect(coord.fireFlash).toHaveBeenCalledWith('created');
  });

  it('onSave for an EXISTING entry saves, reloads, closes the editor, and flashes "saved"', async () => {
    const coord = makeCoord();
    const port = makePort({ saveMemoryEntry: vi.fn(async () => savedEntry()) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    act(() =>
      result.current.setEditing({ id: 'existing', name: 'Edited', description: '', type: 'user', body: 'hi' }),
    );
    await act(async () => {
      await result.current.onSave();
    });

    expect(port.saveMemoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing', name: 'Edited' }),
    );
    expect(coord.closeEditor).toHaveBeenCalled();
    expect(coord.fireFlash).toHaveBeenCalledWith('saved');
  });

  it('onSave is busy while the request is in flight, and not busy afterward', async () => {
    const saved = deferred<MemoryEntry | null>();
    const port = makePort({ saveMemoryEntry: vi.fn(() => saved.promise) });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    act(() => result.current.setEditing({ name: 'Entry', description: '', type: 'user', body: '' }));
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.onSave();
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      saved.resolve(savedEntry());
      await savePromise;
    });
    expect(result.current.busy).toBe(false);
  });

  it('does not let a completed save close a newer editor draft', async () => {
    const saved = deferred<MemoryEntry | null>();
    const coord = makeCoord();
    const port = makePort({ saveMemoryEntry: vi.fn(() => saved.promise) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    act(() => result.current.setEditing({ name: 'First', description: '', type: 'user', body: 'one' }));
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = result.current.onSave();
    });

    // A new draft started while the first save is unresolved is a newer editor
    // session, not an instruction for the old completion to dismiss it.
    act(() => result.current.setEditing({ name: 'Second', description: '', type: 'project', body: 'two' }));
    await act(async () => {
      saved.resolve(savedEntry());
      await firstSave;
    });

    expect(result.current.editing?.name).toBe('Second');
    expect(coord.closeEditor).not.toHaveBeenCalled();
    expect(coord.fireFlash).toHaveBeenCalledWith('created');
  });

  it('ignores a duplicate entry save dispatched before its busy state renders', async () => {
    const saved = deferred<MemoryEntry | null>();
    const port = makePort({ saveMemoryEntry: vi.fn(() => saved.promise) });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    act(() => result.current.setEditing({ name: 'Only once', description: '', type: 'user', body: '' }));
    let firstSave!: Promise<void>;
    let duplicateSave!: Promise<void>;
    act(() => {
      firstSave = result.current.onSave();
      duplicateSave = result.current.onSave();
    });
    expect(port.saveMemoryEntry).toHaveBeenCalledTimes(1);

    await act(async () => {
      saved.resolve(savedEntry());
      await Promise.all([firstSave, duplicateSave]);
    });
  });

  it('onSave is a no-op when the name is blank', async () => {
    const coord = makeCoord();
    const port = makePort();
    const { result } = renderHook(() => useMemoryEntries(port, coord));
    act(() => result.current.startNew());
    act(() => result.current.setEditing({ name: '   ', description: '', type: 'user', body: '' }));

    await act(async () => {
      await result.current.onSave();
    });

    expect(port.saveMemoryEntry).not.toHaveBeenCalled();
    expect(coord.fireFlash).not.toHaveBeenCalled();
  });

  it('onSave is a no-op when there is no draft at all', async () => {
    const port = makePort();
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));
    await act(async () => {
      await result.current.onSave();
    });
    expect(port.saveMemoryEntry).not.toHaveBeenCalled();
  });

  it('a resolved-null save surfaces MUTATION_ERROR without throwing and without closing the editor', async () => {
    const coord = makeCoord();
    const port = makePort({ saveMemoryEntry: vi.fn(async () => null) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    act(() => result.current.setEditing({ name: 'X', description: '', type: 'user', body: '' }));
    await act(async () => {
      await result.current.onSave();
    });
    expect(coord.closeEditor).not.toHaveBeenCalled();
    expect(coord.fireFlash).not.toHaveBeenCalled();
    expect(result.current.loadError).toMatch(/couldn't be saved/);
  });

  it('a thrown save surfaces LOAD_ERROR instead of an unhandled rejection', async () => {
    const coord = makeCoord();
    const port = makePort({
      saveMemoryEntry: vi.fn(async () => {
        throw new Error('save network failure');
      }),
    });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    act(() => result.current.setEditing({ name: 'X', description: '', type: 'user', body: '' }));
    await act(async () => {
      await result.current.onSave();
    });
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
    expect(coord.fireFlash).not.toHaveBeenCalled();
  });

  it('the editor only closes if the edit revision has not moved on since the save started', async () => {
    // start editing, call onSave, then IMMEDIATELY call setEditing again
    // before the save resolves — the newer edit must not be dismissed once
    // the older save resolves.
    const saved = deferred<MemoryEntry | null>();
    const coord = makeCoord();
    const port = makePort({ saveMemoryEntry: vi.fn(() => saved.promise) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    act(() => result.current.setEditing({ name: 'Original', description: '', type: 'user', body: 'one' }));
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.onSave();
    });
    act(() => result.current.setEditing({ name: 'Changed mid-flight', description: '', type: 'user', body: 'two' }));

    await act(async () => {
      saved.resolve(savedEntry());
      await savePromise;
    });

    expect(coord.closeEditor).not.toHaveBeenCalled();
    expect(result.current.editing?.name).toBe('Changed mid-flight');
  });
});

describe('useMemoryEntries — onDelete', () => {
  it('onDelete removes via the port, reloads, and flashes "deleted"', async () => {
    const coord = makeCoord();
    const port = makePort({ deleteMemoryEntry: vi.fn(async () => true) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    await act(async () => {
      await result.current.onDelete('a');
    });

    expect(port.deleteMemoryEntry).toHaveBeenCalledWith('a');
    expect(coord.fireFlash).toHaveBeenCalledWith('deleted');
  });

  it('ignores a duplicate delete for the same entry while the first is in flight', async () => {
    const deletedResult = deferred<boolean>();
    const coord = makeCoord();
    const port = makePort({ deleteMemoryEntry: vi.fn(() => deletedResult.promise) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    let firstDelete!: Promise<void>;
    let duplicateDelete!: Promise<void>;
    act(() => {
      firstDelete = result.current.onDelete('a');
      duplicateDelete = result.current.onDelete('a');
    });
    expect(port.deleteMemoryEntry).toHaveBeenCalledTimes(1);

    await act(async () => {
      deletedResult.resolve(true);
      await Promise.all([firstDelete, duplicateDelete]);
    });
    expect(coord.fireFlash).toHaveBeenCalledTimes(1);
  });

  it('a resolved-false delete surfaces MUTATION_ERROR without a flash', async () => {
    const coord = makeCoord();
    const port = makePort({ deleteMemoryEntry: vi.fn(async () => false) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    await act(async () => {
      await result.current.onDelete('a');
    });
    expect(coord.fireFlash).not.toHaveBeenCalled();
    expect(result.current.loadError).toMatch(/couldn't be saved/);
  });

  it('a thrown delete surfaces LOAD_ERROR instead of an unhandled rejection', async () => {
    const coord = makeCoord();
    const port = makePort({
      deleteMemoryEntry: vi.fn(async () => {
        throw new Error('delete network failure');
      }),
    });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    await act(async () => {
      await result.current.onDelete('a');
    });
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
  });
});

describe('useMemoryEntries — onSaveIndex', () => {
  it('onSaveIndex writes the draft and flashes "indexSaved"', async () => {
    const coord = makeCoord();
    const port = makePort({ saveMemoryIndex: vi.fn(async () => true) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    act(() => result.current.setIndexDraft('- [new](new.md)'));
    await act(async () => {
      await result.current.onSaveIndex();
    });

    expect(port.saveMemoryIndex).toHaveBeenCalledWith('- [new](new.md)');
    expect(result.current.index).toBe('- [new](new.md)');
    expect(result.current.indexDraft).toBeNull();
    expect(coord.fireFlash).toHaveBeenCalledWith('indexSaved');
  });

  it('is a no-op with no draft, and reports a resolved write failure once a draft exists', async () => {
    const coord = makeCoord();
    const port = makePort({ saveMemoryIndex: vi.fn(async () => false) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    // No draft → early return, port untouched.
    await act(async () => {
      await result.current.onSaveIndex();
    });
    expect(port.saveMemoryIndex).not.toHaveBeenCalled();

    // Draft present but the write fails → no index update, no flash.
    act(() => result.current.setIndexDraft('draft'));
    await act(async () => {
      await result.current.onSaveIndex();
    });
    expect(port.saveMemoryIndex).toHaveBeenCalled();
    expect(result.current.indexDraft).toBe('draft');
    expect(coord.fireFlash).not.toHaveBeenCalled();
    expect(result.current.loadError).toMatch(/couldn't be saved/);
  });

  it('a thrown index save surfaces LOAD_ERROR instead of an unhandled rejection', async () => {
    const coord = makeCoord();
    const port = makePort({
      saveMemoryIndex: vi.fn(async () => {
        throw new Error('index network failure');
      }),
    });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    act(() => result.current.setIndexDraft('draft'));
    await act(async () => {
      await result.current.onSaveIndex();
    });
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
  });

  it('does not discard a newer unsaved index edit made while an earlier save is still in flight', async () => {
    const coord = makeCoord();
    const firstSave = deferred<boolean>();
    const port = makePort({ saveMemoryIndex: vi.fn().mockReturnValueOnce(firstSave.promise) });
    const { result } = renderHook(() => useMemoryEntries(port, coord));

    act(() => result.current.setIndexDraft('draft A'));
    let saveA!: Promise<void>;
    act(() => {
      saveA = result.current.onSaveIndex();
    });

    // The user keeps typing while A's save is still pending.
    act(() => result.current.setIndexDraft('draft B'));

    await act(async () => {
      firstSave.resolve(true);
      await saveA;
    });

    // A's confirmed value lands in `index`, but the newer, still-unsaved
    // draft B must survive — not be silently cleared by A's stale closure.
    expect(result.current.index).toBe('draft A');
    expect(result.current.indexDraft).toBe('draft B');
  });

  it('ignores a duplicate index save dispatched before its busy state renders', async () => {
    const saved = deferred<boolean>();
    const port = makePort({ saveMemoryIndex: vi.fn(() => saved.promise) });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    act(() => result.current.setIndexDraft('draft'));
    let firstSave!: Promise<void>;
    let duplicateSave!: Promise<void>;
    act(() => {
      firstSave = result.current.onSaveIndex();
      duplicateSave = result.current.onSaveIndex();
    });
    expect(port.saveMemoryIndex).toHaveBeenCalledTimes(1);

    await act(async () => {
      saved.resolve(true);
      await Promise.all([firstSave, duplicateSave]);
    });
  });

  it('keeps busy true until overlapping entry and index writes both settle', async () => {
    const entrySave = deferred<MemoryEntry | null>();
    const indexSave = deferred<boolean>();
    const port = makePort({
      saveMemoryEntry: vi.fn(() => entrySave.promise),
      saveMemoryIndex: vi.fn(() => indexSave.promise),
    });
    const { result } = renderHook(() => useMemoryEntries(port, makeCoord()));

    act(() => {
      result.current.setEditing({ name: 'Entry', description: '', type: 'user', body: '' });
      result.current.setIndexDraft('index');
    });
    let saveEntry!: Promise<void>;
    let saveIndex!: Promise<void>;
    act(() => {
      saveEntry = result.current.onSave();
      saveIndex = result.current.onSaveIndex();
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      entrySave.resolve(savedEntry());
      await saveEntry;
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      indexSave.resolve(true);
      await saveIndex;
    });
    expect(result.current.busy).toBe(false);
  });
});

describe('useMemoryEntries — onCopyPath', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies the root dir and flashes, but no-ops without a rootDir yet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const coord = makeCoord();
    const { result } = renderHook(() => useMemoryEntries(makePort(), coord));

    // Before reload rootDir is '' → early return.
    await act(async () => {
      await result.current.onCopyPath();
    });
    expect(writeText).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.reload();
    });
    await act(async () => {
      await result.current.onCopyPath();
    });
    expect(writeText).toHaveBeenCalledWith('/memories');
    expect(coord.fireFlash).toHaveBeenCalledWith('pathCopied');
  });

  it("surfaces a loadError (not a claimed success) when copyToClipboard resolves false on total failure", async () => {
    // @injini/ui's copyToClipboard falls back from the Clipboard API to
    // document.execCommand('copy') and resolves `false` (never rejects) when
    // BOTH paths fail. onCopyPath must branch on that boolean, not on a
    // caught rejection.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });
    const coord = makeCoord();
    const { result } = renderHook(() => useMemoryEntries(makePort(), coord));
    await act(async () => {
      await result.current.reload();
    });

    await act(async () => {
      await result.current.onCopyPath();
    });
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
    expect(coord.fireFlash).not.toHaveBeenCalledWith('pathCopied');
  });

  it('surfaces a loadError when the execCommand fallback itself throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        throw new Error('fallback denied');
      }),
    });
    const coord = makeCoord();
    const { result } = renderHook(() => useMemoryEntries(makePort(), coord));
    await act(async () => {
      await result.current.reload();
    });

    await act(async () => {
      await result.current.onCopyPath();
    });
    expect(result.current.loadError).toMatch(/couldn't be loaded/);
    expect(coord.fireFlash).not.toHaveBeenCalledWith('pathCopied');
  });
});

describe('useWiredMemoryEntries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds the real memoryEntriesPort from dependencies.ts', async () => {
    const list: MemoryListResponse = {
      enabled: true,
      rootDir: '/wired-root',
      index: 'wired-index',
      entries: [],
    };
    const fetchMemoryList = vi.spyOn(memoryEntriesPort, 'fetchMemoryList').mockResolvedValue(list);
    const fetchMemoryTree = vi.spyOn(memoryEntriesPort, 'fetchMemoryTree').mockResolvedValue([]);
    const coord = makeCoord();

    const { result } = renderHook(() => useWiredMemoryEntries(coord));
    await act(async () => {
      await result.current.reload();
    });

    expect(fetchMemoryList).toHaveBeenCalledTimes(1);
    expect(fetchMemoryTree).toHaveBeenCalledTimes(1);
    expect(result.current.rootDir).toBe('/wired-root');
  });
});
