import assert from "node:assert/strict";
import { test } from "vitest";

import {
  TaxonomyRecordNotFoundError,
  TaxonomyVersionConflictError,
  importTaxonomy,
  importTerm,
} from "../write-service.js";
import { ForbiddenError } from "../../core/commands/command.js";
import type { Taxonomy, Term } from "../write-service.js";

/**
 * @file `importTaxonomy`/`importTerm` — the publish-content import path (plan-publish-all-types-
 * 2026-09-25.md, slice J1). Both preserve the source's own `id` (unlike `createTaxonomy`/
 * `createTerm`, which mint fresh ones) and are version-checked the same three-way way `importEntry`
 * is: `expectedVersion === undefined` means "this id must not already exist"; a number means "a row
 * at exactly this version must exist". Address (name) uniqueness is the publish factory's own
 * precheck (F1's `config.address`), not this function's job — mirrors `importEntry`'s same
 * disclosed split from slug-uniqueness.
 *
 * No trashed/tombstoned-target refusal is added here: unlike `content_types` (which has a real
 * `tombstone` status checked by `updateContentTypeFields`, S9/d4af29e9) or a trashable post/page
 * (4018304d), `Taxonomy`/`Term` in this package carry no non-`"active"` status value anywhere in
 * this codebase — there is no live/trashed/tombstoned state machine to refuse against. Judgment
 * call, disclosed rather than invented.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const alwaysDeny = async () => ({ allowed: false, reason: "no grant confers admin.taxonomy.manage" });

function fakeTaxonomiesRepo(seed: Taxonomy[] = []) {
  const rows = new Map(seed.map((t) => [t.id, { ...t }]));
  return {
    rows,
    async findById(id: string) {
      const row = rows.get(id);
      return row ? { id: row.id, hierarchical: row.hierarchical } : null;
    },
    async findByIdFull(id: string) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async insert(row: Taxonomy) {
      rows.set(row.id, { ...row });
      return row;
    },
    async update(row: Taxonomy) {
      rows.set(row.id, { ...row });
      return row;
    },
  };
}

function fakeTermsRepo(seed: Term[] = []) {
  const rows = new Map(seed.map((t) => [t.id, { ...t }]));
  return {
    rows,
    async findById(id: string) {
      const row = rows.get(id);
      return row ? { id: row.id, taxonomyId: row.taxonomyId, name: row.name } : null;
    },
    async findByIdFull(id: string) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async insert(row: Term) {
      rows.set(row.id, { ...row });
      return row;
    },
    async update(row: Term) {
      rows.set(row.id, { ...row });
      return row;
    },
  };
}

function baseDeps(overrides: { authorize?: typeof alwaysAllow; taxonomies?: ReturnType<typeof fakeTaxonomiesRepo>; terms?: ReturnType<typeof fakeTermsRepo> } = {}) {
  const revisions: unknown[] = [];
  const outboxEvents: unknown[] = [];
  let watermarkStamps = 0;
  return {
    revisions,
    outboxEvents,
    get watermarkStamps() { return watermarkStamps; },
    deps: {
      authorize: overrides.authorize ?? alwaysAllow,
      clock: { nowIso: () => NOW },
      idGen: { newId: () => "unused" },
      taxonomies: overrides.taxonomies ?? fakeTaxonomiesRepo([{ id: "tax-1", name: "seed", hierarchical: false, status: "active", updatedAt: NOW, version: 1 }]),
      terms: overrides.terms ?? fakeTermsRepo(),
      entryTerms: { upsert: async () => undefined },
      revisions: { insert: async (row: unknown) => { revisions.push(row); } },
      stampWatermark: () => { watermarkStamps += 1; },
      outbox: { enqueue: async (event: unknown) => { outboxEvents.push(event); } },
      workspaceId: "ws-1",
      contentLookup: { resolve: async () => null },
    },
  };
}

// ---------------------------------------------------------------------------
// importTaxonomy
// ---------------------------------------------------------------------------

test("importTaxonomy creates a row preserving the given id when no expectedVersion is supplied and none exists", async () => {
  const { deps, outboxEvents } = baseDeps();

  const taxonomy = await importTaxonomy({ deps, principalId: "user-1", id: "src-tax-1", name: "Cuisine", hierarchical: true, expectedVersion: undefined });

  assert.equal(taxonomy.id, "src-tax-1", "the source id must be preserved");
  assert.equal(taxonomy.version, 1);
  assert.equal((await deps.taxonomies.findByIdFull("src-tax-1"))?.name, "Cuisine");
  assert.equal(outboxEvents.length, 1);
  assert.equal((outboxEvents[0] as { name: string }).name, "taxonomy.imported");
});

test("importTaxonomy updates an existing row in place when expectedVersion matches, bumping version", async () => {
  const taxonomies = fakeTaxonomiesRepo([{ id: "src-tax-1", name: "Cuisine", hierarchical: true, status: "active", updatedAt: "2026-01-01T00:00:00.000Z", version: 2 }]);
  const { deps } = baseDeps({ taxonomies });

  const taxonomy = await importTaxonomy({ deps, principalId: "user-1", id: "src-tax-1", name: "Cuisine Renamed", hierarchical: true, expectedVersion: 2 });

  assert.equal(taxonomy.version, 3);
  assert.equal(taxonomy.name, "Cuisine Renamed");
  assert.equal(taxonomies.rows.size, 1, "an update must not add a second row");
});

test("importTaxonomy: expectedVersion undefined but the id already exists is a version conflict", async () => {
  const taxonomies = fakeTaxonomiesRepo([{ id: "src-tax-1", name: "Cuisine", hierarchical: true, status: "active", updatedAt: NOW, version: 1 }]);
  const { deps } = baseDeps({ taxonomies });

  await assert.rejects(
    importTaxonomy({ deps, principalId: "user-1", id: "src-tax-1", name: "Cuisine", hierarchical: true, expectedVersion: undefined }),
    (err: unknown) => {
      assert.ok(err instanceof TaxonomyVersionConflictError);
      assert.equal(err.message, "taxonomy 'src-tax-1' already exists, but no expectedVersion was supplied for import");
      return true;
    }
  );
});

test("importTaxonomy: expectedVersion set but no such taxonomy exists is a version conflict", async () => {
  const { deps } = baseDeps();

  await assert.rejects(
    importTaxonomy({ deps, principalId: "user-1", id: "ghost", name: "Cuisine", hierarchical: true, expectedVersion: 2 }),
    (err: unknown) => {
      assert.ok(err instanceof TaxonomyVersionConflictError);
      assert.equal(err.message, "expected version 2 for taxonomy 'ghost', but no such taxonomy exists");
      return true;
    }
  );
});

test("importTaxonomy: expectedVersion mismatched against the current row is a version conflict, no write", async () => {
  const taxonomies = fakeTaxonomiesRepo([{ id: "src-tax-1", name: "Cuisine", hierarchical: true, status: "active", updatedAt: NOW, version: 5 }]);
  const { deps } = baseDeps({ taxonomies });

  await assert.rejects(
    importTaxonomy({ deps, principalId: "user-1", id: "src-tax-1", name: "New Name", hierarchical: true, expectedVersion: 2 }),
    (err: unknown) => {
      assert.ok(err instanceof TaxonomyVersionConflictError);
      assert.equal(err.message, "expected version 2 for taxonomy 'src-tax-1', found 5");
      return true;
    }
  );
  assert.equal(taxonomies.rows.get("src-tax-1")?.name, "Cuisine", "the existing row must be untouched on a version conflict");
});

test("an unauthorized principal cannot import a taxonomy — FORBIDDEN, no write", async () => {
  const { deps } = baseDeps({ authorize: alwaysDeny });

  await assert.rejects(
    importTaxonomy({ deps, principalId: "intruder", id: "src-tax-1", name: "Cuisine", hierarchical: true, expectedVersion: undefined }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// importTerm
// ---------------------------------------------------------------------------

test("importTerm creates a row preserving the given id when no expectedVersion is supplied and none exists", async () => {
  const { deps } = baseDeps();

  const term = await importTerm({ deps, principalId: "user-1", id: "src-term-1", taxonomyId: "tax-1", name: "Mexican", parentId: null, expectedVersion: undefined });

  assert.equal(term.id, "src-term-1");
  assert.equal(term.version, 1);
});

test("importTerm updates an existing row in place when expectedVersion matches, bumping version", async () => {
  const terms = fakeTermsRepo([{ id: "src-term-1", taxonomyId: "tax-1", parentId: null, name: "Mexican", status: "active", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 }]);
  const { deps } = baseDeps({ terms });

  const term = await importTerm({ deps, principalId: "user-1", id: "src-term-1", taxonomyId: "tax-1", name: "Mexican Food", parentId: null, expectedVersion: 1 });

  assert.equal(term.version, 2);
  assert.equal(term.name, "Mexican Food");
  assert.equal(terms.rows.size, 1);
});

test("importTerm: expectedVersion undefined but the id already exists is a version conflict", async () => {
  const terms = fakeTermsRepo([{ id: "src-term-1", taxonomyId: "tax-1", parentId: null, name: "Mexican", status: "active", updatedAt: NOW, version: 1 }]);
  const { deps } = baseDeps({ terms });

  await assert.rejects(
    importTerm({ deps, principalId: "user-1", id: "src-term-1", taxonomyId: "tax-1", name: "Mexican", parentId: null, expectedVersion: undefined }),
    (err: unknown) => {
      assert.ok(err instanceof TaxonomyVersionConflictError);
      assert.equal(err.message, "term 'src-term-1' already exists, but no expectedVersion was supplied for import");
      return true;
    }
  );
});

test("importTerm: expectedVersion set but no such term exists is a version conflict", async () => {
  const { deps } = baseDeps();

  await assert.rejects(
    importTerm({ deps, principalId: "user-1", id: "ghost", taxonomyId: "tax-1", name: "Mexican", parentId: null, expectedVersion: 3 }),
    (err: unknown) => {
      assert.ok(err instanceof TaxonomyVersionConflictError);
      assert.equal(err.message, "expected version 3 for term 'ghost', but no such term exists");
      return true;
    }
  );
});

test("importTerm refuses when its owning taxonomy does not exist", async () => {
  const { deps } = baseDeps({ taxonomies: fakeTaxonomiesRepo() });

  await assert.rejects(
    importTerm({ deps, principalId: "user-1", id: "src-term-1", taxonomyId: "ghost-tax", name: "Mexican", parentId: null, expectedVersion: undefined }),
    (err: unknown) => {
      assert.ok(err instanceof TaxonomyRecordNotFoundError);
      return true;
    }
  );
});

test("an unauthorized principal cannot import a term — FORBIDDEN, no write", async () => {
  const { deps } = baseDeps({ authorize: alwaysDeny });

  await assert.rejects(
    importTerm({ deps, principalId: "intruder", id: "src-term-1", taxonomyId: "tax-1", name: "Mexican", parentId: null, expectedVersion: undefined }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError);
      return true;
    }
  );
});
