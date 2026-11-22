import assert from "node:assert/strict";
import { test } from "vitest";

import { type ContentKernel, describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { MenuConflictError, MenuVersionConflictError } from "../menu-service.js";
import { SqlMenuRepo, SqlNavLocationBindingRepo } from "../sql/index.js";
import type { NavMenuDoc, NavMenuEntry } from "../types.js";
import { NAVIGATION_TABLES, createTables } from "./support/navigation-tables.fixture.js";

/**
 * @file The menu and location-binding SQL repos on every dialect through the kernel's matrix: one query body serves
 * SQLite and PGlite. One `describe` per class; covers the live/trash reads, the upsert that never revives a trashed
 * row, the compare-and-set and create-only saves, the transaction, and the workspace scoping of every method.
 */

const NOW = "2026-07-13T00:00:00.000Z";
const WS = "ws-1";
const OTHER = "ws-2";
const TABLES = ["menus", "nav_location_bindings"] as const;
const doc: NavMenuDoc = { type: "menu", version: 1, items: [{ id: "i1", label: "Home", target: { kind: "url", href: "/" } }] };

function menu(id: string, overrides: Partial<NavMenuEntry> = {}): NavMenuEntry {
  return { id, workspaceId: WS, slug: `slug-${id}`, title: `Menu ${id}`, status: "published", doc, locations: ["primary"], updatedAt: NOW, version: 1, ...overrides };
}

interface Bundle { kernel: ContentKernel; menus: SqlMenuRepo; bindings: SqlNavLocationBindingRepo }

function bundleFor(kernel: ContentKernel): Bundle {
  return {
    kernel,
    menus: new SqlMenuRepo({ kernel, tables: NAVIGATION_TABLES }, {}),
    bindings: new SqlNavLocationBindingRepo({ kernel, tables: NAVIGATION_TABLES }, {}),
  };
}

describeEachDialect<Bundle>({ title: "menu repo", options: { tables: TABLES, createTables, make: bundleFor }, body: (make) => {
  test("save and the reads round-trip the doc and locations, scoped to the workspace", async () => {
    const { menus } = make();
    await menus.save(menu("m1"));
    await menus.save(menu("m2", { workspaceId: OTHER, slug: "slug-m1" }));
    assert.deepEqual(await menus.findById({ workspaceId: WS, id: "m1" }), menu("m1"));
    assert.equal((await menus.findBySlug({ workspaceId: OTHER, slug: "slug-m1" }))?.id, "m2");
    assert.deepEqual((await menus.list({ workspaceId: WS })).map((row) => row.id), ["m1"]);
    assert.equal(await menus.findById({ workspaceId: OTHER, id: "m1" }), null);
    assert.equal(await menus.findById({ workspaceId: WS, id: "nope" }), null);
  });

  test("a second save with the same id replaces the row; remove deletes only this workspace's row", async () => {
    const { menus } = make();
    await menus.save(menu("m1"));
    await menus.save(menu("m1", { title: "Renamed", version: 2 }));
    assert.equal((await menus.findById({ workspaceId: WS, id: "m1" }))?.title, "Renamed");
    await menus.remove({ workspaceId: OTHER, id: "m1" });
    assert.ok(await menus.findById({ workspaceId: WS, id: "m1" }));
    await menus.remove({ workspaceId: WS, id: "m1" });
    assert.equal(await menus.findById({ workspaceId: WS, id: "m1" }), null);
  });

  test("a trashed menu is hidden from live reads, never revived by a plain save, and still holds its slug", async () => {
    const { menus } = make();
    await menus.save(menu("t1"));
    await menus.save(menu("t1", { status: "trash", version: 2 }));
    await menus.save(menu("t1", { title: "revived", status: "published", version: 3 }));
    assert.equal(await menus.findById({ workspaceId: WS, id: "t1" }), null);
    assert.equal(await menus.findBySlug({ workspaceId: WS, slug: "slug-t1" }), null);
    assert.deepEqual(await menus.list({ workspaceId: WS }), []);
    const held = await menus.findByIdIncludingTrashed({ workspaceId: WS, id: "t1" });
    assert.deepEqual([held?.status, held?.title, held?.version], ["trash", "Menu t1", 2]);
    assert.equal(await menus.findByIdIncludingTrashed({ workspaceId: OTHER, id: "t1" }), null);
    await assert.rejects(menus.save(menu("t2", { slug: "slug-t1" })), MenuConflictError);
  });

  test("a compare-and-set save lands on the matching version and refuses a stale, trashed or foreign row", async () => {
    const { menus } = make();
    await menus.save(menu("m1"));
    await menus.save(menu("m1", { title: "First", version: 2 }), { expectedVersion: 1 });
    await assert.rejects(menus.save(menu("m1", { title: "Stale", version: 2 }), { expectedVersion: 1 }), MenuVersionConflictError);
    await assert.rejects(menus.save(menu("m1", { workspaceId: OTHER, title: "Hijack", version: 3 }), { expectedVersion: 2 }), MenuVersionConflictError);
    assert.equal((await menus.findById({ workspaceId: WS, id: "m1" }))?.title, "First");
    await menus.save(menu("m1", { status: "trash", version: 3 }), { expectedVersion: 2 });
    await assert.rejects(menus.save(menu("m1", { version: 4 }), { expectedVersion: 3 }), MenuVersionConflictError);
  });

  test("a create-only save inserts an absent id and refuses a taken id and a slug a trashed menu holds", async () => {
    const { menus } = make();
    await menus.save(menu("m1"), { expectedVersion: null });
    await assert.rejects(menus.save(menu("m1", { slug: "other-slug" }), { expectedVersion: null }), MenuVersionConflictError);
    await menus.save(menu("m1", { status: "trash", version: 2 }));
    await assert.rejects(menus.save(menu("m2", { slug: "slug-m1" }), { expectedVersion: null }), (error: unknown) => error instanceof MenuConflictError && !(error instanceof MenuVersionConflictError));
  });

  test("the transaction commits its writes and rolls them all back when the callback throws", async () => {
    const { menus } = make();
    assert.equal(await menus.transaction({ fn: async () => { await menus.save(menu("kept")); return "ok"; } }), "ok");
    await assert.rejects(menus.transaction({ fn: async () => { await menus.save(menu("lost")); throw new Error("abort"); } }), /abort/);
    assert.ok(await menus.findById({ workspaceId: WS, id: "kept" }));
    assert.equal(await menus.findById({ workspaceId: WS, id: "lost" }), null);
  });
} });

describeEachDialect<Bundle>({ title: "nav location binding repo", options: { tables: TABLES, createTables, make: bundleFor }, body: (make) => {
  const bind = (workspaceId: string, locationKey: string, menuId: string) => ({ workspaceId, locationKey, menuId, boundAt: NOW });

  test("upsert round-trips a binding and reassigns a location already bound elsewhere", async () => {
    const { bindings } = make();
    assert.deepEqual(await bindings.upsert(bind(WS, "primary", "m1")), bind(WS, "primary", "m1"));
    await bindings.upsert(bind(WS, "primary", "m2"));
    assert.deepEqual(await bindings.findByLocation({ workspaceId: WS, locationKey: "primary" }), bind(WS, "primary", "m2"));
    assert.equal(await bindings.findByLocation({ workspaceId: OTHER, locationKey: "primary" }), null);
    assert.deepEqual(await bindings.listByWorkspace({ workspaceId: WS }), [bind(WS, "primary", "m2")]);
  });

  test("listByMenu, remove and removeByMenu act on one workspace's rows only", async () => {
    const { bindings } = make();
    for (const row of [bind(WS, "primary", "m1"), bind(WS, "footer", "m1"), bind(OTHER, "primary", "m1")]) await bindings.upsert(row);
    assert.deepEqual((await bindings.listByMenu({ workspaceId: WS, menuId: "m1" })).map((row) => row.locationKey).sort(), ["footer", "primary"]);
    await bindings.remove({ workspaceId: WS, locationKey: "footer" });
    assert.deepEqual((await bindings.listByMenu({ workspaceId: WS, menuId: "m1" })).map((row) => row.locationKey), ["primary"]);
    await bindings.removeByMenu({ workspaceId: WS, menuId: "m1" });
    assert.deepEqual(await bindings.listByWorkspace({ workspaceId: WS }), []);
    assert.equal((await bindings.listByWorkspace({ workspaceId: OTHER })).length, 1);
  });

  test("rebuildForWorkspace replaces the whole workspace's index, clears it for an empty list, and rolls back on failure", async () => {
    const { bindings } = make();
    await bindings.upsert(bind(WS, "old", "m0"));
    await bindings.upsert(bind(OTHER, "keep", "m0"));
    await bindings.rebuildForWorkspace({ workspaceId: WS, bindings: [bind(WS, "a", "m1"), bind(WS, "b", "m2")] });
    assert.deepEqual((await bindings.listByWorkspace({ workspaceId: WS })).map((row) => row.locationKey).sort(), ["a", "b"]);
    await assert.rejects(bindings.rebuildForWorkspace({ workspaceId: WS, bindings: [bind(WS, "dup", "m1"), bind(WS, "dup", "m2")] }));
    assert.deepEqual((await bindings.listByWorkspace({ workspaceId: WS })).map((row) => row.locationKey).sort(), ["a", "b"]);
    await bindings.rebuildForWorkspace({ workspaceId: WS, bindings: [] });
    assert.deepEqual(await bindings.listByWorkspace({ workspaceId: WS }), []);
    assert.equal((await bindings.listByWorkspace({ workspaceId: OTHER })).length, 1);
  });
} });
