import { describe, expect, it } from 'vitest';
import type { JsonRouteAuthorize } from '@jini-ai/core/contracts/server';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import { servingAddressOf, sitePreviewRoute, sitePreviewTargets, type SitePreviewRouteDeps } from '../site-previews.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x41]);

function call(deps: SitePreviewRouteDeps, { name, deny = false }: { name?: string; deny?: boolean } = {}) {
  const asked: unknown[] = [];
  const authorize: JsonRouteAuthorize = async (input) => {
    asked.push(input);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  const params: Record<string, string> = name === undefined ? {} : { workspaceId: 'ws', name };
  const response = sitePreviewRoute.handle({ raw: { body: undefined, query: {}, params }, deps, context: { id: 'operator' }, authorize }, { signal: new AbortController().signal });
  return { response, asked };
}

function reader(reads: string[]): SitePreviewRouteDeps {
  return { previewContentType: 'image/jpeg', sitePreviews: { read: ({ name }) => { reads.push(name); return name === 'alpha' ? JPEG : null; } } };
}

describe('sitePreviewRoute', () => {
  it('is a buffered GET on the sites preview path', () => {
    expect(sitePreviewRoute.method).toBe('get');
    expect(sitePreviewRoute.path).toBe('/api/admin/v1/workspaces/:workspaceId/system/sites/:name/preview');
    expect(sitePreviewRoute.bufferedReply).toBe(true);
  });

  it('answers the capture bytes with the injected type, immutable private caching and nosniff', async () => {
    const reads: string[] = [];
    const { response, asked } = call(reader(reads), { name: 'alpha' });
    const answer = await response;
    expect(answer.status).toBe(200);
    expect(Object.fromEntries(answer.headers)).toEqual({ 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(JPEG);
    expect(asked).toEqual([{ permission: 'system.read', entityType: 'site-registry' }]);
    expect(reads).toEqual(['alpha']);
  });

  it('answers the JSON 404 byte-for-byte without a capture, and without a preview service', async () => {
    const body = '{"code":"SITE_PREVIEW_NOT_FOUND","error":"no preview"}';
    for (const deps of [reader([]), { previewContentType: 'image/jpeg' }]) {
      const answer = await call(deps, { name: 'beta' }).response;
      expect(answer.status).toBe(404);
      expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await answer.text()).toBe(body);
    }
  });

  it('authorizes before any read, and a missing :name param reads the empty name', async () => {
    const reads: string[] = [];
    await expect(call(reader(reads), { name: 'alpha', deny: true }).response).rejects.toBeInstanceOf(RouteRefusalError);
    expect(reads).toEqual([]);
    expect((await call(reader(reads)).response).status).toBe(404);
    expect(reads).toEqual(['']);
  });

  it('lets a read failure reach the host failure port', async () => {
    const deps: SitePreviewRouteDeps = { previewContentType: 'image/jpeg', sitePreviews: { read: () => { throw new Error('EACCES'); } } };
    await expect(call(deps, { name: 'alpha' }).response).rejects.toThrow('EACCES');
  });
});

describe('preview targets', () => {
  it('lists the served site at its socket address plus every running local site, once each', () => {
    const local = (name: string, extra: object = {}) => ({ name, status: 'running', pid: 10, adminUrl: 'https://localhost:3101/admin/', ...extra });
    expect(sitePreviewTargets({ servingName: 'owner', localSites: [local('alpha'), local('beta', { status: 'starting' }), local('gamma', { pid: null }), local('owner')] }, { serving: { scheme: 'http', port: 3000, pid: 7 } })).toEqual([
      { name: 'owner', url: 'http://localhost:3000/', lifecycle: 'serving:7' },
      { name: 'alpha', url: 'https://localhost:3101/', lifecycle: 'pid:10' },
    ]);
  });

  it('reads the serving scheme and port from the socket only', () => {
    expect(servingAddressOf({ req: { socket: { localPort: 443, encrypted: true } } }, { pid: 3 })).toEqual({ scheme: 'https', port: 443, pid: 3 });
    expect(servingAddressOf({ req: {} })).toBeUndefined();
  });
});

it('uses HTTP for a plain socket and omits a running site without a preview address', () => {
  expect(servingAddressOf({ req: { socket: { localPort: 3210 } } }, { pid: 3 })).toEqual({ scheme: 'http', port: 3210, pid: 3 });
  expect(sitePreviewTargets({ servingName: 'owner', localSites: [
    { name: 'pending-address', status: 'running', pid: 10, adminUrl: null },
    { name: 'preview', status: 'running', pid: 11, adminUrl: 'http://localhost:3122/admin/' },
  ] })).toEqual([{ name: 'preview', url: 'http://localhost:3122/', lifecycle: 'pid:11' }]);
});
