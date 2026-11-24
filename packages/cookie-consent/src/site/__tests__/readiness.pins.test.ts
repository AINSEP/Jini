/** Declaration diagnostics replace the removed HTML gate; every output is labelled evidence. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { consentDeclarationReadiness } from '../readiness.js';

const inspect = (html: string, scripts: unknown = []) => consentDeclarationReadiness({ html, scripts, runtimeSlot: true });

test('raw scripts and inline handlers remain unmanaged; no tracker category is inferred', () => {
  const html = '<script src="/own.js"></script><button onclick="privateCode()">Go</button>';
  const result = inspect(html, [{ src: '/own.js', consent: ['analytics'] }]);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.every(item => item.code === 'UNMANAGED_CONTENT' && !('category' in item)));
  assert.ok(!JSON.stringify(result).includes('privateCode'));
});

for (const [value, source] of [
  ['', null], ['https://user:password@example.test/a.js?q=private#private', 'https://example.test/a.js'],
  ['https://[invalid', '[invalid resource URL]'], [`/${'x'.repeat(600)}`, `/${'x'.repeat(499)}`],
] as const) test(`source label redaction remains bounded: ${source?.slice(0, 30)}`, () => {
  assert.equal(inspect(`<script src="${value}"></script>`).warnings[0]!.source, source);
});

test('inert template contents and nonexecutable script data are not executable warning claims', () => {
  const result = inspect('<template><script src="/inert.js"></script></template><script type="application/ld+json">{}</script><script type="text/plain">privateCode()</script>');
  assert.deepEqual(result.warnings, []);
});

test('invalid declarations are blockers, separate from unmanaged warnings', () => {
  const result = inspect('<button onclick="go()">Go</button>', [{ src: '/bad.js', consent: ['unknown'] }]);
  assert.deepEqual(result.declarations, []);
  assert.equal(result.problems[0]!.code, 'INVALID_SCRIPT_DECLARATION');
  assert.equal(result.warnings[0]!.code, 'UNMANAGED_CONTENT');
});

test('known generated declarations and consent assets are not unmanaged page code', () => {
  const html = '<script data-jini-declared-script src="https://example.test/always.js"></script><script src="/_consent/client-abc.min.js"></script><script src="/_consent/extensions.min.js"></script>';
  const result = inspect(html, [{ src: 'https://example.test/always.js' }]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.declarations, [{ src: 'https://example.test/always.js' }]);
});

for (const count of [199, 200, 201]) test(`${count} unmanaged items report truncation only with another diagnostic entry`, () => {
  const result = inspect(`<head><title>Site</title></head><body><p>Ordinary</p>${'<script src="/raw.js"></script>'.repeat(count)}</body>`);
  assert.equal(result.warnings.length, Math.min(count, 200));
  assert.equal(result.truncated, count > 200);
  assert.equal(result.problems.some(item => item.code === 'INVENTORY_TRUNCATED'), count > 200);
});

test('exactly 200 declaration entries remain complete with ordinary DOM nodes left', () => {
  const scripts = Array.from({ length: 200 }, (_, index) => ({ src: `/script-${index}.js` }));
  const result = inspect('<html><head><title>Site</title></head><body>Ordinary</body></html>', scripts);
  assert.equal(result.declarations.length, 200);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.problems, []);
});

test('oversized sample is blocking evidence and never passed to an HTML gate', () => {
  const result = inspect('x'.repeat(1_000_001));
  assert.equal(result.truncated, true);
  assert.equal(result.problems[0]!.code, 'PAGE_UNAVAILABLE');
  assert.deepEqual(result.warnings, []);
});

test('full-document loading-slot gap is separately labelled, even at the diagnostics cap', () => {
  const result = consentDeclarationReadiness({ html: '<p>Page</p>', scripts: Array.from({ length: 200 }, () => ({ src: '/a.js' })), runtimeSlot: false });
  assert.equal(result.warnings[0]!.code, 'MISSING_RUNTIME_SLOT');
  assert.equal(result.declarations.length + result.warnings.length, 200);
  assert.equal(result.truncated, true);
});
