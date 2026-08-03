import assert from "node:assert/strict";
import { test } from "vitest";

import { rebuildNavLocationBindings } from "../reconcile.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../repo.memory.js";
import type { NavMenuEntry } from "../types.js";

/**
 * @file `rebuildNavLocationBindings` — the first real caller of the
 * already-implemented `NavLocationBindingRepoPort.rebuildForWorkspace`
 * (ADR-PIPE-012 D-8, C-009, T026).
 */

function fakeClock(iso = "2026-07-13T00:00:00.000Z") {
  return { nowIso: () => iso };
}

function menu(overrides: Partial<NavMenuEntry> & Pick<NavMenuEntry, "id" | "slug">): NavMenuEntry {
  return {
    workspaceId: "ws-1",
    title: overrides.slug,
    status: "draft",
    doc: { type: "menu", version: 1, items: [] },
    locations: [],
    updatedAt: "2026-07-13T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test("C-009: rebuild produces exactly the union of every menu's .locations field — no orphan, no missing rows", async () => {
  const menuRepo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();

  await menuRepo.save(menu({ id: "menu-1", slug: "primary-nav", locations: ["primary"] }));
  await menuRepo.save(menu({ id: "menu-2", slug: "footer-nav", locations: ["footer", "social"] }));
  await menuRepo.save(menu({ id: "menu-3", slug: "unassigned-nav", locations: [] }));

  const result = await rebuildNavLocationBindings({ menuRepo, bindingRepo, clock, workspaceId: "ws-1" });
  assert.equal(result.rebuiltCount, 3);

  const rows = await bindingRepo.listByWorkspace({ workspaceId: "ws-1" });
  const byLocation = new Map(rows.map((r) => [r.locationKey, r.menuId]));
  assert.equal(rows.length, 3);
  assert.equal(byLocation.get("primary"), "menu-1");
  assert.equal(byLocation.get("footer"), "menu-2");
  assert.equal(byLocation.get("social"), "menu-2");
});

test("C-009: rebuild drops orphan rows the current menu data no longer supports", async () => {
  const menuRepo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();

  // A stale binding-index row with no corresponding menu.locations entry (drift).
  await bindingRepo.upsert({ workspaceId: "ws-1", locationKey: "stale", menuId: "ghost-menu", boundAt: "2026-01-01T00:00:00.000Z" });
  await menuRepo.save(menu({ id: "menu-1", slug: "primary-nav", locations: ["primary"] }));

  await rebuildNavLocationBindings({ menuRepo, bindingRepo, clock, workspaceId: "ws-1" });

  const rows = await bindingRepo.listByWorkspace({ workspaceId: "ws-1" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.locationKey, "primary");
});

test("C-009: rebuild is idempotent — running twice on unchanged menu data produces the same index", async () => {
  const menuRepo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();

  await menuRepo.save(menu({ id: "menu-1", slug: "primary-nav", locations: ["primary", "footer"] }));

  const first = await rebuildNavLocationBindings({ menuRepo, bindingRepo, clock, workspaceId: "ws-1" });
  const firstRows = await bindingRepo.listByWorkspace({ workspaceId: "ws-1" });

  const second = await rebuildNavLocationBindings({ menuRepo, bindingRepo, clock, workspaceId: "ws-1" });
  const secondRows = await bindingRepo.listByWorkspace({ workspaceId: "ws-1" });

  assert.equal(first.rebuiltCount, second.rebuiltCount);
  assert.deepEqual(
    firstRows.map((r) => r.locationKey).sort(),
    secondRows.map((r) => r.locationKey).sort()
  );
  assert.equal(secondRows.length, 2);
});

test("C-009: rebuild only affects the requested workspace's bindings", async () => {
  const menuRepo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();

  await bindingRepo.upsert({ workspaceId: "ws-2", locationKey: "primary", menuId: "other-menu", boundAt: "2026-01-01T00:00:00.000Z" });
  await menuRepo.save(menu({ id: "menu-1", slug: "primary-nav", locations: ["primary"], workspaceId: "ws-1" }));

  await rebuildNavLocationBindings({ menuRepo, bindingRepo, clock, workspaceId: "ws-1" });

  const ws2Rows = await bindingRepo.listByWorkspace({ workspaceId: "ws-2" });
  assert.equal(ws2Rows.length, 1, "a different workspace's bindings are untouched");
});
