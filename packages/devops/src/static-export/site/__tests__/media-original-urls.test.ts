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
