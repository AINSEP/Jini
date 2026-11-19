import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { ENGINE_SUBFOLDERS } from "../../layout.js";
import { requestThemePreviewRefresh } from "../refresh.node.js";
import { syncThemeRoster, themeRosterFingerprint } from "../roster.node.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const themesDir = mkdtempSync(join(tmpdir(), "theme-roster-"));
  roots.push(themesDir);
  for (const sub of ENGINE_SUBFOLDERS) mkdirSync(join(themesDir, sub));
  const themes = [{ id: "plain" }];
  const rescans: { themes: { id: string }[]; dir: string }[] = [];
  const isReservedPath = () => false;
  const rescan = (required: { themes: { id: string }[]; dir: string }) => {
    rescans.push(required);
    required.themes.splice(0, required.themes.length, { id: "rescanned" });
  };
  return { themesDir, themes, isReservedPath, rescan, rescans };
}

test("root and each engine directory mtime affect the fingerprint in layout order", () => {
  const f = fixture();
  const directories = [f.themesDir, ...ENGINE_SUBFOLDERS.map(sub => join(f.themesDir, sub))];
  for (const [index, directory] of directories.entries()) utimesSync(directory, 100, 200 + index);
  assert.equal(themeRosterFingerprint(f), JSON.stringify([null, ...directories.map(dir => statSync(dir).mtimeMs)]));
  for (const directory of directories) {
    const before = themeRosterFingerprint(f);
    utimesSync(directory, 100, 900);
    assert.notEqual(themeRosterFingerprint(f), before);
  }
});

test("marker revision alone causes synchronization", () => {
  const f = fixture();
  requestThemePreviewRefresh(f, { revision: "first" });
  utimesSync(f.themesDir, 100, 200);
  const before = statSync(f.themesDir);
  assert.equal(syncThemeRoster(f), false);
  const fingerprint = themeRosterFingerprint(f);
  requestThemePreviewRefresh(f, { revision: "second" });
  utimesSync(f.themesDir, before.atime, before.mtime);
  assert.notEqual(themeRosterFingerprint(f), fingerprint);
  assert.equal(syncThemeRoster(f), true);
  assert.equal(f.rescans.length, 1);
  assert.equal(f.rescans[0]!.themes, f.themes);
  assert.equal(f.rescans[0]!.dir, f.themesDir);
});

test("unchanged sync skips rescanning and preserves roster objects", () => {
  const f = fixture(), before = f.themes[0];
  assert.equal(syncThemeRoster(f), false);
  assert.equal(syncThemeRoster(f), false);
  assert.equal(f.themes[0], before);
  assert.equal(f.rescans.length, 0);
});

test("force rescans a nested edit whose fingerprint is unchanged", () => {
  const f = fixture();
  const nested = join(f.themesDir, "static", "plain");
  mkdirSync(nested);
  assert.equal(syncThemeRoster(f), false);
  const fingerprint = themeRosterFingerprint(f);
  writeFileSync(join(nested, "tokens.json"), "{}");
  assert.equal(themeRosterFingerprint(f), fingerprint);
  assert.equal(syncThemeRoster(f, { force: true }), true);
  assert.equal(f.rescans.length, 1);
  assert.equal(syncThemeRoster(f), false);
});

test("first sync adopts a hand-built roster, while force discovers on its first call", () => {
  const f = fixture(), before = [...f.themes];
  assert.equal(syncThemeRoster(f), false);
  assert.deepEqual(f.themes, before);
  const themes: { id: string }[] = [];
  assert.equal(syncThemeRoster({ ...f, themes }, { force: true }), true);
  assert.deepEqual(themes, [{ id: "rescanned" }]);
});

test("one change rescans each roster once by actual array identity", () => {
  const f = fixture(), other = { ...f, themes: [...f.themes] };
  assert.equal(syncThemeRoster(f), false);
  assert.equal(syncThemeRoster(other), false);
  requestThemePreviewRefresh(f, { revision: "changed" });
  assert.equal(syncThemeRoster(other), true);
  assert.equal(syncThemeRoster(other), false);
  assert.equal(syncThemeRoster(f), true);
  assert.equal(syncThemeRoster(f), false);
  assert.equal(f.rescans.length, 2);
  assert.equal(f.rescans[0]!.themes, other.themes);
  assert.equal(f.rescans[1]!.themes, f.themes);
});

test("missing directory fingerprint uses null for each mtime", () => {
  const f = fixture();
  rmSync(f.themesDir, { recursive: true });
  assert.equal(themeRosterFingerprint(f), JSON.stringify([null, null, null, null, null, null]));
});

test("a failed rescan does not record the new fingerprint and is retried", () => {
  const f = fixture(), failure = new Error("rescan failed");
  assert.equal(syncThemeRoster(f), false);
  requestThemePreviewRefresh(f, { revision: "retry" });
  let attempts = 0;
  const required = { ...f, rescan: (input: Parameters<typeof f.rescan>[0]) => {
    attempts += 1;
    if (attempts === 1) throw failure;
    f.rescan(input);
  } };
  assert.throws(() => syncThemeRoster(required), error => error === failure);
  assert.equal(syncThemeRoster(required), true);
  assert.equal(attempts, 2);
  assert.equal(syncThemeRoster(required), false);
});

test("marker written during rescan remains visible to the next sync", () => {
  const f = fixture();
  assert.equal(syncThemeRoster(f), false);
  requestThemePreviewRefresh(f, { revision: "before-scan" });
  let scans = 0;
  const required = { ...f, rescan: (input: Parameters<typeof f.rescan>[0]) => {
    scans += 1;
    f.rescan(input);
    if (scans === 1) requestThemePreviewRefresh(f, { revision: "during-scan" });
  } };
  assert.equal(syncThemeRoster(required), true);
  assert.equal(syncThemeRoster(required), true);
  assert.equal(syncThemeRoster(required), false);
  assert.equal(scans, 2);
});
