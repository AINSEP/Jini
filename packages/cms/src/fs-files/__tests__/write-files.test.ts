import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, test, vi } from "vitest";
import { FS_WRITE_LIMITS, FsWriteInputError, inspectWriteTarget, prepareFileWrites, requirePickedFolder, writePreparedFiles, type ResolveFsFilePath } from "../write-files.js";

/**
 * @file The generic batch-write rules with a fake injected resolver. The host's real denylist binding
 * is covered by the host's own tool tests; here the resolver only proves its refusal is surfaced.
 */

const cleanups: string[] = [];
afterEach(() => { for (const dir of cleanups.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const utf8 = (filePath: string, content: string) => ({ path: filePath, content });
/** Denies `.env` anywhere, otherwise joins: stands in for the host's guarded resolver. */
const resolveFsFilePath: ResolveFsFilePath = ({ rootPath, relativePath }) => {
  if (relativePath.split("/").includes(".env")) throw new Error("this file is denied");
  return path.join(rootPath, relativePath);
};

function folderFixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jini-write-files-")));
  cleanups.push(base);
  const site = path.join(base, "site");
  const folder = path.join(base, "picked");
  fs.mkdirSync(site);
  fs.mkdirSync(folder);
  return { base, site, folder };
}

test("refuses non-plain relative paths before touching disk", () => {
  const { folder } = folderFixture();
  for (const bad of ["../escape.txt", "/etc/passwd", "C:evil.txt", "a\\b.txt", "a\0b", "", "a//b.txt", "./a.txt"]) {
    assert.throws(() => prepareFileWrites({ folder, resolveFsFilePath, files: [utf8(bad, "x")] }), FsWriteInputError, JSON.stringify(bad));
  }
  assert.deepEqual(fs.readdirSync(folder), []);
});

test("the injected resolver's refusal becomes a FsWriteInputError naming the path", () => {
  const { folder } = folderFixture();
  assert.throws(() => inspectWriteTarget({ folder, path: "app/.env", resolveFsFilePath }), (error: unknown) =>
    error instanceof FsWriteInputError && error.message === "app/.env: this file is denied");
});

test("refuses symlink components and targets, even ones pointing inside the folder", () => {
  const { folder } = folderFixture();
  fs.mkdirSync(path.join(folder, "real"));
  fs.writeFileSync(path.join(folder, "real", "target.txt"), "keep");
  fs.symlinkSync(path.join(folder, "real"), path.join(folder, "linked-dir"));
  fs.symlinkSync(path.join(folder, "real", "target.txt"), path.join(folder, "linked-file.txt"));
  for (const bad of ["linked-dir/new.txt", "linked-file.txt", "real"]) {
    assert.throws(() => prepareFileWrites({ folder, resolveFsFilePath, files: [utf8(bad, "x")] }), FsWriteInputError, bad);
  }
  assert.equal(fs.readFileSync(path.join(folder, "real", "target.txt"), "utf8"), "keep");
});

test("caps: file count, duplicates and bad encodings are refused", () => {
  const { folder } = folderFixture();
  const many = Array.from({ length: FS_WRITE_LIMITS.maxFiles + 1 }, (_, i) => utf8(`f${i}.txt`, "x"));
  assert.throws(() => prepareFileWrites({ folder, resolveFsFilePath, files: many }), /1 to 50/);
  assert.doesNotThrow(() => prepareFileWrites({ folder, resolveFsFilePath, files: many.slice(1) }));
  assert.throws(() => prepareFileWrites({ folder, resolveFsFilePath, files: [utf8("a.txt", "1"), utf8("A.TXT", "2")] }), /more than once/);
  assert.throws(() => prepareFileWrites({ folder, resolveFsFilePath, files: [{ path: "a.bin", content: "!!!", encoding: "base64" }] }), /base64/);
});

test("prepare reports new vs overwrite; write creates parents, lands exact bytes and stops at the first failure", () => {
  const { folder } = folderFixture();
  fs.writeFileSync(path.join(folder, "index.html"), "old");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const writes = prepareFileWrites({ folder, resolveFsFilePath, files: [utf8("index.html", "new"), { path: "img/logo.png", content: png.toString("base64"), encoding: "base64" }] });
  assert.deepEqual(writes.map((w) => [w.path, w.overwrite, w.bytes.length]), [["index.html", true, 3], ["img/logo.png", false, 6]]);
  assert.deepEqual(writePreparedFiles({ folder, writes, resolveFsFilePath }), { written: ["index.html", "img/logo.png"], notWritten: [] });
  assert.deepEqual(fs.readFileSync(path.join(folder, "img", "logo.png")), png);

  const batch = prepareFileWrites({ folder, resolveFsFilePath, files: [utf8("a.txt", "A"), utf8("b.txt", "B"), utf8("c.txt", "C")] });
  fs.mkdirSync(path.join(folder, "b.txt"));
  const outcome = writePreparedFiles({ folder, writes: batch, resolveFsFilePath });
  assert.deepEqual([outcome.written, outcome.failed?.path, outcome.notWritten], [["a.txt"], "b.txt", ["c.txt"]]);
  assert.deepEqual(fs.readdirSync(folder).filter((name) => name.endsWith(".tmp")), []);
});

test("the picked-folder rule refuses symlinks, home and site ancestors, the site and inside it", () => {
  const { base, site, folder } = folderFixture();
  const home = path.join(base, "home");
  fs.mkdirSync(home);
  fs.symlinkSync(folder, path.join(base, "link"));
  fs.mkdirSync(path.join(site, "themes"));
  assert.equal(requirePickedFolder({ dir: folder, siteDir: site }, { homeDir: home }), folder);
  for (const dir of ["picked", path.join(base, "link"), home, base, site, path.join(site, "themes")]) {
    assert.throws(() => requirePickedFolder({ dir, siteDir: site }, { homeDir: home }), FsWriteInputError, dir);
  }
});

test("an invalid filesystem component surfaces ENOTDIR instead of masquerading as a missing folder", () => {
  const { site, folder } = folderFixture();
  const plain = path.join(folder, "regular.txt");
  fs.writeFileSync(plain, "preserve");
  assert.throws(() => requirePickedFolder({ dir: path.join(plain, "child"), siteDir: site }, { homeDir: site }), { code: "ENOTDIR" });
  assert.equal(fs.readFileSync(plain, "utf8"), "preserve");
});

test("a refused atomic rename removes its staging file, preserves the approved target and stops the batch", () => {
  const { folder } = folderFixture();
  const target = path.join(folder, "primary.txt");
  fs.writeFileSync(target, "original");
  const writes = prepareFileWrites({ folder, resolveFsFilePath, files: [utf8("primary.txt", "replacement"), utf8("later.txt", "later")] });
  const rename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (to !== target) throw new Error("unexpected rename destination");
    throw new Error(`rename refused for ${fs.readFileSync(from, "utf8")}`);
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(writePreparedFiles({ folder, writes, resolveFsFilePath }), {
      written: [], failed: { path: "primary.txt", reason: "rename refused for replacement" }, notWritten: ["later.txt"],
    });
    assert.equal(fs.readFileSync(target, "utf8"), "original");
    assert.deepEqual(fs.readdirSync(folder), ["primary.txt"]);
  } finally {
    rename.mockRestore();
    syncBuiltinESMExports();
  }
});

test("the filesystem root is refused as a picked folder because it contains home and the site", () => {
  const { site } = folderFixture();
  assert.throws(() => requirePickedFolder({ dir: path.parse(site).root, siteDir: site }, { homeDir: site }), (error: unknown) =>
    error instanceof FsWriteInputError && error.message === "The picked folder must not contain your home folder or this site, nor lie inside the site");
});

test("malformed entries and over-size files or batches are refused before any write", () => {
  const { folder } = folderFixture();
  const shape = "each file needs a string 'path' and 'content'";
  for (const entry of [null, { path: "a.txt" }, { path: "a.txt", content: 7 }, { content: "x" }]) {
    assert.throws(() => prepareFileWrites({ folder, resolveFsFilePath, files: [entry] }), (error: unknown) =>
      error instanceof FsWriteInputError && error.message === shape, JSON.stringify(entry));
  }
  assert.throws(() => prepareFileWrites({ folder, resolveFsFilePath, files: [{ path: "a.txt", content: "x", encoding: "latin1" }] }), (error: unknown) =>
    error instanceof FsWriteInputError && error.message === "a.txt: encoding must be 'utf8', or 'base64' with valid base64 content");
  const atCap = "x".repeat(FS_WRITE_LIMITS.maxFileBytes);
  assert.equal(prepareFileWrites({ folder, resolveFsFilePath, files: [utf8("cap.txt", atCap)] })[0]?.bytes.length, FS_WRITE_LIMITS.maxFileBytes);
  assert.throws(() => prepareFileWrites({ folder, resolveFsFilePath, files: [utf8("big.txt", `${atCap}y`)] }), (error: unknown) =>
    error instanceof FsWriteInputError && error.message === "each file may be at most 2 MiB");
  const fiveAtCap = Array.from({ length: 5 }, (_, i) => utf8(`p${i}.txt`, atCap));
  assert.equal(prepareFileWrites({ folder, resolveFsFilePath, files: fiveAtCap }).length, 5);
  assert.throws(() => prepareFileWrites({ folder, resolveFsFilePath, files: [...fiveAtCap, utf8("one-more.txt", "z")] }), (error: unknown) =>
    error instanceof FsWriteInputError && error.message === "one call may write at most 10 MiB; split the change");
  assert.deepEqual(fs.readdirSync(folder), []);
});

test("a target that appeared or vanished since approval is refused and the original disk state kept", () => {
  const { folder } = folderFixture();
  fs.writeFileSync(path.join(folder, "existing.txt"), "keep-me");
  const [appearing] = prepareFileWrites({ folder, resolveFsFilePath, files: [utf8("fresh.txt", "new")] });
  const [vanishing] = prepareFileWrites({ folder, resolveFsFilePath, files: [utf8("existing.txt", "replaced")] });
  fs.writeFileSync(path.join(folder, "fresh.txt"), "someone else");
  fs.rmSync(path.join(folder, "existing.txt"));
  assert.deepEqual(writePreparedFiles({ folder, writes: [appearing!], resolveFsFilePath }), {
    written: [], failed: { path: "fresh.txt", reason: "a file appeared here since approval" }, notWritten: [],
  });
  assert.deepEqual(writePreparedFiles({ folder, writes: [vanishing!, appearing!], resolveFsFilePath }), {
    written: [], failed: { path: "existing.txt", reason: "the file was removed since approval" }, notWritten: ["fresh.txt"],
  });
  assert.equal(fs.readFileSync(path.join(folder, "fresh.txt"), "utf8"), "someone else");
  assert.deepEqual(fs.readdirSync(folder), ["fresh.txt"]);
});
