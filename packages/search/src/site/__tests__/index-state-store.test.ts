import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { sql, type Kysely } from "kysely";
import type { SearchIndexStateRow, SearchTarget } from "../../ports.js";
import { createSqlSearchIndexStore, type SearchIndexDatabase } from "../index-state-store.js";
import { DDL, TABLES, embeddedDialects } from "./support/dialects.js";

/** The host kernel's Kysely handle, re-typed for the raw-SQL tables (as the store does). */
const tables = (db: unknown) => db as Kysely<SearchIndexDatabase>;

/**
 * @file The search-index store's one Kysely body on SQLite and PGlite, over the host's portable table DDL
 * (the same DDL the host's migrations 0027/0028 create, supplied by `support/dialects.ts`).
 */

const TARGET: SearchTarget = { siteId: "site-a", providerId: "builtin", generation: 1 };
const OTHER: SearchTarget = { siteId: "site-a", providerId: "builtin", generation: 2 };

function row(overrides: Partial<SearchIndexStateRow> = {}): SearchIndexStateRow {
  return {
    target: TARGET,
    key: { siteId: "site-a", workspaceId: "ws", collection: "post", documentId: "p/1" },
    revision: 1_760_000_000_123,
    deleted: false,
    status: "pending",
    attempts: 0,
    updatedAtMs: 1_760_000_000_500,
    ...overrides,
  };
}

const key = (documentId: string) => ({ siteId: "site-a", workspaceId: "ws", collection: "post", documentId });

for (const dialect of embeddedDialects()) describe(`SqlSearchIndexStore [${dialect.name}]`, () => {
  const make = () => {
    const kernel = dialect.make();
    let clock = 1_000;
    return { kernel, ...createSqlSearchIndexStore({ kernel, tables: TABLES, now: () => { clock += 1; return clock; } }) };
  };
  test("put inserts then upserts one row per (target, key); get round-trips every field, incl. epoch-ms bigints", async () => {
    const { indexState } = make();
    assert.equal(await indexState.get({ target: TARGET, key: key("p/1") }), null);
    await indexState.put({ row: row() });
    assert.deepEqual(await indexState.get({ target: TARGET, key: key("p/1") }), row());
    const settled = row({ revision: 1_760_000_000_999, deleted: true, status: "failed", attempts: 3, taskId: "t-9", lastError: "boom", updatedAtMs: 1_760_000_001_000 });
    await indexState.put({ row: settled });
    assert.deepEqual(await indexState.get({ target: TARGET, key: key("p/1") }), settled);
    // Same key, other generation: an independent row.
    assert.equal(await indexState.get({ target: OTHER, key: key("p/1") }), null);
    // A key whose parts contain "/" is stored under its encoded form and never collides.
    assert.equal(await indexState.get({ target: TARGET, key: { ...key("p"), collection: "post/1" } }), null);
  });

  test("put rejects older revisions, accepts the same revision, and leaves another generation unchanged", async () => {
    const { indexState } = make();
    const newer = row({ revision: 2 });
    const neighbor = row({ target: OTHER, revision: 1 });
    await indexState.put({ row: newer });
    await indexState.put({ row: neighbor });
    assert.equal(await indexState.put({ row: row({ revision: 1 }) }), false);
    assert.deepEqual(await indexState.get({ target: TARGET, key: key("p/1") }), newer);
    assert.deepEqual(await indexState.get({ target: OTHER, key: key("p/1") }), neighbor);
    const sameRevision = row({ revision: 2, status: "indexed" });
    assert.equal(await indexState.put({ row: sameRevision }), true);
    assert.deepEqual(await indexState.get({ target: TARGET, key: key("p/1") }), sameRevision);
    assert.deepEqual(await indexState.get({ target: OTHER, key: key("p/1") }), neighbor);
  });

  test("settle is a compare-and-swap on the observed revision and task id", async () => {
    const { indexState } = make();
    const settled = row({ status: "indexed", updatedAtMs: 1_760_000_002_000 });
    assert.equal(await indexState.settle({ row: settled, expected: { revision: row().revision, taskId: null } }), false, "no row: nothing to settle");
    assert.equal(await indexState.get({ target: TARGET, key: key("p/1") }), null);
    await indexState.put({ row: row({ taskId: "t-1" }) });
    assert.equal(await indexState.settle({ row: settled, expected: { revision: row().revision, taskId: null } }), false, "another task owns the row");
    assert.equal(await indexState.settle({ row: settled, expected: { revision: row().revision - 1, taskId: "t-1" } }), false, "a newer revision owns the row");
    assert.equal((await indexState.get({ target: TARGET, key: key("p/1") }))?.status, "pending");
    assert.equal(await indexState.settle({ row: settled, expected: { revision: row().revision, taskId: "t-1" } }), true);
    assert.deepEqual(await indexState.get({ target: TARGET, key: key("p/1") }), settled);
    const failed = row({ status: "failed", lastError: "boom", updatedAtMs: 1_760_000_003_000 });
    assert.equal(await indexState.settle({ row: failed, expected: { revision: row().revision, taskId: null } }), true, "a task-less row matches a null task");
    assert.deepEqual(await indexState.get({ target: TARGET, key: key("p/1") }), failed);
    // Another target's row with the same key is untouched.
    assert.equal(await indexState.settle({ row: { ...settled, target: OTHER }, expected: { revision: row().revision, taskId: null } }), false);
  });

  test("listByStatus filters by target and status, oldest first with the key as tie-break, capped at limit", async () => {
    const { indexState } = make();
    await indexState.put({ row: row({ key: key("c"), status: "unknown", updatedAtMs: 5 }) });
    await indexState.put({ row: row({ key: key("b"), status: "pending", updatedAtMs: 5 }) });
    await indexState.put({ row: row({ key: key("a"), status: "pending", updatedAtMs: 9 }) });
    await indexState.put({ row: row({ key: key("d"), status: "indexed", updatedAtMs: 1 }) });
    await indexState.put({ row: row({ target: OTHER, key: key("e"), status: "pending", updatedAtMs: 1 }) });
    const ids = async (statuses: Parameters<typeof indexState.listByStatus>[0]["statuses"], limit = 10) =>
      (await indexState.listByStatus({ target: TARGET, statuses, limit })).map(r => r.key.documentId);
    assert.deepEqual(await ids(["pending", "unknown"]), ["b", "c", "a"]);
    assert.deepEqual(await ids(["pending", "unknown"], 2), ["b", "c"]);
    assert.deepEqual(await ids(["indexed"]), ["d"]);
    assert.deepEqual(await ids([]), [], "no status asked for matches no row");
  });

  test("listByStatus excludes failed rows at or over failedBelowAttempts before the limit applies", async () => {
    const { indexState } = make();
    await indexState.put({ row: row({ key: key("a"), status: "failed", attempts: 5, updatedAtMs: 1 }) });
    await indexState.put({ row: row({ key: key("b"), status: "failed", attempts: 6, updatedAtMs: 2 }) });
    await indexState.put({ row: row({ key: key("c"), status: "unknown", attempts: 9, updatedAtMs: 3 }) });
    await indexState.put({ row: row({ key: key("d"), status: "failed", attempts: 4, updatedAtMs: 4 }) });
    const ids = async (optional?: { failedBelowAttempts?: number }) =>
      (await indexState.listByStatus({ target: TARGET, statuses: ["failed", "unknown"], limit: 2 }, optional)).map(r => r.key.documentId);
    assert.deepEqual(await ids(), ["a", "b"]);
    assert.deepEqual(await ids({ failedBelowAttempts: 5 }), ["c", "d"]);
  });

  test("counts reports every status, zero when absent, per target", async () => {
    const { indexState } = make();
    assert.deepEqual(await indexState.counts({ target: TARGET }), { pending: 0, indexed: 0, unknown: 0, failed: 0 });
    await indexState.put({ row: row({ key: key("a"), status: "pending" }) });
    await indexState.put({ row: row({ key: key("b"), status: "pending" }) });
    await indexState.put({ row: row({ key: key("c"), status: "failed" }) });
    await indexState.put({ row: row({ target: OTHER, key: key("d"), status: "indexed" }) });
    assert.deepEqual(await indexState.counts({ target: TARGET }), { pending: 2, indexed: 0, unknown: 0, failed: 1 });
  });

  test("watermarks: null before start, cursor while running, cursor-less done, upserted in place", async () => {
    const { indexState } = make();
    assert.equal(await indexState.getWatermark({ target: TARGET, collection: "post" }), null);
    await indexState.putWatermark({ target: TARGET, collection: "post", cursor: "id-5", done: false });
    assert.deepEqual(await indexState.getWatermark({ target: TARGET, collection: "post" }), { cursor: "id-5", done: false });
    await indexState.putWatermark({ target: TARGET, collection: "post", done: true });
    assert.deepEqual(await indexState.getWatermark({ target: TARGET, collection: "post" }), { done: true });
    assert.equal(await indexState.getWatermark({ target: TARGET, collection: "page" }), null);
    assert.equal(await indexState.getWatermark({ target: OTHER, collection: "post" }), null);
  });

  test("deleteTarget drops that target's rows and watermarks only", async () => {
    const { indexState } = make();
    await indexState.put({ row: row({ key: key("a") }) });
    await indexState.put({ row: row({ target: OTHER, key: key("a") }) });
    await indexState.putWatermark({ target: TARGET, collection: "post", done: true });
    await indexState.putWatermark({ target: OTHER, collection: "post", done: true });
    await indexState.deleteTarget({ target: TARGET });
    assert.equal(await indexState.get({ target: TARGET, key: key("a") }), null);
    assert.equal(await indexState.getWatermark({ target: TARGET, collection: "post" }), null);
    assert.ok(await indexState.get({ target: OTHER, key: key("a") }));
    assert.deepEqual(await indexState.getWatermark({ target: OTHER, collection: "post" }), { done: true });
  });

  test("targets: empty site, setBuilding (replacing an unfinished one), promote, clearBuilding", async () => {
    const { targets, kernel } = make();
    assert.deepEqual(await targets.get({ siteId: "site-a" }), { active: null, building: null });
    await targets.setBuilding({ target: TARGET });
    await targets.setBuilding({ target: OTHER });
    assert.deepEqual(await targets.get({ siteId: "site-a" }), { active: null, building: OTHER });
    assert.equal(await targets.promote({ siteId: "site-a", expected: TARGET }), false, "a stale expectation never switches");
    assert.deepEqual(await targets.promote({ siteId: "site-a", expected: OTHER }), { replaced: null });
    assert.deepEqual(await targets.get({ siteId: "site-a" }), { active: OTHER, building: null });
    assert.equal(await targets.promote({ siteId: "site-a", expected: OTHER }), false, "a second promote of the same build finds no building");

    const next = { siteId: "site-a", providerId: "meili", generation: 3 };
    await targets.setBuilding({ target: next });
    assert.deepEqual(await targets.get({ siteId: "site-a" }), { active: OTHER, building: next }, "a rebuild keeps the active pointer");
    assert.deepEqual(await targets.promote({ siteId: "site-a", expected: next }), { replaced: OTHER });
    assert.deepEqual(await targets.get({ siteId: "site-a" }), { active: next, building: null });

    await targets.setBuilding({ target: TARGET });
    await targets.clearBuilding({ siteId: "site-a" });
    assert.deepEqual(await targets.get({ siteId: "site-a" }), { active: next, building: null });
    await targets.clearBuilding({ siteId: "site-b" });
    assert.deepEqual(await targets.get({ siteId: "site-b" }), { active: null, building: null }, "clearing an unknown site is a no-op");
    assert.equal(await targets.promote({ siteId: "site-b", expected: TARGET }), false);
    // The pointer row records when it last changed (injected clock, strictly increasing).
    const [stamp] = await kernel.run(db => tables(db)
      .selectFrom("search_index_targets").select("updated_at_ms").where("site_id", "=", "site-a").execute());
    assert.ok(Number(stamp?.updated_at_ms) > 1_000);
  });

  test("promote retires the replaced target in the same transaction; listRetired is oldest first per site; forgetRetired removes one", async () => {
    const { targets } = make();
    const gen = (generation: number, providerId = "builtin", siteId = "site-a"): SearchTarget => ({ siteId, providerId, generation });
    await targets.setBuilding({ target: gen(1) });
    assert.deepEqual(await targets.promote({ siteId: "site-a", expected: gen(1) }), { replaced: null });
    assert.deepEqual(await targets.listRetired({ siteId: "site-a" }), [], "a first promote replaces nothing");
    await targets.setBuilding({ target: gen(2, "meilisearch") });
    await targets.promote({ siteId: "site-a", expected: gen(2, "meilisearch") });
    await targets.setBuilding({ target: gen(3) });
    await targets.promote({ siteId: "site-a", expected: gen(3) });
    await targets.setBuilding({ target: gen(1, "builtin", "site-b") });
    await targets.promote({ siteId: "site-b", expected: gen(1, "builtin", "site-b") });
    assert.deepEqual(await targets.listRetired({ siteId: "site-a" }), [gen(1), gen(2, "meilisearch")]);
    assert.equal(await targets.promote({ siteId: "site-a", expected: gen(9) }), false);
    assert.deepEqual(await targets.listRetired({ siteId: "site-a" }), [gen(1), gen(2, "meilisearch")], "a lost CAS retires nothing");
    await targets.forgetRetired({ target: gen(1) });
    assert.deepEqual(await targets.listRetired({ siteId: "site-a" }), [gen(2, "meilisearch")]);
    assert.deepEqual(await targets.listRetired({ siteId: "site-b" }), []);
  });

  test("promote is a compare-and-swap on the active pointer too: a switch that raced in first wins", async () => {
    const { targets, kernel } = make();
    const raced = { siteId: "site-a", providerId: "meili", generation: 7 };
    await targets.setBuilding({ target: TARGET });
    // Between promote's read and its UPDATE another writer moves the active pointer; simulated by a
    // kernel that moves it right after each statement (so after the read, before the UPDATE).
    const racingKernel: typeof kernel = { ...kernel, run: async (fn) => {
      const result = await kernel.run(fn);
      await kernel.run(db => tables(db)
        .updateTable("search_index_targets").set({ active_provider_id: raced.providerId, active_generation: raced.generation }).where("site_id", "=", "site-a").execute());
      return result;
    } };
    const racing = createSqlSearchIndexStore({ kernel: racingKernel, tables: TABLES, now: () => 1 });
    assert.equal(await racing.targets.promote({ siteId: "site-a", expected: TARGET }), false);
    assert.deepEqual(await targets.get({ siteId: "site-a" }), { active: raced, building: TARGET });
  });

  test("every statement runs against the injected table names, not fixed ones", async () => {
    const kernel = dialect.make();
    const renamed = { state: "host_si_state", watermarks: "host_si_watermarks", targets: "host_si_targets", retired: "host_si_retired" };
    for (const statement of DDL) {
      if (statement.startsWith("CREATE TABLE")) await kernel.execute(sql.raw(statement.replaceAll("search_index_", "host_si_")));
    }
    const store = createSqlSearchIndexStore({ kernel, tables: renamed, now: () => 7 });
    await store.indexState.put({ row: row() });
    await store.indexState.putWatermark({ target: TARGET, collection: "post", done: true });
    await store.targets.setBuilding({ target: TARGET });
    await store.targets.promote({ siteId: "site-a", expected: TARGET });
    await store.targets.setBuilding({ target: OTHER });
    await store.targets.promote({ siteId: "site-a", expected: OTHER });
    assert.deepEqual(await store.indexState.get({ target: TARGET, key: key("p/1") }), row());
    assert.deepEqual(await store.indexState.counts({ target: TARGET }), { pending: 1, indexed: 0, unknown: 0, failed: 0 });
    assert.deepEqual(await store.targets.listRetired({ siteId: "site-a" }), [TARGET]);
    await store.indexState.deleteTarget({ target: TARGET });
    assert.equal(await store.indexState.get({ target: TARGET, key: key("p/1") }), null);
    assert.equal(await store.indexState.getWatermark({ target: TARGET, collection: "post" }), null);
  });
});

test("put reports a write that the driver counted as no row (missing affected-row count) as not written", async () => {
  const kernel = { run: async () => ({}) } as unknown as Parameters<typeof createSqlSearchIndexStore>[0]["kernel"];
  const { indexState } = createSqlSearchIndexStore({ kernel, tables: TABLES, now: () => 1 });
  assert.equal(await indexState.put({ row: row() }), false);
});
