import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { OriginRegistryPort, VerifiedOrigin } from '@jini-ai/core/contracts/server/verified-origin';
import { exportPublicOrigin, rewriteExportOriginResponse, rewriteRenderOrigins } from '../public-origin-policy.js';

const VERIFIED_AT = '2026-10-30T00:00:00Z';

/** A registry whose canonical origin is exactly `evidence` (or a refusal when `evidence` is an Error). */
function registryReturning(evidence: VerifiedOrigin | Error): OriginRegistryPort {
  return {
    canonicalOrigin: async () => { if (evidence instanceof Error) throw evidence; return evidence; },
    isAllowedRedirectTarget: async () => false,
    isAllowedEgressTarget: async () => false,
  };
}

test('configured public evidence becomes the export origin, development evidence for the same host does not', async () => {
  const configured = registryReturning({ scheme: 'https', host: 'public.example.test', source: 'workspace-setting', verifiedAt: VERIFIED_AT });
  assert.equal(await exportPublicOrigin({ registry: configured, workspaceId: 'site' }), 'https://public.example.test');
  const withPort = registryReturning({ scheme: 'https', host: 'public.example.test', port: 8443, source: 'workspace-setting', verifiedAt: VERIFIED_AT });
  assert.equal(await exportPublicOrigin({ registry: withPort, workspaceId: 'site' }), 'https://public.example.test:8443');
  const devSeed = registryReturning({ scheme: 'https', host: 'public.example.test', source: 'dev-capability', verifiedAt: VERIFIED_AT });
  assert.equal(await exportPublicOrigin({ registry: devSeed, workspaceId: 'site' }), undefined);
});

test('registry absence and configured loopback hosts never provide export identity', async () => {
  assert.equal(await exportPublicOrigin({ registry: registryReturning(new Error('No public origin')), workspaceId: 'site' }), undefined);
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'preview.localhost']) {
    const loopback = registryReturning({ scheme: 'https', host, source: 'workspace-setting', verifiedAt: VERIFIED_AT });
    assert.equal(await exportPublicOrigin({ registry: loopback, workspaceId: 'site' }), undefined, host);
  }
});

test('render origins are replaced by the public origin while external URLs keep their bytes', () => {
  const body = '<a href="http://127.0.0.1:4000/about">a</a><a href="https://external.example/x">b</a>{"url":"http:\\/\\/127.0.0.1:4000\\/p"}';
  const actual = rewriteRenderOrigins({ body, renderOrigin: 'http://127.0.0.1:4000', publicOrigin: 'https://public.example.test' });
  assert.equal(actual, '<a href="https://public.example.test/about">a</a><a href="https://external.example/x">b</a>{"url":"https:\\/\\/public.example.test\\/p"}');
  assert.equal(rewriteRenderOrigins({ body: 'see http://127.0.0.1:4000/about', renderOrigin: 'http://127.0.0.1:4000' }), 'see /about');
});

test('text responses are rewritten and drop stale length headers; robots sitemaps go without a public origin', async () => {
  const robots = new Response('User-agent: *\nSitemap: http://127.0.0.1:4000/sitemap.xml\n', { headers: { 'content-type': 'text/plain', 'content-length': '58' } });
  const rewritten = await rewriteExportOriginResponse({ response: robots, url: 'http://127.0.0.1:4000/robots.txt' });
  assert.equal(await rewritten.text(), 'User-agent: *\n');
  assert.equal(rewritten.headers.get('content-length'), null);
  const image = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  assert.equal(await rewriteExportOriginResponse({ response: image, url: 'http://127.0.0.1:4000/a.png' }), image);
  const redirect = new Response(null, { status: 301, headers: { location: 'http://127.0.0.1:4000/new' } });
  const moved = await rewriteExportOriginResponse({ response: redirect, url: 'http://127.0.0.1:4000/old', publicOrigin: 'https://public.example.test' });
  assert.equal(moved.headers.get('location'), 'https://public.example.test/new');
});
