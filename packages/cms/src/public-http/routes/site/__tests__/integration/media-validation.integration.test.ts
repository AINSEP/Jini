import { expect, it, vi } from 'vitest';
import { mediaOriginalVideoRoute, mediaRenditionRoute } from '../../media-rendition.js';

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
