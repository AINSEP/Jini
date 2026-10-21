import { describe, expect, it, vi } from 'vitest';
import { createHttpMediaApi, type MediaTransportPort } from '../adapters/http.js';
import { createMemoryMediaApi, createMemoryMediaProviders } from '../adapters/memory.js';
import { runMediaApiConformance } from '../conformance/media-api.conformance.js';
import { createEditMediaController } from '../controllers/edit-media.controller.js';
import { createProvidersController } from '../controllers/providers.controller.js';
import type { MediaApiPort, MediaProvidersPort } from '../ports.js';
import type { MediaAsset, MediaProvider } from '../models.js';

const input = { filename: 'image.png', contentType: 'image/png', dataBase64: 'aGVsbG8=' };
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

describe('media HTTP adapter writes', () => {
  function recording() {
    const calls: unknown[] = [];
    const asset = { id: 'a/b', filename: 'a.png' } as unknown as MediaAsset;
    const transport: MediaTransportPort = {
      async request<T>(required: Parameters<MediaTransportPort['request']>[0], optional: Parameters<MediaTransportPort['request']>[1]) {
        calls.push([required, optional]);
        return (required.method === 'DELETE' ? { purged: true } : { media: asset }) as T;
      },
      url: ({ path }) => `/api${path}`,
    };
    return { calls, api: createHttpMediaApi({ transport, basePath: '/m/' }) };
  }

  it('uploads with metadata in the body and the signal only in the request options', async () => {
    const { calls, api } = recording();
    const abort = new AbortController();
    await api.upload(input, { alt: 'Alt', signal: abort.signal });
    await api.upload(input);
    expect(calls).toEqual([
      [{ path: '/m', method: 'POST', body: { ...input, alt: 'Alt' } }, { signal: abort.signal }],
      [{ path: '/m', method: 'POST', body: input }, {}],
    ]);
  });

  it('trashes and purges by encoded id, refusing an aborted purge before any request', async () => {
    const { calls, api } = recording();
    expect((await api.trash({ id: 'a/b' })).id).toBe('a/b');
    expect(await api.delete({ id: 'a/b' })).toEqual({ purged: true });
    const abort = new AbortController(); abort.abort();
    expect(() => api.delete({ id: 'a/b' }, { signal: abort.signal })).toThrow(/abort/i);
    expect(calls).toEqual([
      [{ path: '/m/a%2Fb/trash', method: 'POST' }, {}],
      [{ path: '/m/a%2Fb', method: 'DELETE' }, {}],
    ]);
  });

  it('versions the original URL so replaced bytes get a fresh address', () => {
    const { api } = recording();
    expect(api.originalUrl({ id: 'a/b' })).toBe('/api/m/a%2Fb/original');
    expect(api.originalUrl({ id: 'a/b', version: 7 })).toBe('/api/m/a%2Fb/original?v=7');
  });
});

describe('media conformance failures', () => {
  it('names the first broken contract and still cleans up the uploaded asset', async () => {
    const memory = createMemoryMediaApi({});
    const ignoresAbort: MediaApiPort = { ...memory, list: (query) => memory.list(query) };
    await expect(runMediaApiConformance({ api: ignoresAbort })).rejects.toThrow('Media API conformance: aborted list rejects');
    expect(await memory.list({})).toEqual([]);
  });

  it('accepts a replace method the host has marked unsupported', async () => {
    const memory = createMemoryMediaApi({});
    const checks = await runMediaApiConformance({ api: { ...memory, replace: vi.fn(), replaceSupported: false } });
    expect(checks).toContain('replacement is optional and unavailable');
  });
});

describe('edit media controller guards', () => {
  async function fixture(update?: MediaApiPort['update']) {
    const api = createMemoryMediaApi({});
    const item = await api.upload(input);
    return { api, item, edit: createEditMediaController({ api: update ? { ...api, update } : api, item }) };
  }

  it('refuses a second save while one is in flight', async () => {
    const gate = deferred<MediaAsset>();
    const { item, edit } = await fixture(() => gate.promise);
    edit.setDraft({ patch: { title: 'one' } });
    const first = edit.save();
    expect(await edit.save()).toBe(false);
    gate.resolve({ ...item, title: 'one' });
    expect(await first).toBe(true);
  });

  it('drops a save that resolves after dispose', async () => {
    const gate = deferred<MediaAsset>();
    const { item, edit } = await fixture(() => gate.promise);
    edit.setDraft({ patch: { title: 'late' } });
    const saving = edit.save();
    edit.dispose();
    gate.resolve({ ...item, title: 'late' });
    expect(await saving).toBe(false);
  });

  it('refuses to save after dispose and reports non-Error failures with fallback copy', async () => {
    const { edit } = await fixture(async () => { throw 'offline'; });
    edit.setDraft({ patch: { title: 'x' } });
    expect(await edit.save()).toBe(false);
    expect(edit.getSnapshot()).toMatchObject({ saving: false, error: 'Failed to save media metadata' });
    edit.dispose();
    expect(await edit.save()).toBe(false);
  });
});

describe('providers controller', () => {
  const provider: MediaProvider = { id: 'p1', label: 'Provider', configured: false };
  function withProviders(overrides: Partial<MediaProvidersPort> = {}) {
    const api = { ...createMemoryMediaProviders({ providers: [provider] }), ...overrides };
    return { api, controller: createProvidersController({ api }) };
  }

  it('removes a credential and reloads the list', async () => {
    const removeCredential = vi.fn(async () => provider);
    const { controller } = withProviders({ removeCredential });
    expect(await controller.remove({ id: 'p1' })).toBe(true);
    expect(removeCredential).toHaveBeenCalledWith({ id: 'p1' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(controller.getSnapshot().items).toEqual([provider]);
  });

  it('reports a failed credential write and refuses settings the host cannot store', async () => {
    const { saveSettings: _unsupported, ...memory } = createMemoryMediaProviders({ providers: [provider] });
    const controller = createProvidersController({ api: { ...memory, saveCredential: async () => { throw new Error('denied'); } } });
    expect(await controller.save({ id: 'p1', credential: 'value' })).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ saving: false, error: 'Failed to save provider credentials' });
    expect(await controller.saveSettings({ id: 'p1', baseUrl: 'https://x.test', model: 'm' })).toBe(false);
  });

  it('refuses a concurrent write and drops a write that lands after dispose', async () => {
    const gate = deferred<MediaProvider>();
    const { controller } = withProviders({ saveCredential: () => gate.promise });
    const first = controller.save({ id: 'p1', credential: 'one' });
    expect(await controller.save({ id: 'p1', credential: 'two' })).toBe(false);
    controller.dispose();
    gate.resolve(provider);
    expect(await first).toBe(false);
    await controller.load();
    expect(controller.getSnapshot().loading).toBe(false);
    expect(await controller.remove({ id: 'p1' })).toBe(false);
  });
});
