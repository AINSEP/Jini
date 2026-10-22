import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLibraryController } from '../controllers/library.controller.js';
import { createMemoryMediaApi } from '../adapters/memory.js';
import { createHttpMediaApi } from '../adapters/http.js';
import type { MediaApiPort } from '../ports.js';
const input = { filename: 'photo.png', contentType: 'image/png', dataBase64: 'aA==' };
afterEach(() => vi.useRealTimers());
describe('QA API recovery', () => {
  it('never publishes error and loading together, even while retrying a failed read', async () => {
    const api = createMemoryMediaApi({});
    const list = vi.fn(api.list).mockRejectedValueOnce(new Error('offline'));
    const controller = createLibraryController({ api: { ...api, list } });
    const states: ReturnType<typeof controller.getSnapshot>[] = [];
    controller.subscribe({ listener: () => states.push(controller.getSnapshot()) });
    await controller.load(); await controller.load();
    expect(states.every(state => !(state.error && state.loading))).toBe(true);
    controller.dispose();
  });
  it('recovers on a tab change after background failure without discarding known rows', async () => {
    const api = createMemoryMediaApi({}); const item = await api.upload(input);
    const list = vi.fn(api.list).mockResolvedValueOnce([item]).mockRejectedValueOnce(new Error('offline'));
    const controller = createLibraryController({ api: { ...api, list } });
    await controller.load(); await controller.load();
    expect(controller.getSnapshot().items?.[0]?.id).toBe(item.id);
    await controller.setQuery({ query: { filter: 'images' } });
    expect(list).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().error).toBeNull(); controller.dispose();
  });
  it('automatically retries retryable failures at 1s, 2s, then recovers and clears the timer', async () => {
    vi.useFakeTimers(); const api = createMemoryMediaApi({});
    const failure = Object.assign(new Error('HTTP 503'), { retryable: true });
    const list = vi.fn(api.list).mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
    const controller = createLibraryController({ api: { ...api, list } });
    await controller.load(); expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999); expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999); expect(list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(list).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot()).toMatchObject({ items: [], error: null, loading: false });
    expect(vi.getTimerCount()).toBe(0); controller.dispose();
  });
  it('cancels retries on dispose and respects an explicit non-retryable transport error', async () => {
    vi.useFakeTimers(); const api = createMemoryMediaApi({});
    for (const retryable of [true, false]) {
      const list = vi.fn().mockRejectedValue(Object.assign(new Error('HTTP 500'), { retryable }));
      const controller = createLibraryController({ api: { ...api, list } });
      await controller.load(); expect(vi.getTimerCount()).toBe(retryable ? 1 : 0);
      controller.dispose(); await vi.advanceTimersByTimeAsync(60000);
      expect(list).toHaveBeenCalledTimes(1);
    }
  });
});
describe('optional restore capability', () => {
  it('fails closed without a restore method or when explicitly disabled', async () => {
    const api = createMemoryMediaApi({}); const restore = vi.fn(api.trash);
    for (const port of [{ ...api, restore: undefined }, { ...api, restore, restoreSupported: false }]) {
      const controller = createLibraryController({ api: port as MediaApiPort });
      expect(await controller.restore({ id: 'missing' })).toBe(false);
      expect(controller.getSnapshot().error).toBe('Restoring media is unavailable');
      expect(restore).not.toHaveBeenCalled(); controller.dispose();
    }
  });
  it('restores identity and metadata, then removes the row from a Trash filter', async () => {
    const api = createMemoryMediaApi({}); const item = await api.upload(input, { alt: 'Original' });
    await api.trash({ id: item.id });
    const controller = createLibraryController({ api }, { query: { status: 'trashed' } });
    await controller.load(); expect(controller.getSnapshot().items).toHaveLength(1);
    expect(await controller.restore({ id: item.id })).toBe(true);
    expect(controller.getSnapshot().items).toEqual([]);
    expect((await api.list({}))[0]).toMatchObject({ id: item.id, alt: 'Original', status: 'active' });
    controller.dispose();
  });
  it('HTTP advertises restore only with an explicit route and forwards encoded identity/options', async () => {
    const memory = createMemoryMediaApi({}); const item = await memory.upload(input);
    const request = vi.fn(async () => ({ media: item }));
    const transport = { request: request as import('../adapters/http.js').MediaTransportPort['request'], url: ({ path }: { path: string }) => path };
    expect(createHttpMediaApi({ transport, basePath: '/media' }).restore).toBeUndefined();
    const api = createHttpMediaApi({ transport, basePath: '/media' }, { restorePath: ({ id }) => `/media/${encodeURIComponent(id)}/restore` });
    const signal = new AbortController().signal;
    await api.restore!({ id: 'a/b' }, { signal });
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/media/a%2Fb/restore' }, { signal });
  });
});
