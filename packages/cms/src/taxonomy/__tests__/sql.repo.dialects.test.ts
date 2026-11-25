import { sql } from "kysely";
import assert from "node:assert/strict";
import { test } from "vitest";

import { type ContentKernel, describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { SqlEntryTermRepo, SqlTaxonomyRepo, SqlTaxonomyRevisionRepo, SqlTermRepo } from "../sql/index.js";
import type { Taxonomy, Term } from "../write-contracts.js";
import { TAXONOMY_TABLES, createTables } from "./support/taxonomy-tables.fixture.js";

/**
 * @file The four taxonomy SQL repos on every dialect through the kernel's matrix (`describeEachDialect`:
 * one query body serves SQLite and PGlite). One `describe` per class; each public
 * method gets a hit, a miss, other-workspace isolation and (where it writes several rows) a rollback.
 */

const WS = "ws-dialects";
const OTHER = "other-ws";
const T0 = "2026-09-28T00:00:00.000Z";

/** The assignment columns the tests read back through the raw kernel (the adapter itself never exposes them). */
type AssignmentViews = Record<string, { workspace_id: string; content_type: string; content_id: string; term_id: string; added_at: string }>;

const TABLES = ["taxonomies", "terms", "entry_terms", "taxonomy_revisions"] as const;

function taxonomy(id: string, overrides: Partial<Taxonomy> = {}): Taxonomy {
  return { id, name: `Tax ${id}`, hierarchical: false, status: "active", updatedAt: T0, version: 1, ...overrides };
}

function term(id: string, taxonomyId: string, overrides: Partial<Term> = {}): Term {
  return { id, taxonomyId, parentId: null, name: `Term ${id}`, status: "active", updatedAt: T0, version: 1, ...overrides };
}

interface Bundle {
  kernel: ContentKernel;
  taxonomies: SqlTaxonomyRepo;
  terms: SqlTermRepo;
  entryTerms: SqlEntryTermRepo;
  revisions: SqlTaxonomyRevisionRepo;
}

function bundleFor(kernel: ContentKernel): Bundle {
  return {
    kernel,
    taxonomies: new SqlTaxonomyRepo({ kernel, tables: TAXONOMY_TABLES, workspaceId: WS }),
    terms: new SqlTermRepo({ kernel, tables: TAXONOMY_TABLES, workspaceId: WS }),
    entryTerms: new SqlEntryTermRepo({ kernel, tables: TAXONOMY_TABLES, workspaceId: WS }),
    revisions: new SqlTaxonomyRevisionRepo({ kernel, tables: TAXONOMY_TABLES, workspaceId: WS }),
  };
}

function assign(contentId: string, termId: string, addedAt = T0, contentType = "post") {
  return { contentType, contentId, termId, addedAt };
}

describeEachDialect<Bundle>({ title: "taxonomy repo", options: { tables: TABLES, createTables, make: bundleFor }, body: (make) => {
    let ctx!: Bundle;
    const makeRepo = () => ((ctx = make()), ctx.taxonomies);
    test("insert round-trips every field incl. the hierarchical boolean", async () => {
      const repo = makeRepo();
      const row = taxonomy("t1", { hierarchical: true, version: 3 });
      assert.deepEqual(await repo.insert(row), row);
      assert.deepEqual(await repo.findByIdFull({ id: "t1" }), row);
      assert.deepEqual(await repo.findById({ id: "t1" }), { id: "t1", hierarchical: true });
      await repo.insert(taxonomy("t2"));
      assert.deepEqual(await repo.findById({ id: "t2" }), { id: "t2", hierarchical: false });
    });

    test("finds miss an unknown id and another workspace's row", async () => {
      const repo = makeRepo();
      await repo.insert(taxonomy("t1"));
      const other = new SqlTaxonomyRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER });
      for (const target of [repo, other]) {
        assert.equal(await target.findById({ id: "nope" }), null);
        assert.equal(await target.findByIdFull({ id: "nope" }), null);
        assert.equal(await target.findAnyById({ id: "nope" }), null);
        assert.equal(await target.findForTrash({ id: "nope" }), null);
      }
      assert.equal(await other.findById({ id: "t1" }), null);
      assert.equal(await other.findByIdFull({ id: "t1" }), null);
      assert.equal(await other.findAnyById({ id: "t1" }), null);
      assert.equal(await other.findForTrash({ id: "t1" }), null);
      assert.deepEqual(await other.list(), []);
    });

    test("trashed rows hide from live reads but findAnyById still sees them", async () => {
      const repo = makeRepo();
      await repo.insert(taxonomy("gone", { status: "trash" }));
      await repo.insert(taxonomy("live"));
      assert.equal(await repo.findById({ id: "gone" }), null);
      assert.equal(await repo.findByIdFull({ id: "gone" }), null);
      assert.equal(await repo.findForTrash({ id: "gone" }), null);
      assert.equal((await repo.findAnyById({ id: "gone" }))?.status, "trash");
      assert.deepEqual((await repo.list()).map((r) => r.id), ["live"]);
      assert.deepEqual(await repo.findForTrash({ id: "live" }), { id: "live", name: "Tax live", version: 1 });
    });

    test("update rewrites a live row and no-ops on a trashed or other-workspace row", async () => {
      const repo = makeRepo();
      await repo.insert(taxonomy("t1"));
      await repo.insert(taxonomy("dead", { status: "trash", name: "kept" }));
      const changed = taxonomy("t1", { name: "Renamed", hierarchical: true, version: 2, updatedAt: "2026-09-29T00:00:00.000Z" });
      await repo.update(changed);
      assert.deepEqual(await repo.findByIdFull({ id: "t1" }), changed);
      await repo.update(taxonomy("dead", { name: "revived", status: "active" }));
      const dead = await repo.findAnyById({ id: "dead" });
      assert.equal(dead?.status, "trash");
      assert.equal(dead?.name, "kept");
      await (new SqlTaxonomyRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER })).update(taxonomy("t1", { name: "hijacked" }));
      assert.equal((await repo.findByIdFull({ id: "t1" }))?.name, "Renamed");
    });

    test("delete removes only this workspace's row", async () => {
      const repo = makeRepo();
      const other = new SqlTaxonomyRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER });
      await repo.insert(taxonomy("t1"));
      await other.insert(taxonomy("o1"));
      await other.delete({ id: "t1" });
      assert.equal((await repo.findAnyById({ id: "t1" }))?.id, "t1");
      await repo.delete({ id: "o1" });
      assert.equal((await other.findAnyById({ id: "o1" }))?.id, "o1");
      await repo.delete({ id: "t1" });
      assert.equal(await repo.findAnyById({ id: "t1" }), null);
      await repo.delete({ id: "absent" });
    });

    test("transaction commits its writes, rolls them all back on a throw, and nested calls join", async () => {
      const repo = makeRepo();
      const result = await repo.transaction({ fn: async () => {
        await repo.insert(taxonomy("a"));
        return repo.transaction({ fn: async () => {
          await repo.insert(taxonomy("b"));
          return "ok";
        } });
      } });
      assert.equal(result, "ok");
      assert.equal((await repo.list()).length, 2);
      await assert.rejects(
        repo.transaction({ fn: async () => {
          await repo.insert(taxonomy("c"));
          await repo.transaction({ fn: async () => { await repo.insert(taxonomy("inner")); } });
          throw new Error("boom");
        } }),
        /boom/
      );
      assert.equal(await repo.findAnyById({ id: "c" }), null);
      assert.equal(await repo.findAnyById({ id: "inner" }), null);
      assert.equal((await repo.list()).length, 2);
    });
  } });

describeEachDialect<Bundle>({ title: "term repo", options: { tables: TABLES, createTables, make: bundleFor }, body: (make) => {
    let ctx!: Bundle;
    const makeRepo = () => ((ctx = make()), ctx.terms);
    async function seedTaxonomy(id: string, status = "active", workspaceId = WS): Promise<void> {
      await (new SqlTaxonomyRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId })).insert(taxonomy(id, { status }));
    }

    test("insert round-trips every field incl. a parent", async () => {
      const repo = makeRepo();
      await seedTaxonomy("tx");
      const child = term("child", "tx", { parentId: "root", version: 4 });
      assert.deepEqual(await repo.insert(child), child);
      assert.deepEqual(await repo.findByIdFull({ id: "child" }), child);
      assert.deepEqual(await repo.findById({ id: "child" }), { id: "child", taxonomyId: "tx", name: "Term child" });
      assert.deepEqual(await repo.findAnyById({ id: "child" }), child);
      assert.equal(await repo.getParentId({ termId: "child" }), "root");
    });

    test("reads miss an unknown id and another workspace's row", async () => {
      const repo = makeRepo();
      await seedTaxonomy("tx");
      await repo.insert(term("a", "tx"));
      const other = new SqlTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER });
      assert.equal(await repo.findById({ id: "nope" }), null);
      assert.equal(await repo.findByIdFull({ id: "nope" }), null);
      assert.equal(await repo.findAnyById({ id: "nope" }), null);
      assert.equal(await repo.findForTrash({ id: "nope" }), null);
      assert.equal(await repo.findForPurgeAudit({ id: "nope" }), null);
      assert.equal(await repo.getParentId({ termId: "nope" }), null);
      assert.equal(await repo.getParentId({ termId: "a" }), null);
      for (const read of [
        other.findById({ id: "a" }),
        other.findByIdFull({ id: "a" }),
        other.findAnyById({ id: "a" }),
        other.findForTrash({ id: "a" }),
        other.findForPurgeAudit({ id: "a" }),
      ]) {
        assert.equal(await read, null);
      }
      assert.deepEqual(await other.listByTaxonomy({ taxonomyId: "tx" }), []);
      assert.deepEqual(await other.listIdsForPurgeAudit({ taxonomyId: "tx" }), []);
      assert.equal(await other.countChildren({ parentId: "a" }), 0);
    });

    test("a term is hidden by its own trash marker and by a trashed taxonomy; trash-blind reads still see it", async () => {
      const repo = makeRepo();
      await seedTaxonomy("live-tx");
      await seedTaxonomy("dead-tx", "trash");
      await repo.insert(term("ok", "live-tx"));
      await repo.insert(term("own-trash", "live-tx", { status: "trash" }));
      await repo.insert(term("under-trash", "dead-tx"));
      assert.deepEqual((await repo.listByTaxonomy({ taxonomyId: "live-tx" })).map((t) => t.id), ["ok"]);
      assert.deepEqual(await repo.listByTaxonomy({ taxonomyId: "dead-tx" }), []);
      for (const id of ["own-trash", "under-trash"]) {
        assert.equal(await repo.findById({ id: id }), null);
        assert.equal(await repo.findByIdFull({ id: id }), null);
        assert.equal(await repo.findForTrash({ id }), null);
        assert.ok(await repo.findAnyById({ id }));
        assert.ok(await repo.findForPurgeAudit({ id }));
      }
      assert.deepEqual((await repo.listIdsForPurgeAudit({ taxonomyId: "live-tx" })).sort(), ["ok", "own-trash"]);
      assert.deepEqual(await repo.listIdsForPurgeAudit({ taxonomyId: "dead-tx" }), ["under-trash"]);
    });

    test("findForTrash joins the taxonomy name; findForPurgeAudit returns the audit shape", async () => {
      const repo = makeRepo();
      await seedTaxonomy("tx");
      await repo.insert(term("a", "tx", { version: 7 }));
      assert.deepEqual(await repo.findForTrash({ id: "a" }), {
        id: "a",
        name: "Term a",
        taxonomyId: "tx",
        taxonomyName: "Tax tx",
        version: 7,
      });
      assert.deepEqual(await repo.findForPurgeAudit({ id: "a" }), { id: "a", name: "Term a", taxonomyId: "tx" });
    });

    test("update rewrites a live term and no-ops on a trashed, orphaned-by-trash or other-workspace one", async () => {
      const repo = makeRepo();
      await seedTaxonomy("tx");
      await seedTaxonomy("dead-tx", "trash");
      await repo.insert(term("a", "tx"));
      await repo.insert(term("own", "tx", { status: "trash", name: "kept" }));
      await repo.insert(term("under", "dead-tx", { name: "kept" }));
      const changed = term("a", "tx", { name: "Renamed", parentId: "p", version: 2, updatedAt: "2026-09-29T00:00:00.000Z" });
      await repo.update(changed);
      assert.deepEqual(await repo.findByIdFull({ id: "a" }), changed);
      await repo.update(term("own", "tx", { name: "revived", status: "active" }));
      await repo.update(term("under", "dead-tx", { name: "revived" }));
      assert.equal((await repo.findAnyById({ id: "own" }))?.name, "kept");
      assert.equal((await repo.findAnyById({ id: "own" }))?.status, "trash");
      assert.equal((await repo.findAnyById({ id: "under" }))?.name, "kept");
      await (new SqlTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER })).update(term("a", "tx", { name: "hijacked" }));
      assert.equal((await repo.findByIdFull({ id: "a" }))?.name, "Renamed");
    });

    test("countChildren counts direct children only, whatever their status", async () => {
      const repo = makeRepo();
      await seedTaxonomy("tx");
      await repo.insert(term("root", "tx"));
      await repo.insert(term("c1", "tx", { parentId: "root" }));
      await repo.insert(term("c2", "tx", { parentId: "root", status: "trash" }));
      await repo.insert(term("grand", "tx", { parentId: "c1" }));
      assert.equal(await repo.countChildren({ parentId: "root" }), 2);
      assert.equal(await repo.countChildren({ parentId: "c1" }), 1);
      assert.equal(await repo.countChildren({ parentId: "grand" }), 0);
    });

    test("delete removes only this workspace's term", async () => {
      const repo = makeRepo();
      const other = new SqlTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER });
      await seedTaxonomy("tx");
      await seedTaxonomy("otx", "active", OTHER);
      await repo.insert(term("a", "tx"));
      await other.insert(term("o", "otx"));
      await other.delete({ id: "a" });
      assert.ok(await repo.findAnyById({ id: "a" }));
      await repo.delete({ id: "o" });
      assert.ok(await other.findAnyById({ id: "o" }));
      await repo.delete({ id: "a" });
      assert.equal(await repo.findAnyById({ id: "a" }), null);
      await repo.delete({ id: "absent" });
    });

    test("a failed insert inside a taxonomy transaction rolls the earlier insert back", async () => {
      const repo = makeRepo();
      const taxonomies = new SqlTaxonomyRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: WS });
      await seedTaxonomy("tx");
      await repo.insert(term("dup", "tx"));
      await assert.rejects(
        taxonomies.transaction({ fn: async () => {
          await repo.insert(term("fresh", "tx"));
          await repo.insert(term("dup", "tx"));
        } })
      );
      assert.equal(await repo.findAnyById({ id: "fresh" }), null);
      assert.ok(await repo.findAnyById({ id: "dup" }));
    });
  } });

describeEachDialect<Bundle>({ title: "entry-term repo", options: { tables: TABLES, createTables, make: bundleFor }, body: (make) => {
    let ctx!: Bundle;
    const makeRepo = () => ((ctx = make()), ctx.entryTerms);
    async function seedTerms(): Promise<void> {
      const taxonomies = new SqlTaxonomyRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: WS });
      const terms = new SqlTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: WS });
      await taxonomies.insert(taxonomy("tx"));
      await taxonomies.insert(taxonomy("dead-tx", { status: "trash" }));
      for (const id of ["a", "b"]) await terms.insert(term(id, "tx"));
      await terms.insert(term("gone", "tx", { status: "trash" }));
      await terms.insert(term("under", "dead-tx"));
    }

    test("upsert is idempotent per (content, term): a repeat replaces addedAt", async () => {
      const repo = makeRepo();
      await seedTerms();
      const first = assign("p1", "a", "2026-09-28T01:00:00.000Z");
      assert.deepEqual(await repo.upsert(first), first);
      await repo.upsert(assign("p1", "a", "2026-09-28T02:00:00.000Z"));
      assert.equal(await repo.countByTerm({ termId: "a" }), 1);
      const stored = await ctx.kernel.run((db) => db.withTables<AssignmentViews>().selectFrom(TAXONOMY_TABLES.entryTerms).select("added_at")
        .where("workspace_id", "=", WS).where("content_type", "=", "post").where("content_id", "=", "p1").where("term_id", "=", "a").executeTakeFirst());
      assert.equal(stored?.added_at, "2026-09-28T02:00:00.000Z");
      await repo.upsert(assign("p1", "b"));
      await repo.upsert(assign("p1", "a", T0, "page"));
      assert.equal(await repo.countByTerm({ termId: "a" }), 2);
      assert.equal(await repo.countByTerm({ termId: "absent" }), 0);
    });

    test("remove and deleteByContent return the removed count, scoped to the workspace", async () => {
      const repo = makeRepo();
      const other = new SqlEntryTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER });
      await seedTerms();
      await repo.upsert(assign("p1", "a"));
      await repo.upsert(assign("p1", "b"));
      await other.upsert(assign("p1", "a"));
      assert.equal(await repo.remove({ contentType: "post", contentId: "p1", termId: "a" }), 1);
      assert.equal(await repo.remove({ contentType: "post", contentId: "p1", termId: "a" }), 0);
      assert.equal(await other.remove({ contentType: "post", contentId: "p1", termId: "b" }), 0);
      assert.equal(await other.countByTerm({ termId: "a" }), 1);
      assert.equal(await repo.deleteByContent({ workspaceId: OTHER, contentType: "post", contentId: "nope" }), 0);
      assert.equal(await repo.deleteByContent({ workspaceId: WS, contentType: "post", contentId: "p1" }), 1);
      assert.equal(await repo.deleteByContent({ workspaceId: WS, contentType: "post", contentId: "p1" }), 0);
      assert.equal(await other.countByTerm({ termId: "a" }), 1);
    });

    test("countOverlap counts content assigned to both terms, isolated by workspace", async () => {
      const repo = makeRepo();
      await seedTerms();
      await repo.upsert(assign("p1", "a"));
      await repo.upsert(assign("p2", "a"));
      await repo.upsert(assign("p2", "b"));
      await (new SqlEntryTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER })).upsert(assign("p1", "b"));
      assert.equal(await repo.countOverlap({ fromTermId: "a", intoTermId: "b" }), 1);
      assert.equal(await repo.countOverlap({ fromTermId: "a", intoTermId: "absent" }), 0);
      assert.equal(await (new SqlEntryTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER })).countOverlap({ fromTermId: "a", intoTermId: "b" }), 0);
    });

    test("repointTerm moves assignments, collapsing duplicates; other workspaces are untouched", async () => {
      const repo = makeRepo();
      const other = new SqlEntryTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER });
      await seedTerms();
      await repo.upsert(assign("p1", "a", "2026-09-28T01:00:00.000Z"));
      await repo.upsert(assign("p2", "a", "2026-09-28T02:00:00.000Z"));
      await repo.upsert(assign("p2", "b", "2026-09-28T03:00:00.000Z"));
      await repo.upsert(assign("p1", "a", "2026-09-28T04:00:00.000Z", "page"));
      await repo.upsert(assign("page-only", "a", "2026-09-28T05:00:00.000Z", "page"));
      await other.upsert(assign("p1", "a"));
      assert.deepEqual(await repo.repointTerm({ fromTermId: "a", intoTermId: "b" }), { repointedCount: 4 });
      assert.equal(await repo.countByTerm({ termId: "a" }), 0);
      assert.equal(await repo.countByTerm({ termId: "b" }), 4);
      assert.equal(await other.countByTerm({ termId: "a" }), 1);
      const rows = await ctx.kernel.run((db) => db.withTables<AssignmentViews>().selectFrom(TAXONOMY_TABLES.entryTerms)
        .select(["workspace_id", "content_type", "content_id", "term_id", "added_at"]).execute());
      assert.deepEqual(rows.map((row) => [row.workspace_id, row.content_type, row.content_id, row.term_id, row.added_at]).sort(), [
        [OTHER, "post", "p1", "a", T0],
        [WS, "page", "p1", "b", "2026-09-28T04:00:00.000Z"],
        [WS, "page", "page-only", "b", "2026-09-28T05:00:00.000Z"],
        [WS, "post", "p1", "b", "2026-09-28T01:00:00.000Z"],
        [WS, "post", "p2", "b", "2026-09-28T02:00:00.000Z"],
      ].sort());
      assert.deepEqual(await repo.repointTerm({ fromTermId: "a", intoTermId: "b" }), { repointedCount: 0 });
    });

    test("repointTerm rolls back when the merge fails part-way", async () => {
      const repo = makeRepo();
      await seedTerms();
      await repo.upsert(assign("p1", "a"));
      await repo.upsert(assign("p2", "a"));
      // The third statement (the second re-point) fails after the first one landed.
      const flaky = Object.create(ctx.kernel) as ContentKernel;
      let calls = 0;
      flaky.run = (fn) => (++calls === 3 ? Promise.reject(new Error("boom")) : ctx.kernel.run(fn));
      await assert.rejects((new SqlEntryTermRepo({ kernel: flaky, tables: TAXONOMY_TABLES, workspaceId: WS })).repointTerm({ fromTermId: "a", intoTermId: "b" }), /boom/);
      assert.equal(await repo.countByTerm({ termId: "a" }), 2);
      assert.equal(await repo.countByTerm({ termId: "b" }), 0);
    });

    test("listForContent joins names in added order and hides trashed terms and terms of a trashed taxonomy", async () => {
      const repo = makeRepo();
      await seedTerms();
      await repo.upsert(assign("p1", "b", "2026-09-28T02:00:00.000Z"));
      await repo.upsert(assign("p1", "a", "2026-09-28T01:00:00.000Z"));
      await repo.upsert(assign("p1", "gone", "2026-09-28T03:00:00.000Z"));
      await repo.upsert(assign("p1", "under", "2026-09-28T04:00:00.000Z"));
      await repo.upsert(assign("p2", "a"));
      await (new SqlEntryTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER })).upsert(assign("p1", "b"));
      assert.deepEqual(await repo.listForContent({ contentType: "post", contentId: "p1" }), [
        { termId: "a", termName: "Term a", taxonomyName: "Tax tx" },
        { termId: "b", termName: "Term b", taxonomyName: "Tax tx" },
      ]);
      assert.deepEqual(await repo.listForContent({ contentType: "post", contentId: "none" }), []);
      assert.deepEqual(await (new SqlEntryTermRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: "third" })).listForContent({ contentType: "post", contentId: "p1" }), []);
    });
  } });

describeEachDialect<Bundle>({ title: "taxonomy revision repo", options: { tables: TABLES, createTables, make: bundleFor }, body: (make) => {
    let ctx!: Bundle;
    const makeRepo = () => ((ctx = make()), ctx.revisions);
    const revision = (taxonomyId: string, op: "create" | "rename", previousState: Record<string, unknown> | null) => ({
      taxonomyId,
      op,
      previousState,
      actorId: "user-1",
      recordedAt: T0,
    });

    test("insert appends rows in seq order and round-trips previousState (compact JSON or null)", async () => {
      const repo = makeRepo();
      const first = revision("t1", "create", null);
      const second = revision("t1", "rename", { name: "Old", nested: { a: [1, 2] } });
      assert.deepEqual(await repo.insert(first), first);
      await repo.insert(second);
      assert.deepEqual(await repo.listForTests({ taxonomyId: "t1" }), [first, second]);
    });

    test("insert persists a typed actor kind beside actor_id; without one actor_kind stays NULL (unknown)", async () => {
      const repo = makeRepo();
      await repo.insert({ ...revision("t1", "create", null), actorKind: "member" });
      await repo.insert(revision("t1", "rename", null));
      const rows = await ctx.kernel.query<{ op: string; actor_id: string; actor_kind: string | null }>(
        sql`SELECT op, actor_id, actor_kind FROM taxonomy_revisions ORDER BY seq`);
      assert.deepEqual(rows, [{ op: "create", actor_id: "user-1", actor_kind: "member" }, { op: "rename", actor_id: "user-1", actor_kind: null }]);
    });

    test("listForTests misses an unknown taxonomy and another workspace's ledger", async () => {
      const repo = makeRepo();
      await repo.insert(revision("t1", "create", null));
      assert.deepEqual(await repo.listForTests({ taxonomyId: "nope" }), []);
      assert.deepEqual(await (new SqlTaxonomyRevisionRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: OTHER })).listForTests({ taxonomyId: "t1" }), []);
    });

    test("an insert inside a rolled-back transaction leaves no revision", async () => {
      const repo = makeRepo();
      await assert.rejects(
        (new SqlTaxonomyRepo({ kernel: ctx.kernel, tables: TAXONOMY_TABLES, workspaceId: WS })).transaction({ fn: async () => {
          await repo.insert(revision("t1", "create", null));
          throw new Error("boom");
        } }),
        /boom/
      );
      assert.deepEqual(await repo.listForTests({ taxonomyId: "t1" }), []);
    });
  } });
