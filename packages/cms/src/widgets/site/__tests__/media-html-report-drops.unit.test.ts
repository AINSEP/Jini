/** sanitizePageHtml never drops silently (owner, 2026-10-12): 5f237c87a stripped the host's own site's carousel
 * scripts with no trace. Each call that removed anything reports ONCE, naming what and how many. */
import assert from 'node:assert/strict';
import { test } from '../../../__tests__/support/node-test.fixture.js';
import { renderMediaRawHtml, sanitizePageHtml } from '../../html/index.js';
import { logMediaHtmlEvent } from '../media-html-log.js';

test('one report per call, listing every dropped tag and attribute with counts', () => {
  const reports: Record<string, number>[] = [];
  const html = `<p>a</p><script>x()</script><script>y()</script><iframe src="https://x.example/"></iframe><button onclick="z()" class="b">b</button><a href="javascript:evil()">c</a><svg><foreignObject><p>d</p></foreignObject></svg><style>*{}</style><!-- note -->`;
  const output = sanitizePageHtml({ html }, { reportDrops: ({ dropped }) => reports.push(dropped) });
  assert.equal(output, '<p>a</p><button class="b">b</button><a>c</a><svg></svg><style>*{}</style>');
  assert.deepEqual(reports, [{ script: 2, iframe: 1, 'button@onclick': 1, 'a@href': 1, foreignObject: 1 }]);
});

test('a call that drops nothing does not report (comments are not markup)', () => {
  let calls = 0;
  sanitizePageHtml({ html: '<p class="x">kept <b>all</b></p><!-- comment -->' }, { reportDrops: () => { calls += 1; } });
  assert.equal(calls, 0);
});

test('the default reporter logs exactly one console warning per dropping call', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  sanitizePageHtml({ html: '<script>a()</script><script>b()</script><img src="/x.png" onerror="c()">' }, { report: logMediaHtmlEvent });
  sanitizePageHtml({ html: '<p>clean</p>' }, { report: logMediaHtmlEvent });
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(warn.mock.calls[0]!.arguments, ['[media] Raw HTML sanitizer dropped markup', { script: 2, 'img@onerror': 1 }]);
});

test('elements nested past the 128-level bound are dropped and reported, keeping the shallower markup', () => {
  const reports: Record<string, number>[] = [];
  const html = `${'<div>'.repeat(130)}deep${'</div>'.repeat(130)}`;
  const output = sanitizePageHtml({ html }, { reportDrops: ({ dropped }) => reports.push(dropped) });
  assert.equal(output, `${'<div>'.repeat(128)}${'</div>'.repeat(128)}`);
  assert.deepEqual(reports, [{ div: 1 }]);
});

test('the default unknown-slug reporter warns once per slug that the media renderer cannot resolve', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const output = renderMediaRawHtml({ html: '<p>{{media:ghost}} and {{media:ghost}}</p>', media: {}, renderMedia: () => '' }, { report: logMediaHtmlEvent });
  assert.equal(output, '', 'markup holding an unresolvable token is dropped, never shown with the raw token');
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(warn.mock.calls[0]!.arguments, ['[media] unknown slug in raw HTML', { slug: 'ghost' }]);
});
