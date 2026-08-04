import assert from "node:assert/strict";
import { test } from "vitest";

import { wouldCreateCycle } from "../validation-chain.js";

/**
 * @file The cycle-detection algorithm.
 *
 * Assumed seam design:
 *
 * ```ts
 * export interface TermTreeLookup {
 *   getParentId(termId: string): string | null; // null = root
 * }
 * export function wouldCreateCycle(
 *   required: { termId: string; candidateParentId: string; tree: TermTreeLookup },
 *   optional?: {}
 * ): boolean; // true if termId appears anywhere in candidateParentId's ancestor chain, or candidateParentId === termId
 * ```
 *
 * U-002-B1 requires a FULL recursive descendant/ancestor walk, not a fixed-depth or
 * immediate-parent-only comparison — the exact shape a naive implementation gets wrong.
 */

function treeFromEdges(edges: Record<string, string | null>) {
  return {
    getParentId(termId: string) {
      return edges[termId] ?? null;
    },
  };
}

test("EC-05a: self-parenting (candidateParentId === termId) is always a cycle, at zero walk depth", () => {
  const tree = treeFromEdges({ "term-1": null });
  assert.equal(wouldCreateCycle({ termId: "term-1", candidateParentId: "term-1", tree }), true);
});

test("2-node cycle: reparenting term-1 under its own direct child is a cycle", () => {
  // term-1 -> (parent) -> term-2   (term-2's parent is term-1)
  const tree = treeFromEdges({ "term-2": "term-1" });
  assert.equal(wouldCreateCycle({ termId: "term-1", candidateParentId: "term-2", tree }), true);
});

test("EC-05b: a 3+-node ancestor cycle is detected via a full recursive walk, not just an immediate-parent check", () => {
  // term-1 -> term-2 -> term-3 -> term-4 (term-4's parent is term-3, term-3's is term-2, term-2's is term-1)
  // Reparenting term-1 under term-4 would create a 4-node cycle back to term-1.
  const tree = treeFromEdges({ "term-2": "term-1", "term-3": "term-2", "term-4": "term-3" });
  assert.equal(
    wouldCreateCycle({ termId: "term-1", candidateParentId: "term-4", tree }),
    true,
    "a naive immediate-parent-only check would miss this 3+-hop cycle"
  );
});

test("no cycle: reparenting to an unrelated branch of the tree is allowed", () => {
  const tree = treeFromEdges({ "term-2": "term-1", "term-3": "term-1", "term-4": null });
  assert.equal(wouldCreateCycle({ termId: "term-2", candidateParentId: "term-4", tree }), false);
});

test("no cycle: reparenting to root (no ancestors) is never a cycle", () => {
  const tree = treeFromEdges({ "term-1": null, "term-2": null });
  assert.equal(wouldCreateCycle({ termId: "term-1", candidateParentId: "term-2", tree }), false);
});

test("U-002-B1 (property): for chains of depth 1 through 10, a candidate parent at any depth in termId's own descendant chain is always detected as a cycle", () => {
  for (let depth = 1; depth <= 10; depth += 1) {
    const edges: Record<string, string | null> = {};
    let prev = "root";
    edges[prev] = null;
    for (let i = 0; i < depth; i += 1) {
      const node = `node-${depth}-${i}`;
      edges[node] = prev;
      prev = node;
    }
    // `prev` is now the deepest descendant of `root`, `depth` hops away.
    const tree = treeFromEdges(edges);
    assert.equal(
      wouldCreateCycle({ termId: "root", candidateParentId: prev, tree }),
      true,
      `depth ${depth}: reparenting root under its own descendant ${depth} hops away must be detected as a cycle`
    );
  }
});

test("U-002-B1 (property): a candidate parent that is NOT in termId's descendant chain, at any comparable depth, is never a false positive", () => {
  for (let depth = 1; depth <= 10; depth += 1) {
    const edges: Record<string, string | null> = { root: null, "sibling-root": null };
    let prev = "sibling-root";
    for (let i = 0; i < depth; i += 1) {
      const node = `sibling-node-${depth}-${i}`;
      edges[node] = prev;
      prev = node;
    }
    const tree = treeFromEdges(edges);
    assert.equal(
      wouldCreateCycle({ termId: "root", candidateParentId: prev, tree }),
      false,
      `depth ${depth}: an unrelated branch must never be a false-positive cycle`
    );
  }
});
