import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryMenuRepo, MenuConflictError, MenuNotFoundError, MenuVersionConflictError, type NavMenuEntry } from "../../index.js";
import { trashMenu, type RemoveMenuFn } from "../trash-menu.js";

/**
 * @file Characterizes the menu move-to-Trash entry point, written before the verbatim move: it reads
 * the live menu, hands the injected generic `remove` step the display and expected version, and maps
 * that step's two refusals onto the menu domain's not-found and 409-shaped conflict errors.
 */

const AT = "2026-10-04T00:00:00.000Z";
const actor = { principalId: "user-1" };

function menuRow(overrides: Partial<NavMenuEntry> = {}): NavMenuEntry {
  return {
    id: "menu-1", workspaceId: "ws-1", slug: "primary-nav", title: "Primary Nav", status: "published",
    doc: { type: "menu", version: 1, items: [] }, locations: [], updatedAt: AT, version: 3,
    ...overrides,
  };
}

function setup(result: Awaited<ReturnType<RemoveMenuFn>>, rows: NavMenuEntry[] = [menuRow()]) {
  const calls: Parameters<RemoveMenuFn>[0][] = [];
  const remove: RemoveMenuFn = async (required) => { calls.push(required); return result; };
  const deps = { menuRepo: new InMemoryMenuRepo({}, { initialRows: rows }), remove, clock: { nowIso: () => AT } };
  return { deps, calls };
}

test("moves a live menu to the Trash through the injected remove step", async () => {
  const { deps, calls } = setup({ ok: true, version: 4 });
  const result = await trashMenu({ workspaceId: "ws-1", menuId: "menu-1", actor }, deps);
  assert.deepEqual(result, { id: "menu-1", version: 4 });
  assert.deepEqual(calls, [{
    workspaceId: "ws-1", id: "menu-1", display: { title: "Primary Nav", subtitle: "primary-nav" },
    at: AT, expectedVersion: 3, actor,
  }]);
});

test("a missing menu is not found and never reaches remove", async () => {
  const { deps, calls } = setup({ ok: true, version: 4 }, []);
  await assert.rejects(trashMenu({ workspaceId: "ws-1", menuId: "menu-1", actor }, deps), (error: unknown) => {
    assert.ok(error instanceof MenuNotFoundError);
    assert.equal(error.message, "menu 'menu-1' was not found");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("a remove step that finds nothing surfaces as not found", async () => {
  const { deps } = setup({ ok: false, reason: "not-found" });
  await assert.rejects(trashMenu({ workspaceId: "ws-1", menuId: "menu-1", actor }, deps), MenuNotFoundError);
});

test("a row that changed mid-move is a plain conflict", async () => {
  const { deps } = setup({ ok: false, reason: "version-changed" });
  await assert.rejects(trashMenu({ workspaceId: "ws-1", menuId: "menu-1", actor }, deps), (error: unknown) => {
    assert.ok(error instanceof MenuConflictError);
    assert.ok(!(error instanceof MenuVersionConflictError));
    assert.equal(error.message, "menu 'menu-1' changed while it was being deleted — reload and try again");
    return true;
  });
});
