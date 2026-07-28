import { describe, expect, it } from 'vitest';
import { flattenRenderTree, type ComponentLike } from '../tree.js';

interface Node extends ComponentLike {
  readonly children: string[];
}

function map(nodes: Node[]): Map<string, Node> {
  return new Map(nodes.map((n) => [n.id, n]));
}
const getChildIds = (n: Node) => n.children;

describe('flattenRenderTree', () => {
  it('walks a simple tree depth-first, pre-order', () => {
    const components = map([
      { id: 'root', children: ['a', 'b'] },
      { id: 'a', children: [] },
      { id: 'b', children: ['c'] },
      { id: 'c', children: [] },
    ]);
    expect(flattenRenderTree(components, 'root', getChildIds)).toEqual([
      { id: 'root', depth: 0, status: 'ok' },
      { id: 'a', depth: 1, status: 'ok' },
      { id: 'b', depth: 1, status: 'ok' },
      { id: 'c', depth: 2, status: 'ok' },
    ]);
  });

  it('adversarial: a child id referencing a component that does not exist is emitted as a "missing" leaf, not thrown', () => {
    const components = map([{ id: 'root', children: ['ghost'] }]);
    expect(flattenRenderTree(components, 'root', getChildIds)).toEqual([
      { id: 'root', depth: 0, status: 'ok' },
      { id: 'ghost', depth: 1, status: 'missing' },
    ]);
  });

  it('adversarial: a direct A -> B -> A cycle terminates instead of infinite-looping / stack overflowing', () => {
    const components = map([
      { id: 'a', children: ['b'] },
      { id: 'b', children: ['a'] },
    ]);
    expect(flattenRenderTree(components, 'a', getChildIds)).toEqual([
      { id: 'a', depth: 0, status: 'ok' },
      { id: 'b', depth: 1, status: 'ok' },
      { id: 'a', depth: 2, status: 'cycle' },
    ]);
  });

  it('adversarial: a self-reference (A -> A) also terminates', () => {
    const components = map([{ id: 'a', children: ['a'] }]);
    expect(flattenRenderTree(components, 'a', getChildIds)).toEqual([
      { id: 'a', depth: 0, status: 'ok' },
      { id: 'a', depth: 1, status: 'cycle' },
    ]);
  });

  it('a diamond reference (root -> a,b; a -> c; b -> c) is not treated as a cycle — c is a shared, not circular, dependency', () => {
    const components = map([
      { id: 'root', children: ['a', 'b'] },
      { id: 'a', children: ['c'] },
      { id: 'b', children: ['c'] },
      { id: 'c', children: [] },
    ]);
    const result = flattenRenderTree(components, 'root', getChildIds);
    expect(result.filter((n) => n.status === 'cycle')).toEqual([]);
    expect(result.filter((n) => n.id === 'c')).toHaveLength(2);
  });

  it('the root id itself missing produces a single "missing" node, not a crash', () => {
    expect(flattenRenderTree(map([]), 'root', getChildIds)).toEqual([{ id: 'root', depth: 0, status: 'missing' }]);
  });
});
