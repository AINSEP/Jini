import { createHash } from "node:crypto";
import { InMemoryBlobStore } from "../../../../../media/blob-store.memory.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../../../../media/repo.memory.js";
import { InMemoryImageTransformer } from "../../../../../media/image-transformer.js";
import { ImageSourceCorruptError, ImageTransformUnavailableError } from "../../../../../media/image-transformer.sharp.js";
import { sanitizeOriginalBytes } from "../../../../../media/original-response.js";
import type { MediaRecord } from "../../../../../media/types.js";
import { expect, it, vi } from 'vitest';
import { createPublicMediaHandlers, mediaOriginalVideoRoute, mediaRenditionRoute } from '../../media-rendition.js';

it('makes denied and missing replies identical and reads neither validators nor bytes after denial', async () => {
  for (const original of [false, true]) {
    const replies: unknown[] = [];
    for (const allowed of [false, true]) {
      let status = 200;
      const headers: Record<string, string> = {};
      let body: unknown;
      const res: Parameters<typeof mediaRenditionRoute>[0]['res'] = {
        status: code => { status = code; return res; }, set: (name, value) => { headers[name] = value; return res; },
        json: value => { body = value; }, end: () => {}, send: () => {},
      };
      const hash = vi.fn(() => 'tag');
      const transformRead = vi.fn(async () => null);
      const bytes = vi.fn(async () => new Uint8Array());
      const deps = {
        workspaceId: 'w', access: { decide: async () => ({ allowed, gated: false, record: allowed ? null : { id: 'asset', status: 'active', source: { sha256: 'source' } } }) },
        readEntitlement: async () => () => false, hash,
        rendition: { transformRepo: { findByNameVersion: transformRead } },
        original: { mediaRepo: { findById: async () => null, findBySlug: async () => null } },
        blobStore: { get: bytes },
      } as unknown as Parameters<typeof mediaRenditionRoute>[0]['deps'];
      const facts = { assetId: 'asset', transformSpec: 'public.v1', ifNoneMatch: () => '"tag"', range: () => undefined };
      if (original) await mediaOriginalVideoRoute({ deps, facts, res });
      else {
        deps.resolveMediaRendition = async () => ({ outcome: 'not-found' });
        await mediaRenditionRoute({ deps, facts, res });
      }
      replies.push({ status, headers, body });
      expect(status).toBe(404);
      expect(hash).not.toHaveBeenCalled();
      expect(transformRead).not.toHaveBeenCalled();
      expect(bytes).not.toHaveBeenCalled();
    }
    expect(replies[0]).toEqual(replies[1]);
  }
});

it('uses the same normalized original handler for both URL variants without eager entitlement or cache capture', async () => {
  let cacheReads = 0;
  const resolveContext = vi.fn();
  const access = { decide: vi.fn(async () => ({ allowed: false, gated: true, record: null })) };
  const createRenditionAccess = vi.fn(() => access);
  const accessDeps = { get cache() { cacheReads++; return new Map(); } } as unknown as Parameters<typeof createPublicMediaHandlers>[0]['accessDeps'];
  const handlers = createPublicMediaHandlers({ deps: {} as Parameters<typeof createPublicMediaHandlers>[0]['deps'], accessDeps, createRenditionAccess,
    createMemberAccessResolver: () => ({ resolveContext, decide: () => ({ allowed: false }) }), readSessionToken: vi.fn(), nowIso: vi.fn(), resolvePostMemberAccess: vi.fn(),
    writer: { status: ({ response, code }: { response: Parameters<typeof mediaRenditionRoute>[0]['res']; code: number }) => { response.status(code); }, set: ({ response, name, value }) => { response.set(name, value); },
      json: ({ response, body }) => { response.json(body); }, end: ({ response }) => { response.end(); }, send: ({ response, bytes }) => { response.send(bytes); } },
    sendMediaOriginalTrashed: vi.fn(), writeMediaOriginalReply: vi.fn() });
  expect(cacheReads).toBe(0); expect(createRenditionAccess).not.toHaveBeenCalled();
  expect(handlers.original.path).toEqual(['/m/:assetId/original', '/m/:assetId/original.:ext']);
  const replies: unknown[] = [];
  for (const params of [{ assetId: 'asset' }, { assetId: 'asset', ext: 'svg' }]) {
    const res: Parameters<typeof mediaRenditionRoute>[0]['res'] = { status: code => { replies.push(code); return res; }, set: (name, value) => { replies.push([name, value]); return res; }, json: body => { replies.push(body); }, end: vi.fn(), send: vi.fn() };
    await handlers.original.handle({ request: {}, params, ifNoneMatch: () => undefined, range: () => undefined, response: res });
  }
  expect(replies.slice(0, 3)).toEqual(replies.slice(3));
  expect(resolveContext).not.toHaveBeenCalled();
});

type Route = Parameters<typeof mediaRenditionRoute>[0];

function responseFixture() {
  const result: { status: number; headers: Record<string, string>; body: unknown; ended: boolean } = {
    status: 200, headers: {}, body: undefined, ended: false,
  };
  const res: Route['res'] = {
    status: code => { result.status = code; return res; },
    set: (name, value) => { result.headers[name] = value; return res; },
    json: body => { result.body = body; },
    send: bytes => { result.body = bytes; },
    end: () => { result.ended = true; },
  };
  return { result, res };
}

function mediaFixture() {
  const workspaceId = 'coast';
  const createdAt = '2026-01-02T00:00:00Z';
  const record: MediaRecord = {
    id: 'asset-7', slug: 'coast-captions', workspaceId, title: 'Coast', alt: '', caption: '', credit: '',
    source: { sha256: 'source-sha', contentType: 'image/jpeg' }, status: 'active', createdAt, updatedAt: createdAt,
    version: 1, width: null, height: null, cssClass: null, htmlAttributes: null,
  };
  const mediaRepo = new InMemoryMediaRepo({}, { initialRows: [record] });
  const assetBlobRepo = new InMemoryAssetBlobRepo({});
  const renditionRepo = new InMemoryAssetRenditionRepo({});
  const transformRepo = new InMemoryTransformDefinitionRepo({}, { initialRows: [
    { id: 'transform-4', workspaceId, name: 'public', version: 4, params: { format: 'webp' }, owner: 'core', createdAt },
  ] });
  const blobStore = new InMemoryBlobStore();
  const decide = vi.fn<Route['deps']['access']['decide']>(async ({ idOrSlug }) =>
    ({ allowed: idOrSlug === record.slug, gated: false, record }));
  const resolveMediaRendition = vi.fn<Route['deps']['resolveMediaRendition']>(async () => ({ outcome: 'gone' }));
  const hash = vi.fn<Route['deps']['hash']>(input => input.bytes ? 'bytes-tag' : 'stored-tag');
  const sendMediaOriginalTrashed = vi.fn();
  const writeMediaOriginalReply = vi.fn<Route['deps']['writeMediaOriginalReply']>();
  const parseRangeHeader = vi.fn<Route['deps']['parseRangeHeader']>(() => ({ kind: 'none' }));
  const deps: Route['deps'] = {
    workspaceId, access: { decide }, readEntitlement: async () => () => false,
    rendition: { createHash, mediaRepo, blobRepo: assetBlobRepo, renditionRepo, transformRepo, blobStore,
      imageTransformer: new InMemoryImageTransformer(), clock: { nowMs: () => Date.parse(createdAt) }, idGen: { newId: () => 'new-rendition' } },
    original: { mediaRepo, assetBlobRepo }, blobStore, resolveMediaRendition, hash, sendMediaOriginalTrashed, writeMediaOriginalReply,
    sanitizeOriginalBytes, parseRangeHeader, ImageTransformUnavailableError, ImageSourceCorruptError,
  };
  const facts: Route['facts'] = { assetId: 'coast-captions', transformSpec: 'public.v4', ifNoneMatch: () => undefined, range: () => undefined };

  async function storeOriginal(bytes: Uint8Array) {
    const { storageKey } = await blobStore.put({ workspaceId, sha256: record.source.sha256, bytes });
    await assetBlobRepo.save({ id: 'blob-7', workspaceId, sha256: record.source.sha256, storageKey,
      createdByPrincipal: 'fixture-editor', createdAt, status: 'active' });
  }
  async function storeRendition() {
    await renditionRepo.save({ id: 'rendition-4', workspaceId, assetId: 'asset-7', transformName: 'public',
      version: 4, storageKey: 'stored-rendition-key', createdAt });
  }
  return { deps, facts, record, decide, resolveMediaRendition, hash, sendMediaOriginalTrashed, writeMediaOriginalReply,
    parseRangeHeader, mediaRepo, storeOriginal, storeRendition };
}

it.each([
  { transformSpec: 'preview', error: 'malformed media rendition URL' },
  { transformSpec: 'public.v0', error: 'malformed transform version' },
])('rejects $transformSpec before looking up an asset', async ({ transformSpec, error }) => {
  const { deps, facts, decide } = mediaFixture();
  const { result, res } = responseFixture();
  await mediaRenditionRoute({ deps, facts: { ...facts, transformSpec }, res });
  expect(result).toEqual({ status: 400, body: { error }, headers: {}, ended: false });
  expect(decide).not.toHaveBeenCalled();
});

it('returns 304 for a stored public rendition without resolving or reading its bytes', async () => {
  const f = mediaFixture();
  await f.storeRendition();
  const { result, res } = responseFixture();
  await mediaRenditionRoute({ deps: f.deps, facts: { ...f.facts, ifNoneMatch: () => '"older", W/"stored-tag"' }, res });
  expect(f.decide).toHaveBeenCalledExactlyOnceWith({ idOrSlug: 'coast-captions', readEntitlement: f.deps.readEntitlement });
  expect(f.hash).toHaveBeenCalledExactlyOnceWith({ identity: '["source-sha","public",4,"stored-rendition-key"]' });
  expect(f.resolveMediaRendition).not.toHaveBeenCalled();
  expect(result).toEqual({ status: 304, headers: { 'Cache-Control': 'public, max-age=60', ETag: '"stored-tag"' }, body: undefined, ended: true });
});

it('serves unindexed SVG rendition bytes with a byte-derived ETag and inline hardening', async () => {
  const f = mediaFixture();
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  f.resolveMediaRendition.mockResolvedValueOnce({ outcome: 'ok', bytes, contentType: 'image/svg+xml' });
  const { result, res } = responseFixture();
  await mediaRenditionRoute({ deps: f.deps, facts: f.facts, res });
  expect(f.resolveMediaRendition.mock.calls.map(([{ input }]) => input)).toEqual([
    { workspaceId: 'coast', assetId: 'coast-captions', transformName: 'public', version: 4 },
  ]);
  expect(f.hash).toHaveBeenCalledExactlyOnceWith({ identity: 'source-sha:public:4:', bytes });
  expect(result).toEqual({ status: 200, body: bytes, ended: false, headers: {
    'Cache-Control': 'public, max-age=60', 'Content-Type': 'image/svg+xml', ETag: '"bytes-tag"',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  } });
});

it('never negotiates or emits a public validator for a gated rendition even if its ETag matches', async () => {
  const f = mediaFixture();
  await f.storeRendition();
  f.decide.mockResolvedValueOnce({ allowed: true, gated: true, record: f.record });
  const bytes = Uint8Array.of(10, 20, 30);
  f.resolveMediaRendition.mockResolvedValueOnce({ outcome: 'ok', bytes, contentType: 'image/webp' });
  const { result, res } = responseFixture();
  await mediaRenditionRoute({ deps: f.deps, facts: { ...f.facts, ifNoneMatch: () => '"stored-tag"' }, res });
  expect(f.hash).not.toHaveBeenCalled();
  expect(result).toEqual({ status: 200, body: bytes, ended: false,
    headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'image/webp' } });
});

it('writes a non-cacheable 410 for a gone rendition', async () => {
  const f = mediaFixture();
  const { result, res } = responseFixture();
  await mediaRenditionRoute({ deps: f.deps, facts: f.facts, res });
  expect(result).toEqual({ status: 410, headers: { 'Cache-Control': 'no-store' }, body: undefined, ended: true });
});

it.each([
  { error: new ImageTransformUnavailableError({ message: 'image codec unavailable' }), status: 503, message: 'image codec unavailable', headers: { 'Cache-Control': 'no-store' } },
  { error: new ImageSourceCorruptError({ message: 'private decoder detail' }), status: 422, message: 'source image could not be processed', headers: { 'Cache-Control': 'no-store' } },
  { error: new Error('private storage detail'), status: 500, message: 'internal error', headers: {} },
])('maps a rendition failure to a $status response', async ({ error, status, message, headers }) => {
  const f = mediaFixture();
  f.resolveMediaRendition.mockRejectedValueOnce(error);
  const { result, res } = responseFixture();
  await mediaRenditionRoute({ deps: f.deps, facts: f.facts, res });
  expect(result).toEqual({ status, headers, body: { error: message }, ended: false });
});

it('reads stored captions by slug and serves the requested range based on sniffed bytes', async () => {
  const f = mediaFixture();
  const bytes = new TextEncoder().encode('WEBVTT\n\n00:00.000 --> 00:01.000\nCoast\n');
  await f.storeOriginal(bytes);
  f.parseRangeHeader.mockReturnValueOnce({ kind: 'range', start: 0, end: 5 });
  const { res } = responseFixture();
  await mediaOriginalVideoRoute({ deps: f.deps, facts: { ...f.facts, range: () => 'bytes=0-5' }, res });
  expect(f.parseRangeHeader).toHaveBeenCalledExactlyOnceWith({ header: 'bytes=0-5', totalLength: bytes.length });
  expect(f.writeMediaOriginalReply).toHaveBeenCalledExactlyOnceWith({ status: 206, headers: [
    ['X-Content-Type-Options', 'nosniff'], ['Content-Security-Policy', "default-src 'none'; sandbox"],
    ['Cross-Origin-Resource-Policy', 'same-origin'], ['Cache-Control', 'private, no-store'], ['Content-Type', 'text/vtt'],
    ['Accept-Ranges', 'bytes'], ['Content-Range', `bytes 0-5/${bytes.length}`],
  ], body: new TextEncoder().encode('WEBVTT') });
});

it('does not serve a public original for unsupported bytes even if the media record exists', async () => {
  const f = mediaFixture();
  await f.storeOriginal(new TextEncoder().encode('not a supported inline format'));
  const { result, res } = responseFixture();
  await mediaOriginalVideoRoute({ deps: f.deps, facts: f.facts, res });
  expect(result).toEqual({ status: 404, headers: { 'Cache-Control': 'private, no-store' },
    body: { error: 'video rendition not found' }, ended: false });
  expect(f.writeMediaOriginalReply).not.toHaveBeenCalled();
});

it('routes trashed originals through the host writer without loading the source', async () => {
  const f = mediaFixture();
  await f.mediaRepo.save({ ...f.record, status: 'trashed' });
  const { res } = responseFixture();
  await mediaOriginalVideoRoute({ deps: f.deps, facts: f.facts, res });
  expect(f.sendMediaOriginalTrashed).toHaveBeenCalledExactlyOnceWith();
  expect(f.writeMediaOriginalReply).not.toHaveBeenCalled();
});

it('reports an original with missing stored bytes as an internal failure', async () => {
  const f = mediaFixture();
  const { result, res } = responseFixture();
  await mediaOriginalVideoRoute({ deps: f.deps, facts: f.facts, res });
  expect(result).toEqual({ status: 500, headers: {}, body: { error: 'internal error' }, ended: false });
  expect(f.writeMediaOriginalReply).not.toHaveBeenCalled();
});

it('binds the member check and adapted rendition writer to the current request', async () => {
  const f = mediaFixture();
  const request = { cookie: 'member-session' };
  const { result, res: response } = responseFixture();
  const context = { plan: 'supporter' };
  const memberAccess = { minimum: 'supporter' };
  const resolveContext = vi.fn(async () => context);
  const decide = vi.fn(() => ({ allowed: true }));
  const resolvePostMemberAccess = vi.fn(() => memberAccess);
  const readSessionToken = vi.fn(({ request }: { request: { cookie: string } }) => request.cookie);
  const accessDeps: Parameters<Parameters<typeof createPublicMediaHandlers>[0]['createRenditionAccess']>[0] = {
    workspaceId: 'coast', cache: new Map(), nowMs: () => 10, findMedia: async () => f.record,
    readEntries: async () => [], readRetiredSlugs: async () => [], readWidgetRows: undefined, isGated: () => true,
  };
  const gatedAccess = vi.fn<Route['deps']['access']['decide']>(async ({ readEntitlement }) => ({
    allowed: (await readEntitlement({}))({ entry: { memberAccessJson: '{"plan":"supporter"}' } }),
    gated: true, record: f.record,
  }));
  const createRenditionAccess = vi.fn(() => ({ decide: gatedAccess }));
  const handlers = createPublicMediaHandlers({ deps: f.deps, accessDeps, createRenditionAccess,
    createMemberAccessResolver: () => ({ resolveContext, decide }), readSessionToken,
    nowIso: () => '2026-01-02T00:00:00Z', resolvePostMemberAccess,
    writer: { status: ({ response, code }) => { response.status(code); }, set: ({ response, name, value }) => { response.set(name, value); },
      json: ({ response, body }) => { response.json(body); }, end: ({ response }) => { response.end(); },
      send: ({ response, bytes }) => { response.send(bytes); } } satisfies Parameters<typeof createPublicMediaHandlers<unknown, unknown, unknown, Route['res']>>[0]['writer'],
    sendMediaOriginalTrashed: vi.fn(), writeMediaOriginalReply: vi.fn(),
  });
  const bytes = Uint8Array.of(5, 9);
  f.resolveMediaRendition.mockResolvedValueOnce({ outcome: 'ok', contentType: 'image/webp', bytes });
  await handlers.rendition.handle({ request, response, params: { assetId: 'coast-captions', transformSpec: 'public.v4' },
    ifNoneMatch: () => undefined, range: () => undefined });
  expect(createRenditionAccess).toHaveBeenCalledExactlyOnceWith(accessDeps);
  expect(readSessionToken).toHaveBeenCalledExactlyOnceWith({ request });
  expect(resolveContext).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'coast', sessionToken: 'member-session', nowIso: '2026-01-02T00:00:00Z' });
  expect(resolvePostMemberAccess).toHaveBeenCalledExactlyOnceWith({ raw: '{"plan":"supporter"}' });
  expect(decide).toHaveBeenCalledExactlyOnceWith({ access: memberAccess, context });
  expect(result).toEqual({ status: 200, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'image/webp' }, body: bytes, ended: false });
});
