import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test, vi } from "vitest";
import { copyThemeFile, nextAvailableFileName, renameThemeFile, type ThemeFileMovePorts } from "../moves.node.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "theme-moves-"));
  roots.push(root);
  const themeDir = path.join(root, "plain");
  fs.mkdirSync(themeDir);
  const ports: ThemeFileMovePorts = {
    resolvePath: address => path.join(address.themeDir, address.relativePath),
    statPath: ({ target }, { stat = fs.statSync } = {}) => stat(target, { throwIfNoEntry: false }),
    pathError: ({ reason, relativePath }) => new Error(`${reason}: ${relativePath}`),
  };
  return { themeDir, themesRoot: root, ports };
}

test("rename moves the original bytes and inode, creates parents, and refuses collisions and destination rejection", () => {
  const file = fixture();
  const bytes = Buffer.from([0, 255, 128, 42]);
  const source = path.join(file.themeDir, "source.bin");
  fs.writeFileSync(source, bytes);
  const inode = fs.statSync(source).ino;
  const required = { ...file, sourcePath: "source.bin", destPath: "nested/moved.bin" };
  const destination = path.join(file.themeDir, "nested", "moved.bin");
  assert.equal(renameThemeFile(required), destination);
  assert.equal(fs.existsSync(source), false);
  assert.deepEqual(fs.readFileSync(destination), bytes);
  assert.equal(fs.statSync(destination).ino, inode);
  fs.writeFileSync(source, "replacement source");
  assert.throws(() => renameThemeFile(required), { message: "already-exists: nested/moved.bin" });
  assert.equal(fs.readFileSync(source, "utf8"), "replacement source");
  assert.deepEqual(fs.readFileSync(destination), bytes);
  const failure = new Error("fixture destination refusal");
  const resolvePath = vi.fn<ThemeFileMovePorts["resolvePath"]>(address => {
    if (address.relativePath === "../escape.bin") throw failure;
    return path.join(address.themeDir, address.relativePath);
  });
  assert.throws(() => renameThemeFile({ ...required, destPath: "../escape.bin", ports: { ...file.ports, resolvePath } }),
    error => error === failure);
  assert.deepEqual(resolvePath.mock.calls.map(([address]) => address), [
    { themeDir: file.themeDir, themesRoot: file.themesRoot, relativePath: "source.bin" },
    { themeDir: file.themeDir, themesRoot: file.themesRoot, relativePath: "../escape.bin" },
  ]);
  assert.equal(fs.existsSync(path.join(file.themesRoot, "escape.bin")), false);
  assert.equal(fs.readFileSync(source, "utf8"), "replacement source");
});

test("filename allocation preserves the extension and selects the first free suffix", () => {
  assert.equal(nextAvailableFileName({ desiredPath: "pages/about.html", existingPaths: new Set() }), "pages/about.html");
  assert.equal(nextAvailableFileName({ desiredPath: "pages/about.html",
    existingPaths: new Set(["pages/about.html", "pages/about-1.html", "pages/about-3.html"]) }), "pages/about-2.html");
  assert.equal(nextAvailableFileName({ desiredPath: "folder.v2/README",
    existingPaths: new Set(["folder.v2/README"]) }), "folder.v2/README-1");
});

test("copy preserves binary bytes and refuses to overwrite a known destination", () => {
  const file = fixture();
  const bytes = Buffer.from([0, 255, 128, 42]);
  fs.writeFileSync(path.join(file.themeDir, "source.bin"), bytes);
  const required = { ...file, sourcePath: "source.bin", destPath: "copy.bin" };
  const first = copyThemeFile(required);
  assert.equal(first, path.join(file.themeDir, "copy.bin"));
  assert.deepEqual(fs.readFileSync(first), bytes);
  assert.deepEqual(fs.readFileSync(path.join(file.themeDir, "source.bin")), bytes);
  fs.writeFileSync(path.join(file.themeDir, "source.bin"), "poisoned");
  const copyFile = vi.fn(fs.copyFileSync);
  assert.throws(() => copyThemeFile(required, { copyFile }), { message: "already-exists: copy.bin" });
  assert.equal(copyFile.mock.calls.length, 0);
  assert.deepEqual(fs.readFileSync(first), bytes);
});

test("copy refuses missing and nonregular sources without writing", () => {
  const file = fixture();
  fs.mkdirSync(path.join(file.themeDir, "pages"));
  assert.throws(() => copyThemeFile({ ...file, sourcePath: "absent.html", destPath: "copy.html" }),
    { message: "missing: absent.html" });
  assert.throws(() => copyThemeFile({ ...file, sourcePath: "pages", destPath: "copy.html" }),
    { message: "not-regular-file: pages" });
  assert.equal(fs.existsSync(path.join(file.themeDir, "copy.html")), false);
});

test("copy uses the exclusive numeric flag, maps a lost race, and propagates other I/O failures", () => {
  const file = fixture();
  fs.writeFileSync(path.join(file.themeDir, "about.html"), "<p>About</p>");
  const required = { ...file, sourcePath: "about.html", destPath: "about-1.html" };
  const lostRace: typeof fs.copyFileSync = (source, destination, flag) => {
    assert.equal(source, path.join(file.themeDir, "about.html"));
    assert.equal(destination, path.join(file.themeDir, "about-1.html"));
    assert.equal(flag, fs.constants.COPYFILE_EXCL);
    throw Object.assign(new Error("fixture lost race"), { code: "EEXIST" });
  };
  assert.throws(() => copyThemeFile(required, { copyFile: lostRace }), { message: "already-exists: about-1.html" });
  const ioFault = Object.assign(new Error("fixture I/O error"), { code: "EIO" });
  assert.throws(() => copyThemeFile(required, { copyFile: () => { throw ioFault; } }), error => error === ioFault);
  assert.equal(copyThemeFile(required), path.join(file.themeDir, "about-1.html"));
  assert.equal(fs.readFileSync(path.join(file.themeDir, "about-1.html"), "utf8"), "<p>About</p>");
});
