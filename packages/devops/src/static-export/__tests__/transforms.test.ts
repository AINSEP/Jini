import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ExportPathError } from '../contracts.js';
import { extractAssetUrls, extractCssUrls, extractHtmlReferences, normalizeBasePath, outputFileForUrl, renderRedirectStub, rewriteRouteBodyForBasePath, safeRelativeOutputFile } from '../transforms.js';

const OUTSIDE = 'Output path resolved outside the output directory — refused';
const URL_OUTSIDE = 'URL resolved outside the output directory — refused';
/** Asserts the refusal is an ExportPathError carrying exactly `message`. */
function refuses(fn: () => unknown, message: string, label = ''): void {
  assert.throws(fn, (error: unknown) => error instanceof ExportPathError && error.message === message, label);
}

test('normalizeBasePath treats blank and root prefixes as no base path', () => {
  for (const raw of ['', '   ', '/', '//', ' /// ']) assert.equal(normalizeBasePath({ raw }), '');
});

test('normalizeBasePath adds a leading slash and drops trailing slashes', () => {
  assert.equal(normalizeBasePath({ raw: 'repo' }), '/repo');
  assert.equal(normalizeBasePath({ raw: ' /a/b// ' }), '/a/b');
});

test('normalizeBasePath refuses characters that would break URLs or markup', () => {
  for (const raw of ['/a\\b', '/a b', '/a\x00', '/a\x7f', '/a?x', '/a#x', '/a"b', "/a'b", '/a<b', '/a>b', '//cdn.test']) {
    refuses(() => normalizeBasePath({ raw }), 'Invalid export base path.', raw);
  }
});

test('normalizeBasePath refuses empty, dot and dot-dot segments', () => {
  for (const raw of ['/a//b', '/a/./b', '/a/../b', '..', '.']) {
    refuses(() => normalizeBasePath({ raw }), 'Invalid export base path.', raw);
  }
});

test('safeRelativeOutputFile accepts nested forward-slash paths unchanged', () => {
  assert.equal(safeRelativeOutputFile({ value: 'a/b.c/d.html' }), 'a/b.c/d.html');
  assert.equal(safeRelativeOutputFile({ value: '...' }), '...');
});

test('safeRelativeOutputFile refuses empty, absolute, separator, control and colon paths', () => {
  for (const value of ['', '/abs', 'a\\b', 'a\x00b', 'a\x1fb', 'a\x7fb', 'c:file']) refuses(() => safeRelativeOutputFile({ value }), OUTSIDE, JSON.stringify(value));
});

test('safeRelativeOutputFile refuses empty, dot and dot-dot segments', () => {
  for (const value of ['a//b', 'a/', './a', 'a/..', '../a']) refuses(() => safeRelativeOutputFile({ value }), OUTSIDE, value);
});

test('outputFileForUrl refuses non-rooted, protocol-relative and control-character URLs', () => {
  for (const url of ['', 'relative', '//cdn.test/a', '/a\\b', '/a\x00', '/a\x7f']) refuses(() => outputFileForUrl({ url }), URL_OUTSIDE, JSON.stringify(url));
});

test('outputFileForUrl refuses malformed percent-encoding', () => {
  refuses(() => outputFileForUrl({ url: '/a%ZZ' }), 'Invalid URL encoding — refused');
});

test('outputFileForUrl refuses decoded traversal and decoded separators', () => {
  for (const url of ['/a/%2e%2e/b', '/a/../b', '/a%5Cb', '/a%3Ab', '/a%00']) refuses(() => outputFileForUrl({ url }), OUTSIDE, url);
});

test('outputFileForUrl maps assets to their path and drops queries and fragments', () => {
  assert.equal(outputFileForUrl({ url: '/assets/a%20b.css?v=1#x' }), 'assets/a b.css');
  assert.equal(outputFileForUrl({ url: '/dir/' }), 'dir');
});

test('outputFileForUrl maps the root asset URL to an empty name that is then refused', () => {
  refuses(() => outputFileForUrl({ url: '/' }), OUTSIDE);
});

test('outputFileForUrl maps content routes to index.html except JSON files', () => {
  assert.equal(outputFileForUrl({ url: '/' }, { contentRoute: true }), 'index.html');
  assert.equal(outputFileForUrl({ url: '/?q=1' }, { contentRoute: true }), 'index.html');
  assert.equal(outputFileForUrl({ url: '/about/' }, { contentRoute: true }), 'about/index.html');
  assert.equal(outputFileForUrl({ url: '/batch.JSON?page=2' }, { contentRoute: true }), 'batch.JSON');
  assert.equal(outputFileForUrl({ url: '/robots.txt' }, { contentRoute: false }), 'robots.txt');
});

test('rewriteRouteBodyForBasePath leaves every body untouched without a base path', () => {
  const html = '<a href="/x"></a>';
  for (const path of ['/', '/sitemap.xml', '/robots.txt', '/x.json', '/feed.xml']) assert.equal(rewriteRouteBodyForBasePath({ path, body: html, basePath: '' }), html);
});

test('rewriteRouteBodyForBasePath never rewrites the feed', () => {
  assert.equal(rewriteRouteBodyForBasePath({ path: '/feed.xml', body: '<a href="/x"></a>', basePath: '/b' }), '<a href="/x"></a>');
});

test('rewriteRouteBodyForBasePath prefixes sitemap locations and robots sitemap lines only', () => {
  assert.equal(rewriteRouteBodyForBasePath({ path: '/sitemap.xml', body: '<loc>/a</loc><loc>/b/c</loc><loc>//x</loc><a href="/y">', basePath: '/b' }), '<loc>/b/a</loc><loc>/b/c</loc><loc>//x</loc><a href="/y">');
  assert.equal(rewriteRouteBodyForBasePath({ path: '/robots.txt', body: 'Sitemap:  /s.xml  \nAllow: /a\n', basePath: '/b' }), 'Sitemap: /b/s.xml\nAllow: /a\n');
});

test('rewriteRouteBodyForBasePath prefixes HTML attributes but not data- attributes or relative values', () => {
  assert.equal(
    rewriteRouteBodyForBasePath({ path: '/p', body: `<a href="/a"><img src='rel.png'><x data-href="/d"><v poster="/b/p"><a href="">`, basePath: '/b' }),
    `<a href="/b/a"><img src='rel.png'><x data-href="/d"><v poster="/b/p"><a href="">`,
  );
});

test('rewriteRouteBodyForBasePath rewrites each srcset candidate, keeping descriptors and trailing commas', () => {
  assert.equal(
    rewriteRouteBodyForBasePath({ path: '/', body: '<img srcset=" /a.png 1x,/c.png, /d.png 2x , rel.png 3x,">', basePath: '/b' }),
    '<img srcset=" /b/a.png 1x,/b/c.png, /b/d.png 2x , rel.png 3x,">',
  );
});

test('extractHtmlReferences yields attributes in document order, splitting srcset and skipping data- attributes', () => {
  const html = `<form method="post" action="/f"></form><a href="/a"><x data-src="/no"><img srcset="/s1 1x,/s2,, /s3 2x" src="/i"><video poster="/v"><form action=''>`;
  assert.deepEqual([...extractHtmlReferences({ html })], [
    { url: '/f', attribute: 'action' }, { url: '/a', attribute: 'href' }, { url: '/s1', attribute: 'srcset' }, { url: '/s2', attribute: 'srcset' },
    { url: '/s3', attribute: 'srcset' }, { url: '/i', attribute: 'src' }, { url: '/v', attribute: 'poster' }, { url: '', attribute: 'action' },
  ]);
});

test('extractHtmlReferences skips empty attribute values except form actions', () => {
  assert.deepEqual([...extractHtmlReferences({ html: '<a href=""><img srcset="  , "><form action="">' })], [{ url: '', attribute: 'action' }]);
});

test('extractAssetUrls keeps prefixed same-site URLs once, without fragments, ignoring protocol-relative ones', () => {
  const html = `<img src="/assets/a.png#f"><img src="/assets/a.png"><img src="//assets/x"><a href="/other"><img srcset="/assets/s.png 1x, /elsewhere 2x">`
    + `{"href": "/assets/j.png#k", "url":"//assets/no", "src" : "/nope", "title": "/assets/t.png"}`;
  assert.deepEqual(extractAssetUrls({ html, prefixes: ['/assets/'] }), ['/assets/a.png', '/assets/s.png']);
});

test('extractAssetUrls returns nothing without prefixes', () => {
  assert.deepEqual(extractAssetUrls({ html: '<img src="/assets/a.png">{"src":"/assets/b"}', prefixes: [] }), []);
});

test('extractCssUrls resolves against the stylesheet and keeps same-origin prefixed paths', () => {
  const css = `a{b:url(font.woff)} c{d:url( "../img/x.png" )} e{f:url('/assets/abs.png?v=1')} g{h:url(/other/z.png)}`;
  assert.deepEqual(extractCssUrls({ css, cssUrl: '/assets/css/main.css', prefixes: ['/assets/'] }), ['/assets/css/font.woff', '/assets/img/x.png', '/assets/abs.png']);
});

test('extractCssUrls skips blank, data:, unparseable and cross-origin references', () => {
  const css = `a{b:url(  )} c{d:url(data:image/png;base64,AAA)} e{f:url(http://[)} g{h:url(https://cdn.test/assets/x)} i{j:url(//cdn.test/assets/y)}`;
  assert.deepEqual(extractCssUrls({ css, cssUrl: '/assets/main.css', prefixes: ['/assets/'] }), []);
});

test('renderRedirectStub keeps fragment, http(s) and mailto targets', () => {
  for (const location of ['#top', 'https://example.test/a', 'HTTP://example.test', 'mailto:a@example.test']) {
    assert.match(renderRedirectStub({ location }), new RegExp(`href="${location.replace(/[.?]/g, '\\$&')}"`));
  }
});

test('renderRedirectStub keeps same-origin root paths and prefixes them with the base path', () => {
  assert.match(renderRedirectStub({ location: ' /a ' }), /content="0; url=\/a"/);
  assert.match(renderRedirectStub({ location: '/a' }, { basePath: '/b' }), /href="\/b\/a"/);
  assert.match(renderRedirectStub({ location: '/b/a' }, { basePath: '/b' }), /href="\/b\/a"/);
});

test('renderRedirectStub degrades unparseable, relative and backslash targets to #', () => {
  for (const location of ['// bad', 'relative/path', '/\\evil.test', 'ftp://x.test', '']) {
    assert.match(renderRedirectStub({ location }), /content="0; url=#"><link rel="canonical" href="#">/, JSON.stringify(location));
  }
});

test('renderRedirectStub escapes the visible location text', () => {
  assert.match(renderRedirectStub({ location: `javascript:'<x>'` }), /Redirecting to <a href="#">javascript:&#39;&lt;x&gt;&#39;<\/a>/);
});

test('extractAssetUrls never keeps protocol-relative URLs, even under a root prefix', () => {
  assert.deepEqual(extractAssetUrls({ html: '<img src="//cdn.test/a.png"><img srcset="//cdn.test/b.png 1x, /c.png 2x">{"src":"//cdn.test/d"}', prefixes: ['/'] }), ['/c.png']);
});


test('HTML rewriting and crawling only touch actual URL attributes and style positions', () => {
  const inert = `<article><code>background:url(/assets/sample.png)</code><pre>src="/assets/text.png" {"src":"/assets/json.png"}</pre>&lt;img src="/assets/escaped.png"&gt;</article><!-- <img src="/assets/comment.png"> --><script>const sample = '<img src="/assets/script.png">';</script>`;
  const real = `<IMG SRC = /assets/image.png><source srcset="/assets/a.png 1x, /assets/b.png 2x"><video poster='/assets/poster.png'></video><meta property="og:image" content="/assets/og.png"><meta content="/assets/tw.png" name="twitter:image"><meta name="description" content="url(/assets/description.png)"><link rel="manifest" href="/assets/site.webmanifest"><style>.x{background:url(/assets/style.png)}</style><div style="background:url('/assets/inline.png')" data-src="/assets/data.png"></div>`;
  const body = inert + real;
  const rewritten = rewriteRouteBodyForBasePath({ path: '/', body, basePath: '/repo' });
  assert.equal(rewritten.slice(0, inert.length), inert);
  const expected = ['image', 'a', 'b', 'poster', 'og', 'tw', 'style', 'inline'].map(name => `/assets/${name}.png`).concat('/assets/site.webmanifest');
  assert.deepEqual(new Set(extractAssetUrls({ html: body, prefixes: ['/assets/'] })), new Set(expected));
  for (const url of expected) assert.ok(rewritten.includes('/repo' + url), url);
  assert.ok(rewritten.includes('content="url(/assets/description.png)"'));
  assert.ok(rewritten.includes('data-src="/assets/data.png"'));
});


test('manifest and sitemap crawling require their explicit response formats', () => {
  const prefixes = ['/assets/'];
  assert.deepEqual(extractAssetUrls({ html: '{"icons":[{"src":"/assets/icon.png"}],"description":"url(/assets/sample.png)"}', prefixes }, { format: 'json' }), ['/assets/icon.png']);
  assert.deepEqual(extractAssetUrls({ html: '<urlset><image:loc>/assets/map.png</image:loc></urlset>', prefixes }, { format: 'xml' }), ['/assets/map.png']);
});
