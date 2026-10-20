import assert from 'node:assert/strict';
import { test } from 'vitest';
import { exportSite } from '../runner.js';
import type { ExportSiteArgs, ManifestRoute, RouteManifest } from '../contracts.js';

type Responder = () => Response | Promise<Response>;

/** Minimal export harness: every request is answered from `responses` (404 when absent). */
function harness(routes: ManifestRoute[], responses: Record<string, Responder>, theme?: RouteManifest['activeTheme']) {
  const writes = new Map<string, string | Buffer>();
  const fetched: string[] = [];
  let closes = 0;
  const manifest: RouteManifest = { routes, skipped: [], ...(theme ? { activeTheme: theme } : {}) };
  const args: ExportSiteArgs = {
    outputDir: '/out', manifest: { build: async () => manifest },
    app: { open: async () => ({ baseUrl: 'http://127.0.0.1:4000', close: async () => { closes++; } }) },
    writer: { prepare: async () => {}, write: async ({ outputFile, data }) => { writes.set(outputFile, data); } },
    assetSource: { listThemeFiles: async () => [] },
    themeLayout: { resolve: () => ({ pagesDir: 'pages', assetUrlPrefix: '/assets/t/' }) },
    assetUrlPrefixes: ['/assets/'], requestHeaders: {},
    security: { transformHtml: ({ html }) => '<!--safe-->' + html },
    errorPage: { outputFile: '404.html', acceptStatus: ({ status }) => status === 404 },
    describeError: ({ error }) => error instanceof Error ? `described ${error.message}` : 'described',
    fetch: async (input) => {
      const url = new URL(input.url);
      fetched.push(url.pathname + url.search);
      const respond = responses[url.pathname + url.search] ?? responses[url.pathname];
      return respond ? respond() : new Response('missing', { status: 404 });
    },
  };
  return { args, manifest, writes, fetched, closes: () => closes };
}
const html = (body: string, status = 200): Responder => () => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const page = (path: string, kind = 'page'): ManifestRoute => ({ path, kind, label: path });

test('a thrown TimeoutError is reported as a timeout with the configured limit', async () => {
  const h = harness([page('/')], { '/': () => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }); } });
  const report = await exportSite(h.args, { fetchTimeoutMs: 5 });
  assert.deepEqual(report.routes.failed, [{ path: '/', kind: 'page', reason: 'GET http://127.0.0.1:4000/ timed out after 5ms' }]);
});

test('a thrown AbortError is reported as a timeout with the default limit', async () => {
  const h = harness([page('/')], { '/': () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } });
  assert.equal((await exportSite(h.args)).routes.failed[0]!.reason, 'GET http://127.0.0.1:4000/ timed out after 30000ms');
});

test('a thrown non-Error value is described by the host', async () => {
  const h = harness([page('/')], { '/': () => { throw 'plain string'; } });
  assert.equal((await exportSite(h.args)).routes.failed[0]!.reason, 'GET http://127.0.0.1:4000/ failed: described');
});

test('every request carries manual redirects, the caller headers and a timeout signal', async () => {
  const h = harness([page('/')], { '/': html('ok') });
  let init: RequestInit | undefined;
  const original = h.args.fetch;
  h.args.fetch = async (input, optional) => { init = optional?.init; return original(input, optional); };
  h.args.requestHeaders = { 'x-mode': 'export' };
  await exportSite(h.args);
  assert.equal(init?.redirect, 'manual');
  assert.equal(new Headers(init?.headers).get('x-mode'), 'export');
  assert.ok(init?.signal instanceof AbortSignal);
});

test('a redirect route without a manifest target uses the live Location and cancels a non-empty body', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('moved')); }, cancel() { cancelled = true; } });
  const h = harness([{ path: '/old', kind: 'redirect', label: 'old' }], { '/old': () => new Response(body, { status: 302, headers: { location: '/new' } }) });
  const report = await exportSite(h.args, { basePath: '/b' });
  assert.equal(cancelled, true);
  const written = String(h.writes.get('old/index.html'));
  assert.ok(written.startsWith('<!--safe--><!doctype html>'));
  assert.match(written, /url=\/b\/new"/);
  assert.equal(report.routes.succeeded[0]!.contentType, 'text/html; charset=utf-8');
});

test('a redirect route with no Location and no manifest target fails without writing', async () => {
  const h = harness([{ path: '/old', kind: 'redirect', label: 'old' }], { '/old': () => new Response(null, { status: 301 }) });
  const report = await exportSite(h.args);
  assert.deepEqual(report.routes.failed, [{ path: '/old', kind: 'redirect', reason: 'redirect response carried no Location header' }]);
  assert.equal(h.writes.size, 0);
});

test('a redirect route is never crawled for assets or discovered routes', async () => {
  const h = harness([{ path: '/old', kind: 'redirect', label: 'old', redirectTarget: '/assets/x.png' }], { '/old': () => new Response(null, { status: 301 }) });
  h.args.discoverRoutes = () => assert.fail('redirect stubs are not scanned for routes');
  await exportSite(h.args);
  assert.deepEqual(h.fetched, ['/old']);
});

test('an error-page rejection uses the host rejection reason when supplied', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const h = harness([page('/probe', 'not-found')], { '/probe': () => new Response(body, { status: 500 }) });
  h.args.errorPage.rejectionReason = ({ status }) => `host says ${status}`;
  const report = await exportSite(h.args);
  assert.deepEqual(report.routes.failed, [{ path: '/probe', kind: 'not-found', reason: 'host says 500' }]);
  assert.equal(cancelled, true);
});

test('an error-page rejection without a host reason names the status', async () => {
  const h = harness([page('/probe', 'not-found')], { '/probe': html('ok', 200) });
  assert.equal((await exportSite(h.args)).routes.failed[0]!.reason, 'expected an accepted response for the error-page probe, got 200');
});

test('a non-200 content route fails with the status', async () => {
  const h = harness([page('/a')], { '/a': html('moved', 301) });
  assert.deepEqual((await exportSite(h.args)).routes.failed, [{ path: '/a', kind: 'page', reason: 'expected 200, got 301' }]);
});

test('the error page is written to the host artifact path, always sanitized, and never crawled', async () => {
  const h = harness([page('/probe', 'not-found')], { '/probe': () => new Response('<img src="/assets/e.png">', { status: 404 }) });
  h.args.discoverRoutes = () => assert.fail('error pages are not scanned for routes');
  const report = await exportSite(h.args, { basePath: '/b' });
  assert.equal(h.writes.get('404.html'), '<!--safe--><img src="/b/assets/e.png">');
  assert.deepEqual(h.fetched, ['/probe']);
  assert.equal(report.routes.succeeded[0]!.outputFile, '404.html');
});

test('a hostile error-page artifact path is refused before any request', async () => {
  const h = harness([page('/probe', 'not-found')], { '/probe': html('x', 404) });
  h.args.errorPage.outputFile = '../escape.html';
  const report = await exportSite(h.args);
  assert.deepEqual(report.routes.failed, [{ path: '/probe', kind: 'not-found', reason: 'GET http://127.0.0.1:4000/probe failed: described Output path resolved outside the output directory — refused' }]);
  assert.deepEqual(h.fetched, []);
});

test('an error-page request path is validated even though its artifact path comes from the host', async () => {
  const h = harness([page('/../probe', 'not-found')], {});
  const report = await exportSite(h.args);
  assert.equal(report.routes.failed[0]!.reason, 'GET http://127.0.0.1:4000/../probe failed: described Output path resolved outside the output directory — refused');
  assert.deepEqual(h.fetched, []);
});

test('only text/html content routes are sanitized; other types are written as rewritten text', async () => {
  const h = harness([page('/a'), page('/robots.txt', 'well-known'), page('/data.json')], {
    '/a': () => new Response('<a href="/x">', { headers: { 'content-type': 'TEXT/HTML; charset=utf-8' } }),
    '/robots.txt': () => new Response('Sitemap: /s.xml', { headers: { 'content-type': 'text/plain' } }),
    '/data.json': () => new Response('{"href":"/x"}', { headers: { 'content-type': 'application/json' } }),
  });
  await exportSite(h.args, { basePath: '/b' });
  assert.equal(h.writes.get('a/index.html'), '<!--safe--><a href="/b/x">');
  assert.equal(h.writes.get('robots.txt'), 'Sitemap: /b/s.xml');
  assert.equal(h.writes.get('data.json'), '{"href":"/b/x"}');
});

test('a content route without a content type is written unsanitized and still scanned for dropped references', async () => {
  const h = harness([page('/a')], { '/a': () => new Response(new TextEncoder().encode('<a href="/gone">')) });
  const report = await exportSite(h.args);
  assert.equal(report.routes.succeeded[0]!.contentType, null);
  assert.equal(h.writes.get('a/index.html'), '<a href="/gone">');
  assert.deepEqual(report.droppedReferences, [{ page: '/a', url: '/gone', attribute: 'href', reason: 'not-exported' }]);
});

test('a non-HTML route with a non-.html artifact is not scanned for dropped references', async () => {
  const h = harness([page('/robots.txt', 'well-known')], { '/robots.txt': () => new Response('href="/gone"', { headers: { 'content-type': 'text/plain' } }) });
  assert.deepEqual((await exportSite(h.args)).droppedReferences, []);
});

test('discovered routes already in the manifest are not requested twice', async () => {
  const h = harness([page('/'), page('/b')], { '/': html('home'), '/b': html('b') });
  h.args.discoverRoutes = () => [page('/b'), page('/'), page('/c')];
  const report = await exportSite(h.args);
  assert.deepEqual(h.fetched, ['/', '/b', '/c']);
  assert.deepEqual(report.routes.failed.map(route => route.path), ['/c']);
});

test('discovery receives the raw pre-rewrite HTML and the page path', async () => {
  const h = harness([page('/p')], { '/p': html('<a href="/x">') });
  const seen: Array<{ path: string; html: string }> = [];
  h.args.discoverRoutes = (required) => { seen.push(required); return []; };
  await exportSite(h.args, { basePath: '/b' });
  assert.deepEqual(seen, [{ path: '/p', html: '<a href="/x">' }]);
});

test('an asset already fetched is not fetched again when a stylesheet references it', async () => {
  const h = harness([page('/')], {
    '/': html('<link href="/assets/a.css"><img src="/assets/i.png">'),
    '/assets/a.css': () => new Response('x{y:url(i.png)} z{w:url(/assets/a.css)}', { headers: { 'content-type': 'text/css' } }),
    '/assets/i.png': () => new Response(new Uint8Array([1])),
  });
  const report = await exportSite(h.args);
  assert.deepEqual(h.fetched, ['/', '/assets/a.css', '/assets/i.png']);
  assert.deepEqual(report.assets.succeeded.map(asset => asset.url), ['/assets/a.css', '/assets/i.png']);
});

test('a stylesheet with a query string is still crawled one hop', async () => {
  const h = harness([page('/')], {
    '/': html('<link href="/assets/a.css?v=2">'),
    '/assets/a.css': () => new Response('x{y:url(f.woff)}', { headers: { 'content-type': 'text/css' } }),
    '/assets/f.woff': () => new Response(new Uint8Array([2])),
  });
  await exportSite(h.args);
  assert.deepEqual(h.fetched, ['/', '/assets/a.css?v=2', '/assets/f.woff']);
});

test('a failed asset response is cancelled and reported with its status', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const h = harness([page('/')], { '/': html('<img src="/assets/x.png">'), '/assets/x.png': () => new Response(body, { status: 503 }) });
  const report = await exportSite(h.args);
  assert.deepEqual(report.assets.failed, [{ url: '/assets/x.png', reason: 'GET /assets/x.png -> 503' }]);
  assert.equal(cancelled, true);
});

test('a refused asset path uses the host term when supplied, before any request', async () => {
  const h = harness([page('/')], { '/': html('<img src="/assets/%2e%2e/%2e%2e/x">') });
  h.args.assetPathFailureReason = 'unsafe asset path';
  const report = await exportSite(h.args);
  assert.deepEqual(report.assets.failed, [{ url: '/assets/%2e%2e/%2e%2e/x', reason: 'unsafe asset path' }]);
  assert.deepEqual(h.fetched, ['/']);
});

test('the host asset term is not used for transport failures', async () => {
  const h = harness([page('/')], { '/': html('<img src="/assets/x.png">'), '/assets/x.png': () => { throw new Error('reset'); } });
  h.args.assetPathFailureReason = 'unsafe asset path';
  assert.deepEqual((await exportSite(h.args)).assets.failed, [{ url: '/assets/x.png', reason: 'GET http://127.0.0.1:4000/assets/x.png failed: described reset' }]);
});

test('theme pages, index, 404 and fetched theme assets are accounted; other theme files are unreferenced', async () => {
  const h = harness([page('/'), { path: '/about', kind: 'theme-page', label: 'about' }, { path: '/x', kind: 'page', label: 'contact' }], {
    '/': html('<img src="/assets/t/img%20one.png?v=1#f"><img src="/assets/other/z.png">'), '/about': html('a'), '/x': html('x'),
    '/assets/t/img%20one.png': () => new Response(new Uint8Array([1])), '/assets/other/z.png': () => new Response(new Uint8Array([1])),
  }, { id: 't', dir: '/theme' });
  h.args.assetSource.listThemeFiles = async () => ['pages/contact.html', 'pages/404.html', 'img one.png', 'pages/index.html', 'pages/about.html', 'other/z.png', 'a.txt'];
  assert.deepEqual((await exportSite(h.args)).unreferencedThemeFiles, ['a.txt', 'other/z.png', 'pages/contact.html']);
});

test('a link and a later form to the same URL become one needs-server entry', async () => {
  const h = harness([page('/')], { '/': html('<a href="/submit"></a><form action="/submit"></form><a href="/submit?again"></a>') });
  assert.deepEqual((await exportSite(h.args)).droppedReferences, [{ page: '/', url: '/submit', attribute: 'action', reason: 'needs-server' }]);
});

test('an empty or query-only form action targets the page itself and is reported as needs-server', async () => {
  const h = harness([page('/p')], { '/p': html('<form action=""></form><form action="?x=1"></form><a href="?y"></a><a href=" "></a>') });
  assert.deepEqual((await exportSite(h.args)).droppedReferences, [{ page: '/p', url: '/p', attribute: 'action', reason: 'needs-server' }]);
});

test('unparseable and fragment-only references are skipped', async () => {
  const h = harness([page('/')], { '/': html('<a href="http://[bad"></a><a href="#top"></a><form action="#f"></form>') });
  assert.deepEqual((await exportSite(h.args)).droppedReferences, []);
});

test('relative references resolve against the base-path page URL and the base path is stripped', async () => {
  const h = harness([page('/docs/')], { '/docs/': html('<a href="next"></a><a href="/b"></a><a href="/bb/x"></a>') });
  const report = await exportSite(h.args, { basePath: '/b' });
  assert.deepEqual(report.droppedReferences, [
    { page: '/docs/', url: '/docs/next', attribute: 'href', reason: 'not-exported' },
    { page: '/docs/', url: '/', attribute: 'href', reason: 'not-exported' },
    { page: '/docs/', url: '/bb/x', attribute: 'href', reason: 'not-exported' },
  ]);
});

test('a reference to the bare base path resolves to the site root', async () => {
  const h = harness([page('/p')], { '/p': html('<form action="/b"></form>') });
  const report = await exportSite(h.args, { basePath: '/b' });
  assert.deepEqual(report.droppedReferences, [{ page: '/p', url: '/', attribute: 'action', reason: 'needs-server' }]);
});

test('written artifact paths, route paths and asset URLs all count as exported; the error-page request path does not', async () => {
  const h = harness([page('/p'), page('/probe', 'not-found')], {
    '/p': html('<a href="/p/index.html"></a><a href="/p/"></a><a href="/404.html"></a><a href="/probe"></a><img src="/assets/i.png?x"><a href="/assets/i.png/"></a>'),
    '/probe': html('', 404), '/assets/i.png': () => new Response(new Uint8Array([1])),
  });
  assert.deepEqual((await exportSite(h.args)).droppedReferences, [{ page: '/p', url: '/probe', attribute: 'href', reason: 'not-exported' }]);
});

test('dropped references are deduplicated per page, not across pages', async () => {
  const h = harness([page('/a'), page('/b')], { '/a': html('<a href="/gone"></a>'), '/b': html('<a href="/gone"></a>') });
  assert.deepEqual((await exportSite(h.args)).droppedReferences.map(ref => ref.page), ['/a', '/b']);
});

test('a needs-server upgrade still applies to an existing key after the 200-entry cap', async () => {
  const links = Array.from({ length: 200 }, (_, i) => `<a href="/m${i}"></a>`).join('');
  const h = harness([page('/')], { '/': html(links + '<form action="/m0"></form><form action="/new"></form>') });
  const dropped = (await exportSite(h.args)).droppedReferences;
  assert.equal(dropped.length, 200);
  assert.deepEqual(dropped[0], { page: '/', url: '/m0', attribute: 'action', reason: 'needs-server' });
  assert.equal(dropped.some(ref => ref.url === '/new'), false);
});

test('fetchTimeoutMs must be a positive safe integer, checked before the writer prepares', async () => {
  for (const fetchTimeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    const h = harness([page('/')], {});
    let prepared = false;
    h.args.writer.prepare = async () => { prepared = true; };
    await assert.rejects(exportSite(h.args, { fetchTimeoutMs }), (error: unknown) => error instanceof RangeError && error.message === 'fetchTimeoutMs must be a positive integer');
    assert.equal(prepared, false);
  }
});

test('an invalid base path is refused before the writer prepares', async () => {
  const h = harness([page('/')], {});
  h.args.writer.prepare = async () => assert.fail('prepared');
  await assert.rejects(exportSite(h.args, { basePath: '/a/../b' }), { message: 'Invalid export base path.' });
});

test('prepare receives the clean flag, defaulting to false', async () => {
  const seen: Array<boolean | undefined> = [];
  for (const options of [{}, { clean: true }]) {
    const h = harness([], {});
    h.args.writer.prepare = async (_required, optional) => { seen.push(optional?.clean); };
    await exportSite(h.args, options);
  }
  assert.deepEqual(seen, [false, true]);
});

test('an app session that is not a bare HTTP origin is refused and still closed', async () => {
  for (const baseUrl of ['ftp://127.0.0.1', 'http://user@127.0.0.1', 'http://:pw@127.0.0.1', 'http://127.0.0.1/app', 'http://127.0.0.1/?q', 'http://127.0.0.1/#h', 'file:///tmp/x']) {
    const h = harness([page('/')], { '/': html('x') });
    let closed = 0;
    h.args.app.open = async () => ({ baseUrl, close: async () => { closed++; } });
    await assert.rejects(exportSite(h.args), (error: unknown) => error instanceof Error && error.message === 'App session baseUrl must be an HTTP origin without credentials.', baseUrl);
    assert.equal(closed, 1, baseUrl);
    assert.deepEqual(h.fetched, [], baseUrl);
  }
});

test('an unparseable app session URL is refused and still closed', async () => {
  const h = harness([page('/')], {});
  let closed = 0;
  h.args.app.open = async () => ({ baseUrl: 'not a url', close: async () => { closed++; } });
  await assert.rejects(exportSite(h.args), (error: unknown) => error instanceof TypeError && /Invalid URL/.test(error.message));
  assert.equal(closed, 1);
});

test('https origins and trailing-slash origins are accepted and requests use the bare origin', async () => {
  for (const baseUrl of ['https://site.test:8443/', 'http://127.0.0.1:4000']) {
    const h = harness([page('/')], { '/': html('x') });
    const urls: string[] = [];
    h.args.app.open = async () => ({ baseUrl, close: async () => {} });
    h.args.fetch = async (input) => { urls.push(input.url); return new Response('x'); };
    await exportSite(h.args);
    assert.deepEqual(urls, [new URL(baseUrl).origin + '/']);
  }
});

test('the report carries the base path warning only when a base path is set', async () => {
  const plain = await exportSite(harness([], {}).args);
  assert.equal('basePath' in plain, false);
  assert.equal('basePathRewriteWarning' in plain, false);
  const based = await exportSite(harness([], {}).args, { basePath: 'b' });
  assert.equal(based.basePath, '/b');
  assert.match(based.basePathRewriteWarning!, /^base-path rewriting is a best-effort TEXT rewrite/);
});

test('a manifest build failure propagates before the app opens', async () => {
  const h = harness([], {});
  h.args.manifest.build = async () => { throw new Error('manifest canary'); };
  await assert.rejects(exportSite(h.args), { message: 'manifest canary' });
  assert.equal(h.closes(), 0);
});

test('a theme inventory failure propagates after the app closes', async () => {
  const h = harness([], {}, { id: 't', dir: '/theme' });
  h.args.assetSource.listThemeFiles = async () => { throw new Error('inventory canary'); };
  await assert.rejects(exportSite(h.args), { message: 'inventory canary' });
  assert.equal(h.closes(), 1);
});
