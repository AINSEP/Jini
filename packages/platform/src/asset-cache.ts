// Local disk cache + same-origin proxy for external images/videos referenced
// by sandboxed HTML (an iframe preview, an embedded document, etc.) that a
// host application renders on cross-origin CDNs.
//
// Two problems this solves for that sandboxed content:
//   1. A CSP like `img-src 'self' data: blob:; media-src 'self' ...` blocks
//      absolute third-party URLs outright inside the sandbox.
//   2. Even when reachable, those hosts have no nearby edge for many users,
//      so each render re-pays multi-second cross-border latency per asset.
//
// A caller rewrites matching URLs (via `assetCacheRewriteUrl`) to a
// same-origin route it serves from this cache: fetched once, validated,
// stored content-addressably on disk, and replayed instantly afterwards.
//
// SSRF is the load-bearing risk here: the route fetches a caller-supplied URL.
// `assertSafePublicUrl` rejects non-http(s) schemes, embedded credentials,
// localhost, and literal private IPs up-front. The authoritative guard against
// DNS rebinding / TOCTOU is `createValidatingLookup`: it is installed as the
// undici Agent's connection-time `lookup`, so the address that is *validated*
// is the exact address the socket *connects to* — there is no separate
// validation lookup a rebinding resolver could diverge from.

import { createHash } from 'node:crypto';
import { lookup as dnsLookupCb } from 'node:dns';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isIP, type LookupFunction } from 'node:net';
import path from 'node:path';

import { Agent } from 'undici';
import { isPrivateAddress } from './net/address.js';

/** Media extensions we are willing to cache + proxy. Anything else (HTML,
 *  CSS, JS, fonts) is intentionally left alone so this surface never becomes a
 *  general-purpose open proxy. */
export const CACHEABLE_MEDIA_EXT =
  /\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|m4v|ogg|mp3|wav)(?:$|[?#])/i;

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** True when `raw` is an absolute http(s) URL pointing at a media file we are
 *  willing to route through the cache. Pure + side-effect free so the URL
 *  rewriter and tests can share the exact predicate. */
export function isCacheableExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) return false;
  // `String#split` always returns a non-empty array (even `''.split(x)` is
  // `['']`), so index 0 is never `undefined` — the `!` narrows a
  // `noUncheckedIndexedAccess` false positive, not a real fallback path.
  const pathOnly = value.split(/[?#]/)[0]!;
  return CACHEABLE_MEDIA_EXT.test(pathOnly) || CACHEABLE_MEDIA_EXT.test(value);
}

/** Map a cacheable external URL to its same-origin proxy URL. `routePath`
 *  defaults to `/api/asset-cache` but is caller-configurable since the route
 *  is mounted by the host application, not this package. */
export function assetCacheRewriteUrl(raw: string, routePath = '/api/asset-cache'): string {
  return `${routePath}?url=${encodeURIComponent(raw.trim())}`;
}

/** Error carrying the HTTP status the route should surface. */
export class AssetCacheError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AssetCacheError';
    this.status = status;
  }
}

/** Cheap up-front rejection: enforce http(s), no embedded credentials, no
 *  localhost, and no *literal* private IP. This is NOT the DNS-rebinding guard
 *  (that is `createValidatingLookup`, applied at connection time) — it only
 *  fast-fails the obvious cases before any socket is opened. */
export function assertSafePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AssetCacheError(400, 'invalid url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AssetCacheError(400, 'unsupported url scheme');
  }
  if (url.username || url.password) {
    throw new AssetCacheError(400, 'url credentials are not allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const lowerHost = host.toLowerCase();
  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost')) {
    throw new AssetCacheError(400, 'localhost is not allowed');
  }
  if (isIP(host) && isPrivateAddress({ address: host })) {
    throw new AssetCacheError(400, 'url points at a private address');
  }
  return url;
}

type DnsLookupCb = typeof dnsLookupCb;

/** Wrap a `dns.lookup`-shaped resolver so the resolved address is rejected when
 *  it is private. Installed as the undici Agent's connection-time `lookup`, so
 *  the validated address IS the one the socket connects to — closing the
 *  DNS-rebinding / TOCTOU gap a separate pre-validation lookup would leave open.
 *  Exported so the guard can be unit-tested without standing up a server. */
export function createValidatingLookup(lookupImpl: DnsLookupCb = dnsLookupCb) {
  return function validatingLookup(
    hostname: string,
    options: unknown,
    callback?: (err: Error | null, address?: unknown, family?: number) => void,
  ): void {
    const cb = (typeof options === 'function' ? options : callback) as (
      err: Error | null,
      address?: unknown,
      family?: number,
    ) => void;
    const opts = (typeof options === 'function' ? {} : (options ?? {})) as Record<string, unknown>;
    (lookupImpl as unknown as (h: string, o: unknown, c: (e: Error | null, a?: unknown, f?: number) => void) => void)(
      hostname,
      opts,
      (err, address, family) => {
        if (err) return cb(err);
        const list = Array.isArray(address) ? address : [{ address, family }];
        for (const entry of list) {
          const addr = typeof entry === 'string' ? entry : (entry as { address: string }).address;
          if (isPrivateAddress({ address: addr })) {
            return cb(new AssetCacheError(400, 'host resolves to a private address'));
          }
        }
        return cb(null, address, family);
      },
    );
  };
}

export interface AssetCacheResult {
  buf: Buffer;
  contentType: string;
}

export interface AssetCacheOptions {
  /** Directory the cache writes content-addressed blobs into. */
  cacheDir: string;
  /** Hard ceiling on a single asset's size. Default 64 MiB. */
  maxBytes?: number;
  /** Per-fetch timeout. Default 15s. */
  fetchTimeoutMs?: number;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable `dns.lookup` for the connection-time SSRF guard (tests). */
  lookupImpl?: DnsLookupCb;
}

export interface AssetCache {
  get(rawUrl: string): Promise<AssetCacheResult>;
}

/** Build a disk-backed cache for external sandboxed-content media. Concurrent
 *  requests for the same URL share one in-flight fetch; completed fetches
 *  persist to `<cacheDir>/<sha256>` (+ `.json` sidecar) and are replayed from
 *  disk. */
export function createAssetCache(opts: AssetCacheOptions): AssetCache {
  const cacheDir = opts.cacheDir;
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
  const timeoutMs = opts.fetchTimeoutMs ?? 15_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Pin SSRF validation to the actual outbound connection: the Agent resolves
  // the host once, and `validatingLookup` rejects the connection if that exact
  // address is private. No separate pre-validation lookup to rebind around.
  const dispatcher = new Agent({
    connect: { lookup: createValidatingLookup(opts.lookupImpl) as unknown as LookupFunction },
  });
  const inflight = new Map<string, Promise<AssetCacheResult>>();

  function keyFor(rawUrl: string): string {
    return createHash('sha256').update(rawUrl).digest('hex');
  }

  async function readFromDisk(key: string): Promise<AssetCacheResult | null> {
    const blobPath = path.join(cacheDir, key);
    const metaPath = `${blobPath}.json`;
    try {
      const [buf, metaRaw] = await Promise.all([readFile(blobPath), readFile(metaPath, 'utf8')]);
      const meta = JSON.parse(metaRaw) as { contentType?: unknown };
      const contentType =
        typeof meta.contentType === 'string' && meta.contentType ? meta.contentType : 'application/octet-stream';
      return { buf, contentType };
    } catch {
      return null;
    }
  }

  async function writeToDisk(key: string, result: AssetCacheResult): Promise<void> {
    await mkdir(cacheDir, { recursive: true });
    const blobPath = path.join(cacheDir, key);
    const tmpPath = `${blobPath}.${process.pid}.tmp`;
    await writeFile(tmpPath, result.buf);
    await rename(tmpPath, blobPath);
    await writeFile(`${blobPath}.json`, JSON.stringify({ contentType: result.contentType }));
  }

  function resolveContentType(headerValue: string | null, url: URL): string {
    // `(headerValue ?? '')` is reachable (no content-type header at all). The
    // trailing `?? ''` after the optional-chained `.split(';')[0]?.trim()` is
    // not: `String#split` always returns a non-empty array, so `[0]` is never
    // `undefined` and `?.` never short-circuits — kept for
    // `noUncheckedIndexedAccess`, not a real fallback path.
    const header = (headerValue ?? '').split(';')[0]!.trim().toLowerCase();
    if (/^(?:image|video|audio)\//.test(header)) return header;
    const ext = path.posix.extname(url.pathname).toLowerCase();
    const guessed = EXT_TO_MIME[ext];
    if (guessed) return guessed;
    throw new AssetCacheError(415, `unsupported content-type: ${header || 'unknown'}`);
  }

  /** Drain the body, aborting the moment the accumulated size exceeds
   *  `maxBytes`. A response without a trustworthy Content-Length must never be
   *  fully buffered first — that would turn this caller-supplied proxy into a
   *  memory-exhaustion path. */
  async function readBodyCapped(response: Response, controller: AbortController): Promise<Buffer> {
    const body = response.body;
    if (!body) {
      const ab = await response.arrayBuffer();
      if (ab.byteLength > maxBytes) throw new AssetCacheError(413, 'asset exceeds size limit');
      return Buffer.from(ab);
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort(); // stop pulling more bytes from upstream
          throw new AssetCacheError(413, 'asset exceeds size limit');
        }
        chunks.push(value);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // reader already closed / errored — nothing to release
      }
    }
    return Buffer.concat(chunks);
  }

  async function fetchAndStore(rawUrl: string, key: string): Promise<AssetCacheResult> {
    const url = assertSafePublicUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        // `dispatcher` carries the connection-time SSRF guard. It is an undici
        // extension of RequestInit; attach it at runtime to avoid the
        // undici-types (bundled with @types/node) vs undici@7 Dispatcher version
        // skew that a typed field would trip over.
        const init: RequestInit = { redirect: 'error', signal: controller.signal };
        (init as { dispatcher?: unknown }).dispatcher = dispatcher;
        response = await fetchImpl(url, init);
      } catch (err) {
        throw new AssetCacheError(502, `fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!response.ok) {
        throw new AssetCacheError(502, `upstream responded ${response.status}`);
      }
      const declaredLength = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new AssetCacheError(413, 'asset exceeds size limit');
      }
      const contentType = resolveContentType(response.headers.get('content-type'), url);
      const buf = await readBodyCapped(response, controller);
      const result: AssetCacheResult = { buf, contentType };
      try {
        await writeToDisk(key, result);
      } catch {
        // A cache-write failure must not fail the request; serve from memory.
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function get(rawUrl: string): Promise<AssetCacheResult> {
    if (!isCacheableExternalUrl(rawUrl)) {
      throw new AssetCacheError(400, 'url is not a cacheable external media url');
    }
    const key = keyFor(rawUrl.trim());
    const cached = await readFromDisk(key);
    if (cached) return cached;
    const existing = inflight.get(key);
    if (existing) return existing;
    const pending = fetchAndStore(rawUrl.trim(), key).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, pending);
    return pending;
  }

  return { get };
}

/** Exposed for tests that need to assert the on-disk key layout. */
export function assetCacheKey(rawUrl: string): string {
  return createHash('sha256').update(rawUrl.trim()).digest('hex');
}
