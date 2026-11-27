import { expect, it } from 'vitest';
import { cssUrlRefs } from '../css-url-refs.js';

it.each([
  ['word boundary and case', '_url(hidden.svg) curl(other.svg) URL(keep.svg)', ['keep.svg']],
  ['optional independent quotes', `url("a.svg) url(b.svg'  ) url('c.svg" )`, ['a.svg', 'b.svg', 'c.svg']],
  ['invalid quoted closers do not consume the next opener', `url('bad.svg' nonsense) url("good.svg")`, ['good.svg']],
  ['empty refs and whitespace backtracking', `url() url('') url(') url(  ) url( ') URL(real.svg)`, [' ', ' ', 'real.svg']],
  ['unterminated input does not invent a reference', 'url(valid.svg) url("unfinished.svg', ['valid.svg']],
  ['embedded opener inside a consumed legacy capture', 'url(url(inner.svg) url(outer.svg)', ['url(inner.svg', 'outer.svg']],
] as const)('respects legacy CSS capture rules for %s', (_name, text, refs) => {
  expect(cssUrlRefs(text)).toEqual(refs);
});
