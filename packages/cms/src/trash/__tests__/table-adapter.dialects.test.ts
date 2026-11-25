import assert from "node:assert/strict";
import { sql } from "kysely";
import { test } from "vitest";

import { type ContentKernel, describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import type { TrashAdapter } from "../ports.js";
import type { TrashEntry } from "../registry-types.js";
import { createTableTrashAdapter } from "../sql/index.js";
import { TRASH_TABLES, createTables as createTrashedItems } from "./support/trash-tables.fixture.js";

/**
 * @file The generic table adapter on every dialect: classification order (not-found, version-changed, already-in-state,
 * transition), status and timestamp markers, the prior-marker restore, the blocker, the purge guards (a live row, a stale
 * version, a writer racing the claim), cascades with their phantom `trashed_items` rows, the transaction + lock order and
 * the lazily resolved kernel.
 */

const WS = "ws-1";
const AT = "2026-10-10T00:00:00.000Z";

const form: TrashEntry = {
  entityType: "form", label: "Form", permission: "x.delete", table: "t_form", idColumn: "id", workspaceColumn: "workspace_id",
  marker: { kind: "timestamp", column: "deleted_at" }, versionColumn: "version", touchColumn: "updated_at", display: { title: "t_form.name" },
  purgeFirst: [{ table: "t_sub", parentIdColumn: "form_id", idColumn: "id", entityType: "form_submission" }],
};
const menu: TrashEntry = {
  entityType: "menu", label: "Menu", permission: "x.delete", table: "t_menu", idColumn: "id", workspaceColumn: "workspace_id",
  marker: { kind: "status", column: "status", trashed: "trash", restoreFallback: "published" }, versionColumn: "version", touchColumn: "updated_at",
  display: { title: "t_menu.title" }, blocker: { table: "t_kid", parentIdColumn: "menu_id", code: "MENU_HAS_KIDS" },
};

async function createTables(kernel: ContentKernel, dialect: Parameters<typeof createTrashedItems>[1]): Promise<void> {
  for (const statement of [
    "CREATE TABLE t_form (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, deleted_at TEXT, updated_at TEXT, version INTEGER)",
    "CREATE TABLE t_sub (id TEXT PRIMARY KEY, form_id TEXT)",
    "CREATE TABLE t_menu (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, status TEXT, updated_at TEXT, version INTEGER)",
    "CREATE TABLE t_kid (id TEXT PRIMARY KEY, menu_id TEXT)",
  ]) await kernel.execute(sql.raw(statement));
  await createTrashedItems(kernel, dialect);
}

interface Bundle { kernel: ContentKernel; events: string[]; adapter(entry: TrashEntry, over?: ContentKernel): TrashAdapter }

function bundleFor(kernel: ContentKernel): Bundle {
  const events: string[] = [];
  const recording: ContentKernel = {
    ...kernel,
    transaction: (fn) => { events.push("transaction"); return kernel.transaction(fn); },
    lockKey: async (key: string) => { events.push(`lock:${key}`); await kernel.lockKey(key); },
    run: (fn) => { events.push("run"); return kernel.run(fn); },
  };
  return { kernel, events, adapter: (entry, over) => createTableTrashAdapter({ entry, kernel: over ?? recording, tables: TRASH_TABLES }) };
}

const seedForm = (kernel: ContentKernel, deletedAt: string | null, version = 3) =>
  kernel.execute(sql.raw(`INSERT INTO t_form VALUES ('f1', '${WS}', 'F', ${deletedAt ? `'${deletedAt}'` : "NULL"}, NULL, ${version})`));
const formRow = (kernel: ContentKernel) => kernel.query<{ deleted_at: string | null; version: number }>(sql`SELECT deleted_at, version FROM t_form WHERE id = 'f1'`).then((r) => r[0]);
const count = (kernel: ContentKernel, table: string) => kernel.query<{ n: number | string }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`)).then((r) => Number(r[0]?.n));
const args = (expectedVersion: number | null) => ({ workspaceId: WS, entityId: "f1", at: AT, expectedVersion });

describeEachDialect<Bundle>({ title: "table trash adapter", options: { tables: ["t_form", "t_sub", "t_menu", "t_kid", "trashed_items"], createTables, make: bundleFor }, body: (make) => {
  test("hide then unhide a timestamp entry bumps the version each time and clears the marker", async () => {
    const { kernel, adapter } = make();
    await seedForm(kernel, null);
    assert.deepEqual(await adapter(form).hide(args(3)), { ok: true, version: 4 });
    assert.deepEqual(await formRow(kernel), { deleted_at: AT, version: 4 });
    assert.deepEqual(await adapter(form).unhide(args(4)), { ok: true, version: 5 });
    assert.deepEqual(await formRow(kernel), { deleted_at: null, version: 5 });
  });

  test("classification: missing is not-found; a stale version wins over already-in-state; a matching already-in-state is an unchanged no-op", async () => {
    const { kernel, adapter } = make();
    assert.deepEqual(await adapter(form).hide(args(3)), { ok: false, reason: "not-found" });
    await seedForm(kernel, AT);
    assert.deepEqual(await adapter(form).hide(args(2)), { ok: false, reason: "version-changed" });
    assert.deepEqual(await adapter(form).hide(args(3)), { ok: true, version: 3, noop: true });
    assert.deepEqual(await formRow(kernel), { deleted_at: AT, version: 3 });
    assert.deepEqual(await adapter(form).unhide(args(null)), { ok: true, version: 4 });
    assert.deepEqual(await adapter(form).unhide(args(4)), { ok: true, version: 4, noop: true });
  });

  test("a status marker records the prior status on hide and restores it on unhide, else the entry's fallback", async () => {
    const { kernel, adapter } = make();
    await kernel.execute(sql.raw(`INSERT INTO t_menu VALUES ('m1', '${WS}', 'M', 'draft', NULL, 1)`));
    const hidden = await adapter(menu).hide({ workspaceId: WS, entityId: "m1", at: AT, expectedVersion: 1 });
    assert.deepEqual(hidden, { ok: true, version: 2, priorMarker: "draft" });
    await adapter(menu).unhide({ workspaceId: WS, entityId: "m1", at: AT, expectedVersion: 2 }, { priorMarker: "draft" });
    assert.equal((await kernel.query<{ status: string }>(sql`SELECT status FROM t_menu WHERE id = 'm1'`))[0]?.status, "draft");
    await adapter(menu).hide({ workspaceId: WS, entityId: "m1", at: AT, expectedVersion: 3 });
    await adapter(menu).unhide({ workspaceId: WS, entityId: "m1", at: AT, expectedVersion: 4 });
    assert.equal((await kernel.query<{ status: string }>(sql`SELECT status FROM t_menu WHERE id = 'm1'`))[0]?.status, "published");
  });

  test("a blocker refuses a real hide with its code and count, and never runs for an already-trashed row", async () => {
    const { kernel, adapter } = make();
    await kernel.execute(sql.raw(`INSERT INTO t_menu VALUES ('m1', '${WS}', 'M', 'draft', NULL, 1), ('m2', '${WS}', 'M2', 'trash', NULL, 1)`));
    await kernel.execute(sql.raw("INSERT INTO t_kid VALUES ('k1', 'm1'), ('k2', 'm1')"));
    assert.deepEqual(await adapter(menu).hide({ workspaceId: WS, entityId: "m1", at: AT, expectedVersion: 1 }), { ok: false, reason: "blocked", code: "MENU_HAS_KIDS", count: 2 });
    // The blocker names a table that does not exist: evaluating it throws, so a clean no-op proves it never ran.
    const unreachable: TrashEntry = { ...menu, blocker: { table: "no_such_table", parentIdColumn: "menu_id", code: "X" } };
    assert.deepEqual(await adapter(unreachable).hide({ workspaceId: WS, entityId: "m2", at: AT, expectedVersion: 1 }), { ok: true, version: 1, noop: true });
  });

  test("purge: a live row at a matching version and a stale version both report version-changed and delete nothing; a missing row is already-gone", async () => {
    const { kernel, adapter } = make();
    assert.equal(await adapter(form).purge({ workspaceId: WS, entityId: "f1", expectedVersion: 3 }), "already-gone");
    await seedForm(kernel, null);
    await kernel.execute(sql.raw("INSERT INTO t_sub VALUES ('s1', 'f1')"));
    assert.equal(await adapter(form).purge({ workspaceId: WS, entityId: "f1", expectedVersion: 3 }), "version-changed");
    await kernel.execute(sql.raw(`UPDATE t_form SET deleted_at = '${AT}'`));
    assert.equal(await adapter(form).purge({ workspaceId: WS, entityId: "f1", expectedVersion: 2 }), "version-changed");
    assert.equal(await count(kernel, "t_form"), 1);
    assert.equal(await count(kernel, "t_sub"), 1);
  });

  test("purge removes the children and their trashed_items rows with the parent, and leaves another form's rows", async () => {
    const { kernel, adapter } = make();
    await seedForm(kernel, AT);
    await kernel.execute(sql.raw("INSERT INTO t_sub VALUES ('s1', 'f1'), ('s2', 'f1'), ('other', 'f2')"));
    for (const id of ["s1", "s2", "other"]) {
      await kernel.execute(sql.raw(`INSERT INTO trashed_items VALUES ('ti-${id}', '${WS}', 'form_submission', '${id}', '${AT}', '${AT}', 'p', NULL, 't', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`));
    }
    assert.equal(await adapter(form).purge({ workspaceId: WS, entityId: "f1", expectedVersion: 3 }), "purged");
    assert.equal(await count(kernel, "t_form"), 0);
    assert.deepEqual(await kernel.query<{ id: string }>(sql`SELECT id FROM t_sub`), [{ id: "other" }]);
    assert.deepEqual(await kernel.query<{ entity_id: string }>(sql`SELECT entity_id FROM trashed_items`), [{ entity_id: "other" }]);
  });

  test("a purge whose cascade fails rolls the whole transaction back", async () => {
    const { kernel, adapter } = make();
    await seedForm(kernel, AT);
    await kernel.execute(sql.raw("INSERT INTO t_sub VALUES ('s1', 'f1')"));
    const broken: TrashEntry = { ...form, purgeFirst: [...(form.purgeFirst ?? []), { table: "no_such_table", parentIdColumn: "form_id" }] };
    await assert.rejects(adapter(broken).purge({ workspaceId: WS, entityId: "f1", expectedVersion: 3 }), /no_such_table/);
    assert.equal(await count(kernel, "t_form"), 1);
    assert.equal(await count(kernel, "t_sub"), 1);
  });

  test("a writer that restores the row between the purge's read and its claim, without a version bump, is not overwritten", async () => {
    const { kernel, adapter } = make();
    await seedForm(kernel, AT);
    let reads = 0;
    const racing: ContentKernel = { ...kernel, run: async (fn) => {
      const result = await kernel.run(fn);
      if (++reads === 1) await kernel.execute(sql.raw("UPDATE t_form SET deleted_at = NULL"));
      return result;
    } };
    assert.equal(await adapter(form, racing).purge({ workspaceId: WS, entityId: "f1", expectedVersion: 3 }), "version-changed");
    assert.deepEqual(await formRow(kernel), { deleted_at: null, version: 3 });
  });

  for (const operation of ["hide", "unhide", "purge"] as const) {
    test(`${operation} runs in a transaction and takes the row's lock key before its first read`, async () => {
      const { kernel, events, adapter } = make();
      await seedForm(kernel, operation === "hide" ? null : AT);
      if (operation === "purge") await adapter(form).purge({ workspaceId: WS, entityId: "f1", expectedVersion: 3 });
      else await adapter(form)[operation](args(3));
      assert.deepEqual(events.slice(0, 3), ["transaction", `lock:trash:form:${WS}:f1`, "run"]);
    });
  }

  test("the kernel is read on the first call, not at construction", async () => {
    const { kernel } = make();
    await seedForm(kernel, null);
    let reads = 0;
    const adapter = createTableTrashAdapter({ entry: form, tables: TRASH_TABLES, get kernel() { reads += 1; return kernel; } });
    assert.equal(reads, 0);
    await adapter.hide(args(null));
    await adapter.unhide(args(null));
    assert.equal(reads, 1);
  });
} });
