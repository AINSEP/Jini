import { expect, it } from 'vitest';
import { renderHtmlTaxonomy } from '../render-entry.js';

const attributes = { section: 'data-host-taxonomy', list: 'data-host-list', term: 'data-host-term', label: 'data-host-label' };

it('renders flat terms in input order with host attributes and exact escaping', () => {
  expect(renderHtmlTaxonomy({ id: 'tags"', name: 'Tags & <types>', hierarchical: false, attributes,
    terms: [{ id: 'b', name: '<B>', parentId: 'a' }, { id: 'a', name: 'A & "A"', parentId: null }] })).toBe(
    '<section data-host-taxonomy="tags&quot;" aria-label="Tags &amp; &lt;types&gt;"><ul data-host-list data-depth="0"><li data-host-term="b" data-depth="0"><span data-host-label>&lt;B&gt;</span></li><li data-host-term="a" data-depth="0"><span data-host-label>A &amp; &quot;A&quot;</span></li></ul></section>',
  );
});

it('keeps missing and self-parented terms as roots and nests their children', () => {
  expect(renderHtmlTaxonomy({ id: 't', name: 'T', hierarchical: true, attributes, terms: [
    { id: 'missing', name: 'Missing', parentId: 'absent' }, { id: 'self', name: 'Self', parentId: 'self' }, { id: 'child', name: 'Child', parentId: 'missing' },
  ] })).toBe('<section data-host-taxonomy="t" aria-label="T"><ul data-host-list data-depth="0"><li data-host-term="missing" data-depth="0"><span data-host-label>Missing</span><ul data-host-list data-depth="1"><li data-host-term="child" data-depth="1"><span data-host-label>Child</span></li></ul></li><li data-host-term="self" data-depth="0"><span data-host-label>Self</span></li></ul></section>');
});

it('renders a rootless two-node cycle once per term without recursion overflow', () => {
  expect(renderHtmlTaxonomy({ id: 't', name: 'T', hierarchical: true, attributes, terms: [
    { id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' },
  ] })).toBe('<section data-host-taxonomy="t" aria-label="T"><ul data-host-list data-depth="0"><li data-host-term="a" data-depth="0"><span data-host-label>A</span><ul data-host-list data-depth="1"><li data-host-term="b" data-depth="1"><span data-host-label>B</span></li></ul></li></ul></section>');
});
