import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assignTerms,
  createTaxonomy,
  createTerm,
  renameTerm,
  deleteTerm,
  deleteTaxonomy,
  TermHasAssignedContentError,
  TermHasChildTermsError,
  TaxonomyHasAssignedContentError,
} from "../write-service.js";
import { ForbiddenError } from "../../core/commands/command.js";

/**
 * @file The taxonomy write-service's ordinary (non-gated) mutations.
 *
 * Assumed seam design (mirrors `core/commands/command.ts`'s established two-object,
 * authorize-then-write-then-revise-then-stamp-then-outbox pattern used elsewhere in this repo):
 *
 * ```ts
 * export interface WriteServiceDeps {
 *   authorize: AuthorizeFn;                 // reused AuthorizeFn shape from core/commands/command.ts —
 *                                            // these are ORDINARY mutations (per implementation-outline.md's
 *                                            // Module Map note "core/gated-mutations imported only for
 *                                            // mergeTerm"), so authorize()-before-any-side-effect (REQ-17)
 *                                            // is the same ForbiddenError/ordering core/commands already
 *                                            // provides, not core/gated-mutations' own gateway ceremony.
 *   clock: ClockPort; idGen: IdGeneratorPort;
 *   taxonomies: TaxonomyRepoPort; terms: TermRepoPort; entryTerms: EntryTermRepoPort;
 *   revisions: TaxonomyRevisionRepoPort;     // .insert() called for every op except assign/unassign
 *   stampWatermark: (tx: unknown) => void;   // core/gated-mutations.stampWatermark, injected
 *   outbox: { enqueue: (event: unknown) => Promise<void> };
 *   validateHierarchy: typeof import("../../validation-chain").validateHierarchyAssignment;
 *   validateContentJoin: typeof import("../../validation-chain").validateContentJoin;
 * }
 *
 * export async function createTaxonomy(required: { deps: WriteServiceDeps; principalId: string;
 *   name: string; hierarchical: boolean }, optional?: {}): Promise<Taxonomy>;
 *
 * export async function createTerm(required: { deps: WriteServiceDeps; principalId: string;
 *   taxonomyId: string; name: string; parentId?: string | null }, optional?: {}): Promise<Term>;
 *
 * export async function renameTerm(required: { deps: WriteServiceDeps; principalId: string;
 *   termId: string; newName: string }, optional?: {}): Promise<Term>;
 *
 * export async function assignTerms(required: { deps: WriteServiceDeps; principalId: string;
 *   contentType: string; contentId: string; termIds: string[] }, optional?: {}): Promise<void>;
 * ```
 */

function baseDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const revisionsInserted: unknown[] = [];
  const outboxEvents: unknown[] = [];
  let watermarkStamps = 0;
  return {
    authorize: async () => ({ allowed: true, reason: "matched" }),
    clock: { nowIso: () => "2026-07-15T00:00:00.000Z" },
    idGen: (() => {
      let n = 0;
      return { newId: () => `id-${++n}` };
    })(),
    taxonomies: {
      async findById(id: string) {
        return { id, hierarchical: true };
      },
      async insert(row: unknown) {
        return row;
      },
    },
    terms: {
      async findById(id: string) {
        // Default: any `term-*` id resolves against `tax-1` — matches the AC-17/AC-20
        // assignTerms fixtures below, which don't override `terms` themselves.
        return id.startsWith("term-") ? { id, taxonomyId: "tax-1" } : null;
      },
      async insert(row: unknown) {
        return row;
      },
      async update(row: unknown) {
        return row;
      },
    },
    entryTerms: {
      async upsert() {
        return undefined;
      },
    },
    // Finding 1 fix (TM-adr041-043-044-045-audit-001) — `assignTerms` now validates via
    // `validateContentJoin`. Default: caller's own workspace, and a resolvable "post"/"post-1"
    // content row matching what the AC-17/AC-20 fixtures below assign terms to.
    workspaceId: "ws-1",
    contentLookup: {
      async resolve({ contentType, contentId }: { contentType: string; contentId: string }) {
        return contentType === "post" && contentId === "post-1" ? { workspaceId: "ws-1", kind: "post" } : null;
      },
    },
    revisions: {
      async insert(row: unknown) {
        revisionsInserted.push(row);
      },
    },
    get revisionsInserted() {
      return revisionsInserted;
    },
    stampWatermark: () => {
      watermarkStamps += 1;
    },
    get watermarkStamps() {
      return watermarkStamps;
    },
    outbox: {
      async enqueue(event: unknown) {
        outboxEvents.push(event);
      },
    },
    get outboxEvents() {
      return outboxEvents;
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// REQ-01 / REQ-02 / AC-01 / AC-02 / AC-03
// ---------------------------------------------------------------------------

test("AC-01: createTaxonomy stores both hierarchical and flat taxonomies in the same shared table (no separate category/tag table)", async () => {
  const deps = baseDeps();
  const category = await createTaxonomy({ deps, principalId: "u-1", name: "Category", hierarchical: true });
  const tag = await createTaxonomy({ deps, principalId: "u-1", name: "Tag", hierarchical: false });

  assert.equal(category.hierarchical, true);
  assert.equal(tag.hierarchical, false);
});

test("AC-13 / EC-04: createTerm rejects a non-null parentId on a flat (tag) taxonomy", async () => {
  const deps = baseDeps({
    taxonomies: { async findById() { return { id: "tax-1", hierarchical: false }; } },
  });

  await assert.rejects(
    createTerm({ deps, principalId: "u-1", taxonomyId: "tax-1", name: "urgent", parentId: "term-x" })
  );
});

test("AC-03: createTerm accepts a valid same-taxonomy parentId on a hierarchical taxonomy", async () => {
  const deps = baseDeps({
    taxonomies: { async findById() { return { id: "tax-1", hierarchical: true }; } },
    terms: {
      async findById(id: string) {
        return id === "term-parent" ? { id: "term-parent", taxonomyId: "tax-1" } : null;
      },
      async insert(row: unknown) {
        return row;
      },
    },
  });

  const term = await createTerm({ deps, principalId: "u-1", taxonomyId: "tax-1", name: "Child", parentId: "term-parent" });
  assert.ok(term);
});

// ---------------------------------------------------------------------------
// REQ-12 / AC-15 / AC-15a / AC-15b — revisioning with composite actor identity
// ---------------------------------------------------------------------------

test("AC-15: renameTerm produces exactly one taxonomy_revisions row carrying the pre-rename state", async () => {
  const deps = baseDeps({
    terms: {
      async findById() {
        return { id: "term-1", name: "old-name", taxonomyId: "tax-1" };
      },
      async update(row: unknown) {
        return row;
      },
    },
  });

  await renameTerm({ deps, principalId: "u-1", termId: "term-1", newName: "new-name" });

  assert.equal(deps.revisionsInserted.length, 1);
  const revision = deps.revisionsInserted[0] as { previousState?: { name?: string } };
  assert.equal(revision.previousState?.name, "old-name");
});

// ---------------------------------------------------------------------------
// REQ-13 / INV-05 / AC-17 — assign/unassign never revisioned
// ---------------------------------------------------------------------------

test("AC-17 / INV-05: assignTerms produces zero taxonomy_revisions rows", async () => {
  const deps = baseDeps({
    taxonomies: { async findById() { return { id: "tax-1", hierarchical: false, allowList: ["post", "page"] }; } },
  });

  await assignTerms({ deps, principalId: "u-1", contentType: "post", contentId: "post-1", termIds: ["term-1"] });

  assert.equal(deps.revisionsInserted.length, 0, "INV-05: assignTerms must never produce a taxonomy_revisions row");
});

// ---------------------------------------------------------------------------
// REQ-14 / AC-19 / AC-20 — same-transaction watermark + outbox
// ---------------------------------------------------------------------------

test("AC-19: renameTerm's commit includes exactly one watermark stamp and one outbox enqueue", async () => {
  const deps = baseDeps({
    terms: {
      async findById() {
        return { id: "term-1", name: "old", taxonomyId: "tax-1" };
      },
      async update(row: unknown) {
        return row;
      },
    },
  });

  await renameTerm({ deps, principalId: "u-1", termId: "term-1", newName: "new" });

  assert.equal(deps.watermarkStamps, 1);
  assert.equal(deps.outboxEvents.length, 1);
});

test("AC-20: assignTerms' commit includes exactly one watermark stamp and one outbox enqueue per call", async () => {
  const deps = baseDeps();
  await assignTerms({ deps, principalId: "u-1", contentType: "post", contentId: "post-1", termIds: ["term-1", "term-2"] });

  assert.equal(deps.watermarkStamps, 1, "one call to assignTerms must stamp the watermark exactly once, not once per termId");
  assert.equal(deps.outboxEvents.length, 1);
});

// ---------------------------------------------------------------------------
// REQ-17 / AC-25 — authorize() before any side effect
// ---------------------------------------------------------------------------

test("AC-25 / REQ-17: an unauthorized renameTerm call is rejected before any other side effect (no revision, no watermark stamp, no outbox event)", async () => {
  const deps = baseDeps({
    authorize: async () => ({ allowed: false, reason: "no_grant" }),
    terms: {
      async findById() {
        return { id: "term-1", name: "old", taxonomyId: "tax-1" };
      },
    },
  });

  await assert.rejects(
    renameTerm({ deps, principalId: "u-1", termId: "term-1", newName: "new" }),
    (err: unknown) => err instanceof ForbiddenError
  );

  assert.equal(deps.revisionsInserted.length, 0);
  assert.equal(deps.watermarkStamps, 0);
  assert.equal(deps.outboxEvents.length, 0);
});

// ---------------------------------------------------------------------------
// AC-26 — createTaxonomy is ordinary, no plan()/confirmation ceremony
// ---------------------------------------------------------------------------

test("AC-26: createTaxonomy succeeds directly with no plan()/confirmation token required", async () => {
  const deps = baseDeps();
  const taxonomy = await createTaxonomy({ deps, principalId: "u-1", name: "Genre", hierarchical: true });
  assert.ok(taxonomy.id);
});

// ---------------------------------------------------------------------------
// deleteTerm / deleteTaxonomy — this dispatch's own tests (no formal AC ids; the taxonomy delete
// gap this closes had no spec coverage to begin with, per the dispatch brief). Extended in a
// second pass (coordinator review) to mutation-prove the transaction boundary itself, not just
// the guard's final answer — see `transactionRecorder` below.
// ---------------------------------------------------------------------------

/**
 * Records the exact order `deps.transaction()` opens/commits/rolls-back relative to every guard
 * read and write `deleteTerm`/`deleteTaxonomy` makes. This is what makes the TOCTOU fix
 * mutation-provable rather than merely "the final answer looked right": if a future edit moves a
 * guard read (or the delete itself) back OUTSIDE the `deps.transaction()` callback — the exact
 * regression the coordinator flagged as the one most likely to be missed — the read's mark would
 * land before `"tx:start"` (or after `"tx:commit"`/`"tx:rollback"`) instead of between them, and
 * every `assert.deepEqual(recorder.log, [...])` below would go red. A pass-count assertion like
 * "countByTerm was called" cannot distinguish "called inside the transaction" from "called before
 * it" — only the ordered log can.
 */
function transactionRecorder() {
  const log: string[] = [];
  return {
    log,
    mark(label: string) {
      log.push(label);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      log.push("tx:start");
      try {
        const result = await fn();
        log.push("tx:commit");
        return result;
      } catch (err) {
        log.push("tx:rollback");
        throw err;
      }
    },
  };
}

/** Builds a deletable-term-repo double: `findById` resolves any seeded term, `countChildren`
 * counts by `parentId`, `delete` records what was removed. Every method marks the given
 * `recorder` with its own label before returning, so a test can assert exactly where in the
 * transaction's timeline each call landed. */
function deletableTermsDeps(
  seed: Array<{ id: string; taxonomyId: string; parentId?: string | null; name?: string }>,
  recorder: ReturnType<typeof transactionRecorder>
) {
  const deleted: string[] = [];
  return {
    deleted,
    async findById(id: string) {
      recorder.mark("terms.findById");
      const row = seed.find((t) => t.id === id);
      return row ? { id: row.id, taxonomyId: row.taxonomyId, name: row.name } : null;
    },
    async listByTaxonomy(params: { taxonomyId: string }) {
      recorder.mark("terms.listByTaxonomy");
      return seed
        .filter((t) => t.taxonomyId === params.taxonomyId && !deleted.includes(t.id))
        .map((t) => ({ id: t.id, taxonomyId: t.taxonomyId, parentId: t.parentId ?? null, name: t.name ?? t.id, status: "active", updatedAt: "now", version: 1 }));
    },
    async countChildren(params: { parentId: string }) {
      recorder.mark("terms.countChildren");
      return seed.filter((t) => t.parentId === params.parentId && !deleted.includes(t.id)).length;
    },
    async delete(id: string) {
      recorder.mark("terms.delete");
      deleted.push(id);
    },
    // `TermRepoPort`'s other two methods — unused by any `deleteTerm`/`deleteTaxonomy` test here,
    // present only so this double satisfies `WriteServiceDeps.terms`'s base contract (delete is
    // additive on top of it, not a replacement for it — see `DeletableTermRepoPort`'s doc comment).
    async insert(row: unknown) {
      return row;
    },
    async update(row: unknown) {
      return row;
    },
  };
}

/** Builds an assignment-count-capable entry-terms double: `countByTerm` returns `byTerm[termId]`
 * (default 0), plus `EntryTermRepoPort`'s base `upsert` (unused by any `deleteTerm`/`deleteTaxonomy`
 * test here, present only to satisfy `WriteServiceDeps.entryTerms`'s base contract). Marks
 * `recorder` on every `countByTerm` call — see `deletableTermsDeps`'s doc comment. */
function countableEntryTermsDeps(byTerm: Record<string, number> = {}, recorder?: ReturnType<typeof transactionRecorder>) {
  return {
    async countByTerm(params: { termId: string }) {
      recorder?.mark("entryTerms.countByTerm");
      return byTerm[params.termId] ?? 0;
    },
    async upsert(row: unknown) {
      return row;
    },
  };
}

test("deleteTerm: deletes an unassigned, childless term and produces exactly one 'delete' revision, one watermark stamp, one outbox event", async () => {
  const recorder = transactionRecorder();
  const terms = deletableTermsDeps([{ id: "term-1", taxonomyId: "tax-1" }], recorder);
  // `Object.assign(baseDeps(), {...})` rather than `baseDeps({...})` or `{ ...baseDeps(), ... }`:
  // `baseDeps`'s own `overrides` parameter is typed `Partial<Record<string, unknown>>` (loose by
  // design for its existing, narrower-port callers), so passing through it loses the extra
  // `DeletableTermRepoPort`/`AssignmentCountEntryTermRepoPort` methods statically. And spreading
  // an ALREADY-CONSTRUCTED `baseDeps()` result (`{ ...baseDeps(), ... }`) silently snapshots its
  // `watermarkStamps`/`revisionsInserted`/`outboxEvents` getters to their value at spread time,
  // disconnecting the primitive-valued `watermarkStamps` counter from `stampWatermark`'s closure
  // (a real bug this file's first draft hit — `watermarkStamps` read back as 0 after a genuine
  // stamp). `Object.assign` mutates the live object in place instead, so every getter/closure
  // this double doesn't override stays connected.
  const deps = Object.assign(baseDeps(), {
    terms,
    entryTerms: countableEntryTermsDeps({}, recorder),
    transaction: recorder.transaction,
  });

  const result = await deleteTerm({ deps, principalId: "u-1", termId: "term-1" });

  assert.deepEqual(result, { deletedTermId: "term-1" });
  assert.deepEqual(terms.deleted, ["term-1"]);
  assert.equal(deps.revisionsInserted.length, 1);
  assert.equal((deps.revisionsInserted[0] as { op: string }).op, "delete");
  assert.equal(deps.watermarkStamps, 1);
  assert.equal(deps.outboxEvents.length, 1);
  // The TOCTOU proof: every guard read AND the delete itself happened strictly between
  // `tx:start`/`tx:commit` — none of them ran before the transaction opened.
  assert.deepEqual(recorder.log, [
    "tx:start",
    "terms.findById",
    "terms.countChildren",
    "entryTerms.countByTerm",
    "terms.delete",
    "tx:commit",
  ]);
});

test("deleteTerm: refuses with TermHasAssignedContentError and the exact assigned count when content is still assigned, with zero side effects", async () => {
  const recorder = transactionRecorder();
  const terms = deletableTermsDeps([{ id: "term-1", taxonomyId: "tax-1" }], recorder);
  const deps = Object.assign(baseDeps(), {
    terms,
    entryTerms: countableEntryTermsDeps({ "term-1": 3 }, recorder),
    transaction: recorder.transaction,
  });

  await assert.rejects(
    deleteTerm({ deps, principalId: "u-1", termId: "term-1" }),
    (err: unknown) => err instanceof TermHasAssignedContentError && err.assignedCount === 3
  );

  assert.deepEqual(terms.deleted, [], "a refused delete must not touch the repo");
  assert.equal(deps.revisionsInserted.length, 0);
  assert.equal(deps.watermarkStamps, 0);
  assert.equal(deps.outboxEvents.length, 0);
  // The guard read ran INSIDE the transaction (between start/rollback), and the refusal rolled
  // the (empty) transaction back rather than committing it — proves the guard's own error takes
  // the rollback path, not a silent "catch and continue".
  assert.deepEqual(recorder.log, ["tx:start", "terms.findById", "terms.countChildren", "entryTerms.countByTerm", "tx:rollback"]);
});

test("deleteTerm: refuses with TermHasChildTermsError and the exact child count when the term still has children, with zero side effects", async () => {
  const recorder = transactionRecorder();
  const terms = deletableTermsDeps(
    [
      { id: "term-parent", taxonomyId: "tax-1" },
      { id: "term-child-a", taxonomyId: "tax-1", parentId: "term-parent" },
      { id: "term-child-b", taxonomyId: "tax-1", parentId: "term-parent" },
    ],
    recorder
  );
  const deps = Object.assign(baseDeps(), {
    terms,
    entryTerms: countableEntryTermsDeps({}, recorder),
    transaction: recorder.transaction,
  });

  await assert.rejects(
    deleteTerm({ deps, principalId: "u-1", termId: "term-parent" }),
    (err: unknown) => err instanceof TermHasChildTermsError && err.childCount === 2
  );

  assert.deepEqual(terms.deleted, []);
  assert.equal(deps.revisionsInserted.length, 0);
  assert.equal(deps.watermarkStamps, 0);
  // The children guard refuses BEFORE the assignment guard even runs (`entryTerms.countByTerm`
  // never appears) — cheaper check first — and still rolls back.
  assert.deepEqual(recorder.log, ["tx:start", "terms.findById", "terms.countChildren", "tx:rollback"]);
});

test("deleteTerm: an unauthorized call is rejected before any lookup or side effect, and never even opens a transaction", async () => {
  const recorder = transactionRecorder();
  const terms = deletableTermsDeps([{ id: "term-1", taxonomyId: "tax-1" }], recorder);
  const deps = Object.assign(baseDeps(), {
    authorize: async () => ({ allowed: false, reason: "no_grant" }),
    terms,
    entryTerms: countableEntryTermsDeps({}, recorder),
    transaction: recorder.transaction,
  });

  await assert.rejects(
    deleteTerm({ deps, principalId: "u-1", termId: "term-1" }),
    (err: unknown) => err instanceof ForbiddenError
  );
  assert.deepEqual(terms.deleted, []);
  // `authorize()` runs BEFORE `deps.transaction()` is ever called — a denied caller never opens a
  // transaction at all, let alone touches a repo.
  assert.deepEqual(recorder.log, []);
});

test("deleteTaxonomy: cascades to every (unassigned) member term and returns their ids, when no member has any content assignment", async () => {
  const recorder = transactionRecorder();
  const terms = deletableTermsDeps(
    [
      { id: "term-1", taxonomyId: "tax-1" },
      { id: "term-2", taxonomyId: "tax-1" },
    ],
    recorder
  );
  const deletedTaxonomies: string[] = [];
  const deps = Object.assign(baseDeps(), {
    taxonomies: {
      async findById(id: string) {
        recorder.mark("taxonomies.findById");
        return { id, hierarchical: true };
      },
      async delete(id: string) {
        recorder.mark("taxonomies.delete");
        deletedTaxonomies.push(id);
      },
      // Base `TaxonomyRepoPort` method, unused here — see `deletableTermsDeps`'s matching comment.
      async insert(row: unknown) { return row; },
    },
    terms,
    entryTerms: countableEntryTermsDeps({}, recorder),
    transaction: recorder.transaction,
  });

  const result = await deleteTaxonomy({ deps, principalId: "u-1", taxonomyId: "tax-1" });

  assert.equal(result.deletedTaxonomyId, "tax-1");
  assert.deepEqual(result.deletedTermIds.sort(), ["term-1", "term-2"]);
  assert.deepEqual(terms.deleted.sort(), ["term-1", "term-2"]);
  assert.deepEqual(deletedTaxonomies, ["tax-1"]);
  assert.equal(deps.revisionsInserted.length, 1);
  assert.equal((deps.revisionsInserted[0] as { op: string }).op, "delete");
  // Full cascade proof: the existence check, the member listing, BOTH per-term guard reads, BOTH
  // term deletes, and the taxonomy delete itself all ran inside the one transaction — nothing
  // committed piecemeal.
  assert.deepEqual(recorder.log, [
    "tx:start",
    "taxonomies.findById",
    "terms.listByTaxonomy",
    "entryTerms.countByTerm",
    "entryTerms.countByTerm",
    "terms.delete",
    "terms.delete",
    "taxonomies.delete",
    "tx:commit",
  ]);
});

test("deleteTaxonomy: refuses with TaxonomyHasAssignedContentError summed across every member term, and deletes nothing", async () => {
  const recorder = transactionRecorder();
  const terms = deletableTermsDeps(
    [
      { id: "term-1", taxonomyId: "tax-1" },
      { id: "term-2", taxonomyId: "tax-1" },
    ],
    recorder
  );
  const deletedTaxonomies: string[] = [];
  const deps = Object.assign(baseDeps(), {
    taxonomies: {
      async findById(id: string) {
        recorder.mark("taxonomies.findById");
        return { id, hierarchical: true };
      },
      async delete(id: string) {
        recorder.mark("taxonomies.delete");
        deletedTaxonomies.push(id);
      },
      async insert(row: unknown) { return row; },
    },
    terms,
    entryTerms: countableEntryTermsDeps({ "term-1": 2, "term-2": 1 }, recorder),
    transaction: recorder.transaction,
  });

  await assert.rejects(
    deleteTaxonomy({ deps, principalId: "u-1", taxonomyId: "tax-1" }),
    (err: unknown) => err instanceof TaxonomyHasAssignedContentError && err.assignedCount === 3
  );

  assert.deepEqual(terms.deleted, []);
  assert.deepEqual(deletedTaxonomies, []);
  assert.equal(deps.revisionsInserted.length, 0);
  // Both per-term counts ran (the sum needs both) before the refusal rolled back — no delete call
  // for either term or the taxonomy appears anywhere in the log.
  assert.deepEqual(recorder.log, [
    "tx:start",
    "taxonomies.findById",
    "terms.listByTaxonomy",
    "entryTerms.countByTerm",
    "entryTerms.countByTerm",
    "tx:rollback",
  ]);
});

test("deleteTaxonomy: a nonexistent taxonomy rejects with TaxonomyRecordNotFoundError", async () => {
  const recorder = transactionRecorder();
  const deps = Object.assign(baseDeps(), {
    // Not found short-circuits before `terms`/`entryTerms` are ever touched, so these stubs exist
    // only to satisfy `DeleteTaxonomyRequired`'s type — none of their methods are called.
    taxonomies: {
      async findById() {
        recorder.mark("taxonomies.findById");
        return null;
      },
      async delete() { throw new Error("must not be called"); },
      async insert(row: unknown) { return row; },
    },
    terms: deletableTermsDeps([], recorder),
    entryTerms: {
      async countByTerm(): Promise<number> { throw new Error("must not be called"); },
      async upsert(row: unknown) { return row; },
    },
    transaction: recorder.transaction,
  });

  await assert.rejects(deleteTaxonomy({ deps, principalId: "u-1", taxonomyId: "does-not-exist" }));
  assert.deepEqual(recorder.log, ["tx:start", "taxonomies.findById", "tx:rollback"]);
});

test("deleteTaxonomy: an unauthorized call is rejected before any lookup or side effect, and never even opens a transaction", async () => {
  const recorder = transactionRecorder();
  const deps = Object.assign(baseDeps(), {
    authorize: async () => ({ allowed: false, reason: "no_grant" }),
    taxonomies: {
      async findById() { throw new Error("must not be called"); },
      async delete() { throw new Error("must not be called"); },
      async insert(row: unknown) { return row; },
    },
    terms: deletableTermsDeps([], recorder),
    entryTerms: countableEntryTermsDeps({}, recorder),
    transaction: recorder.transaction,
  });

  await assert.rejects(
    deleteTaxonomy({ deps, principalId: "u-1", taxonomyId: "tax-1" }),
    (err: unknown) => err instanceof ForbiddenError
  );
  assert.deepEqual(recorder.log, [], "an unauthorized caller must not even open a transaction");
});

test("deleteTaxonomy: a mid-cascade failure rolls back rather than leaving a partial delete (atomicity proof)", async () => {
  const recorder = transactionRecorder();
  const terms = deletableTermsDeps(
    [
      { id: "term-1", taxonomyId: "tax-1" },
      { id: "term-2", taxonomyId: "tax-1" },
    ],
    recorder
  );
  // Simulates the exact failure mode Hazard #1 (atomicity) names: the SECOND term's delete throws
  // partway through the cascade (e.g. a disk-full/constraint error a real DB could raise).
  const originalDelete = terms.delete.bind(terms);
  let deleteCalls = 0;
  terms.delete = async (id: string) => {
    deleteCalls += 1;
    if (deleteCalls === 2) {
      throw new Error("simulated mid-cascade failure");
    }
    return originalDelete(id);
  };
  const deletedTaxonomies: string[] = [];
  const deps = Object.assign(baseDeps(), {
    taxonomies: {
      async findById(id: string) { return { id, hierarchical: true }; },
      async delete(id: string) { deletedTaxonomies.push(id); },
      async insert(row: unknown) { return row; },
    },
    terms,
    entryTerms: countableEntryTermsDeps({}, recorder),
    transaction: recorder.transaction,
  });

  await assert.rejects(
    deleteTaxonomy({ deps, principalId: "u-1", taxonomyId: "tax-1" }),
    (err: unknown) => err instanceof Error && err.message === "simulated mid-cascade failure"
  );

  // The taxonomy row itself must NEVER be deleted when a member term's delete fails partway
  // through — a real DB's ROLLBACK guarantees this; this recorder-level assertion is the closest
  // a pure-domain (no real SQL) test can get to proving the SAME OBLIGATION is honored: the
  // taxonomy delete call never even happens after the mid-cascade throw, and the transaction
  // wrapper took the rollback branch, not commit. (Whether that rollback ACTUALLY undoes term-1's
  // delete against a real connection is proven separately, at the SQLite integration layer, where
  // a real ROLLBACK is observable — a plain-JS double has no way to un-happen the `deleted.push`
  // this domain layer isn't responsible for reverting.)
  assert.equal(deletedTaxonomies.length, 0, "the taxonomy row must not be deleted after a mid-cascade failure");
  assert.equal(recorder.log.at(-1), "tx:rollback");
  assert.ok(!recorder.log.includes("taxonomies.delete"), "the taxonomy delete must never be reached after term-2's delete throws");
});
