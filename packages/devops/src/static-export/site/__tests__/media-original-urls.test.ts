import { expect, it, vi } from 'vitest';
import type { ExportMediaUrlDeps } from '../media-original-urls.js';
import { rewriteMediaOriginalUrls, rewriteExportMediaResponse } from '../media-original-urls.js';

it('foreign same-shaped media URL is never rewritten', async () => {
  const deps: ExportMediaUrlDeps<{ status: string; kind: string; source: { sha256: string } }> = {
    workspaceId: 'site', originRegistry: { canonicalOrigin: vi.fn().mockResolvedValue({ scheme: 'https', host: 'own.example' }) },
    findMedia: vi.fn().mockResolvedValue({ status: 'active', kind: 'image', source: { sha256: 'hash' } }),
    resolveContentTypes: vi.fn().mockResolvedValue(new Map([['hash', 'image/png']])),
    mediaPublicPath: vi.fn(() => '/m/key/original.png?v=hash'),
  };
  const body = '<img src="https://foreign.example/m/key/original?size=1#tail">';
  expect(await rewriteMediaOriginalUrls({ body, deps })).toBe(body);
  expect(deps.findMedia).not.toHaveBeenCalled();
  expect(deps.mediaPublicPath).not.toHaveBeenCalled();
});

it('binary response retains identity', async () => {
  const deps: ExportMediaUrlDeps<{ status: string; kind: string; source: { sha256: string } }> = {
    workspaceId: 'site', originRegistry: { canonicalOrigin: vi.fn() }, findMedia: vi.fn(),
    resolveContentTypes: vi.fn(), mediaPublicPath: vi.fn(),
  };
  const response = new Response(new Uint8Array([0, 255]), { headers: { 'content-type': 'image/png', 'content-length': '2', 'content-encoding': 'identity' } });
  expect(await rewriteExportMediaResponse({ response, deps })).toBe(response);
  expect(response.headers.get('content-length')).toBe('2');
  expect(response.headers.get('content-encoding')).toBe('identity');
});

type Media = { status: string; kind: string; source: { sha256: string } };
const record = (sha256: string, status = 'active', kind = 'image'): Media => ({ status, kind, source: { sha256 } });

function localMedia(records: ReadonlyMap<string, Media>, types: ReadonlyMap<string, string>) {
  const deps = {
    workspaceId: 'summer',
    originRegistry: { canonicalOrigin: vi.fn<ExportMediaUrlDeps<Media>['originRegistry']['canonicalOrigin']>().mockResolvedValue({
      scheme: 'https', host: 'gallery.example', source: 'workspace-setting', verifiedAt: '2026-11-20T00:00:00Z',
    }) },
    findMedia: vi.fn(async ({ idOrSlug }: { workspaceId: string; idOrSlug: string }) => records.get(idOrSlug) ?? null),
    resolveContentTypes: vi.fn(async (_: { media: readonly Media[] }) => types),
    mediaPublicPath: vi.fn(({ key, sha256 }: Parameters<ExportMediaUrlDeps<Media>['mediaPublicPath']>[0]) =>
      `/m/${encodeURIComponent(key)}/original.png?v=${sha256}`),
  } satisfies ExportMediaUrlDeps<Media>;
  return deps;
}

it('upgrades eligible local and same-origin URLs only, preserving other query keys and fragments', async () => {
  const sunrise = record('sha-sun');
  const untyped = record('sha-untyped');
  const deps = localMedia(new Map([
    ['sun rise', sunrise], ['draft', record('draft', 'pending')],
    ['report', record('doc', 'active', 'document')], ['untyped', untyped],
  ]), new Map([['sha-sun', 'image/png']]));
  const body = '<meta property="og:image" content="//gallery.example/m/sun%20rise/original?v=old&size=2#cover">'
    + '<img src="/m/sun%20rise/original"><img src="/m/draft/original"><img src="/m/report/original">'
    + '<img src="/m/missing/original"><img src="/m/untyped/original"><img src="/m/%ZZ/original">'
    + '<img src="https://[:::]/m/sun%20rise/original"><p>/m/sun%20rise/original</p>';

  expect(await rewriteMediaOriginalUrls({ body, deps })).toBe(
    '<meta property="og:image" content="//gallery.example/m/sun%20rise/original.png?v=sha-sun&size=2#cover">'
    + '<img src="/m/sun%20rise/original.png?v=sha-sun"><img src="/m/draft/original"><img src="/m/report/original">'
    + '<img src="/m/missing/original"><img src="/m/untyped/original"><img src="/m/%ZZ/original">'
    + '<img src="https://[:::]/m/sun%20rise/original"><p>/m/sun%20rise/original</p>',
  );
  expect(deps.originRegistry.canonicalOrigin).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'summer' });
  expect(deps.findMedia.mock.calls).toEqual(['sun rise', 'sun rise', 'draft', 'report', 'missing', 'untyped'].map(idOrSlug => [{ workspaceId: 'summer', idOrSlug }]));
  expect(deps.resolveContentTypes).toHaveBeenCalledExactlyOnceWith({ media: [sunrise, sunrise, untyped] });
  expect(deps.mediaPublicPath.mock.calls).toEqual([1, 2].map(() => [{
    key: 'sun rise', sha256: 'sha-sun', variant: { kind: 'original', contentType: 'image/png' },
  }]));
});

it('keeps absolute URLs when the registry is unavailable and copies rewritten CSS response metadata', async () => {
  const deps = localMedia(new Map([['cover', record('cover-sha')]]), new Map([['cover-sha', 'image/png']]));
  deps.originRegistry.canonicalOrigin.mockRejectedValue(new Error('Origin not configured'));
  const response = new Response('a{background:url(/m/cover/original)} b{background:url(https://gallery.example/m/cover/original)}', {
    status: 202, statusText: 'Queued', headers: { 'content-type': 'text/css; charset=utf-8', 'content-length': '99', 'content-encoding': 'identity', 'x-export': 'summer' },
  });
  const output = await rewriteExportMediaResponse({ response, deps });
  expect(await output.text()).toBe('a{background:url(/m/cover/original.png?v=cover-sha)} b{background:url(https://gallery.example/m/cover/original)}');
  expect({ status: output.status, statusText: output.statusText, headers: Object.fromEntries(output.headers) }).toEqual({
    status: 202, statusText: 'Queued', headers: { 'content-type': 'text/css; charset=utf-8', 'x-export': 'summer' },
  });
});

it('preserves a bodyless redirect without opening media', async () => {
  const deps = localMedia(new Map(), new Map());
  const response = new Response(null, { status: 302, headers: { location: '/m/cover/original', 'content-type': 'text/html' } });
  expect(await rewriteExportMediaResponse({ response, deps })).toBe(response);
  expect(deps.findMedia).not.toHaveBeenCalled();
});

it('rewrites an absolute media URL only on the verified custom port', async () => {
  const deps = localMedia(new Map([['cover', record('cover-sha')]]), new Map([['cover-sha', 'image/png']]));
  deps.originRegistry.canonicalOrigin.mockResolvedValue({
    scheme: 'https', host: 'gallery.example', port: 8443, source: 'workspace-setting', verifiedAt: '2026-11-20T00:00:00Z',
  });
  const body = '<img src="https://gallery.example:8443/m/cover/original"><img src="https://gallery.example/m/cover/original">';

  expect(await rewriteMediaOriginalUrls({ body, deps })).toBe(
    '<img src="https://gallery.example:8443/m/cover/original.png?v=cover-sha"><img src="https://gallery.example/m/cover/original">',
  );
});

it('treats a verified default port as the plain origin', async () => {
  const deps = localMedia(new Map([['cover', record('cover-sha')]]), new Map([['cover-sha', 'image/png']]));
  deps.originRegistry.canonicalOrigin.mockResolvedValue({
    scheme: 'https', host: 'gallery.example', port: 443, source: 'workspace-setting', verifiedAt: '2026-11-20T00:00:00Z',
  });
  const body = '<img src="https://gallery.example/m/cover/original"><img src="https://gallery.example:8443/m/cover/original">';

  expect(await rewriteMediaOriginalUrls({ body, deps })).toBe(
    '<img src="https://gallery.example/m/cover/original.png?v=cover-sha"><img src="https://gallery.example:8443/m/cover/original">',
  );
});

it('keeps absolute media URLs as written when the configured origin cannot be parsed', async () => {
  const deps = localMedia(new Map([['cover', record('cover-sha')]]), new Map([['cover-sha', 'image/png']]));
  deps.originRegistry.canonicalOrigin.mockResolvedValue({
    scheme: 'https', host: 'gallery example', source: 'workspace-setting', verifiedAt: '2026-11-20T00:00:00Z',
  });
  const body = '<img src="https://gallery.example/m/cover/original"><img src="/m/cover/original">';

  expect(await rewriteMediaOriginalUrls({ body, deps })).toBe(
    '<img src="https://gallery.example/m/cover/original"><img src="/m/cover/original.png?v=cover-sha">',
  );
  expect(deps.findMedia).toHaveBeenCalledExactlyOnceWith({ workspaceId: deps.workspaceId, idOrSlug: 'cover' });
});
