import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";
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
