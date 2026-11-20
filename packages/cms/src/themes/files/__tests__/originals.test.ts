import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, test } from "vitest";
import { resetThemeFileToOriginal, themeFileDiffersFromOriginal, type ThemeOriginalFilePorts } from "../originals.node.js";
import { resolveThemeOriginalSource } from "../original-source.node.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const themesRoot = mkdtempSync(join(tmpdir(), "theme-originals-"));
  roots.push(themesRoot);
  const themeDir = join(themesRoot, "static", "plain");
  const originalsRoot = join(themesRoot, "__original-themes__");
  const originalDir = join(originalsRoot, "static", "plain");
  mkdirSync(themeDir, { recursive: true });
  mkdirSync(originalDir, { recursive: true });
  const refusal = new Error("path refusal");
  const ports: ThemeOriginalFilePorts = {
    resolvePath: ({ themeDir, relativePath }) => {
      const target = join(themeDir, relativePath);
      if (relative(themeDir, target).startsWith("..")) throw refusal;
      return target;
    },
    statPath: ({ target }, { stat = statSync } = {}) => stat(target, { throwIfNoEntry: false }),
    digest: ({ path }) => createHash("sha256").update(readFileSync(path)).digest("hex"),
    changedError: () => new Error("changed"),
    pathError: () => refusal,
    isPathError: ({ error }) => error === refusal,
    reportPruneFailure: ({ error }) => { throw error; },
  };
  return { themeDir, themesRoot, originalDir, originalsRoot, relativePath: "file.bin", ports, refusal };
}

function write(dir: string, name: string, bytes: Buffer): string {
  const target = join(dir, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return target;
}

test("equal-size changed bytes are modified", () => {
  const f = fixture();
  write(f.themeDir, f.relativePath, Buffer.from("red"));
  write(f.originalDir, f.relativePath, Buffer.from("tan"));
  assert.equal(themeFileDiffersFromOriginal(f), true);
});

test("comparison reaches beyond the first chunk", () => {
  const f = fixture(), bytes = Buffer.alloc(200_001, 0x61);
  write(f.themeDir, f.relativePath, bytes);
  write(f.originalDir, f.relativePath, bytes);
  assert.equal(themeFileDiffersFromOriginal(f), false);
  bytes[70_000] = 0x62;
  write(f.originalDir, f.relativePath, bytes);
  assert.equal(themeFileDiffersFromOriginal(f), true);
  bytes[70_000] = 0x61;
  bytes[bytes.length - 1] = 0x62;
  write(f.originalDir, f.relativePath, bytes);
  assert.equal(themeFileDiffersFromOriginal(f), true);
});

test("different sizes return before either file is opened", () => {
  const f = fixture();
  const live = write(f.themeDir, f.relativePath, Buffer.from("longer"));
  write(f.originalDir, f.relativePath, Buffer.from("x"));
  const statPath = f.ports.statPath;
  f.ports = { ...f.ports, statPath: (required, optional) => {
    const result = statPath(required, optional);
    if (required.target === live) rmSync(live);
    return result;
  } };
  assert.equal(themeFileDiffersFromOriginal(f), true);
});

test("reset checks a missing original before resolving live; comparison resolves live first", () => {
  const f = fixture(), reached: string[] = [];
  const resolvePath = f.ports.resolvePath;
  f.ports = { ...f.ports, resolvePath: address => {
    reached.push(address.themeDir);
    if (address.themeDir === f.themeDir) throw f.refusal;
    return resolvePath(address);
  } };
  assert.equal(resetThemeFileToOriginal(f), null);
  assert.deepEqual(reached, [f.originalDir]);
  assert.throws(() => themeFileDiffersFromOriginal(f), error => error === f.refusal);
  assert.deepEqual(reached, [f.originalDir, f.themeDir]);
});

test("original path refusals become missing originals, other I/O failures propagate", () => {
  const f = fixture();
  assert.equal(resetThemeFileToOriginal({ ...f, relativePath: "../other/theme.json" }), null);
  const failure = new Error("EIO");
  f.ports = { ...f.ports, statPath: () => { throw failure; } };
  assert.throws(() => resetThemeFileToOriginal(f), error => error === failure);
});

test("reset refuses a nonregular live target", () => {
  const f = fixture();
  write(f.originalDir, f.relativePath, Buffer.from("original"));
  mkdirSync(join(f.themeDir, f.relativePath));
  assert.throws(() => resetThemeFileToOriginal(f), error => error === f.refusal);
  assert.equal(statSync(join(f.themeDir, f.relativePath)).isDirectory(), true);
});

test("equal bytes preserve inode and mtime", () => {
  const f = fixture(), bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0, 0x80]);
  write(f.originalDir, f.relativePath, bytes);
  const live = write(f.themeDir, f.relativePath, bytes), before = statSync(live);
  assert.deepEqual(resetThemeFileToOriginal(f), { wasModified: false, bytes: bytes.length });
  assert.equal(statSync(live).ino, before.ino);
  assert.equal(statSync(live).mtimeMs, before.mtimeMs);
});

test("reset recreates missing parents with exact binary bytes and original mode", () => {
  const f = fixture(), bytes = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0xff, 0xfe, 0, 0x80]);
  const relativePath = "fonts/sub/face.woff2";
  chmodSync(write(f.originalDir, relativePath, bytes), 0o640);
  assert.deepEqual(resetThemeFileToOriginal({ ...f, relativePath }), { wasModified: true, bytes: bytes.length });
  const target = join(f.themeDir, relativePath);
  assert.deepEqual(readFileSync(target), bytes);
  assert.equal(statSync(target).mode & 0o777, 0o640);
});

test("replacement keeps the live mode and stores revisions under the live address", () => {
  const f = fixture(), bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80]);
  chmodSync(write(f.originalDir, f.relativePath, bytes), 0o644);
  const live = write(f.themeDir, f.relativePath, Buffer.from("edited"));
  chmodSync(live, 0o600);
  assert.deepEqual(resetThemeFileToOriginal(f), { wasModified: true, bytes: bytes.length });
  assert.deepEqual(readFileSync(live), bytes);
  assert.equal(themeFileDiffersFromOriginal(f), false);
  assert.equal(statSync(live).mode & 0o777, 0o600);
  const revisionRoot = join(f.themeDir, ".trash", "revisions");
  assert.deepEqual(readFileSync(join(revisionRoot, readdirSync(revisionRoot)[0]!, f.relativePath)), Buffer.from("edited"));
  assert.equal(existsSync(join(f.originalDir, ".trash")), false);
});

test("reset uses site bytes before package bytes and falls back to the separate package catalog", () => {
  const f = fixture(), packaged = fixture();
  write(f.themeDir, f.relativePath, Buffer.from("edited"));
  write(f.originalDir, f.relativePath, Buffer.from("site"));
  write(packaged.originalDir, f.relativePath, Buffer.from("package"));
  const required = { manifest: { id: "plain", tier: "static" }, siteThemesRoot: f.themesRoot, packageThemesRoot: packaged.themesRoot };
  const site = resolveThemeOriginalSource(required);
  assert.ok(site);
  assert.equal(site.source, "site");
  assert.deepEqual(resetThemeFileToOriginal({ ...f, ...site }), { wasModified: true, bytes: 4 });
  assert.deepEqual(readFileSync(join(f.themeDir, f.relativePath)), Buffer.from("site"));
  rmSync(f.originalDir, { recursive: true });
  const source = resolveThemeOriginalSource(required);
  assert.ok(source);
  assert.equal(source.source, "package");
  assert.deepEqual(resetThemeFileToOriginal({ ...f, ...source }), { wasModified: true, bytes: 7 });
  assert.deepEqual(readFileSync(join(f.themeDir, f.relativePath)), Buffer.from("package"));
  assert.deepEqual(readFileSync(join(packaged.originalDir, f.relativePath)), Buffer.from("package"));
});
