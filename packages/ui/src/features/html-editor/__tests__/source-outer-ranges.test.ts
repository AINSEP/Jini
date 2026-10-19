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

describe('source element validation', () => {
  it('ranges a self-closing foreign element like a void element', () => {
    const [svg] = indexSourceElements({ html: '<svg><circle/><g></g></svg>' }, {});
    expect(svg!.children.map(child => child.outerRange)).toEqual([
      { outerStart: 5, outerEnd: 14, openingEnd: 14 },
      { outerStart: 14, outerEnd: 21, openingEnd: 17 },
    ]);
  });
  it('keeps ranges but marks both siblings unsupported when foster parenting reorders them', () => {
    const elements = indexSourceElements({ html: '<table><div>x</div></table>' }, {});
    expect(elements.map(el => [el.tagName, el.outerRange, el.sourceSupported])).toEqual([
      ['div', { outerStart: 7, outerEnd: 19, openingEnd: 12 }, false],
      ['table', { outerStart: 0, outerEnd: 27, openingEnd: 7 }, false],
    ]);
  });
  it('gives a template no range', () => {
    expect(indexSourceElements({ html: '<template><p>x</p></template>' }, {})[0]!.outerRange).toBeNull();
  });
  it('gives no range to an element located outside its parent content', () => {
    const second = indexSourceElements({ html: '<p><b>1<p>2</b>3' }, {})[1]!;
    expect(second.children.map(child => [child.tagName, child.outerRange])).toEqual([['b', null]]);
  });
  it('gives no range to an element whose end tag is omitted', () => {
    expect(indexSourceElements({ html: '<li>a<li>b' }, {}).map(el => el.outerRange)).toEqual([null, null]);
  });
  it('supports an element whose descendants are all supported', () => {
    expect(indexSourceElements({ html: '<div><p>x</p><br></div>' }, {})[0]!.sourceSupported).toBe(true);
  });
});
