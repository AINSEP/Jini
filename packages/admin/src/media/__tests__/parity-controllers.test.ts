import { describe, it, expect, vi } from 'vitest';
import { createMemoryMediaApi, createMemoryMediaProviders } from '../adapters/memory.js';
import { createHttpMediaApi } from '../adapters/http.js';
import { createEditMediaController } from '../controllers/edit-media.controller.js';
import { createLibraryController } from '../controllers/library.controller.js';
import { createProvidersController } from '../controllers/providers.controller.js';
import { runMediaApiConformance } from '../conformance/media-api.conformance.js';
import { canReplaceMedia, mediaRowHandles } from '../rules.js';
import type { MediaApiPort, MediaProvidersPort } from '../ports.js';
const input = { filename: 'image.png', contentType: 'image/png', dataBase64: 'aGVsbG8=' };
async function fixture() {
  const api = createMemoryMediaApi({});
  const item = await api.upload(input, { slug: 'readable', width: 800, height: 600, cssClass: 'wide', htmlAttributes: 'loading="lazy"' });
  return { api, item };
}
describe('legacy media controller guards', () => {
  it('keeps legacy row handle normalization and resolves whole-list collision chains', () => {
    expect(mediaRowHandles({ media: ['x', 'x-2', 'X', '***', 'My_Server.1'].map(id => ({ id })) })).toEqual([
      'media-item-x', 'media-item-x-2', 'media-item-x-3', 'media-item-4', 'media-item-my-server-1',
    ]);
  });
  it('saves CMS fields independently, clearing native dimensions with null and retaining other fields', async () => {
    const { api, item } = await fixture();
    const update = vi.fn(api.update);
    const edit = createEditMediaController({ api: { ...api, update }, item });
    edit.setDraft({ patch: { width: null, height: null, cssClass: null, htmlAttributes: null } });
    expect(await edit.save()).toBe(true);
    expect(update.mock.calls[0]?.[0]).toEqual({ id: item.id, patch: { width: null, height: null, cssClass: null, htmlAttributes: null } });
    expect((await api.list({}))[0]?.slug).toBe('readable');
    edit.setDraft({ patch: { slug: 'new-slug' } });
    await edit.save();
    expect(update.mock.calls[1]?.[0]).toEqual({ id: item.id, patch: { slug: 'new-slug' } });
    edit.setDraft({ patch: { title: 'new title' } });
    await edit.save();
    expect(update.mock.calls[2]?.[0]).toEqual({ id: item.id, patch: { title: 'new title' } });
    expect((await api.list({}))[0]?.slug).toBe('new-slug');
    edit.dispose();
  });
  it('sends invalid attribute drafts to the independent server validator and exposes its exact error', async () => {
    const { api, item } = await fixture();
    const update = vi.fn(async () => { throw new Error("'onclick' is not allowed by the server"); });
    const edit = createEditMediaController({ api: { ...api, update }, item });
    edit.setDraft({ patch: { title: 'edited', htmlAttributes: 'onclick="alert(1)"' } });
    expect(await edit.save()).toBe(false);
    expect(update.mock.calls).toHaveLength(1);
    expect(update).toHaveBeenCalledWith({ id: item.id, patch: { title: 'edited', htmlAttributes: 'onclick="alert(1)"' } }, { signal: expect.any(AbortSignal) });
    expect(edit.getSnapshot().error).toBe("'onclick' is not allowed by the server");
    expect((await api.list({}))[0]?.title).toBe('image.png');
    edit.dispose();
  });
  it('performs no write on unchanged metadata, including optional fields omitted by a host', async () => {
    const { api, item } = await fixture();
    const { slug, width, height, cssClass, htmlAttributes, ...oldHost } = item;
    const update = vi.fn(api.update);
    const edit = createEditMediaController({ api: { ...api, update }, item: oldHost });
    expect(await edit.save()).toBe(true);
    expect(update).not.toHaveBeenCalled();
    edit.dispose();
  });
  it('fails replacement closed when the method is absent or explicitly disabled, without upload/trash', async () => {
    const { api, item } = await fixture();
    const { replace, ...withoutReplace } = api;
    for (const host of [withoutReplace, { ...api, replaceSupported: false }]) {
      const upload = vi.fn(host.upload), trash = vi.fn(host.trash);
      const port: MediaApiPort = { ...host, upload, trash };
      expect(canReplaceMedia({ api: port })).toBe(false);
      const edit = createEditMediaController({ api: port, item });
      expect(await edit.replace({ upload: input })).toBe(false);
      expect(edit.getSnapshot().error).toBe('File replacement is unavailable');
      expect(upload).not.toHaveBeenCalled(); expect(trash).not.toHaveBeenCalled();
      edit.dispose();
    }
  });
  it('conforms without a replacement method and cleans its temporary asset', async () => {
    const { replace, ...api } = createMemoryMediaApi({});
    const checks = await runMediaApiConformance({ api });
    expect(checks).toContain('replacement is optional and unavailable');
    expect(await api.list({})).toEqual([]);
  });
  it('replacement changes bytes but retains ID, slug, all metadata and public references', async () => {
    const { api, item } = await fixture();
    const replaced = await api.replace!({ id: item.id, upload: { ...input, filename: 'different.webm', contentType: 'video/webm' } });
    expect(replaced).toMatchObject({ id: item.id, title: item.title, slug: item.slug, width: 800, height: 600, cssClass: 'wide', htmlAttributes: 'loading="lazy"', publicUrl: item.publicUrl });
    expect(replaced.sha256).not.toBe(item.sha256);
    expect(replaced.version).toBe(item.version + 1);
    await api.trash({ id: item.id });
    await expect(api.replace!({ id: item.id, upload: input })).rejects.toThrow('trashed');
    const abort = new AbortController(); abort.abort();
    await expect(api.replace!({ id: item.id, upload: input }, { signal: abort.signal })).rejects.toThrow();
  });
  it('exposes replacement only with an HTTP route and forwards encoded identity and abort options', async () => {
    const { item } = await fixture();
    const request = vi.fn(async () => ({ media: item }));
    const transport = { request: request as import('../adapters/http.js').MediaTransportPort['request'], url: ({ path }: { path: string }) => path };
    expect(createHttpMediaApi({ transport, basePath: '/media' }).replace).toBeUndefined();
    const api = createHttpMediaApi({ transport, basePath: '/media' }, { replacePath: ({ id }) => `/media/${encodeURIComponent(id)}/replace` });
    expect(canReplaceMedia({ api })).toBe(true);
    const signal = new AbortController().signal;
    await api.replace!({ id: 'a/b', upload: input }, { signal });
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/media/a%2Fb/replace', body: input }, { signal });
  });
  it('keeps full-library counts while search/filter/order are local, including known zero after purge', async () => {
    const { api, item } = await fixture();
    const clip = await api.upload({ ...input, contentType: 'video/webm', filename: 'clip' });
    const list = vi.fn(api.list);
    const library = createLibraryController({ api: { ...api, list } });
    expect(library.getSnapshot().counts).toBeNull();
    await library.load();
    expect(library.getSnapshot().counts).toEqual({ all: 2, images: 1, videos: 1 });
    await library.setQuery({ query: { filter: 'images', search: 'image', orderBy: 'alphabetical' } });
    expect(library.getSnapshot().items?.map(row => row.id)).toEqual([item.id]);
    expect(library.getSnapshot().counts).toEqual({ all: 2, images: 1, videos: 1 });
    expect(list).toHaveBeenCalledTimes(1);
    await library.trash({ id: clip.id });
    library.requestPurge({ item: (await api.list({})).find(row => row.id === clip.id)! });
    await library.confirmPurge({ confirmed: true });
    expect(library.getSnapshot().counts).toEqual({ all: 1, images: 1, videos: 0 });
    library.dispose();
  });
  it('serializes destructive operations so an unrelated completion cannot clear pending purge', async () => {
    const { api, item } = await fixture();
    const trashed = await api.trash({ id: item.id });
    let finish!: (value: { purged: boolean }) => void;
    const deleteRow = vi.fn(() => new Promise<{ purged: boolean }>(resolve => { finish = resolve; }));
    const trash = vi.fn(api.trash);
    const library = createLibraryController({ api: { ...api, delete: deleteRow, trash } });
    library.requestPurge({ item: trashed });
    const pending = library.confirmPurge({ confirmed: true });
    expect(await library.trash({ id: 'unrelated' })).toBe(false);
    library.cancelPurge();
    expect(library.getSnapshot().busy).toBe(true);
    expect(library.getSnapshot().pendingPurge?.id).toBe(item.id);
    expect(trash).not.toHaveBeenCalled();
    finish({ purged: true }); await pending;
    expect(library.getSnapshot().busy).toBe(false);
    expect(library.getSnapshot().pendingPurge).toBeNull();
    library.dispose();
  });
  it('saves provider endpoint/model without changing credentials or sibling providers', async () => {
    const api = createMemoryMediaProviders({ providers: [{ id: 'one', label: 'One', configured: true, baseUrl: 'https://old', model: 'old' }, { id: 'two', label: 'Two', configured: false }] });
    const controller = createProvidersController({ api });
    expect(await controller.saveSettings({ id: 'one', baseUrl: 'https://new', model: 'new' })).toBe(true);
    expect(await api.list({})).toEqual([{ id: 'one', label: 'One', configured: true, baseUrl: 'https://new', model: 'new' }, { id: 'two', label: 'Two', configured: false }]);
    await controller.save({ id: 'one', credential: 'secret' });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('secret');
    expect(controller.getSnapshot().items[0]?.baseUrl).toBe('https://new');
    controller.dispose();
  });
  it('preserves provider rows on rejected and null reads, while empty lists are authoritative', async () => {
    let state: 'ok' | 'null' | 'error' | 'empty' = 'ok';
    const memory = createMemoryMediaProviders({ providers: [{ id: 'one', label: 'One', configured: true }] });
    const api: MediaProvidersPort = { ...memory, async list() { if (state === 'error') throw new Error('403'); return state === 'null' ? null : state === 'empty' ? [] : memory.list({}); } };
    const controller = createProvidersController({ api }); await controller.load();
    for (const next of ['null', 'error'] as const) { state = next; await controller.load(); expect(controller.getSnapshot().items).toEqual([{ id: 'one', label: 'One', configured: true }]); }
    state = 'empty'; await controller.load(); expect(controller.getSnapshot().items).toEqual([]);
    controller.dispose();
  });
});
