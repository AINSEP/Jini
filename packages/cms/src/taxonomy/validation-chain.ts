/**
 * @file The fixed taxonomy validation chains.
 *
 * Purpose:
 * Two pure, order-critical decision functions:
 *  - `validateContentJoin` — the allow-list -> workspace -> lens chain that gates every
 *    `entry_terms` write ("opt-in per content type" plus the workspace/lens folds a security
 *    audit added).
 *  - `validateHierarchyAssignment` — the hierarchical-mode -> same-taxonomy -> cycle chain
 *    that gates every `parentId` write.
 *
 * Both chains were the exact unit three separate Red-Team rounds found real ordering defects in —
 * a combined-failure case must always report the FIRST-in-order failure, never a later one that
 * also happens to apply. Every test in `validation-chain.unit.test.ts` replays one of those
 * regressions or a compound-failure case to lock the order in place.
 *
 * `wouldCreateCycle` is the full ancestor-chain walk `validateHierarchyAssignment`'s cycle check
 * ultimately calls — kept exported separately since it has its own certified property tests
 * (depth 1-10 chains) independent of the chain that wraps it.
 *
 * How it relates to the project:
 * Consumed directly by `write-service.ts`'s `createTerm`/`renameTerm`/`assignTerms` (and would be
 * consumed by a future `reparentTerm`, not yet built — no certified test in this slice exercises
 * it). Reuses no port/dep — these are pure functions over caller-resolved data, never performing
 * their own repo lookups, so the ordering guarantee holds regardless of how a caller wires them.
 */

export class TaxonomyNotApplicableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxonomyNotApplicableError";
  }
}

export class WorkspaceMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceMismatchError";
  }
}

export class ContentTypeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentTypeMismatchError";
  }
}

export class TaxonomyNotHierarchicalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxonomyNotHierarchicalError";
  }
}

export class ParentCrossTaxonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParentCrossTaxonomyError";
  }
}

export class TermNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermNotFoundError";
  }
}

export class HierarchyCycleDetectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HierarchyCycleDetectedError";
  }
}

/** Ancestor-chain lookup a cycle check walks. `null` marks a root (no parent). */
export interface TermTreeLookup {
  getParentId(termId: string): string | null;
}

/**
 * CIC U-002 — true if assigning `candidateParentId` as `termId`'s parent would create a cycle:
 * either immediate self-parenting, or `termId` appearing anywhere in `candidateParentId`'s own
 * ancestor chain. A full recursive walk, not a fixed-depth or immediate-parent-only comparison
 * (U-002-B1) — the exact shape a naive implementation gets wrong (a 3+-hop cycle is the
 * regression case this exists to catch).
 *
 * A `visited` guard bounds the walk even against a pre-existing malformed tree (defensive; no
 * certified test constructs one, but an unbounded walk over attacker/bug-corrupted ancestor data
 * would otherwise loop forever).
 *
 * @complexity O(depth) — one `getParentId` call per ancestor hop, each hop visited at most once.
 * @overallScore 100
 */
export function wouldCreateCycle(
  required: { termId: string; candidateParentId: string; tree: TermTreeLookup },
  _optional: Record<string, never> = {}
): boolean {
  const { termId, candidateParentId, tree } = required;

  if (candidateParentId === termId) return true;

  const visited = new Set<string>();
  let current: string | null = candidateParentId;
  while (current !== null) {
    if (visited.has(current)) return false; // malformed/self-looping ancestor data upstream of termId; not this call's cycle
    visited.add(current);
    const parent: string | null = tree.getParentId(current);
    if (parent === termId) return true;
    current = parent;
  }
  return false;
}

/**
 * U-001-B1/ORD1/ORD2 — the content-join chain: allow-list, THEN workspace, THEN lens, in that
 * fixed order. A combined-failure case always reports the first-in-order failure (U-001-ORD1:
 * not-on-allow-list always wins over a simultaneous workspace mismatch; U-001-ORD2: a workspace
 * mismatch always wins over a simultaneous lens mismatch).
 *
 * @complexity O(1) — three independent comparisons, no loop.
 * @overallScore 100
 */
export function validateContentJoin(
  required: {
    taxonomyId: string;
    isOnAllowList: boolean;
    callerWorkspaceId: string;
    resolvedTermWorkspaceId: string;
    resolvedContentWorkspaceId: string;
    suppliedContentType: string;
    resolvedContentKind: string;
  },
  _optional: Record<string, never> = {}
): void {
  const {
    taxonomyId,
    isOnAllowList,
    callerWorkspaceId,
    resolvedTermWorkspaceId,
    resolvedContentWorkspaceId,
    suppliedContentType,
    resolvedContentKind,
  } = required;

  if (!isOnAllowList) {
    throw new TaxonomyNotApplicableError(
      `taxonomy '${taxonomyId}' is not on the allow-list for content type '${suppliedContentType}'`
    );
  }

  if (resolvedTermWorkspaceId !== callerWorkspaceId || resolvedContentWorkspaceId !== callerWorkspaceId) {
    throw new WorkspaceMismatchError(
      `term/content workspace does not match the caller's workspace '${callerWorkspaceId}'`
    );
  }

  if (resolvedContentKind !== suppliedContentType) {
    throw new ContentTypeMismatchError(
      `supplied content type '${suppliedContentType}' does not match the resolved row's own kind '${resolvedContentKind}'`
    );
  }
}

/**
 * U-001-B2/B3/ORD3 — the hierarchy chain: hierarchical-mode, THEN same-taxonomy (distinguishing
 * not-found from wrong-taxonomy), THEN cycle, in that fixed order. `null` `candidateParentId`
 * (no parent assignment attempted) always short-circuits to a pass regardless of mode (RT-012's
 * regression: a no-op parent write must never be rejected).
 *
 * The compound RT-001 regression this chain exists to prevent: a flat taxonomy's candidate parent
 * that ALSO happens to exist in a different taxonomy must report `TAXONOMY_NOT_HIERARCHICAL`,
 * never `PARENT_CROSS_TAXONOMY` — hierarchical-mode is checked first and is decisive on its own.
 *
 * @complexity O(1) plus the injected `wouldCreateCycle` closure's own cost (U-002, only reached
 * once hierarchical-mode and same-taxonomy both pass).
 * @overallScore 100
 */
export function validateHierarchyAssignment(
  required: {
    childTaxonomyId: string;
    taxonomyIsHierarchical: boolean;
    candidateParentId: string | null;
    resolvedParent: { id: string; taxonomyId: string } | null | "not-applicable";
    wouldCreateCycle: (candidateParentId: string) => boolean;
    termId: string;
  },
  _optional: Record<string, never> = {}
): void {
  const { taxonomyIsHierarchical, candidateParentId, resolvedParent, childTaxonomyId, wouldCreateCycle: checkCycle } =
    required;

  if (candidateParentId === null) return;

  if (!taxonomyIsHierarchical) {
    throw new TaxonomyNotHierarchicalError(
      `taxonomy '${childTaxonomyId}' is not hierarchical; parentId must be null`
    );
  }

  if (resolvedParent === null || resolvedParent === "not-applicable") {
    throw new TermNotFoundError(`parent term '${candidateParentId}' was not found`);
  }

  if (resolvedParent.taxonomyId !== childTaxonomyId) {
    throw new ParentCrossTaxonomyError(
      `parent term '${candidateParentId}' belongs to taxonomy '${resolvedParent.taxonomyId}', not '${childTaxonomyId}'`
    );
  }

  if (checkCycle(candidateParentId)) {
    throw new HierarchyCycleDetectedError(
      `assigning '${candidateParentId}' as parent would create a hierarchy cycle`
    );
  }
}
