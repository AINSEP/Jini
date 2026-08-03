import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assignTerms,
  createTaxonomy,
  createTerm,
  renameTerm,
} from "../write-service.js";
import { ForbiddenError } from "../../core/commands/command.js";

/**
 * @file SPEC-018 C-201/C-202/C-204 / REQ-01–REQ-05, REQ-12–REQ-14, REQ-17 — the taxonomy
 * write-service's ordinary (non-gated) mutations.
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
