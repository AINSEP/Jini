import { describe, expect, it } from 'vitest';
import { MAX_RENDER_NODES, flattenRenderTree, type ComponentLike } from '../tree.js';

interface Node extends ComponentLike {
  readonly children: string[];
}

function map(nodes: Node[]): Map<string, Node> {
  return new Map(nodes.map((n) => [n.id, n]));
}
const getChildIds = ({ component: n }: { component: Node }) => n.children;

describe('flattenRenderTree', () => {
  it('walks a simple tree depth-first, pre-order', () => {
    const components = map([
      { id: 'root', children: ['a', 'b'] },
      { id: 'a', children: [] },
      { id: 'b', children: ['c'] },
      { id: 'c', children: [] },
    ]);
    expect(flattenRenderTree({ components, rootId: 'root', getChildIds })).toEqual([
      { id: 'root', depth: 0, status: 'ok' },
      { id: 'a', depth: 1, status: 'ok' },
      { id: 'b', depth: 1, status: 'ok' },
      { id: 'c', depth: 2, status: 'ok' },
    ]);
  });

  it('adversarial: a child id referencing a component that does not exist is emitted as a "missing" leaf, not thrown', () => {
    const components = map([{ id: 'root', children: ['ghost'] }]);
    expect(flattenRenderTree({ components, rootId: 'root', getChildIds })).toEqual([
      { id: 'root', depth: 0, status: 'ok' },
      { id: 'ghost', depth: 1, status: 'missing' },
    ]);
  });

  it('adversarial: a direct A -> B -> A cycle terminates instead of infinite-looping / stack overflowing', () => {
    const components = map([
      { id: 'a', children: ['b'] },
      { id: 'b', children: ['a'] },
    ]);
    expect(flattenRenderTree({ components, rootId: 'a', getChildIds })).toEqual([
      { id: 'a', depth: 0, status: 'ok' },
      { id: 'b', depth: 1, status: 'ok' },
      { id: 'a', depth: 2, status: 'cycle' },
    ]);
  });

  it('adversarial: a self-reference (A -> A) also terminates', () => {
    const components = map([{ id: 'a', children: ['a'] }]);
    expect(flattenRenderTree({ components, rootId: 'a', getChildIds })).toEqual([
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
    const result = flattenRenderTree({ components, rootId: 'root', getChildIds });
    expect(result.filter((n) => n.status === 'cycle')).toEqual([]);
    expect(result.filter((n) => n.id === 'c')).toHaveLength(2);
  });

  it('the root id itself missing produces a single "missing" node, not a crash', () => {
    expect(flattenRenderTree({ components: map([]), rootId: 'root', getChildIds })).toEqual([{ id: 'root', depth: 0, status: 'missing' }]);
  });
});

// Regression (2026-07-29 audit). The two adversarial shapes above (missing child, cycle) were
// handled; two others were not, and both are reachable from a small, entirely valid, acyclic
// `updateComponents` message:
//
//  - a deep *chain* overflowed the JS call stack (`RangeError`), because the walk was plain
//    recursion with no depth bound and no iterative fallback;
//  - a *fan-out* amplified exponentially: 24 components, each naming the next one twice, expand
//    to 2^24 - 1 render nodes. Measured before the fix: 16,777,215 nodes in ~15s from a message
//    of a few hundred bytes. Nothing crashed — it just consumed the renderer.
describe('flattenRenderTree — bounded against untrusted trees', () => {
  /** A straight chain `n0 -> n1 -> ... -> n(size-1)`. */
  function chain(size: number): Map<string, Node> {
    const nodes: Node[] = [];
    for (let i = 0; i < size; i += 1) {
      nodes.push({ id: `n${i}`, children: i + 1 < size ? [`n${i + 1}`] : [] });
    }
    return map(nodes);
  }

  it('walks a chain far deeper than the JS call stack without throwing', () => {
    // 10,000 is comfortably past where the recursive walk died (measured: fine at 6,000,
    // RangeError at 8,000) and comfortably under MAX_RENDER_NODES, so this measures depth
    // safety alone rather than the node cap below.
    const result = flattenRenderTree({ components: chain(10_000), rootId: 'n0', getChildIds });
    expect(result).toHaveLength(10_000);
    expect(result[0]).toEqual({ id: 'n0', depth: 0, status: 'ok' });
    expect(result[9_999]).toEqual({ id: 'n9999', depth: 9_999, status: 'ok' });
    expect(result.every((node) => node.status === 'ok')).toBe(true);
  });

  it('caps an exponentially amplifying fan-out instead of expanding all 2^24 of it', () => {
    const nodes: Node[] = [];
    for (let i = 0; i < 24; i += 1) {
      nodes.push({ id: `n${i}`, children: i + 1 < 24 ? [`n${i + 1}`, `n${i + 1}`] : [] });
    }
    const result = flattenRenderTree({ components: map(nodes), rootId: 'n0', getChildIds });
    expect(result).toHaveLength(MAX_RENDER_NODES + 1);
    // The cap is reported, not silently applied: the last node tells a renderer the tree was cut
    // short, the same way `missing`/`cycle` make those two degradations visible.
    expect(result[MAX_RENDER_NODES]).toMatchObject({ status: 'truncated' });
    expect(result.slice(0, MAX_RENDER_NODES).every((node) => node.status === 'ok')).toBe(true);
  });

  it('leaves a tree just under the cap untouched', () => {
    const result = flattenRenderTree({ components: chain(MAX_RENDER_NODES), rootId: 'n0', getChildIds });
    expect(result).toHaveLength(MAX_RENDER_NODES);
    expect(result.some((node) => node.status === 'truncated')).toBe(false);
  });
});

// Characterization pins (code-health wave 3), written before the child-push loop was extracted.
describe('flattenRenderTree — walk bookkeeping', () => {
  it('asks for child ids once per present, non-cycle node and never for missing or cycle nodes', () => {
    const asked: string[] = [];
    const components = map([
      { id: 'root', children: ['a', 'ghost'] },
      { id: 'a', children: ['root'] },
    ]);
    const result = flattenRenderTree({ components, rootId: 'root', getChildIds: ({ component }) => { asked.push(component.id); return component.children; } });
    expect(asked).toEqual(['root', 'a']);
    expect(result).toEqual([
      { id: 'root', depth: 0, status: 'ok' },
      { id: 'a', depth: 1, status: 'ok' },
      { id: 'root', depth: 2, status: 'cycle' },
      { id: 'ghost', depth: 1, status: 'missing' },
    ]);
  });

  it('drops an id from the ancestor set once its subtree closes, so a later sibling may repeat it', () => {
    const components = map([
      { id: 'root', children: ['a', 'a'] },
      { id: 'a', children: ['b'] },
      { id: 'b', children: [] },
    ]);
    expect(flattenRenderTree({ components, rootId: 'root', getChildIds }).map((n) => `${n.id}:${n.depth}:${n.status}`))
      .toEqual(['root:0:ok', 'a:1:ok', 'b:2:ok', 'a:1:ok', 'b:2:ok']);
  });

  it('keeps every child in order, including repeated and missing ids, at depth + 1', () => {
    const components = map([
      { id: 'root', children: ['x', 'y', 'x', 'z'] },
      { id: 'x', children: [] },
      { id: 'z', children: [] },
    ]);
    expect(flattenRenderTree({ components, rootId: 'root', getChildIds })).toEqual([
      { id: 'root', depth: 0, status: 'ok' },
      { id: 'x', depth: 1, status: 'ok' },
      { id: 'y', depth: 1, status: 'missing' },
      { id: 'x', depth: 1, status: 'ok' },
      { id: 'z', depth: 1, status: 'ok' },
    ]);
  });

  it('labels the truncation marker with the id and depth of the first node it did not walk', () => {
    const children = Array.from({ length: MAX_RENDER_NODES + 5 }, (_, i) => `c${i}`);
    const components = new Map<string, Node>([['root', { id: 'root', children }], ...children.map((id): [string, Node] => [id, { id, children: [] }])]);
    const result = flattenRenderTree({ components, rootId: 'root', getChildIds });
    expect(result).toHaveLength(MAX_RENDER_NODES + 1);
    expect(result[MAX_RENDER_NODES]).toEqual({ id: `c${MAX_RENDER_NODES - 1}`, depth: 1, status: 'truncated' });
  });

  it('counts missing and cycle markers toward the node cap', () => {
    const children = Array.from({ length: MAX_RENDER_NODES }, () => 'ghost');
    const result = flattenRenderTree({ components: map([{ id: 'root', children }]), rootId: 'root', getChildIds });
    expect(result).toHaveLength(MAX_RENDER_NODES + 1);
    expect(result[MAX_RENDER_NODES - 1]).toEqual({ id: 'ghost', depth: 1, status: 'missing' });
    expect(result[MAX_RENDER_NODES]).toEqual({ id: 'ghost', depth: 1, status: 'truncated' });
  });
});
