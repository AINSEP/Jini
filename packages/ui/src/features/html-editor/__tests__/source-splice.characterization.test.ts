// @vitest-environment node
import { expect, it } from 'vitest';
import { indexElementSourceRanges, indexSourceElements } from '../source-splice.js';

it('indexes void, implicit, raw and nested nodes with the original element slots', () => {
  const html = 'text<!--c--><style>x{}</style><div><img><script>x()</script><br><p>x</p></div>';
  expect([...indexElementSourceRanges(html)].map(([key, range]) => [key, range.tagName, html.slice(range.start, range.end)])).toEqual([
    ['0', 'div', '<img><script>x()</script><br><p>x</p>'], ['0.0', 'img', ''], ['0.1', 'br', ''], ['0.2', 'p', 'x'],
  ]);
  const [root] = indexSourceElements({ html }, {});
  expect(root!.path).toBeNull();
  const div = indexSourceElements({ html }, {})[1]!;
  expect(div.sourceSupported).toBe(true);
  expect(div.children.map(child => [child.tagName, child.path, child.sourceSupported])).toEqual([
    ['img', [0, 0], true], ['script', null, true], ['br', [0, 1], true], ['p', [0, 2], true],
  ]);
});
it('distinguishes foreign self-closing tags, templates, missing end tags and implied table nodes', () => {
  const elements = indexSourceElements({ html: '<svg><path/></svg><template><b>x</b></template><div>' }, {});
  expect(elements.map(el => [el.tagName, el.sourceSupported, el.outerRange !== null])).toEqual([
    ['svg', true, true], ['template', false, false], ['div', false, false],
  ]);
  expect(elements[0]!.children[0]!.sourceSupported).toBe(true);
  expect(elements[1]!.children).toEqual([]);
  const [table] = indexSourceElements({ html: '<table><tr><td>x</td></tr></table>' }, {});
  expect(table!.sourceSupported).toBe(false);
  expect(table!.children[0]!.outerRange).toBeNull();
  expect([...indexElementSourceRanges('<table><tr><td>x</td></tr></table>').keys()]).toEqual(['0', '0.0.0', '0.0.0.0']);
});
it('marks both siblings unsafe when foster parenting reverses source order', () => {
  const elements = indexSourceElements({ html: '<table><div>x</div></table>' }, {});
  expect(elements.map(el => [el.tagName, el.sourceSupported])).toEqual([['div', false], ['table', false]]);
});
