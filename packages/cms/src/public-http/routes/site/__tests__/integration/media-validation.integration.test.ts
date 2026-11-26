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
