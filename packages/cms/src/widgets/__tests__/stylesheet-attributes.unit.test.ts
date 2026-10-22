import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseEmbedHtmlAttributes } from '../markers/html-attributes.js';

test('stylesheet validation accepts Unicode glyph escapes without rewriting the CSS', () => {
  for (const escape of ['\\2713', '\\002713 ', '\\1f680 ', '\\A0 ', '\\10ffff']) {
    const css = `.checks::before { content: '${escape}'; }`;
    const result = parseEmbedHtmlAttributes({ text: `style="${css}"` }, { styleContext: 'stylesheet' });
    assert.deepEqual(result, { attributes: { style: css }, errors: [], error: null });
    // Inline attributes retain their established conservative escape policy.
    assert.equal(parseEmbedHtmlAttributes({ text: `style="${css}"` }).error?.reason, 'unsafe-style');
  }
});

test('stylesheet validation still rejects escaped executable CSS and invalid code points', () => {
  for (const css of [
    'width:\\65 xpression(1)',
    'background:url(\\6a avascript:x)',
    'background:url(\\00006A\r\navascript:x)',
    'background:url(\\v bscript:x)',
    '@\\69mport url(x)',
    '-moz-\\62inding:url(x)',
    'beha\\76ior:url(x)',
    '@import url(x)',
    'background:url(javascript:x)',
    "content:'\\0'",
    "content:'\\9f'",
    "content:'\\d800'",
    "content:'\\110000'",
    "content:'\\\\'",
  ]) {
    const result = parseEmbedHtmlAttributes({ text: `style="${css}" data-safe="kept"` }, { styleContext: 'stylesheet' });
    assert.deepEqual(result.attributes, { 'data-safe': 'kept' }, css);
    assert.deepEqual(result.errors, [{ reason: 'unsafe-style', attribute: 'style' }], css);
  }
});
