import { describe, it, expect } from 'vitest';
import { createMemoryMediaApi, createMemoryMediaProviders } from '../adapters/memory.js';
import { createLibraryController } from '../controllers/library.controller.js';
import { createEditMediaController } from '../controllers/edit-media.controller.js';
import { createProvidersController } from '../controllers/providers.controller.js';
import { runMediaApiConformance } from '../conformance/media-api.conformance.js';
import type { MediaAsset } from '../models.js';
import type { MediaApiPort } from '../ports.js';
const image = { filename: 'photo.png', contentType: 'image/png', dataBase64: 'test-bytes' };
describe('memory API and controllers', () => {
  it('passes the exported adapter checklist', async () => {
    const api = createMemoryMediaApi({});
    const checks = await runMediaApiConformance({ api });
    expect(checks).toHaveLength(15);
    expect(await api.list({})).toEqual([]);
  });
  it('uploads, filters, trashes, and confirms an irreversible purge', async () => {
    const api = createMemoryMediaApi({});
    const controller = createLibraryController({ api });
    let updates = 0;
    const unsubscribe = controller.subscribe({ listener: () => updates++ });
    const initial = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(initial);
    await controller.load();
    expect(controller.getSnapshot().items).toEqual([]);
    expect(await controller.upload({ input: image, alt: 'accessible' })).toBe(true);
    await controller.upload({
      input: { ...image, filename: 'clip.webm', contentType: 'video/webm' },
    });
    await controller.setQuery({ query: { filter: 'images', search: 'photo' } });
    const item = controller.getSnapshot().items![0]!;
    expect(item.alt).toBe('accessible');
    expect(controller.getSnapshot().items).toHaveLength(1);
    controller.requestPurge({ item });
    expect(controller.getSnapshot().pendingPurge).toBeNull();
    await controller.trash({ id: item.id });
    const trashed = controller.getSnapshot().items![0]!;
    controller.requestPurge({ item: trashed });
    expect(await controller.confirmPurge({ confirmed: false })).toBe(false);
    expect(await controller.confirmPurge({ confirmed: true })).toBe(true);
    expect(controller.getSnapshot().pendingPurge).toBeNull();
    expect(controller.getSnapshot().items).toEqual([]);
    expect(updates).toBeGreaterThan(0);
    unsubscribe();
    controller.dispose();
    const count = updates;
    await controller.load();
    expect(updates).toBe(count);
  });
  it('diffs against the frozen edit baseline without reverting another operator', async () => {
    const api = createMemoryMediaApi({});
    const item = await api.upload(image, { alt: 'old' });
    const edit = createEditMediaController({ api, item });
    await api.update({ id: item.id, patch: { alt: 'another operator' } });
    edit.setDraft({ patch: { title: 'renamed' } });
    expect(await edit.save()).toBe(true);
    expect((await api.list({}))[0]?.alt).toBe('another operator');
    edit.setDraft({ patch: { title: 'renamed again' } });
    await edit.save();
    expect((await api.list({}))[0]?.alt).toBe('another operator');
    expect(await edit.replace({ upload: { ...image, contentType: 'video/webm' } })).toBe(true);
    const replaced = (await api.list({}))[0]!;
    expect(replaced.id).toBe(item.id);
    expect(replaced.title).toBe('renamed again');
    expect(replaced.contentType).toBe('video/webm');
    edit.dispose();
  });
  it('rejects stale list responses and aborts subscriptions on dispose', async () => {
    const api = createMemoryMediaApi({});
    const item = await api.upload(image);
    let resolveFirst!: (items: readonly MediaAsset[]) => void;
    let calls = 0;
    const signals: (AbortSignal | undefined)[] = [];
    const delayed: MediaApiPort = {
      ...api,
      list: (_query, options = {}) => {
        signals.push(options.signal);
        if (++calls === 1)
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        return Promise.resolve([item]);
      },
    };
    const controller = createLibraryController({ api: delayed });
    const first = controller.load();
    await controller.setQuery({ query: { search: 'photo' } });
    resolveFirst([]);
    await first;
    expect(controller.getSnapshot().items?.[0]?.id).toBe(item.id);
    expect(signals[0]?.aborted).toBe(true);
    controller.dispose();
    expect(signals[1]?.aborted).toBe(true);
  });
  it('keeps loaded items when a background refresh fails and clears a prior write error', async () => {
    const real = createMemoryMediaApi({});
    const item = await real.upload(image);
    let failRead = false,
      failWrite = true;
    const api: MediaApiPort = {
      ...real,
      list: async (query) => {
        if (failRead) throw new Error('offline');
        return real.list(query);
      },
      trash: async (target) => {
        if (failWrite) throw new Error('denied');
        return real.trash(target);
      },
    };
    const controller = createLibraryController({ api });
    await controller.load();
    failRead = true;
    await controller.load();
    expect(controller.getSnapshot().items?.[0]?.id).toBe(item.id);
    expect(controller.getSnapshot().error).toBe('offline');
    failRead = false;
    expect(await controller.trash({ id: item.id })).toBe(false);
    expect(controller.getSnapshot().error).toBe('denied');
    failWrite = false;
    expect(await controller.trash({ id: item.id })).toBe(true);
    expect(controller.getSnapshot().error).toBeNull();
  });
  it('serializes provider writes and preserves the previous list on an unreachable read', async () => {
    const memory = createMemoryMediaProviders({
      providers: [{ id: 'example', label: 'Example', configured: false }],
    });
    let unavailable = false;
    const controller = createProvidersController({
      api: {
        ...memory,
        list: (options) => (unavailable ? Promise.resolve(null) : memory.list(options)),
      },
    });
    await controller.load();
    expect(await controller.save({ id: 'example', credential: 'secret' })).toBe(true);
    expect(controller.getSnapshot().items).toEqual([
      { id: 'example', label: 'Example', configured: true },
    ]);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('secret');
    unavailable = true;
    await controller.load();
    expect(controller.getSnapshot().items[0]?.configured).toBe(true);
    expect(controller.getSnapshot().error).toBe('Provider service unavailable');
    controller.dispose();
  });
});
