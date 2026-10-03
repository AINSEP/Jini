// Unit coverage for the external media cache + SSRF guard (./asset-cache.ts).
//
// The load-bearing risk is SSRF: a same-origin route fetches a
// caller-supplied URL, so these tests pin that private/loopback/link-local
// hosts are refused, that only http(s) media URLs are accepted, and that the
// disk cache fetches once then replays (including concurrent de-duplication).

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetCacheError,
  assertSafePublicUrl,
  assetCacheKey,
  assetCacheRewriteUrl,
  createAssetCache,
  createValidatingLookup,
  isCacheableExternalUrl,
} from '../asset-cache.js';

describe('isCacheableExternalUrl', () => {
  it('accepts absolute http(s) media urls', () => {
    expect(isCacheableExternalUrl('https://res.cloudinary.com/x/portal_bg.png')).toBe(true);
    expect(isCacheableExternalUrl('http://images.example.com/a/b.jpg?v=2')).toBe(true);
    expect(isCacheableExternalUrl('https://d8j0.cloudfront.net/clip.mp4')).toBe(true);
    expect(isCacheableExternalUrl('https://cdn.example.com/a.webp#frag')).toBe(true);
  });

  it('rejects non-media, relative, data, and non-http urls', () => {
    expect(isCacheableExternalUrl('https://fonts.googleapis.com/css2?family=Inter')).toBe(false);
    expect(isCacheableExternalUrl('https://cdn.example.com/app.js')).toBe(false);
    expect(isCacheableExternalUrl('./hero.png')).toBe(false);
    expect(isCacheableExternalUrl('/api/asset-cache/x/hero.png')).toBe(false);
    expect(isCacheableExternalUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isCacheableExternalUrl(42)).toBe(false);
  });
});

describe('assetCacheRewriteUrl', () => {
  it('encodes the full url into the default same-origin proxy path', () => {
    expect(assetCacheRewriteUrl('https://res.cloudinary.com/x/a b.png')).toBe(
      '/api/asset-cache?url=https%3A%2F%2Fres.cloudinary.com%2Fx%2Fa%20b.png',
    );
  });

  it('honors a caller-supplied route path', () => {
    expect(assetCacheRewriteUrl('https://res.cloudinary.com/x/a.png', '/media-proxy')).toBe(
      '/media-proxy?url=https%3A%2F%2Fres.cloudinary.com%2Fx%2Fa.png',
    );
  });
});

describe('assertSafePublicUrl (up-front rejection)', () => {
  it('rejects unsupported schemes and embedded credentials', () => {
    expect(() => assertSafePublicUrl('ftp://host/x.png')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => assertSafePublicUrl('https://user:pass@host/x.png')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => assertSafePublicUrl('not a url')).toThrow(AssetCacheError);
  });

  it('rejects localhost and literal private IPs before any socket opens', () => {
    expect(() => assertSafePublicUrl('http://localhost/x.png')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => assertSafePublicUrl('http://127.0.0.1/x.png')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => assertSafePublicUrl('http://169.254.169.254/x.png')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    // IPv4-mapped IPv6 literal — the URL parser normalizes the bracketed host
    // to `::ffff:7f00:1`, which must still be rejected as loopback.
    expect(() => assertSafePublicUrl('http://[::ffff:127.0.0.1]/x.png')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('accepts a public host (DNS is validated later, at connection time)', () => {
    expect(assertSafePublicUrl('https://res.cloudinary.com/x/a.png').hostname).toBe('res.cloudinary.com');
  });
});

describe('createValidatingLookup (DNS-rebinding / TOCTOU guard)', () => {
  // The lookup the Agent actually connects through: whatever address it
  // resolves is the address that must pass, so a rebinding resolver cannot
  // hand a public IP to a pre-check and a private IP to the real fetch.
  function run(lookupImpl: (h: string, o: unknown, cb: (e: Error | null, a?: unknown, f?: number) => void) => void) {
    return new Promise<{ err: Error | null; address?: unknown }>((resolve) => {
      createValidatingLookup(lookupImpl as never)('host.example', { all: false }, (err, address) =>
        resolve({ err, address }),
      );
    });
  }

  it('passes a public resolved address through', async () => {
    const { err, address } = await run((_h, _o, cb) => cb(null, '93.184.216.34', 4));
    expect(err).toBeNull();
    expect(address).toBe('93.184.216.34');
  });

  it('rejects when the resolved address is private (the rebinding case)', async () => {
    const { err } = await run((_h, _o, cb) => cb(null, '169.254.169.254', 4));
    expect(err).toBeInstanceOf(AssetCacheError);
    expect((err as AssetCacheError).status).toBe(400);
  });

  it('rejects when any address in an all:true result is private', async () => {
    const { err } = await run((_h, _o, cb) =>
      cb(null, [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.9', family: 4 },
      ]),
    );
    expect(err).toBeInstanceOf(AssetCacheError);
  });

  it('accepts an all:true result whose entries are raw address strings (not {address} objects)', async () => {
    const { err, address } = await run((_h, _o, cb) => cb(null, ['93.184.216.34', '1.1.1.1']));
    expect(err).toBeNull();
    expect(address).toEqual(['93.184.216.34', '1.1.1.1']);
  });

  it('rejects when a raw-string entry in the list is private', async () => {
    const { err } = await run((_h, _o, cb) => cb(null, ['93.184.216.34', '127.0.0.1']));
    expect(err).toBeInstanceOf(AssetCacheError);
  });

  it('propagates a lookup error untouched', async () => {
    const boom = new Error('dns resolution failed');
    const { err } = await run((_h, _o, cb) => cb(boom));
    expect(err).toBe(boom);
  });

  it('supports the 2-arg dns.lookup call form (options omitted, callback in its place)', () => {
    return new Promise<void>((resolve) => {
      const lookupImpl = ((_h: string, _o: unknown, cb: (e: Error | null, a?: unknown, f?: number) => void) =>
        cb(null, '93.184.216.34', 4)) as never;
      const wrapped = createValidatingLookup(lookupImpl);
      // Real dns.lookup allows `lookup(hostname, callback)` — the wrapper
      // must detect the 2nd positional arg is itself the callback.
      (wrapped as unknown as (h: string, cb: (e: Error | null, a?: unknown) => void) => void)(
        'host.example',
        (err, address) => {
          expect(err).toBeNull();
          expect(address).toBe('93.184.216.34');
          resolve();
        },
      );
    });
  });

  it('defaults options to {} when called with options explicitly undefined', () => {
    return new Promise<void>((resolve) => {
      const lookupImpl = ((_h: string, opts: unknown, cb: (e: Error | null, a?: unknown, f?: number) => void) => {
        expect(opts).toEqual({});
        cb(null, '93.184.216.34', 4);
      }) as never;
      const wrapped = createValidatingLookup(lookupImpl);
      wrapped('host.example', undefined, (err) => {
        expect(err).toBeNull();
        resolve();
      });
    });
  });
});

describe('createAssetCache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'jini-asset-cache-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function pngResponse(bytes = 8): Response {
    return new Response(Buffer.alloc(bytes, 1), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(bytes) },
    });
  }

  it('fetches once, stores on disk, and replays from cache', async () => {
    let calls = 0;
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => {
        calls += 1;
        return pngResponse();
      }) as typeof fetch,
    });
    const url = 'https://res.cloudinary.com/x/portal_bg.png';
    const first = await cache.get(url);
    expect(first.contentType).toBe('image/png');
    expect(first.buf.byteLength).toBe(8);
    // On-disk blob exists under the sha256 key.
    const onDisk = await readFile(path.join(dir, assetCacheKey(url)));
    expect(onDisk.byteLength).toBe(8);
    // Second call is served from disk — no extra fetch.
    const second = await cache.get(url);
    expect(second.buf.byteLength).toBe(8);
    expect(calls).toBe(1);
  });

  it('de-duplicates concurrent requests for the same url', async () => {
    let calls = 0;
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return pngResponse();
      }) as typeof fetch,
    });
    const url = 'https://images.example.com/a/b.jpg';
    const [a, b] = await Promise.all([cache.get(url), cache.get(url)]);
    expect(a.buf.byteLength).toBe(8);
    expect(b.buf.byteLength).toBe(8);
    expect(calls).toBe(1);
  });

  it('derives content-type from the extension when the header is generic', async () => {
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () =>
        new Response(Buffer.alloc(4, 2), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        })) as typeof fetch,
    });
    const out = await cache.get('https://cdn.example.com/clip.mp4');
    expect(out.contentType).toBe('video/mp4');
  });

  it('rejects oversized assets (declared Content-Length)', async () => {
    const cache = createAssetCache({
      cacheDir: dir,
      maxBytes: 16,
      fetchImpl: (async () => pngResponse(1024)) as typeof fetch,
    });
    await expect(cache.get('https://res.cloudinary.com/x/big.png')).rejects.toMatchObject({ status: 413 });
  });

  it('stops reading a no-Content-Length body once it exceeds the cap (no full buffering)', async () => {
    let pulls = 0;
    // 100 chunks × 8 bytes = 800 bytes, streamed, with NO content-length.
    const stream = new ReadableStream<Uint8Array>({
      pull(controllerStream) {
        pulls += 1;
        if (pulls > 100) return controllerStream.close();
        controllerStream.enqueue(new Uint8Array(8).fill(7));
      },
    });
    const cache = createAssetCache({
      cacheDir: dir,
      maxBytes: 16, // two 8-byte chunks fit; the third must trip the cap
      fetchImpl: (async () =>
        new Response(stream, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch,
    });
    await expect(cache.get('https://res.cloudinary.com/x/stream.png')).rejects.toMatchObject({ status: 413 });
    // It must abort after a few chunks, NOT drain all 100 (no full buffering).
    expect(pulls).toBeLessThan(10);
  });

  it('refuses non-cacheable urls without fetching', async () => {
    let calls = 0;
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => {
        calls += 1;
        return pngResponse();
      }) as typeof fetch,
    });
    await expect(cache.get('https://cdn.example.com/app.js')).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(0);
  });

  it('refuses a literal private-IP url before fetching (SSRF up-front guard)', async () => {
    let calls = 0;
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => {
        calls += 1;
        return pngResponse();
      }) as typeof fetch,
    });
    // 169.254.169.254 is the cloud metadata endpoint — must never be fetched.
    await expect(cache.get('https://169.254.169.254/x.png')).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(0);
  });
  // DNS-rebinding (host that *resolves* to a private address) is covered by the
  // createValidatingLookup suite above — that guard runs at connection time,
  // inside the undici Agent, not through the injectable fetchImpl.

  it('reads a bodyless response (no stream) via arrayBuffer, capped at maxBytes', async () => {
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () =>
        new Response(null, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch,
    });
    const out = await cache.get('https://res.cloudinary.com/x/empty.png');
    expect(out.buf.byteLength).toBe(0);
  });

  it('rejects a bodyless response whose buffered size still exceeds maxBytes', async () => {
    // A real Response can't have a null `.body` AND non-empty arrayBuffer()
    // bytes, so this exercises the no-stream branch with a minimal duck-typed
    // stand-in — the same shape createAssetCache's injectable fetchImpl
    // already accepts instead of a native Response.
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'image/png' : null) },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(64),
    };
    const cache = createAssetCache({
      cacheDir: dir,
      maxBytes: 16,
      fetchImpl: (async () => fakeResponse) as unknown as typeof fetch,
    });
    await expect(cache.get('https://res.cloudinary.com/x/no-stream-big.png')).rejects.toMatchObject({ status: 413 });
  });

  it('swallows a reader.cancel() failure while aborting an oversized stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controllerStream) {
        controllerStream.enqueue(new Uint8Array(32).fill(9));
      },
      cancel() {
        throw new Error('cancel exploded');
      },
    });
    const cache = createAssetCache({
      cacheDir: dir,
      maxBytes: 8,
      fetchImpl: (async () =>
        new Response(stream, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch,
    });
    // Still surfaces the 413 — the failed cancel() must not mask it or throw
    // a different error out of the finally block.
    await expect(cache.get('https://res.cloudinary.com/x/cancel-fails.png')).rejects.toMatchObject({ status: 413 });
  });

  it('wraps a fetch rejection as a 502', async () => {
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as typeof fetch,
    });
    await expect(cache.get('https://res.cloudinary.com/x/unreachable.png')).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('network down'),
    });
  });

  it('wraps a non-Error fetch rejection as a 502, stringifying the thrown value', async () => {
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error, testing String(err)
        throw 'connection reset';
      }) as typeof fetch,
    });
    await expect(cache.get('https://res.cloudinary.com/x/non-error-throw.png')).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('connection reset'),
    });
  });

  it('falls back to global fetch when no fetchImpl is supplied', async () => {
    const fetchSpy = vi.fn(async () => pngResponse(4));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const cache = createAssetCache({ cacheDir: dir });
      const out = await cache.get('https://res.cloudinary.com/x/default-fetch.png');
      expect(out.buf.byteLength).toBe(4);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects with 415 when neither the header nor the URL pathname extension is a recognized media type', async () => {
    // isCacheableExternalUrl matches on the raw URL string (not just the
    // pathname), so a URL whose *query string* ends in a recognized
    // extension passes the up-front cacheability check even though its
    // pathname extension (what resolveContentType actually inspects) is not
    // itself recognized (and here, `?f=` keeps it off the exact `pathOnly`
    // match too) — a real, reachable mismatch, not synthetic.
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () =>
        new Response(Buffer.alloc(4), { status: 200, headers: { 'content-type': 'application/octet-stream' } })) as typeof fetch,
    });
    await expect(cache.get('https://cdn.example.com/render.php?f=photo.png')).rejects.toMatchObject({
      status: 415,
      message: expect.stringContaining('unsupported content-type'),
    });
  });

  it('rejects with 415 and an "unknown" placeholder when there is no content-type header at all either', async () => {
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => new Response(Buffer.alloc(4), { status: 200 })) as typeof fetch,
    });
    await expect(cache.get('https://cdn.example.com/render.php?f=photo.png')).rejects.toMatchObject({
      status: 415,
      message: expect.stringContaining('unsupported content-type: unknown'),
    });
  });

  it('derives content-type from the extension when there is no content-type header at all', async () => {
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => new Response(Buffer.alloc(4, 3), { status: 200 })) as typeof fetch,
    });
    const out = await cache.get('https://cdn.example.com/clip.webm');
    expect(out.contentType).toBe('video/webm');
  });

  it('falls back to application/octet-stream when a disk-cached sidecar has no usable contentType', async () => {
    const url = 'https://res.cloudinary.com/x/corrupt-meta.png';
    const key = assetCacheKey(url);
    await writeFile(path.join(dir, key), Buffer.alloc(4, 5));
    // A sidecar whose contentType is missing/non-string — readFromDisk must
    // still succeed, replaying with the generic fallback content-type.
    await writeFile(path.join(dir, `${key}.json`), JSON.stringify({ contentType: 42 }));
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => {
        throw new Error('must not fetch — should replay from disk');
      }) as typeof fetch,
    });
    const out = await cache.get(url);
    expect(out.contentType).toBe('application/octet-stream');
    expect(out.buf.byteLength).toBe(4);
  });

  it('skips a falsy (undefined) chunk from the reader without treating it as data', async () => {
    let reads = 0;
    const fakeBody = {
      getReader: () => ({
        read: async () => {
          reads += 1;
          if (reads === 1) return { done: false, value: undefined };
          if (reads === 2) return { done: false, value: new Uint8Array(4).fill(6) };
          return { done: true, value: undefined };
        },
        cancel: async () => {},
      }),
    };
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'image/png' : null) },
      body: fakeBody,
    };
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => fakeResponse) as unknown as typeof fetch,
    });
    const out = await cache.get('https://res.cloudinary.com/x/undefined-chunk.png');
    expect(out.buf.byteLength).toBe(4);
  });

  it('rejects a non-OK upstream response as a 502', async () => {
    const cache = createAssetCache({
      cacheDir: dir,
      fetchImpl: (async () => new Response('nope', { status: 404 })) as typeof fetch,
    });
    await expect(cache.get('https://res.cloudinary.com/x/missing.png')).rejects.toMatchObject({ status: 502 });
  });

  it('serves from memory when the disk write fails (cacheDir is not a usable directory)', async () => {
    // cacheDir already exists as a plain FILE, so mkdir(cacheDir) inside
    // writeToDisk fails — the fetch must still succeed from memory.
    const fileAsCacheDir = path.join(dir, 'cache-dir-is-actually-a-file');
    await writeFile(fileAsCacheDir, 'not a directory');
    const cache = createAssetCache({
      cacheDir: fileAsCacheDir,
      fetchImpl: (async () => pngResponse(4)) as typeof fetch,
    });
    const out = await cache.get('https://res.cloudinary.com/x/write-fails.png');
    expect(out.buf.byteLength).toBe(4);
  });
});
