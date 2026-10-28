// Boundary pins for ./asset-cache.ts: every refusal's status + exact message,
// the size-limit edges (exactly maxBytes passes, maxBytes + 1 is refused) on
// all three read paths, and the cache-key containment guarantee. Written green
// against the pre-refactor code so the refactor is provably behaviour-neutral.

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AssetCacheError,
  assertSafePublicUrl,
  assetCacheKey,
  createAssetCache,
  createValidatingLookup,
  isCacheableExternalUrl,
} from '../asset-cache.js';

type LookupCallback = (err: Error | null, address?: unknown, family?: number) => void;

function refusal(fn: () => unknown): AssetCacheError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AssetCacheError) return error;
    throw error;
  }
  throw new Error('expected an AssetCacheError');
}

describe('assertSafePublicUrl refusals (status + message)', () => {
  it.each([
    ['not a url', 'invalid url'],
    ['ftp://host/x.png', 'unsupported url scheme'],
    ['file:///etc/passwd.png', 'unsupported url scheme'],
    ['https://user@host.example/x.png', 'url credentials are not allowed'],
    ['https://:secret@host.example/x.png', 'url credentials are not allowed'],
    ['http://localhost/x.png', 'localhost is not allowed'],
    ['http://LOCALHOST/x.png', 'localhost is not allowed'],
    ['http://cdn.localhost/x.png', 'localhost is not allowed'],
    ['http://127.0.0.1/x.png', 'url points at a private address'],
    ['http://10.1.2.3/x.png', 'url points at a private address'],
    ['http://[::1]/x.png', 'url points at a private address'],
    ['http://[::ffff:127.0.0.1]/x.png', 'url points at a private address'],
  ])('refuses %s with 400 "%s"', (raw, message) => {
    const error = refusal(() => assertSafePublicUrl(raw));
    expect(error.status).toBe(400);
    expect(error.message).toBe(message);
    expect(error.name).toBe('AssetCacheError');
  });

  it('accepts a public IPv4 literal', () => {
    expect(assertSafePublicUrl('http://93.184.216.34/x.png').hostname).toBe('93.184.216.34');
  });

  it('accepts a public IPv6 literal (brackets are stripped before the private check)', () => {
    expect(assertSafePublicUrl('http://[2606:4700::1111]/x.png').hostname).toBe('[2606:4700::1111]');
  });

  it('does not treat a host that merely contains "localhost" as localhost', () => {
    expect(assertSafePublicUrl('http://notlocalhost.example/x.png').hostname).toBe('notlocalhost.example');
  });
});

describe('isCacheableExternalUrl edges', () => {
  it('accepts an uppercase scheme and extension, and trims whitespace', () => {
    expect(isCacheableExternalUrl('  HTTPS://cdn.example.com/A.PNG  ')).toBe(true);
  });

  it('rejects an extension that only appears mid-path', () => {
    expect(isCacheableExternalUrl('https://cdn.example.com/a.png/evil')).toBe(false);
  });
});

describe('createValidatingLookup refusal', () => {
  it('refuses a private answer with 400 "host resolves to a private address" and never returns the address', async () => {
    const lookupImpl = ((_h: string, _o: unknown, cb: LookupCallback) => cb(null, '::1', 6)) as never;
    const result = await new Promise<{ err: Error | null; address: unknown }>((resolve) => {
      createValidatingLookup(lookupImpl)('host.example', {}, (err, address) => resolve({ err, address }));
    });
    expect(result.err).toBeInstanceOf(AssetCacheError);
    expect((result.err as AssetCacheError).status).toBe(400);
    expect(result.err?.message).toBe('host resolves to a private address');
    expect(result.address).toBeUndefined();
  });

  it('forwards the caller options object to the resolver unchanged', async () => {
    let seen: unknown;
    const lookupImpl = ((_h: string, opts: unknown, cb: LookupCallback) => {
      seen = opts;
      cb(null, '93.184.216.34', 4);
    }) as never;
    const options = { all: true, family: 4 };
    await new Promise<void>((resolve) => {
      createValidatingLookup(lookupImpl)('host.example', options, () => resolve());
    });
    expect(seen).toBe(options);
  });

  it('passes the resolved family through on success', async () => {
    const lookupImpl = ((_h: string, _o: unknown, cb: LookupCallback) => cb(null, '93.184.216.34', 4)) as never;
    const family = await new Promise<number | undefined>((resolve) => {
      createValidatingLookup(lookupImpl)('host.example', {}, (_err, _address, fam) => resolve(fam));
    });
    expect(family).toBe(4);
  });
});

describe('assetCacheKey containment', () => {
  it.each([
    'https://cdn.example.com/../../etc/passwd.png',
    'https://cdn.example.com/..\\..\\windows\\system32\\a.png',
    'https://cdn.example.com/C:\\Windows\\a.png',
  ])('maps %s to a 64-char lowercase hex key (no separators, no drive letter)', (url) => {
    expect(assetCacheKey(url)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('trims before hashing, so padded and bare urls share a key', () => {
    expect(assetCacheKey('  https://cdn.example.com/a.png\n')).toBe(assetCacheKey('https://cdn.example.com/a.png'));
  });
});

describe('createAssetCache boundaries', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'jini-asset-bounds-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function cacheWith(fetchImpl: typeof fetch, maxBytes = 16, extra: { fetchTimeoutMs?: number } = {}) {
    return createAssetCache({ cacheDir: dir, maxBytes, fetchImpl, ...extra });
  }

  function streamOf(chunks: number[]): ReadableStream<Uint8Array> {
    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        const size = chunks[index++];
        if (size === undefined) return controller.close();
        controller.enqueue(new Uint8Array(size).fill(1));
      },
    });
  }

  it('refuses a non-cacheable url with 400 "url is not a cacheable external media url"', async () => {
    const cache = cacheWith(async () => new Response(null));
    await expect(cache.get('https://cdn.example.com/app.js')).rejects.toMatchObject({
      name: 'AssetCacheError',
      status: 400,
      message: 'url is not a cacheable external media url',
    });
  });

  it('refuses a non-string url with the same 400', async () => {
    const cache = cacheWith(async () => new Response(null));
    await expect(cache.get(42 as never)).rejects.toMatchObject({
      status: 400,
      message: 'url is not a cacheable external media url',
    });
  });

  it('refuses a localhost media url with 400 "localhost is not allowed" before fetching', async () => {
    let calls = 0;
    const cache = cacheWith(async () => {
      calls += 1;
      return new Response(null);
    });
    await expect(cache.get('http://localhost/x.png')).rejects.toMatchObject({
      status: 400,
      message: 'localhost is not allowed',
    });
    expect(calls).toBe(0);
  });

  it('refuses a non-OK upstream with 502 "upstream responded <status>"', async () => {
    const cache = cacheWith(async () => new Response('gone', { status: 410 }));
    await expect(cache.get('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 502,
      message: 'upstream responded 410',
    });
  });

  it('wraps a fetch rejection as 502 "fetch failed: <message>"', async () => {
    const cache = cacheWith(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(cache.get('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 502,
      message: 'fetch failed: ECONNRESET',
    });
  });

  it('requests with redirect:"error", an AbortSignal, and the given URL object', async () => {
    let seenInit: RequestInit | undefined;
    let seenUrl: unknown;
    const cache = cacheWith(async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return new Response(new Uint8Array(1), { headers: { 'content-type': 'image/png' } });
    });
    await cache.get('https://cdn.example.com/a.png');
    expect(seenInit?.redirect).toBe('error');
    expect(seenInit?.signal).toBeInstanceOf(AbortSignal);
    expect(seenUrl).toBeInstanceOf(URL);
    expect(String(seenUrl)).toBe('https://cdn.example.com/a.png');
  });

  it('aborts the fetch after fetchTimeoutMs and surfaces 502 "fetch failed: ..."', async () => {
    const cache = cacheWith(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')));
        }),
      16,
      { fetchTimeoutMs: 5 },
    );
    await expect(cache.get('https://cdn.example.com/slow.png')).rejects.toMatchObject({
      status: 502,
      message: 'fetch failed: aborted by timeout',
    });
  });

  it('accepts a declared Content-Length of exactly maxBytes', async () => {
    const cache = cacheWith(
      async () => new Response(new Uint8Array(16), { headers: { 'content-type': 'image/png', 'content-length': '16' } }),
    );
    expect((await cache.get('https://cdn.example.com/a.png')).buf.byteLength).toBe(16);
  });

  it('refuses a declared Content-Length of maxBytes + 1 with 413 "asset exceeds size limit" before reading', async () => {
    let read = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        read = true;
        controller.close();
      },
    }, { highWaterMark: 0 }); // pull only on an actual read
    const cache = cacheWith(
      async () => new Response(body, { headers: { 'content-type': 'image/png', 'content-length': '17' } }),
    );
    await expect(cache.get('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 413,
      message: 'asset exceeds size limit',
    });
    expect(read).toBe(false);
  });

  it('ignores a non-numeric Content-Length and falls through to the streamed cap', async () => {
    const cache = cacheWith(
      async () =>
        new Response(streamOf([8, 8]), { headers: { 'content-type': 'image/png', 'content-length': 'lots' } }),
    );
    expect((await cache.get('https://cdn.example.com/a.png')).buf.byteLength).toBe(16);
  });

  it('accepts a streamed body totalling exactly maxBytes across chunks', async () => {
    const cache = cacheWith(async () => new Response(streamOf([10, 6]), { headers: { 'content-type': 'image/png' } }));
    const out = await cache.get('https://cdn.example.com/a.png');
    expect(out.buf.byteLength).toBe(16);
  });

  it('refuses a streamed body totalling maxBytes + 1 with 413 "asset exceeds size limit"', async () => {
    const cache = cacheWith(async () => new Response(streamOf([10, 7]), { headers: { 'content-type': 'image/png' } }));
    await expect(cache.get('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 413,
      message: 'asset exceeds size limit',
    });
  });

  it('aborts the request signal when the streamed cap trips', async () => {
    let signal: AbortSignal | undefined;
    const cache = cacheWith(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Response(streamOf([17]), { headers: { 'content-type': 'image/png' } });
    });
    await expect(cache.get('https://cdn.example.com/a.png')).rejects.toMatchObject({ status: 413 });
    expect(signal?.aborted).toBe(true);
  });

  it('does not write anything to disk when the size cap trips', async () => {
    const cache = cacheWith(async () => new Response(streamOf([17]), { headers: { 'content-type': 'image/png' } }));
    await expect(cache.get('https://cdn.example.com/a.png')).rejects.toMatchObject({ status: 413 });
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses an unsupported content-type with 415 naming the header value', async () => {
    const cache = cacheWith(
      async () => new Response(new Uint8Array(1), { headers: { 'content-type': 'Text/HTML; charset=utf-8' } }),
    );
    // 6cb09d281 deliberately admits only media pathnames; reach the upstream MIME check.
    await expect(cache.get('https://cdn.example.com/a.png')).rejects.toMatchObject({
      status: 415,
      message: 'unsupported content-type: text/html',
    });
  });

  it('normalises a media content-type header (drops parameters, lowercases)', async () => {
    const cache = cacheWith(
      async () => new Response(new Uint8Array(1), { headers: { 'content-type': 'Image/PNG; q=1' } }),
    );
    expect((await cache.get('https://cdn.example.com/a.png')).contentType).toBe('image/png');
  });

  it('guesses from an uppercase pathname extension', async () => {
    const cache = cacheWith(async () => new Response(new Uint8Array(1)));
    expect((await cache.get('https://cdn.example.com/A.JPEG')).contentType).toBe('image/jpeg');
  });

  it('persists blob + sidecar under the sha256 key, with no stray tmp file', async () => {
    const cache = cacheWith(async () => new Response(new Uint8Array(3), { headers: { 'content-type': 'image/gif' } }));
    const url = 'https://cdn.example.com/a.gif';
    await cache.get(url);
    const key = assetCacheKey(url);
    expect((await readdir(dir)).sort()).toEqual([key, `${key}.json`].sort());
  });

  it('keys a whitespace-padded url the same as the bare url (replays from disk)', async () => {
    let calls = 0;
    const cache = cacheWith(async () => {
      calls += 1;
      return new Response(new Uint8Array(2), { headers: { 'content-type': 'image/png' } });
    });
    await cache.get('https://cdn.example.com/a.png');
    await cache.get('  https://cdn.example.com/a.png  ');
    expect(calls).toBe(1);
  });

  it('clears the in-flight entry after a failure so the next call fetches again', async () => {
    let calls = 0;
    const cache = cacheWith(async () => {
      calls += 1;
      return calls === 1
        ? new Response('x', { status: 500 })
        : new Response(new Uint8Array(2), { headers: { 'content-type': 'image/png' } });
    });
    await expect(cache.get('https://cdn.example.com/a.png')).rejects.toMatchObject({ status: 502 });
    expect((await cache.get('https://cdn.example.com/a.png')).buf.byteLength).toBe(2);
    expect(calls).toBe(2);
  });
});
