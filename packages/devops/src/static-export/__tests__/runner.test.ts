import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { exportSite } from '../runner.js';
import { createNodeArtifactWriter } from '../node-adapters.js';
import { redirectOutcomeFor, renderRedirectStub, rewriteRouteBodyForBasePath } from '../transforms.js';
import { firstExportFailure } from '../failure-summary.js';
import type { ExportSiteArgs, RouteManifest } from '../contracts.js';

function fixture() {
  const writes = new Map<string, string | Buffer>();
  const fetched: string[] = [];
  const initByPath = new Map<string, RequestInit>();
  let closes = 0;
  const manifest: RouteManifest = { routes: [
    { path: '/', kind: 'home', label: 'home' }, { path: '/old', kind: 'redirect', label: 'old', redirectTarget: '/declared' },
    { path: '/missing-probe', kind: 'not-found', label: '404' }, { path: '/robots.txt', kind: 'well-known', label: 'robots' },
    { path: '/sitemap.xml', kind: 'well-known', label: 'sitemap' }, { path: '/feed.xml', kind: 'well-known', label: 'feed' },
  ], skipped: [{ reason: 'wildcard', detail: '/family/*' }], activeTheme: { id: 'plain', dir: '/theme', apiVersion: 2 } };
  const args: ExportSiteArgs = {
    outputDir: '/artifact', manifest: { build: async () => manifest }, app: { open: async () => ({ baseUrl: 'http://127.0.0.1:43210', close: async () => { closes++; } }) },
    writer: { prepare: async () => {}, write: async ({ outputFile, data }) => { writes.set(outputFile, data); } },
    assetSource: { listThemeFiles: async () => ['render/pages/index.html', 'render/pages/404.html', 'main.css', 'font.bin', 'unused.jpg'] },
    themeLayout: { resolve: () => ({ pagesDir: 'render/pages', assetUrlPrefix: '/assets/plain/' }) }, assetUrlPrefixes: ['/assets/'], requestHeaders: { 'x-export-mode': '1' },
    security: { transformHtml: ({ html }) => html.replace('<head>', '<head><meta name="referrer" content="same-origin">') },
    errorPage: { outputFile: '404.html', acceptStatus: ({ status }) => status >= 400 && status < 500 }, describeError: ({ error }) => error instanceof Error ? error.message : String(error),
    fetch: async (input, optional) => {
      const url = new URL(input.url);
      fetched.push(url.pathname + url.search);
      initByPath.set(url.pathname, optional?.init ?? {});
      const bodies: Record<string, string> = {
        '/': '<html><head></head><body><a href="/about">About</a><img srcset="/assets/a.bin 1x, /assets/b.bin 2x"><link href="/assets/plain/main.css"></body></html>',
        '/robots.txt': 'Sitemap: /sitemap.xml\n', '/sitemap.xml': '<loc>/about</loc><loc>https://external.test/about</loc>', '/feed.xml': '<link>/about</link>',
        '/missing-probe': '<html><head></head><body>missing</body></html>', '/assets/plain/main.css': 'a{src:url(font.bin)}',
      };
      if (url.pathname === '/old') return new Response(null, { status: 301, headers: { location: '/live' } });
      if (url.pathname.endsWith('.bin')) return new Response(new Uint8Array([0,128,255]), { headers: { 'content-type': 'application/octet-stream' } });
      return new Response(bodies[url.pathname] ?? 'missing', { status: url.pathname === '/missing-probe' ? 404 : url.pathname in bodies ? 200 : 404, headers: { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.xml') ? 'application/xml' : url.pathname === '/robots.txt' ? 'text/plain' : 'text/html' } });
    },
  };
  return { args, manifest, writes, fetched, initByPath, closes: () => closes };
}

// Generalized from site-exporter.test.ts: same output and failures, no CMS/app/database fixtures.
test('exports real response bytes/content types, route tree, redirect destination, assets and one CSS hop', async () => {
  const f = fixture();
  const report = await exportSite(f.args);
  assert.deepEqual(report.routes.failed, []);
  assert.deepEqual(report.assets.failed, []);
  assert.deepEqual([...f.writes.keys()].sort(), ['404.html', 'assets/a.bin', 'assets/b.bin', 'assets/plain/font.bin', 'assets/plain/main.css', 'feed.xml', 'index.html', 'old/index.html', 'robots.txt', 'sitemap.xml']);
  assert.match(String(f.writes.get('old/index.html')), /url=\/live/);
  assert.doesNotMatch(String(f.writes.get('old/index.html')), /declared/);
  assert.deepEqual(f.writes.get('assets/a.bin'), Buffer.from([0,128,255]));
  for (const route of report.routes.succeeded) assert.deepEqual(route.data, f.writes.get(route.outputFile));
  for (const asset of report.assets.succeeded) assert.deepEqual(asset.data, f.writes.get(asset.outputFile));
  assert.deepEqual(report.unreferencedThemeFiles, ['unused.jpg']);
  assert.deepEqual(report.skippedManifestEntries, [{ reason: 'wildcard', detail: '/family/*' }]);
  assert.equal(f.closes(), 1);
  assert.equal(new Headers(f.initByPath.get('/')?.headers).get('x-export-mode'), '1');
  assert.equal(f.initByPath.get('/old')?.redirect, 'manual');
});

test('second export with clean:false replaces its HTML and binary files while keeping foreign files', async () => {
  const outputDir = await realpath(await mkdtemp(path.join(tmpdir(), 'static-export-rebuild-')));
  const f = fixture();
  f.args.outputDir = outputDir;
  f.args.writer = createNodeArtifactWriter({});
  try {
    const first = await exportSite(f.args);
    assert.deepEqual(first.routes.failed, []);
    assert.deepEqual(first.assets.failed, []);
    assert.deepEqual(await readFile(path.join(outputDir, 'assets/a.bin')), Buffer.from([0,128,255]));
    await writeFile(path.join(outputDir, 'foreign.txt'), 'user-added file');
    await writeFile(path.join(outputDir, 'assets/foreign.txt'), 'user-added asset');
    const originalFetch = f.args.fetch;
    const updatedHtml = '<html>updated<img src="/assets/a.bin"></html>';
    f.args.fetch = async (input, options) => {
      const pathname = new URL(input.url).pathname;
      if (pathname === '/') return new Response(updatedHtml, { headers: { 'content-type': 'text/html' } });
      if (pathname === '/assets/a.bin') return new Response(new Uint8Array([7]), { headers: { 'content-type': 'application/octet-stream' } });
      return originalFetch(input, options);
    };
    // Each build creates a new writer; rebuilding must not depend on process-local ownership state.
    f.args.writer = createNodeArtifactWriter({});
    const second = await exportSite(f.args, { clean: false });
    assert.deepEqual(second.routes.failed, []);
    assert.deepEqual(second.assets.failed, []);
    assert.equal(await readFile(path.join(outputDir, 'index.html'), 'utf8'), updatedHtml);
    assert.deepEqual(await readFile(path.join(outputDir, 'assets/a.bin')), Buffer.from([7]));
    assert.equal(await readFile(path.join(outputDir, 'foreign.txt'), 'utf8'), 'user-added file');
    assert.equal(await readFile(path.join(outputDir, 'assets/foreign.txt'), 'utf8'), 'user-added asset');
    assert.equal(f.closes(), 2);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('second export with clean:true removes foreign files before rebuilding', async () => {
  const outputDir = await realpath(await mkdtemp(path.join(tmpdir(), 'static-export-clean-')));
  const f = fixture();
  f.args.outputDir = outputDir;
  f.args.writer = createNodeArtifactWriter({});
  try {
    const first = await exportSite(f.args);
    assert.deepEqual(first.routes.failed, []);
    assert.deepEqual(first.assets.failed, []);
    await writeFile(path.join(outputDir, 'foreign.txt'), 'user-added file');
    await writeFile(path.join(outputDir, 'assets/foreign.txt'), 'user-added asset');
    const second = await exportSite(f.args, { clean: true });
    assert.deepEqual(second.routes.failed, []);
    assert.deepEqual(second.assets.failed, []);
    await assert.rejects(readFile(path.join(outputDir, 'foreign.txt')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(outputDir, 'assets/foreign.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(outputDir, 'index.html'), 'utf8'), first.routes.succeeded.find(route => route.path === '/')!.data);
    assert.deepEqual(await readFile(path.join(outputDir, 'assets/a.bin')), Buffer.from([0,128,255]));
    assert.equal(f.closes(), 2);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('base path normalization is inert when absent and rewrites output while crawling raw URLs', async () => {
  const plain = fixture(), empty = fixture();
  await exportSite(plain.args); await exportSite(empty.args, { basePath: '' });
  assert.deepEqual(plain.writes, empty.writes);
  for (const basePath of ['repo', '/repo', '/repo/']) {
    const f = fixture();
    const report = await exportSite(f.args, { basePath });
    assert.equal(report.basePath, '/repo');
    assert.equal(typeof report.basePathRewriteWarning, 'string');
    assert.match(String(f.writes.get('index.html')), /href="\/repo\/about"/);
    assert.match(String(f.writes.get('index.html')), /srcset="\/repo\/assets\/a.bin 1x, \/repo\/assets\/b.bin 2x"/);
    assert.equal(f.writes.get('robots.txt'), 'Sitemap: /repo/sitemap.xml\n');
    assert.equal(f.writes.get('sitemap.xml'), '<loc>/repo/about</loc><loc>https://external.test/about</loc>');
    assert.equal(f.writes.get('feed.xml'), '<link>/about</link>');
    assert.equal(f.fetched.some(url => url.startsWith('/repo/')), false);
  }
  assert.equal(rewriteRouteBodyForBasePath({ path: '/', body: '<a href="/repo/about"></a><img src="//cdn.test/x"><img srcset="data:image/png;base64,AAA 1x, /a 2x">', basePath: '/repo' }), '<a href="/repo/about"></a><img src="//cdn.test/x"><img srcset="data:image/png;base64,AAA 1x, /repo/a 2x">');
});

test('crashed error pages and nonredirect responses fail without writing their artifacts', async () => {
  const f = fixture();
  const original = f.args.fetch;
  f.args.fetch = async (input, optional) => {
    const url = new URL(input.url);
    if (url.pathname === '/missing-probe') return new Response('crashed', { status: 500 });
    if (url.pathname === '/old') return new Response('not a redirect');
    return original(input, optional);
  };
  const report = await exportSite(f.args);
  assert.deepEqual(report.routes.failed.map(r => r.path), ['/old', '/missing-probe']);
  assert.equal(f.writes.has('404.html'), false);
  assert.equal(f.writes.has('old/index.html'), false);
  assert.equal(f.closes(), 1);
});

test('individual network/body/write failures are reported and the app always closes', async () => {
  for (const boundary of ['network', 'body', 'write'] as const) {
    const f = fixture();
    const original = f.args.fetch;
    f.args.fetch = async (input, optional) => {
      const pathname = new URL(input.url).pathname;
      if (['/missing-probe', '/assets/a.bin'].includes(pathname) && boundary !== 'write') {
        if (boundary === 'network') throw new TypeError('transport canary');
        return new Response(new ReadableStream({ start(controller) { controller.error(new Error('body canary')); } }), { status: pathname === '/missing-probe' ? 404 : 200 });
      }
      return original(input, optional);
    };
    if (boundary === 'write') f.args.writer.write = async ({ outputFile, data }) => { if (['404.html', 'assets/a.bin'].includes(outputFile)) throw new Error('write canary'); f.writes.set(outputFile, data); };
    const report = await exportSite(f.args);
    assert.deepEqual(report.routes.failed.map(r => r.path), ['/missing-probe']);
    assert.deepEqual(report.assets.failed.map(a => a.url), ['/assets/a.bin']);
    assert.match(report.routes.failed[0]!.reason, /canary/);
    assert.match(report.assets.failed[0]!.reason, /canary/);
    assert.equal(f.closes(), 1);
  }
});

test('hostile asset and route paths are refused before HTTP and artifact writes', async () => {
  const f = fixture();
  f.manifest.routes.push({ path: '/../../outside', kind: 'page', label: 'bad' });
  const original = f.args.fetch;
  f.args.fetch = async (input, optional) => new URL(input.url).pathname === '/' ? new Response('<img src="/assets/../../../outside"><img src="/assets/%2e%2e/%2e%2e/outside"><img src="/assets/%ZZ">', { headers: { 'content-type': 'text/html' } }) : original(input, optional);
  const report = await exportSite(f.args);
  assert.deepEqual(report.assets.failed.map(a => a.url), ['/assets/../../../outside', '/assets/%2e%2e/%2e%2e/outside', '/assets/%ZZ']);
  assert.equal(report.routes.failed.some(r => r.path === '/../../outside'), true);
  assert.equal(f.fetched.includes('/outside'), false);
  assert.equal([...f.writes.keys()].some(name => name.includes('outside')), false);
});

test('asset failures discovered by CSS are disclosed; a CSS child is not recursively scanned', async () => {
  const f = fixture();
  const original = f.args.fetch;
  f.args.fetch = async (input, optional) => {
    const pathname = new URL(input.url).pathname;
    if (pathname === '/assets/plain/main.css') return new Response('a{src:url(missing.woff)} @import url(child.css)', { headers: { 'content-type': 'text/css' } });
    if (pathname === '/assets/plain/child.css') return new Response('a{src:url(third-hop.bin)}', { headers: { 'content-type': 'text/css' } });
    return original(input, optional);
  };
  const report = await exportSite(f.args);
  assert.deepEqual(report.assets.failed.map(a => a.url), ['/assets/plain/missing.woff']);
  assert.equal(f.fetched.includes('/assets/plain/third-hop.bin'), false);
});

test('missing active theme needs no file inventory; writer refusal happens before app startup', async () => {
  const f = fixture();
  delete f.manifest.activeTheme;
  f.args.assetSource.listThemeFiles = async () => { assert.fail('inventory with no theme'); };
  assert.deepEqual((await exportSite(f.args)).unreferencedThemeFiles, []);
  const refused = fixture();
  refused.args.writer.prepare = async () => { throw new Error('output not empty'); };
  await assert.rejects(exportSite(refused.args), /output not empty/);
  assert.equal(refused.closes(), 0);
});

test('redirect decision boundaries, live header precedence and unsafe targets are preserved', () => {
  for (const status of [200, 299, 400, 500]) assert.deepEqual(redirectOutcomeFor({ status, locationHeader: '/live' }), { kind: 'failed', reason: `expected a 3xx redirect response, got ${status}` });
  assert.deepEqual(redirectOutcomeFor({ status: 301, locationHeader: '/live' }, { manifestTarget: '/declared' }), { kind: 'redirect-to', location: '/live' });
  assert.deepEqual(redirectOutcomeFor({ status: 302, locationHeader: null }, { manifestTarget: '/declared' }), { kind: 'redirect-to', location: '/declared' });
  assert.deepEqual(redirectOutcomeFor({ status: 302, locationHeader: null }), { kind: 'failed', reason: 'redirect response carried no Location header' });
  for (const location of ['javascript:alert(1)', 'data:text/html,attack', '//evil.test', '/\\evil.test']) {
    const html = renderRedirectStub({ location });
    assert.match(html, /content="0; url=#"/);
    assert.match(html, /href="#"/);
  }
  assert.match(renderRedirectStub({ location: '/safe?x="&' }), /url=\/safe\?x=&quot;&amp;/);
});

test('first export failure checks routes before assets and counts each collection separately', () => {
  const f = fixture();
  const report = { outputDir: '/artifact', routes: { succeeded: [], failed: [{ path: '/bad', kind: 'page', reason: 'bad' }] }, assets: { succeeded: [], failed: [{ url: '/asset', reason: 'missing' }, { url: '/two', reason: 'missing' }] }, skippedManifestEntries: f.manifest.skipped, unreferencedThemeFiles: [] };
  assert.deepEqual(firstExportFailure({ report }), { kind: 'route', identifier: '/bad', reason: 'bad', count: 1 });
  report.routes.failed = [];
  assert.deepEqual(firstExportFailure({ report }), { kind: 'asset', identifier: '/asset', reason: 'missing', count: 2 });
  report.assets.failed = [];
  assert.equal(firstExportFailure({ report }), undefined);
});
