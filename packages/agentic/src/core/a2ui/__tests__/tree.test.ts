import { describe, expect, it } from 'vitest';
import { MAX_RENDER_NODES, flattenRenderTree, type ComponentLike } from '../tree.js';

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
    const result = flattenRenderTree(chain(10_000), 'n0', getChildIds);
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
    const result = flattenRenderTree(map(nodes), 'n0', getChildIds);
    expect(result).toHaveLength(MAX_RENDER_NODES + 1);
    // The cap is reported, not silently applied: the last node tells a renderer the tree was cut
    // short, the same way `missing`/`cycle` make those two degradations visible.
    expect(result[MAX_RENDER_NODES]).toMatchObject({ status: 'truncated' });
    expect(result.slice(0, MAX_RENDER_NODES).every((node) => node.status === 'ok')).toBe(true);
  });

  it('leaves a tree just under the cap untouched', () => {
    const result = flattenRenderTree(chain(MAX_RENDER_NODES), 'n0', getChildIds);
    expect(result).toHaveLength(MAX_RENDER_NODES);
    expect(result.some((node) => node.status === 'truncated')).toBe(false);
  });
});
