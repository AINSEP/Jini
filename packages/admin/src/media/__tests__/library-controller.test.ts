import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLibraryController } from '../controllers/library.controller.js';
import { createMemoryMediaApi } from '../adapters/memory.js';
import type { MediaApiPort } from '../ports.js';
import type { MediaAsset } from '../models.js';
const image = { filename: 'photo.png', contentType: 'image/png', dataBase64: 'aA==' };
const retryable = () => Object.assign(new Error('HTTP 503'), { retryable: true });
afterEach(() => vi.useRealTimers());
async function seeded(): Promise<{ api: MediaApiPort; item: MediaAsset }> {
  const api = createMemoryMediaApi({});
  const item = await api.upload(image);
  return { api, item };
}
describe('library controller load', () => {
  it('publishes frozen filtered items, tab counts and the untyped flag after a read', async () => {
    const { api, item } = await seeded();
    const untyped: MediaAsset = { ...item, id: 'untyped', contentType: null };
    const controller = createLibraryController({ api: { ...api, list: async () => [item, untyped] } }, { query: { filter: 'images' } });
    await controller.load();
    const snapshot = controller.getSnapshot();
    expect(snapshot.items?.map((row) => row.id)).toEqual([item.id]);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
    expect(Object.isFrozen(snapshot.items?.[0])).toBe(true);
    expect(snapshot.counts).toEqual({ all: 2, images: 1, videos: 0 });
    expect(snapshot.hasUntyped).toBe(true);
    expect(snapshot).toMatchObject({ loading: false, error: null });
  });
  it('reports the fallback message when a read rejects with a non-Error value', async () => {
    const { api } = await seeded();
    const controller = createLibraryController({ api: { ...api, list: () => Promise.reject('down') } });
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ error: 'Failed to load media', loading: false, items: null });
  });
  it('does not schedule a retry for a non-retryable read failure', async () => {
    vi.useFakeTimers();
    const { api } = await seeded();
    const list = vi.fn(() => Promise.reject(Object.assign(new Error('HTTP 403'), { retryable: false })));
    const controller = createLibraryController({ api: { ...api, list } });
    await controller.load();
    expect(controller.getSnapshot().error).toBe('HTTP 403');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('backs off retries exponentially and caps the delay at 30 seconds', async () => {
    vi.useFakeTimers();
    const { api } = await seeded();
    const list = vi.fn(() => Promise.reject(retryable()));
    const controller = createLibraryController({ api: { ...api, list } });
    await controller.load();
    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const [index, delay] of delays.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(list).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(list).toHaveBeenCalledTimes(index + 2);
    }
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('restarts the backoff at 1 second after a successful read', async () => {
    vi.useFakeTimers();
    const { api } = await seeded();
    let calls = 0;
    const list = vi.fn<MediaApiPort['list']>((query, options) => (++calls === 3 ? api.list(query, options) : Promise.reject(retryable())));
    const controller = createLibraryController({ api: { ...api, list } });
    await controller.load();
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    expect(controller.getSnapshot().error).toBeNull();
    await controller.load();
    await vi.advanceTimersByTimeAsync(999);
    expect(list).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(list).toHaveBeenCalledTimes(5);
    controller.dispose();
  });
  it('drops a superseded read and keeps loading until the latest one settles', async () => {
    const { api, item } = await seeded();
    const pending: ((rows: readonly MediaAsset[]) => void)[] = [];
    const list: MediaApiPort['list'] = () => new Promise((resolve) => { pending.push(resolve); });
    const controller = createLibraryController({ api: { ...api, list } });
    const first = controller.load();
    const second = controller.load();
    pending[0]!([item]);
    await first;
    expect(controller.getSnapshot()).toMatchObject({ loading: true, items: null });
    pending[1]!([]);
    await second;
    expect(controller.getSnapshot()).toMatchObject({ loading: false, items: [] });
  });
  it('ignores the failure of a read aborted by a newer read', async () => {
    const { api } = await seeded();
    let calls = 0;
    const list: MediaApiPort['list'] = (query, options) =>
      ++calls === 1
        ? new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
        : api.list(query, options);
    const controller = createLibraryController({ api: { ...api, list } });
    const first = controller.load();
    await controller.load();
    await first;
    expect(controller.getSnapshot()).toMatchObject({ error: null, loading: false });
  });
  it('does nothing after dispose', async () => {
    const { api } = await seeded();
    const list = vi.fn(api.list);
    const controller = createLibraryController({ api: { ...api, list } });
    controller.dispose();
    await controller.load();
    expect(list).not.toHaveBeenCalled();
  });
});
describe('library controller settleLibrary', () => {
  it('accepts cache data without a read and clears the error', async () => {
    const { api, item } = await seeded();
    const list = vi.fn(api.list);
    const controller = createLibraryController({ api: { ...api, list } });
    controller.settleLibrary({ error: new Error('stale') });
    controller.settleLibrary({ all: [item, { ...item, id: 'untyped', contentType: null }] });
    expect(list).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ error: null, hasUntyped: true, counts: { all: 2, images: 1, videos: 0 } });
    expect(controller.getSnapshot().items).toHaveLength(2);
  });
  it('reports the error after accepting data when both arrive together', async () => {
    const { api, item } = await seeded();
    const controller = createLibraryController({ api });
    controller.settleLibrary({ all: [item], error: new Error('Latest read failed') });
    expect(controller.getSnapshot()).toMatchObject({ error: 'Latest read failed', hasUntyped: false });
    expect(controller.getSnapshot().items).toHaveLength(1);
  });
  it('reads on a tab change before any library is known', async () => {
    const { api, item } = await seeded();
    const list = vi.fn(api.list);
    const controller = createLibraryController({ api: { ...api, list } });
    await controller.setQuery({ query: { filter: 'images' } });
    expect(list).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().items?.map((row) => row.id)).toEqual([item.id]);
  });
  it('re-reads on a tab change after the last read failed, filtering known rows first', async () => {
    const { api, item } = await seeded();
    let calls = 0;
    const list: MediaApiPort['list'] = (query, options) => (++calls === 2 ? Promise.reject(new Error('HTTP 403')) : api.list(query, options));
    const controller = createLibraryController({ api: { ...api, list } });
    await controller.load();
    await controller.load();
    expect(controller.getSnapshot().error).toBe('HTTP 403');
    const pending = controller.setQuery({ query: { filter: 'videos' } });
    expect(controller.getSnapshot().items).toEqual([]);
    await pending;
    expect(calls).toBe(3);
    expect(controller.getSnapshot()).toMatchObject({ error: null, items: [] });
    expect(item.contentType).toBe('image/png');
  });
  it('lets a later tab change filter the settled library without a read', async () => {
    const { api, item } = await seeded();
    const list = vi.fn(api.list);
    const controller = createLibraryController({ api: { ...api, list } });
    controller.settleLibrary({ all: [item] });
    await controller.setQuery({ query: { filter: 'videos' } });
    expect(list).not.toHaveBeenCalled();
    expect(controller.getSnapshot().items).toEqual([]);
  });
  it('ignores input after dispose', async () => {
    const { api, item } = await seeded();
    const controller = createLibraryController({ api });
    controller.dispose();
    controller.settleLibrary({ all: [item], error: new Error('late') });
    expect(controller.getSnapshot()).toMatchObject({ items: null, error: null });
  });
});
describe('library controller writes', () => {
  it('reports the fallback message when a write rejects with a non-Error value', async () => {
    const { api } = await seeded();
    const controller = createLibraryController({ api: { ...api, upload: () => Promise.reject('nope') } });
    expect(await controller.upload({ input: image })).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ error: 'Media write failed', busy: false, pendingIds: [] });
  });
  it('refuses restore with a specific error when the port cannot restore', async () => {
    const { api, item } = await seeded();
    const { restore: _restore, ...noRestore } = api;
    const controller = createLibraryController({ api: noRestore });
    expect(await controller.restore({ id: item.id })).toBe(false);
    expect(controller.getSnapshot().error).toBe('Restoring media is unavailable');
  });
  it('restores a trashed asset through the port and reloads', async () => {
    const { api, item } = await seeded();
    await api.trash({ id: item.id });
    const controller = createLibraryController({ api });
    expect(await controller.restore({ id: item.id })).toBe(true);
    expect(controller.getSnapshot().items?.[0]?.status).toBe('active');
  });
  it('fails a purge the port did not perform and keeps the pending purge', async () => {
    const { api, item } = await seeded();
    await api.trash({ id: item.id });
    const controller = createLibraryController({ api: { ...api, delete: async () => ({ purged: false }) } });
    await controller.load();
    const trashed = controller.getSnapshot().items![0]!;
    controller.requestPurge({ item: trashed });
    expect(await controller.confirmPurge({ confirmed: true })).toBe(false);
    expect(controller.getSnapshot().error).toBe('The file was not permanently deleted');
    expect(controller.getSnapshot().pendingPurge).toBe(trashed);
  });
  it('removes a purged card even when the follow-up read fails', async () => {
    const { api, item } = await seeded();
    await api.trash({ id: item.id });
    let calls = 0;
    const list: MediaApiPort['list'] = (query, options) => (++calls === 1 ? api.list(query, options) : Promise.reject(new Error('offline')));
    const controller = createLibraryController({ api: { ...api, list } });
    await controller.load();
    controller.requestPurge({ item: controller.getSnapshot().items![0]! });
    expect(await controller.confirmPurge({ confirmed: true })).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ items: [], counts: { all: 0, images: 0, videos: 0 }, error: 'offline' });
  });
  it('reports false for a write whose call finished after dispose', async () => {
    const { api, item } = await seeded();
    let finish!: () => void;
    const upload: MediaApiPort['upload'] = () => new Promise((resolve) => { finish = () => resolve(item); });
    const list = vi.fn(api.list);
    const controller = createLibraryController({ api: { ...api, upload, list } });
    const result = controller.upload({ input: image });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.dispose();
    finish();
    expect(await result).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });
  it('skips a write queued behind another card once the controller is disposed', async () => {
    const { api, item } = await seeded();
    const other = await api.upload(image);
    let finish!: () => void;
    const trash = vi.fn<MediaApiPort['trash']>((required) =>
      new Promise((resolve) => { finish = () => resolve({ ...item, ...required, status: 'trashed' }); }));
    const controller = createLibraryController({ api: { ...api, trash } });
    const first = controller.trash({ id: item.id });
    const queued = controller.trash({ id: other.id });
    expect(controller.getSnapshot().pendingIds).toEqual([item.id, other.id]);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.dispose();
    finish();
    expect(await first).toBe(false);
    expect(await queued).toBe(false);
    expect(trash).toHaveBeenCalledTimes(1);
  });
  it('publishes no error for a write that fails after dispose', async () => {
    const { api } = await seeded();
    let fail!: () => void;
    const upload: MediaApiPort['upload'] = () => new Promise((_resolve, reject) => { fail = () => reject(new Error('late failure')); });
    const controller = createLibraryController({ api: { ...api, upload } });
    const result = controller.upload({ input: image });
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'));
    controller.dispose();
    fail();
    expect(await result).toBe(false);
    expect(controller.getSnapshot().error).toBeNull();
  });
  it('refuses a second write on the same card while the first is pending', async () => {
    const { api, item } = await seeded();
    const trash = vi.fn(api.trash);
    const controller = createLibraryController({ api: { ...api, trash } });
    const first = controller.trash({ id: item.id });
    expect(await controller.trash({ id: item.id })).toBe(false);
    expect(await first).toBe(true);
    expect(trash).toHaveBeenCalledTimes(1);
  });
  it('refuses a card write while an exclusive upload is pending', async () => {
    const { api, item } = await seeded();
    const trash = vi.fn(api.trash);
    const controller = createLibraryController({ api: { ...api, trash } });
    const upload = controller.upload({ input: image });
    expect(await controller.trash({ id: item.id })).toBe(false);
    expect(await upload).toBe(true);
    expect(trash).not.toHaveBeenCalled();
  });
  it('refuses to confirm when no purge is pending', async () => {
    const { api } = await seeded();
    const remove = vi.fn(api.delete);
    const controller = createLibraryController({ api: { ...api, delete: remove } });
    expect(await controller.confirmPurge({ confirmed: true })).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
  it('cancels a pending purge only while idle', async () => {
    const { api, item } = await seeded();
    await api.trash({ id: item.id });
    const controller = createLibraryController({ api });
    await controller.load();
    controller.requestPurge({ item: controller.getSnapshot().items![0]! });
    controller.cancelPurge();
    expect(controller.getSnapshot().pendingPurge).toBeNull();
  });
});
