import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent } from 'undici';
import { expect, it, vi } from 'vitest';
import { createAssetCache } from '../asset-cache.js';

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
