/** Spec/ADR: ADS-memory/.local-artifacts/theme-preview-refresh/design.md */
import assert from "node:assert/strict";
import { onTestFinished, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createThemePreviewFeed,
  readThemePreviewRefresh,
  requestThemePreviewRefresh,
  validatePreviewPath,
  type ThemePreviewRefresh,
} from "../refresh.node.js";

const isReservedPath = ({ pathname }: { pathname: string }, _optional: Record<string, never> = {}) => pathname === "/private";

test("refresh marker crosses independent readers and clears navigation after a save", () => {
  const themesDir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-refresh-"));
  onTestFinished(() => fs.rmSync(themesDir, { recursive: true, force: true }));
  assert.equal(readThemePreviewRefresh({ themesDir, isReservedPath }), null);
  const event = requestThemePreviewRefresh(
    { themesDir, isReservedPath },
    { path: "/create-a-theme?lang=en", revision: "revision-1" },
  );
  assert.deepEqual(event, { revision: "revision-1", path: "/create-a-theme?lang=en" });
  assert.deepEqual(readThemePreviewRefresh({ themesDir, isReservedPath }), event);
  requestThemePreviewRefresh({ themesDir, isReservedPath }, { revision: "revision-2" });
  assert.deepEqual(readThemePreviewRefresh({ themesDir, isReservedPath }), { revision: "revision-2" });
});

test("feed starts silently, deduplicates ticks and delivers optional navigation on new writes", async () => {
  let frame = { revision: "initial", path: "/old-tool-path" };
  const emitted: unknown[] = [];
  const feed = createThemePreviewFeed({ isReservedPath, read: () => frame, emit: ({ frame: event }, _options = {}) => emitted.push(event) });
  feed();
  feed();
  frame = { revision: "changed", path: "/new-tool-path" };
  feed();
  feed();
  assert.deepEqual(emitted, [{ revision: "changed", path: "/new-tool-path" }]);
});

test("a tool navigation between connection and first tick is delivered, not treated as historical", async () => {
  let frame: ThemePreviewRefresh | null = null;
  const emitted: unknown[] = [];
  const feed = createThemePreviewFeed({ isReservedPath, read: () => frame, emit: ({ frame: next }, _options = {}) => emitted.push(next) });
  frame = { revision: "new-tool", path: "/create-a-theme" };
  feed();
  assert.deepEqual(emitted, [{ revision: "new-tool", path: "/create-a-theme" }]);
});

test("a resumed desktop feed delivers the revision saved during its disconnected interval", async () => {
  const emitted: unknown[] = [];
  const frame = { revision: "while-disconnected", path: "/new-path" };
  const tick = createThemePreviewFeed({ isReservedPath, read: () => frame, emit: ({ frame: next }, _options = {}) => emitted.push(next) }, { resumeRevision: "last-delivered" });
  tick(); tick();
  assert.deepEqual(emitted, [frame]);
});

test("deskfx M1: a refresh may create themes inside an existing site but never recreate a moved site", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preview-no-resurrection-"));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const themesDir = path.join(root, "themes");
  requestThemePreviewRefresh({ themesDir, isReservedPath }, { revision: "first" });
  assert.equal(readThemePreviewRefresh({ themesDir, isReservedPath })?.revision, "first");
  requestThemePreviewRefresh({ themesDir, isReservedPath }, { revision: "second" });
  assert.equal(readThemePreviewRefresh({ themesDir, isReservedPath })?.revision, "second");
  const moved = path.join(root, "moved-site");
  assert.throws(() => requestThemePreviewRefresh({ themesDir: path.join(moved, "themes"), isReservedPath }), { code: "ENOENT" });
  assert.equal(fs.existsSync(moved), false);
  const file = path.join(root, "file"); fs.writeFileSync(file, "keep");
  assert.throws(() => requestThemePreviewRefresh({ themesDir: file, isReservedPath }), { code: "EEXIST" });
  assert.equal(fs.readFileSync(file, "utf8"), "keep");
});

test("a marker with an invalid revision or an unsafe stored path reads as no refresh", () => {
  const themesDir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-refresh-invalid-"));
  onTestFinished(() => fs.rmSync(themesDir, { recursive: true, force: true }));
  const marker = path.join(themesDir, ".preview-refresh.json");
  fs.writeFileSync(marker, JSON.stringify({ revision: 42 }));
  assert.equal(readThemePreviewRefresh({ themesDir, isReservedPath }), null);
  fs.writeFileSync(marker, JSON.stringify({ revision: "has space" }));
  assert.equal(readThemePreviewRefresh({ themesDir, isReservedPath }), null);
  fs.writeFileSync(marker, JSON.stringify({ revision: "ok-1", path: "//evil.example" }));
  assert.equal(readThemePreviewRefresh({ themesDir, isReservedPath }), null);
  fs.writeFileSync(marker, JSON.stringify({ revision: "ok-2", path: "/fine" }));
  assert.deepEqual(readThemePreviewRefresh({ themesDir, isReservedPath }), { revision: "ok-2", path: "/fine" });
});

test("a feed that starts with no marker stays silent until one appears, and ignores a vanished marker", async () => {
  let frame: ThemePreviewRefresh | null = null;
  const emitted: unknown[] = [];
  const tick = createThemePreviewFeed({ isReservedPath, read: () => frame, emit: ({ frame: next }, _options = {}) => emitted.push(next) });
  tick();
  assert.deepEqual(emitted, []);
  frame = { revision: "first" };
  tick();
  frame = null;
  tick();
  assert.deepEqual(emitted, [{ revision: "first" }]);
});

test("reserved-path policy checks decoded and normalized paths in validation and marker operations", () => {
  const themesDir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-refresh-policy-"));
  onTestFinished(() => fs.rmSync(themesDir, { recursive: true, force: true }));
  const marker = path.join(themesDir, ".preview-refresh.json");
  for (const path of ["/./private", "/%70rivate"]) {
    assert.throws(() => validatePreviewPath({ path, isReservedPath }), {
      message: "path must be a site-relative public URL starting with /",
    });
    assert.throws(() => requestThemePreviewRefresh({ themesDir, isReservedPath }, { path }), {
      message: "path must be a site-relative public URL starting with /",
    });
    fs.writeFileSync(marker, JSON.stringify({ revision: "reserved", path }));
    assert.equal(readThemePreviewRefresh({ themesDir, isReservedPath }), null);
  }
});

test("invalid UTF-8 escapes in a preview path fail with public-path guidance", () => {
  assert.throws(() => validatePreviewPath({ path: "/notes/%C0%AF", isReservedPath }),
    { message: "path must be a site-relative public URL starting with /" });
});
