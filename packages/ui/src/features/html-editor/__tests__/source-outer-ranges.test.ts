// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { indexSourceElements } from '../source-splice.js';

describe('verified outer source ranges', () => {
  it.each(['<img data-kui title="a > b">', "<span title='a > b' data-kui>é &amp; 😀\r\né</span>", '<script>if (1 > 0) x("&amp;");</script>', '<style>p > b { color : red; }</style>'])('slices exact authored code units: %s', html => {
    const [element] = indexSourceElements({ html }, {});
    expect(element!.outerRange!.outerStart).toBe(0);
    expect(element!.outerRange!.outerEnd).toBe(html.length);
    const opening = html.startsWith('<img') ? html : html.slice(0, html.indexOf('>é') >= 0 ? html.indexOf('>é') + 1 : html.indexOf('>') + 1);
    expect(html.slice(0, element!.outerRange!.openingEnd)).toBe(opening);
    expect(html.slice(element!.outerRange!.outerStart, element!.outerRange!.outerEnd)).toBe(html);
  });
  it('keeps atom positions but excludes atoms from text-splice path slots', () => {
    const elements = indexSourceElements({ html: '<style>x{}</style><p>hi</p><script>x()</script><p>bye</p>' }, {});
    expect(elements.map(el => el.path)).toEqual([null, [0], null, [1]]);
  });
  it.each(['<div>', '<p>x<p>y</p>', '<table><tr><td>x</td></tr></table>'])('marks unsupported outer ranges instead of guessing: %s', html => {
    expect(indexSourceElements({ html }, {})[0]!.sourceSupported).toBe(false);
  });
});
