import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, MockAgent, type Dispatcher } from 'undici';
import { expect, it, vi } from 'vitest';
import { createAssetCache, createAssetCacheDispatcher } from '../asset-cache.js';

it('returns fetched media even when its cache directory cannot be created', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jini-unwritable-cache-'));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'file'), 'block directory creation');
  const dispatcher = new MockAgent();
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([7, 8]), { headers: { 'content-type': 'image/png' } }));
  const cache = createAssetCache({ cacheDir: join(dir, 'file', 'cache'), fetchImpl }, { dispatcher });
  try {
    expect(await cache.get('https://assets.example.test/image.png')).toEqual({ buf: Buffer.from([7, 8]), contentType: 'image/png' });
    expect(await cache.get('https://assets.example.test/image.png')).toEqual({ buf: Buffer.from([7, 8]), contentType: 'image/png' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  } finally { await cache.close?.(); await dispatcher.close(); await rm(dir, { recursive: true, force: true }); }
});

// hwb #24: source data is served by the fake fetch; no socket opens.
it('forwards the host dispatcher while retaining URL rejection and host ownership', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hwb-assets-')); const dispatcher = new MockAgent();
  const closeSpy = vi.spyOn(dispatcher, 'close');
  let actual: unknown; let calls = 0;
  const cache = createAssetCache({ cacheDir: dir, fetchImpl: async (_url, init) => { calls++; actual = Reflect.get(init!, 'dispatcher'); return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }); } }, { dispatcher });
  try {
    expect(await cache.get('https://example.test/image.png')).toEqual({ buf: Buffer.from([1, 2, 3]), contentType: 'image/png' });
    expect(actual).toBe(dispatcher);
    await expect(cache.get('https://127.0.0.1/image.png')).rejects.toThrow('url points at a private address');
    expect(calls).toBe(1);
    await cache.close?.();
    expect(closeSpy).not.toHaveBeenCalled();
  } finally { await dispatcher.close(); await rm(dir, { recursive: true, force: true }); }
});

it('creates a synchronous real dispatcher that rejects private DNS answers at connection time', async () => {
  let lookups = 0;
  const lookupImpl = ((_hostname: string, _options: unknown,
    callback: (error: Error | null, address: string, family: number) => void) => {
    lookups++;
    callback(null, '127.0.0.1', 4);
  }) as unknown as typeof import('node:dns').lookup;
  const dispatcher = createAssetCacheDispatcher({}, { lookupImpl });
  try {
    expect(dispatcher).toBeInstanceOf(Agent);
    await expect(dispatcher.request({ origin: 'http://assets.example.test', path: '/image.png', method: 'GET' }))
      .rejects.toMatchObject({ name: 'AssetCacheError', status: 400, message: 'host resolves to a private address' });
    expect(lookups).toBe(1);
  } finally { await dispatcher.close(); }
});

it('closes the lazily created dispatcher owned by the cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jini-owned-assets-'));
  let dispatcher: Dispatcher | undefined;
  let closed = false;
  const cache = createAssetCache({ cacheDir: dir, fetchImpl: async (_url, init) => {
    dispatcher = Reflect.get(init!, 'dispatcher') as unknown as Dispatcher;
    return new Response(new Uint8Array([4, 5, 6]), { headers: { 'content-type': 'image/png' } });
  } });
  try {
    expect(await cache.get('https://assets.example.test/image.png'))
      .toEqual({ buf: Buffer.from([4, 5, 6]), contentType: 'image/png' });
    expect(dispatcher).toBeInstanceOf(Agent);
    expect((dispatcher as Agent).closed).toBe(false);
    await cache.close?.();
    closed = true;
    expect((dispatcher as Agent).closed).toBe(true);
  } finally {
    if (!closed) await cache.close?.();
    await rm(dir, { recursive: true, force: true });
  }
});
