import assert from "node:assert/strict";
import { test } from "vitest";
import { sql } from "kysely";

import { describeEachDialect, type ContentKernel } from "../../core/__tests__/support/dialect-matrix.js";
import type { EntryRefRow } from "../ports.js";
import { entryRefsRepoFor } from "../sql/index.js";

/**
 * @file The entry-refs repo's one Kysely body on every dialect (`describeEachDialect` + ONE
 * factory). Covers every public method: hit, miss, insertion order, other-workspace isolation,
 * empty replacements and rollback.
 */

const WS = "ws-dialects";
const OTHER = "ws-other";

function ref(sourceEntryId: string, targetId: string, overrides: Partial<EntryRefRow> = {}): EntryRefRow {
  return {
    workspaceId: WS,
    sourceEntryId,
    sourceKind: "widget-embed",
    fieldPath: "body",
    targetKind: "asset",
    targetId,
    ...overrides,
  };
}

function repos(kernel: ContentKernel) {
  return { kernel, repo: entryRefsRepoFor({ kernel, tables: { entryRefs: "fixture_refs" } }) };
}

describeEachDialect({ title: "entry refs repo", options: {
  tables: ["fixture_refs"], make: repos,
  createTables: async (kernel, dialect) => {
    const identity = dialect === "sqlite" ? sql`integer primary key autoincrement` : sql`integer generated always as identity primary key`;
    await kernel.execute(sql`create table fixture_refs (
      id ${identity}, workspace_id text not null, source_entry_id text not null,
      source_kind text not null, field_path text not null, target_kind text not null, target_id text not null
    )`);
  },
}, body: (makeRepos) => {
  test("replaceForSource then findBySource / findByTarget return rows in insertion order", async () => {
    const { repo } = makeRepos();
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [ref("s1", "m2"), ref("s1", "m1", { fieldPath: "hero" })] });
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s2", refs: [ref("s2", "m1")] });
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s1" }), [
      ref("s1", "m2"),
      ref("s1", "m1", { fieldPath: "hero" }),
    ]);
    assert.deepEqual(await repo.findByTarget({ workspaceId: WS, targetKind: "asset", targetId: "m1" }), [
      ref("s1", "m1", { fieldPath: "hero" }),
      ref("s2", "m1"),
    ]);
  });

  test("reads miss unknown sources/targets, the wrong target kind, and other workspaces", async () => {
    const { repo } = makeRepos();
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [ref("s1", "m1")] });
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "nope" }), []);
    assert.deepEqual(await repo.findBySource({ workspaceId: OTHER, sourceEntryId: "s1" }), []);
    assert.deepEqual(await repo.findByTarget({ workspaceId: WS, targetKind: "asset", targetId: "nope" }), []);
    assert.deepEqual(await repo.findByTarget({ workspaceId: WS, targetKind: "entry", targetId: "m1" }), []);
    assert.deepEqual(await repo.findByTarget({ workspaceId: OTHER, targetKind: "asset", targetId: "m1" }), []);
  });

  test("replaceForSource fully replaces one source's slice; an empty list clears it", async () => {
    const { repo } = makeRepos();
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [ref("s1", "m1"), ref("s1", "m2")] });
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s2", refs: [ref("s2", "m1")] });
    await repo.replaceForSource({ workspaceId: OTHER, sourceEntryId: "s1", refs: [ref("s1", "m1", { workspaceId: OTHER })] });
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [ref("s1", "m3")] });
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s1" }), [ref("s1", "m3")]);
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [] });
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s1" }), []);
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s2" }), [ref("s2", "m1")]);
    assert.deepEqual(await repo.findBySource({ workspaceId: OTHER, sourceEntryId: "s1" }), [ref("s1", "m1", { workspaceId: OTHER })]);
  });

  test("removeBySource drops only that source in that workspace", async () => {
    const { repo } = makeRepos();
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [ref("s1", "m1")] });
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s2", refs: [ref("s2", "m1")] });
    await repo.replaceForSource({ workspaceId: OTHER, sourceEntryId: "s1", refs: [ref("s1", "m1", { workspaceId: OTHER })] });
    await repo.removeBySource({ workspaceId: WS, sourceEntryId: "s1" });
    await repo.removeBySource({ workspaceId: WS, sourceEntryId: "nope" });
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s1" }), []);
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s2" }), [ref("s2", "m1")]);
    assert.equal((await repo.findBySource({ workspaceId: OTHER, sourceEntryId: "s1" })).length, 1);
  });

  test("rebuildForWorkspace replaces the whole workspace and leaves others alone", async () => {
    const { repo } = makeRepos();
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [ref("s1", "m1")] });
    await repo.replaceForSource({ workspaceId: OTHER, sourceEntryId: "s1", refs: [ref("s1", "m1", { workspaceId: OTHER })] });
    await repo.rebuildForWorkspace({ workspaceId: WS, refs: [ref("s9", "m9"), ref("s8", "m9")] });
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s1" }), []);
    assert.deepEqual(await repo.findByTarget({ workspaceId: WS, targetKind: "asset", targetId: "m9" }), [
      ref("s9", "m9"),
      ref("s8", "m9"),
    ]);
    await repo.rebuildForWorkspace({ workspaceId: WS, refs: [] });
    assert.deepEqual(await repo.findByTarget({ workspaceId: WS, targetKind: "asset", targetId: "m9" }), []);
    assert.equal((await repo.findBySource({ workspaceId: OTHER, sourceEntryId: "s1" })).length, 1);
  });

  test("writes inside a failed transaction roll back, including the nested delete-then-insert", async () => {
    const { kernel, repo } = makeRepos();
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [ref("s1", "m1")] });
    await assert.rejects(
      kernel.transaction(async () => {
        await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [ref("s1", "m2")] });
        await repo.rebuildForWorkspace({ workspaceId: WS, refs: [ref("s5", "m5")] });
        throw new Error("boom");
      }),
      /boom/
    );
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s1" }), [ref("s1", "m1")]);
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s5" }), []);
  });
  for (const operation of ["replaceForSource", "rebuildForWorkspace"] as const) {
    test(`${operation} restores old rows when its insert fails`, async () => {
      const { repo } = makeRepos();
      await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "s1", refs: [ref("s1", "old")] });
      const invalid = ref("s1", "bad", { fieldPath: null as unknown as string });
      await assert.rejects(repo[operation]({ workspaceId: WS, sourceEntryId: "s1", refs: [invalid] }));
      assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "s1" }), [ref("s1", "old")]);
    });
  }

  test("colliding source and target IDs remain scoped on both reads", async () => {
    const { repo } = makeRepos();
    const own = ref("same", "same");
    const other = ref("same", "same", { workspaceId: OTHER });
    await repo.replaceForSource({ workspaceId: WS, sourceEntryId: "same", refs: [own] });
    await repo.replaceForSource({ workspaceId: OTHER, sourceEntryId: "same", refs: [other] });
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "same" }), [own]);
    assert.deepEqual(await repo.findByTarget({ workspaceId: OTHER, targetKind: "asset", targetId: "same" }), [other]);
  });

  test("unknown persisted source and target kinds survive conversion unchanged", async () => {
    const { kernel, repo } = makeRepos();
    await kernel.execute(sql`insert into fixture_refs
      (workspace_id, source_entry_id, source_kind, field_path, target_kind, target_id)
      values (${WS}, 'unknown-source', 'future-source', 'body', 'future-target', 'unknown-target')`);
    assert.deepEqual(await repo.findBySource({ workspaceId: WS, sourceEntryId: "unknown-source" }), [{
      workspaceId: WS, sourceEntryId: "unknown-source", sourceKind: "future-source",
      fieldPath: "body", targetKind: "future-target", targetId: "unknown-target",
    }]);
  });
} });
