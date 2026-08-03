import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ContentTypeMismatchError,
  HierarchyCycleDetectedError,
  ParentCrossTaxonomyError,
  TaxonomyNotApplicableError,
  TaxonomyNotHierarchicalError,
  TermNotFoundError,
  WorkspaceMismatchError,
  validateContentJoin,
  validateHierarchyAssignment,
} from "../validation-chain.js";

/**
 * @file SPEC-018 C-208 / CIC U-001 / REQ-06–REQ-11 / behavior.spec.md §2.1 — the fixed
 * validation-chain ordering. This is the single unit three separate Red-Team rounds found real
 * ordering defects in (RT-001, RT-011, RT-012) — every regression case is replayed here as a
 * first-class test, not just an example.
 *
 * Assumed seam design:
 *
 * ```ts
 * export class TaxonomyNotApplicableError extends Error {}
 * export class WorkspaceMismatchError extends Error {}
 * export class ContentTypeMismatchError extends Error {}
 * export class TaxonomyNotHierarchicalError extends Error {}
 * export class ParentCrossTaxonomyError extends Error {}
 * export class TermNotFoundError extends Error {}
 * export class HierarchyCycleDetectedError extends Error {}
 *
 * // Content-join chain: allow-list -> workspace -> lens (U-001-ORD1, U-001-ORD2)
 * export function validateContentJoin(
 *   required: {
 *     taxonomyId: string; isOnAllowList: boolean;
 *     callerWorkspaceId: string; resolvedTermWorkspaceId: string; resolvedContentWorkspaceId: string;
 *     suppliedContentType: string; resolvedContentKind: string;
 *   },
 *   optional?: {}
 * ): void; // throws the first-failing check's typed error, in fixed order
 *
 * // Hierarchy chain: hierarchical-mode -> same-taxonomy (incl. not-found) -> cycle (U-001-B2/B3/ORD3)
 * export function validateHierarchyAssignment(
 *   required: {
 *     childTaxonomyId: string; taxonomyIsHierarchical: boolean;
 *     candidateParentId: string | null;
 *     resolvedParent: { id: string; taxonomyId: string } | null | "not-applicable";
 *     wouldCreateCycle: (candidateParentId: string) => boolean;
 *     termId: string;
 *   },
 *   optional?: {}
 * ): void; // throws the first-failing check's typed error, in fixed order
 * ```
 */

// ---------------------------------------------------------------------------
// U-001-B1 / U-001-ORD1 / U-001-ORD2 — content-join chain: allow-list -> workspace -> lens
// ---------------------------------------------------------------------------

test("U-001-B1 / AC-07: allow-list check runs first — a not-on-allow-list taxonomy is rejected with zero downstream checks reached", () => {
  assert.throws(
    () =>
      validateContentJoin({
        taxonomyId: "tax-1",
        isOnAllowList: false,
        callerWorkspaceId: "ws-1",
        resolvedTermWorkspaceId: "ws-2", // ALSO would fail workspace check
        resolvedContentWorkspaceId: "ws-3",
        suppliedContentType: "post",
        resolvedContentKind: "page", // ALSO would fail lens check
      }),
    (err: unknown) => err instanceof TaxonomyNotApplicableError
  );
});

test("U-001-ORD1 / EC-08: an inapplicable-taxonomy-plus-mismatched-workspace case reports TAXONOMY_NOT_APPLICABLE, never WORKSPACE_MISMATCH", () => {
  assert.throws(
    () =>
      validateContentJoin({
        taxonomyId: "tax-1",
        isOnAllowList: false,
        callerWorkspaceId: "ws-1",
        resolvedTermWorkspaceId: "ws-2",
        resolvedContentWorkspaceId: "ws-1",
        suppliedContentType: "post",
        resolvedContentKind: "post",
      }),
    (err: unknown) => {
      assert.ok(err instanceof TaxonomyNotApplicableError);
      assert.ok(!(err instanceof WorkspaceMismatchError));
      return true;
    }
  );
});

test("AC-09 / EC-01: workspace check runs after allow-list passes — cross-workspace term rejected", () => {
  assert.throws(
    () =>
      validateContentJoin({
        taxonomyId: "tax-1",
        isOnAllowList: true,
        callerWorkspaceId: "ws-1",
        resolvedTermWorkspaceId: "ws-2",
        resolvedContentWorkspaceId: "ws-1",
        suppliedContentType: "post",
        resolvedContentKind: "post",
      }),
    (err: unknown) => err instanceof WorkspaceMismatchError
  );
});

test("U-001-ORD2: a combined workspace-mismatch-plus-lens-mismatch case reports WORKSPACE_MISMATCH, never CONTENT_TYPE_MISMATCH", () => {
  assert.throws(
    () =>
      validateContentJoin({
        taxonomyId: "tax-1",
        isOnAllowList: true,
        callerWorkspaceId: "ws-1",
        resolvedTermWorkspaceId: "ws-2",
        resolvedContentWorkspaceId: "ws-3",
        suppliedContentType: "post",
        resolvedContentKind: "page", // ALSO a lens mismatch
      }),
    (err: unknown) => {
      assert.ok(err instanceof WorkspaceMismatchError);
      assert.ok(!(err instanceof ContentTypeMismatchError));
      return true;
    }
  );
});

test("AC-10 / EC-02: lens check runs last — a lens mismatch after allow-list and workspace both pass is rejected with CONTENT_TYPE_MISMATCH", () => {
  assert.throws(
    () =>
      validateContentJoin({
        taxonomyId: "tax-1",
        isOnAllowList: true,
        callerWorkspaceId: "ws-1",
        resolvedTermWorkspaceId: "ws-1",
        resolvedContentWorkspaceId: "ws-1",
        suppliedContentType: "page",
        resolvedContentKind: "post",
      }),
    (err: unknown) => err instanceof ContentTypeMismatchError
  );
});

test("AC-10: a fully valid content-join (on allow-list, matching workspace, matching lens) never throws", () => {
  assert.doesNotThrow(() =>
    validateContentJoin({
      taxonomyId: "tax-1",
      isOnAllowList: true,
      callerWorkspaceId: "ws-1",
      resolvedTermWorkspaceId: "ws-1",
      resolvedContentWorkspaceId: "ws-1",
      suppliedContentType: "post",
      resolvedContentKind: "post",
    })
  );
});

// ---------------------------------------------------------------------------
// U-001-B2 / U-001-B3 / U-001-ORD3 — hierarchy chain: hierarchical-mode -> same-taxonomy (incl.
// not-found) -> cycle (this is the RT-001 regression this unit exists to prevent)
// ---------------------------------------------------------------------------

test("U-001-B2 / U-001-ORD3 / AC-13 / EC-04: hierarchical-mode check runs first — a non-null parentId on a flat (non-hierarchical) taxonomy is rejected with TAXONOMY_NOT_HIERARCHICAL", () => {
  assert.throws(
    () =>
      validateHierarchyAssignment({
        childTaxonomyId: "tax-tags",
        taxonomyIsHierarchical: false,
        candidateParentId: "term-x",
        resolvedParent: null, // ALSO would fail same-taxonomy (not-found) if reached
        wouldCreateCycle: () => true, // ALSO would fail cycle check if reached
        termId: "term-1",
      }),
    (err: unknown) => err instanceof TaxonomyNotHierarchicalError
  );
});

test("U-001-B2 / U-001-ORD3 / AC-13 (RT-001 regression, compound case): flat taxonomy + a candidate parent that exists in a DIFFERENT taxonomy still reports TAXONOMY_NOT_HIERARCHICAL, never PARENT_CROSS_TAXONOMY — this is the exact case Red-Team round 1 found broken", () => {
  assert.throws(
    () =>
      validateHierarchyAssignment({
        childTaxonomyId: "tax-tags",
        taxonomyIsHierarchical: false,
        candidateParentId: "term-x",
        resolvedParent: { id: "term-x", taxonomyId: "tax-categories" }, // exists, but wrong taxonomy AND flat mode
        wouldCreateCycle: () => false,
        termId: "term-1",
      }),
    (err: unknown) => {
      assert.ok(err instanceof TaxonomyNotHierarchicalError, "must be TAXONOMY_NOT_HIERARCHICAL, never PARENT_CROSS_TAXONOMY, for the compound case");
      assert.ok(!(err instanceof ParentCrossTaxonomyError));
      return true;
    }
  );
});

test("U-001-B3 / AC-12b / EC-03b: same-taxonomy check distinguishes not-found from wrong-taxonomy — a parentId that resolves to no term at all is TERM_NOT_FOUND", () => {
  assert.throws(
    () =>
      validateHierarchyAssignment({
        childTaxonomyId: "tax-categories",
        taxonomyIsHierarchical: true,
        candidateParentId: "term-ghost",
        resolvedParent: null,
        wouldCreateCycle: () => false,
        termId: "term-1",
      }),
    (err: unknown) => err instanceof TermNotFoundError
  );
});

test("AC-12 / AC-12a / EC-03 / EC-03a: same-taxonomy check rejects a parent that exists but belongs to a different taxonomy, with PARENT_CROSS_TAXONOMY (distinct from TERM_NOT_FOUND)", () => {
  assert.throws(
    () =>
      validateHierarchyAssignment({
        childTaxonomyId: "tax-categories",
        taxonomyIsHierarchical: true,
        candidateParentId: "term-x",
        resolvedParent: { id: "term-x", taxonomyId: "tax-other-hierarchical" },
        wouldCreateCycle: () => false,
        termId: "term-1",
      }),
    (err: unknown) => {
      assert.ok(err instanceof ParentCrossTaxonomyError);
      assert.ok(!(err instanceof TermNotFoundError));
      return true;
    }
  );
});

test("U-001-ORD3: cycle check runs last — only reached after hierarchical-mode and same-taxonomy both pass", () => {
  assert.throws(
    () =>
      validateHierarchyAssignment({
        childTaxonomyId: "tax-categories",
        taxonomyIsHierarchical: true,
        candidateParentId: "term-x",
        resolvedParent: { id: "term-x", taxonomyId: "tax-categories" },
        wouldCreateCycle: () => true,
        termId: "term-1",
      }),
    (err: unknown) => err instanceof HierarchyCycleDetectedError
  );
});

test("a fully valid hierarchy assignment (hierarchical taxonomy, same-taxonomy parent, no cycle) never throws", () => {
  assert.doesNotThrow(() =>
    validateHierarchyAssignment({
      childTaxonomyId: "tax-categories",
      taxonomyIsHierarchical: true,
      candidateParentId: "term-x",
      resolvedParent: { id: "term-x", taxonomyId: "tax-categories" },
      wouldCreateCycle: () => false,
      termId: "term-1",
    })
  );
});

test("null parentId (no parent assignment attempted) never throws, regardless of hierarchical mode", () => {
  assert.doesNotThrow(() =>
    validateHierarchyAssignment({
      childTaxonomyId: "tax-tags",
      taxonomyIsHierarchical: false,
      candidateParentId: null,
      resolvedParent: "not-applicable",
      wouldCreateCycle: () => false,
      termId: "term-1",
    })
  );
});
