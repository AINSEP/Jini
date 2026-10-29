import { describe, expect, it } from 'vitest';
import { cssUrlTokens } from '../css-urls.js';

// The scanner replaced this regex; it must find the same tokens, spans and captures.
const REGEX = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const viaRegex = (css: string) => [...css.matchAll(REGEX)].map(match => ({ start: match.index!, end: match.index! + match[0].length, quote: match[1]!, value: match[2]! }));

describe('cssUrlTokens', () => {
  it.each([
    'a { background: url(/a.png) }',
    "url( '/b.png' ) url(\"/c.png\")",
    'url(  )',
    'url()',
    "url('a\"b')",
    'url( x y )',
    "url('')",
    'url(url(/a.png))',
    "url('/a.png' x)",
    'url(/a.png',
    "url(  'q' )url(\n/n\n)",
  ])('matches the regex on %j', css => {
    expect(cssUrlTokens(css)).toEqual(viaRegex(css));
  });

  it('stays linear on an unterminated value', () => {
    const css = 'url('.repeat(20_000) + ' '.repeat(50_000);
    expect(cssUrlTokens(css)).toEqual([]);
  });
});
