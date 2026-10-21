import { expect, it } from 'vitest';
import { indexElementSourceRanges, pathKey, spliceElementInner } from '../source-splice.js';

it('never addresses an element the parser created from a stray end tag, so it is never spliced', () => {
  for (const [html, tagName] of [['<div>a</p>b</div>', 'p'], ['<div></br></div>', 'br']] as const) {
    const index = indexElementSourceRanges(html);
    expect(index.get(pathKey([0]))?.tagName).toBe('div');
    expect(index.has(pathKey([0, 0]))).toBe(false);
    expect(spliceElementInner(html, [0, 0], tagName, 'X')).toBeNull();
  }
});
