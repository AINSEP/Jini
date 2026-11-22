/** Pins every diagnostic media-html emits (text, arguments, order), so the move to a package that
 * has no console of its own can prove each line still reaches the host's log. */
import assert from 'node:assert/strict';
import { test } from '../../../__tests__/support/node-test.fixture.js';
import { renderMediaRawHtml, sanitizePageHtml } from '../../html/index.js';
import { logMediaHtmlEvent } from '../media-html-log.js';

const renderPhoto = ({ props }: { props: Record<string, unknown> }): string => props.slug === 'photo' ? '<img src="/photo" alt="Library">' : '';

test('a mixed fixture logs the sanitizer drops, then each unknown slug and each kind mismatch, in visit order', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const html = '<script>x()</script><p>{{media:ghost}}</p><video data-media-slug="photo"></video><b>kept</b>';
  const output = renderMediaRawHtml({ html, media: { photo: { slug: 'photo' } }, renderMedia: renderPhoto }, { report: logMediaHtmlEvent });
  assert.equal(output, '<b>kept</b>');
  assert.deepEqual(warn.mock.calls.map(call => call.arguments), [
    ['[media] Raw HTML sanitizer dropped markup', { script: 1 }],
    ['[media] media kind does not match Raw HTML element', { slug: 'photo', tag: 'video', mediaTag: 'img' }],
    ['[media] unknown slug in raw HTML', { slug: 'ghost' }],
  ]);
});

test('a malformed fragment is repaired by the parser, resolved and logs nothing when nothing is dropped', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const html = '<p>open <b>bold <img data-media-slug="photo"></i> tail';
  const output = renderMediaRawHtml({ html, media: { photo: { slug: 'photo' } }, renderMedia: renderPhoto }, { report: logMediaHtmlEvent });
  assert.equal(output, '<p>open <b>bold <img data-media-slug="photo" src="/photo" alt="Library"> tail</b></p>');
  assert.equal(warn.mock.callCount(), 0);
});

test('sanitizePageHtml on its own logs once for a call that drops markup', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(sanitizePageHtml({ html: '<iframe src="https://x.example/"></iframe><i>ok</i>' }, { report: logMediaHtmlEvent }), '<i>ok</i>');
  assert.deepEqual(warn.mock.calls.map(call => call.arguments), [['[media] Raw HTML sanitizer dropped markup', { iframe: 1 }]]);
});
