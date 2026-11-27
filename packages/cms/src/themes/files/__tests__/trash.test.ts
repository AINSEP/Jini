import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import type { TrashAdapter, TrashMarkerResult } from "../../../trash/ports.js";
import { createThemeTrashAdapter, locateThemeFolder, type ThemeTrashPorts } from "../trash.node.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const operation = { workspaceId: "workspace", entityId: "plain", at: "2026-01-01T00:00:00Z", expectedVersion: null };
const success: TrashMarkerResult = { ok: true, version: null };
function fixture() {
  const themesDir = mkdtempSync(join(tmpdir(), "theme-trash-"));
  roots.push(themesDir, `${themesDir}-trash`);
  const calls: string[] = [];
  const live: TrashAdapter = {
    entityType: "theme",
    hide: async () => { calls.push("live.hide"); return success; },
    unhide: async () => { calls.push("live.unhide"); return success; },
    purge: async () => { calls.push("live.purge"); return "purged"; },
  };
  const original: TrashAdapter = {
    entityType: "theme",
    hide: async () => { calls.push("original.hide"); return success; },
    unhide: async () => { calls.push("original.unhide"); return success; },
    purge: async () => { calls.push("original.purge"); return "purged"; },
  };
  const locations: Parameters<ThemeTrashPorts["createDirectoryAdapter"]>[0][] = [];
  const refusal = new Error("location refusal");
  const ports: ThemeTrashPorts = {
    findTheme: () => ({ dir: join(themesDir, "static", "plain"), tier: "static" }),
    locationError: () => refusal,
    createDirectoryAdapter: required => { locations.push(required); return locations.length === 1 ? live : original; },
    refresh: async () => { calls.push("refresh"); },
  };
  const adapter = createThemeTrashAdapter({ themesDir, ports });
  return { themesDir, calls, live, original, ports, adapter, locations, refusal };
}

test("hide moves the live theme then its original, before refresh; restore reverses them", async () => {
  const f = fixture();
  assert.deepEqual(await f.adapter.hide(operation), success);
  assert.deepEqual(f.calls, ["live.hide", "original.hide", "refresh"]);
  f.calls.length = 0;
  assert.deepEqual(await f.adapter.unhide(operation), success);
  assert.deepEqual(f.calls, ["original.unhide", "live.unhide", "refresh"]);
  f.calls.length = 0;
  assert.equal(await f.adapter.purge(operation), "purged");
  assert.deepEqual(f.calls, ["live.purge", "original.purge"]);
});

test("an original hide failure refreshes before live undo, refreshes again, and rethrows", async () => {
  const f = fixture(), failure = new Error("EIO");
  f.original.hide = async () => { f.calls.push("original.hide"); throw failure; };
  await assert.rejects(f.adapter.hide(operation), error => error === failure);
  assert.deepEqual(f.calls, ["live.hide", "original.hide", "refresh", "live.unhide", "refresh"]);
});

test("a live restore refusal reparks the original this call restored", async () => {
  const f = fixture();
  const refused: TrashMarkerResult = { ok: false, reason: "version-changed" };
  f.live.unhide = async () => { f.calls.push("live.unhide"); return refused; };
  assert.deepEqual(await f.adapter.unhide(operation), refused);
  assert.deepEqual(f.calls, ["original.unhide", "live.unhide", "original.hide"]);
});

test("an absent original does not prevent hide or restore", async () => {
  const f = fixture();
  f.original.hide = async () => { f.calls.push("original.hide"); return { ok: false, reason: "not-found" }; };
  f.original.unhide = async () => { f.calls.push("original.unhide"); return { ok: false, reason: "not-found" }; };
  assert.deepEqual(await f.adapter.hide(operation), success);
  assert.deepEqual(await f.adapter.unhide(operation), success);
  assert.deepEqual(f.calls, ["live.hide", "original.hide", "refresh", "original.unhide", "live.unhide", "refresh"]);
});

test("a live not-found leaves its original alone", async () => {
  const f = fixture();
  f.live.hide = async () => { f.calls.push("live.hide"); return { ok: false, reason: "not-found" }; };
  assert.deepEqual(await f.adapter.hide(operation), { ok: false, reason: "not-found" });
  assert.deepEqual(f.calls, ["live.hide"]);
});

test("a blocked original undoes live hide", async () => {
  const f = fixture();
  const blocked: TrashMarkerResult = { ok: false, reason: "blocked", code: "ALREADY_IN_TRASH", count: 1 };
  f.original.hide = async () => { f.calls.push("original.hide"); return blocked; };
  assert.deepEqual(await f.adapter.hide(operation), blocked);
  assert.deepEqual(f.calls, ["live.hide", "original.hide", "refresh", "live.unhide", "refresh"]);
});

test("a live restore throw reparks its restored original and rethrows", async () => {
  const f = fixture(), failure = new Error("restore EIO");
  f.live.unhide = async () => { f.calls.push("live.unhide"); throw failure; };
  await assert.rejects(f.adapter.unhide(operation), error => error === failure);
  assert.deepEqual(f.calls, ["original.unhide", "live.unhide", "original.hide"]);
});

test("two restore refusals never repark an original this call did not restore", async () => {
  const f = fixture();
  f.original.unhide = async () => { f.calls.push("original.unhide"); return { ok: false, reason: "blocked", code: "REFUSED", count: 1 }; };
  f.live.unhide = async () => { f.calls.push("live.unhide"); return { ok: false, reason: "version-changed" }; };
  assert.deepEqual(await f.adapter.unhide(operation), { ok: false, reason: "version-changed" });
  assert.deepEqual(f.calls, ["original.unhide", "live.unhide"]);
});

test("live version-changed on purge never purges the original", async () => {
  const f = fixture();
  f.live.purge = async () => { f.calls.push("live.purge"); return "version-changed"; };
  assert.equal(await f.adapter.purge(operation), "version-changed");
  assert.deepEqual(f.calls, ["live.purge"]);
});

test("locator refuses invalid segments and folders outside the allowed parents", () => {
  const f = fixture(), reasons: string[] = [];
  const ports = { ...f.ports, locationError: ({ reason }: Parameters<ThemeTrashPorts["locationError"]>[0]) => { reasons.push(reason); return f.refusal; } };
  for (const themeId of ["", ".", "..", "a/b", "a\\b"]) {
    assert.throws(() => locateThemeFolder({ themesDir: f.themesDir, themeId, ports }), error => error === f.refusal);
  }
  for (const dir of [join(f.themesDir, "renamed-folder"), join(f.themesDir, "deep", "nested", "plain")]) {
    ports.findTheme = () => ({ dir, tier: "static" });
    assert.throws(() => locateThemeFolder({ themesDir: f.themesDir, themeId: "plain", ports }), error => error === f.refusal);
  }
  assert.deepEqual(reasons, [...Array<string>(5).fill("invalid-segment"), "outside-themes-directory", "outside-themes-directory"]);
});

test("a parked location wins over live, preserves the live claim, and restores missing original tier parents", () => {
  const f = fixture();
  const parkedDir = join(`${f.themesDir}-trash`, "plain");
  mkdirSync(parkedDir, { recursive: true });
  assert.deepEqual(locateThemeFolder({ themesDir: f.themesDir, themeId: "plain", ports: f.ports }), {
    liveParent: f.themesDir, liveNames: ["plain"], parkedDir,
  });
  const originalParked = join(`${f.themesDir}-trash`, "__original-themes__", "static", "plain");
  mkdirSync(originalParked, { recursive: true });
  assert.deepEqual(f.locations[1]!.locate({ workspaceId: "workspace", entityId: "plain" }), {
    liveParent: join(f.themesDir, "__original-themes__", "static"), liveNames: [], parkedDir: originalParked,
  });
  assert.equal(existsSync(join(f.themesDir, "__original-themes__", "static")), true);
});

test("the locator carries the discovered engine tier into the new parking path", () => {
  const f = fixture();
  assert.deepEqual(locateThemeFolder({ themesDir: f.themesDir, themeId: "plain", ports: f.ports }), {
    liveParent: join(f.themesDir, "static"), liveNames: ["plain"], parkedDir: join(`${f.themesDir}-trash`, "static", "plain"),
  });
});
