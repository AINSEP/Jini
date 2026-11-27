import assert from "node:assert/strict";
import { test, expect, vi } from "vitest";

import type { TrashAdapter } from "../../../trash/ports.js";
import { isMismatchedOwnerEnvelope, removeMismatchedOwnerEntries, type OwnerEntryRow } from "../unreadable-owner-entries-repair.js";

/**
 * @file The boot repair's predicate on its own: a row is removable only when its envelope has a
 * namespace and NONE of them is the owner's. Everything else (a readable row, a row with both, a
 * malformed or missing envelope) is out of scope and stays.
 */

const owner = "widget";

test("a payload under another namespace only is mismatched (the 2026-08-03 probe rows)", () => {
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { site: { payload: "probe" } } }, owner }), true);
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { site: "scalar", other: {} } }, owner }), true);
});

test("any envelope that carries the owner's key is never mismatched, readable or not", () => {
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { widget: { payload: "{}" } } }, owner }), false);
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { widget: { payload: "{}" }, site: { payload: "x" } } }, owner }), false);
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext: { widget: null, site: {} } }, owner }), false);
});

test("a missing or non-object envelope, or an empty ext, is not this defect", () => {
  for (const fieldsJson of [null, "text", 3, [], {}, { ext: null }, { ext: [] }, { ext: "site" }, { ext: {} }, { payload: "x" }]) {
    assert.equal(isMismatchedOwnerEnvelope({ fieldsJson, owner }), false, JSON.stringify(fieldsJson));
  }
});

test("an inherited key is not an own namespace", () => {
  const ext = Object.create({ site: {} }) as Record<string, unknown>;
  assert.equal(isMismatchedOwnerEnvelope({ fieldsJson: { ext }, owner }), false);
});

const at = "2026-11-26T01:02:03.000Z";
const bad: OwnerEntryRow = { workspace_id: "ws-9", id: "broken", type: "widget", version: "6", fields_json: '{"ext":{"site":{"payload":"old"}}}' };

function repairFixture() {
  const hide = vi.fn<TrashAdapter["hide"]>(async () => ({ ok: true, version: 7 }));
  const purge = vi.fn<TrashAdapter["purge"]>(async () => "purged");
  const unhide = vi.fn<TrashAdapter["unhide"]>();
  const removalFor = vi.fn((type: string) => ({
    adapter: { entityType: type, hide, purge, unhide }, via: type === "widget" ? "trash-purge" as const : "hard-delete" as const,
  }));
  const repair = (rows: readonly OwnerEntryRow[]) => removeMismatchedOwnerEntries({
    rows, owners: { widget: "widget", banner: "banner" }, removalFor, at,
  });
  return { repair, hide, purge, unhide, removalFor };
}

test("removes only classified rows, using each row's partition and the version returned by hide", async () => {
  const f = repairFixture();
  const valid = { ...bad, id: "valid", fields_json: '{"ext":{"widget":null,"site":{}}}' };
  const unparseable = { ...bad, id: "unparseable", fields_json: "{" };
  const banner = { ...bad, id: "old-banner", type: "banner", workspace_id: "ws-10", version: 20n };
  f.hide.mockResolvedValueOnce({ ok: true, version: 7 }).mockResolvedValueOnce({ ok: true, version: 21 });
  expect(await f.repair([valid, bad, unparseable, banner])).toEqual([
    { workspaceId: "ws-9", id: "broken", type: "widget", via: "trash-purge" },
    { workspaceId: "ws-10", id: "old-banner", type: "banner", via: "hard-delete" },
  ]);
  expect(f.removalFor.mock.calls).toEqual([["widget"], ["banner"]]);
  expect(f.hide.mock.calls).toEqual([
    [{ workspaceId: "ws-9", entityId: "broken", expectedVersion: 6, at }],
    [{ workspaceId: "ws-10", entityId: "old-banner", expectedVersion: 20, at }],
  ]);
  expect(f.purge.mock.calls).toEqual([
    [{ workspaceId: "ws-9", entityId: "broken", expectedVersion: 7 }],
    [{ workspaceId: "ws-10", entityId: "old-banner", expectedVersion: 21 }],
  ]);
});

test("fails before picking a deletion adapter for a type with no owner mapping", async () => {
  const f = repairFixture();
  await expect(f.repair([{ ...bad, type: "unknown" }])).rejects.toThrow("Owner entry repair has no owner for type unknown");
  expect(f.removalFor.mock.calls).toEqual([]);
});

test("aborts without purging if the classified row loses the hide version race", async () => {
  const f = repairFixture();
  f.hide.mockResolvedValue({ ok: false, reason: "version-changed" });
  await expect(f.repair([bad])).rejects.toThrow("boot repair: entry broken (type widget) changed since it was classified (version-changed); nothing was removed, the next boot retries");
  expect(f.purge.mock.calls).toEqual([]);
});

test("does not report removal if the purge adapter refuses the hidden row", async () => {
  const f = repairFixture();
  f.purge.mockResolvedValue("still-referenced");
  await expect(f.repair([bad])).rejects.toThrow("boot repair: entry broken (type widget) was not purged (still-referenced); nothing was removed, the next boot retries");
  expect(f.purge.mock.calls).toEqual([[{ workspaceId: "ws-9", entityId: "broken", expectedVersion: 7 }]]);
});
