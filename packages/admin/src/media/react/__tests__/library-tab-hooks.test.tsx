import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLibraryTab } from '../hooks/LibraryTab.hooks.js';
import { MediaPortsContext } from '../hooks/MediaPorts.hooks.js';
import { MediaLibraryContext } from '../hooks/MediaPage.hooks.js';
import { createMemoryMediaApi } from '../../adapters/memory.js';
import type { LibraryState, createLibraryController } from '../../controllers/library.controller.js';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort, MediaEventsPort } from '../../ports.js';

afterEach(cleanup);
const ALL = ['media.upload', 'media.update', 'media.trash', 'media.restore', 'media.delete.force'];
const asset = (id: string, title: string, createdAt: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id, title, alt: '', contentType: 'image/png', publicUrl: null, status: 'active', sha256: id, caption: '', credit: '',
  createdAt, updatedAt: createdAt, version: 1, ...patch,
});
// Newest first: Alpha, Bravo, Charlie.
const seed = () => [asset('a', 'Alpha', '2026-01-03T00:00:00Z'), asset('b', 'Bravo', '2026-01-02T00:00:00Z'), asset('c', 'Charlie', '2026-01-01T00:00:00Z', { contentType: null })];
type View = ReturnType<typeof useLibraryTab>;
type Shared = { controller: ReturnType<typeof createLibraryController> | null; snapshot: LibraryState | null };

function mount({ permissions = ALL, params = {}, api = createMemoryMediaApi({ assets: seed() }), events, shared = null, grid = true }: {
  permissions?: string[]; params?: Record<string, unknown>; api?: MediaApiPort; events?: MediaEventsPort; shared?: Shared | null; grid?: boolean;
} = {}) {
  let vm!: View, first: View | undefined;
  // Renders the grid the way LibraryTab.tsx does, so the focus effects find real cards.
  function Harness() {
    vm = useLibraryTab({ params, permissions });
    first ??= vm;
    return grid ? (
      <div ref={vm.gridRef} tabIndex={-1} data-testid="grid">
        {vm.items.map(item => <button key={item.id} data-jini-part="media.card" data-media-id={item.id}>{item.title}</button>)}
      </div>
    ) : null;
  }
  const view = render(
    <MediaPortsContext.Provider value={{ mediaApi: api, ...(events ? { mediaEvents: events } : {}) }}>
      <MediaLibraryContext.Provider value={shared}><Harness /></MediaLibraryContext.Provider>
    </MediaPortsContext.Provider>,
  );
  const ready = () => waitFor(() => expect(vm.loading || vm.busy).toBe(false));
  const card = (id: string) => view.container.querySelector(`[data-media-id="${id}"]`);
  return { ...view, api, vm: () => vm, first: () => first!, ready, card };
}

describe('useLibraryTab', () => {
  it('loads the library and labels the empty state per filter', async () => {
    const f = mount();
    expect(f.first().loading).toBe(true);
    await f.ready();
    expect(f.vm().items.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(f.vm()).toMatchObject({ emptyLabel: 'No media found', statusFilter: 'all', orderBy: 'created', search: '', untyped: false, canUpload: true, canPurge: true });
    cleanup();
    const images = mount({ params: { filter: 'images' } });
    await images.ready();
    expect(images.vm()).toMatchObject({ emptyLabel: 'No images yet. Upload an image to see it here.', untyped: true });
    cleanup();
    expect(mount({ params: { filter: 'videos' } }).vm().emptyLabel).toBe('No videos yet. Upload a video to see it here.');
    cleanup();
    expect(mount({ params: { filter: 'docs' } }).vm().emptyLabel).toBe('No media found');
  });

  it('withholds every write affordance without permissions', async () => {
    const f = mount({ permissions: [] });
    await f.ready();
    expect(Object.keys(f.vm().actions[0]!).sort()).toEqual(['busy', 'item', 'onPreview']);
    await expect(f.vm().upload({ input: { filename: 'x.png', contentType: 'image/png', dataBase64: 'eA==' } })).resolves.toBe(false);
    expect(f.vm().confirmPurge()).toBeUndefined();
    expect(f.vm().items).toHaveLength(3);
  });

  it('hides restore when the host cannot restore', async () => {
    const api = createMemoryMediaApi({ assets: seed() });
    const f = mount({ api: { ...api, restoreSupported: false } });
    await f.ready();
    expect(f.vm().actions[0]).not.toHaveProperty('onRestore');
    expect(f.vm().actions[0]).toHaveProperty('onTrash');
  });

  it('opens, moves and closes the lightbox by index', async () => {
    const f = mount();
    await f.ready();
    act(() => f.vm().actions[1]!.onPreview());
    expect(f.vm().lightboxIndex).toBe(1);
    act(() => f.vm().onNavigate(2));
    expect(f.vm().lightboxIndex).toBe(2);
    act(() => f.vm().closeLightbox());
    expect(f.vm().lightboxIndex).toBeNull();
  });

  it('rereads after an edit, announces it and refocuses the edited card', async () => {
    const f = mount();
    await f.ready();
    const list = vi.spyOn(f.api, 'list');
    act(() => f.vm().actions[1]!.onEdit!());
    expect(f.vm().editing?.id).toBe('b');
    await act(async () => f.vm().saved({ message: 'Saved Bravo' }));
    expect(list).toHaveBeenCalledTimes(1);
    expect(f.vm()).toMatchObject({ editing: null, success: 'Saved Bravo' });
    expect(document.activeElement).toBe(f.card('b'));
  });

  it('rereads quietly when a save carries no message and nothing was being edited', async () => {
    const f = mount();
    await f.ready();
    (f.card('a') as HTMLElement).focus();
    await act(async () => f.vm().saved());
    expect(f.vm().success).toBeNull();
    expect(document.activeElement).toBe(f.card('a'));
    act(() => f.vm().actions[0]!.onEdit!());
    act(() => f.vm().closeEdit());
    expect(f.vm().editing).toBeNull();
  });

  it('refocuses the card now at the edited position when the edited asset is gone after the reread', async () => {
    const f = mount();
    await f.ready();
    act(() => f.vm().actions[2]!.onEdit!());
    await act(async () => { await f.api.trash({ id: 'c' }); await f.api.delete({ id: 'c' }); });
    await act(async () => f.vm().saved());
    expect(document.activeElement).toBe(f.card('b'));
  });

  it('refocuses the first card when the edited asset is no longer in view', async () => {
    const f = mount();
    await f.ready();
    act(() => f.vm().actions[2]!.onEdit!());
    await act(async () => f.vm().onSearch({ value: 'alp' }));
    await act(async () => f.vm().saved());
    expect(document.activeElement).toBe(f.card('a'));
  });

  it('trashes and restores, announcing each and keeping focus on the same card', async () => {
    const f = mount();
    await f.ready();
    await act(async () => f.vm().actions[1]!.onTrash!());
    await f.ready();
    expect(f.vm().success).toBe('Trashed Bravo');
    expect(f.vm().items[1]!.status).toBe('trashed');
    expect(document.activeElement).toBe(f.card('b'));
    await act(async () => f.vm().actions[1]!.onRestore!());
    await f.ready();
    expect(f.vm().success).toBe('Restored Bravo');
    expect(document.activeElement).toBe(f.card('b'));
  });

  it('stays quiet when a trash or restore is refused', async () => {
    const api = createMemoryMediaApi({ assets: seed() });
    const f = mount({ api: { ...api, trash: async () => { throw new Error('nope'); }, restore: async () => { throw new Error('nope'); } } });
    await f.ready();
    await act(async () => f.vm().actions[0]!.onTrash!());
    await act(async () => f.vm().actions[0]!.onRestore!());
    await f.ready();
    expect(f.vm().success).toBeNull();
  });

  it('moves focus to the card now at that position, or the grid, when the trashed card leaves the view', async () => {
    const f = mount({ api: createMemoryMediaApi({ assets: seed().slice(0, 2) }) });
    await f.ready();
    await act(async () => f.vm().onStatus({ value: 'active' }));
    await f.ready();
    await act(async () => f.vm().actions[1]!.onTrash!());
    await f.ready();
    expect(f.vm().items.map(item => item.id)).toEqual(['a']);
    expect(document.activeElement).toBe(f.card('a'));
    await act(async () => f.vm().actions[0]!.onTrash!());
    await f.ready();
    expect(f.vm().items).toEqual([]);
    expect(document.activeElement).toBe(f.getByTestId('grid'));
  });

  it('applies status, search and order queries', async () => {
    const f = mount();
    await f.ready();
    await act(async () => f.vm().onStatus({ value: 'trashed' }));
    expect(f.vm().statusFilter).toBe('trashed');
    await act(async () => f.vm().onStatus({ value: 'bogus' }));
    expect(f.vm().statusFilter).toBe('all');
    await act(async () => f.vm().onSearch({ value: 'char' }));
    expect(f.vm()).toMatchObject({ search: 'char', items: [expect.objectContaining({ id: 'c' })] });
    await act(async () => f.vm().onSearch({ value: '' }));
    await act(async () => f.vm().onOrder({ value: 'alphabetical' }));
    expect(f.vm().orderBy).toBe('alphabetical');
    await act(async () => f.vm().onOrder({ value: 'anything' }));
    expect(f.vm().orderBy).toBe('created');
  });

  it('uploads with and without alt text and focuses the grid only after a success', async () => {
    const api = createMemoryMediaApi({ assets: [] });
    const upload = vi.spyOn(api, 'upload');
    const f = mount({ api });
    await f.ready();
    const input = { filename: 'new.png', contentType: 'image/png', dataBase64: 'eA==' };
    await act(async () => { await expect(f.vm().upload({ input, alt: 'New' })).resolves.toBe(true); });
    expect(upload.mock.calls[0]![1]).toMatchObject({ alt: 'New' });
    expect(document.activeElement).toBe(f.getByTestId('grid'));
    await act(async () => { await f.vm().upload({ input }); });
    expect(upload.mock.calls[1]![1]).toMatchObject({ alt: '' });
    (document.activeElement as HTMLElement).blur();
    upload.mockRejectedValueOnce(new Error('too big'));
    await act(async () => { await expect(f.vm().upload({ input })).resolves.toBe(false); });
    expect(document.activeElement).toBe(document.body);
  });

  it('confirms a purge, announces it and focuses the card now at that index', async () => {
    const api = createMemoryMediaApi({ assets: seed() });
    await api.trash({ id: 'b' });
    const f = mount({ api });
    await f.ready();
    expect(f.vm().confirmPurge()).toBeUndefined();
    act(() => f.vm().actions[1]!.onPurge!());
    expect(f.vm().snapshot?.pendingPurge?.id).toBe('b');
    act(() => f.vm().cancelPurge());
    expect(f.vm().snapshot?.pendingPurge).toBeNull();
    act(() => f.vm().actions[1]!.onPurge!());
    await act(async () => f.vm().confirmPurge());
    await f.ready();
    expect(f.vm().success).toBe('Deleted permanently Bravo');
    expect(f.vm().items.map(item => item.id)).toEqual(['a', 'c']);
    expect(document.activeElement).toBe(f.card('c'));
  });

  it('focuses the grid after purging the last card, and stays quiet when the purge fails', async () => {
    const api = createMemoryMediaApi({ assets: [asset('a', 'Alpha', '2026-01-01T00:00:00Z', { status: 'trashed' })] });
    const f = mount({ api });
    await f.ready();
    act(() => f.vm().actions[0]!.onPurge!());
    await act(async () => f.vm().confirmPurge());
    await f.ready();
    expect(document.activeElement).toBe(f.getByTestId('grid'));
    cleanup();
    const failing = createMemoryMediaApi({ assets: [asset('a', 'Alpha', '2026-01-01T00:00:00Z', { status: 'trashed' })] });
    const g = mount({ api: { ...failing, delete: async () => ({ purged: false }) } });
    await g.ready();
    act(() => g.vm().actions[0]!.onPurge!());
    await act(async () => g.vm().confirmPurge());
    expect(g.vm().success).toBeNull();
  });

  it('settles focus requests without a mounted grid', async () => {
    const api = createMemoryMediaApi({ assets: seed() });
    await api.trash({ id: 'a' });
    const f = mount({ api, grid: false });
    await f.ready();
    await act(async () => f.vm().actions[1]!.onTrash!());
    await f.ready();
    act(() => f.vm().actions[0]!.onPurge!());
    await act(async () => f.vm().confirmPurge());
    await f.ready();
    expect(f.vm().success).toBe('Deleted permanently Alpha');
  });

  it('refreshes on host events and unsubscribes on unmount', async () => {
    let onRefresh: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const events: MediaEventsPort = { subscribe: ({ onRefresh: listener }) => { onRefresh = listener; return unsubscribe; } };
    const f = mount({ events });
    await f.ready();
    const list = vi.spyOn(f.api, 'list');
    await act(async () => onRefresh!());
    expect(list).toHaveBeenCalledTimes(1);
    act(() => f.vm().onRetry());
    await f.ready();
    expect(list).toHaveBeenCalledTimes(2);
    f.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('keeps first-render handlers inert before the controller exists', async () => {
    const f = mount();
    const first = f.first();
    expect(first.controller).toBeNull();
    first.onRetry(); first.onStatus({ value: 'active' }); first.onSearch({ value: 'x' }); first.onOrder({ value: 'alphabetical' }); first.cancelPurge();
    expect(first.confirmPurge()).toBeUndefined();
    await expect(first.upload({ input: { filename: 'x.png', contentType: 'image/png', dataBase64: 'eA==' } })).resolves.toBe(false);
    await act(async () => first.saved());
    await f.ready();
    expect(f.vm()).toMatchObject({ statusFilter: 'all', search: '', orderBy: 'created' });
  });
});

describe('useLibraryTab inside a shared media page', () => {
  function sharedController(snapshot: Partial<LibraryState>) {
    const state: LibraryState = { items: [], query: {}, loading: false, busy: false, pendingIds: [], error: null, pendingPurge: null, hasUntyped: false, counts: null, ...snapshot };
    const controller = { getSnapshot: () => state, load: vi.fn(async () => {}), subscribe: () => () => {} };
    return { controller: controller as unknown as ReturnType<typeof createLibraryController>, snapshot: state, load: controller.load };
  }

  it('reads the page controller instead of loading its own or subscribing to host events', async () => {
    const api = createMemoryMediaApi({ assets: seed() });
    const list = vi.spyOn(api, 'list');
    const subscribe = vi.fn(() => () => {});
    const shared = sharedController({ items: seed().slice(0, 1), pendingIds: ['a'] });
    const f = mount({ api, events: { subscribe }, shared });
    expect(f.vm()).toMatchObject({ controller: shared.controller, loading: false, items: [expect.objectContaining({ id: 'a' })] });
    expect(f.vm().actions[0]!.busy).toBe(true);
    await act(async () => {});
    expect(list).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(shared.load).not.toHaveBeenCalled();
  });

  it('retries a failed shared read on re-entry, but not one still loading', () => {
    const failed = sharedController({ error: 'offline' });
    mount({ shared: failed });
    expect(failed.load).toHaveBeenCalledTimes(1);
    cleanup();
    const retrying = sharedController({ error: 'offline', loading: true });
    mount({ shared: retrying });
    expect(retrying.load).not.toHaveBeenCalled();
  });
});
