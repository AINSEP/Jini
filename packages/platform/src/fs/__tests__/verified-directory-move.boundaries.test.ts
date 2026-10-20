import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { directoryFingerprint, moveDirectoryVerified } from "../verified-directory-move.js";

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "move-bounds-"))); roots.push(root);
  const from = path.join(root, "source"), to = path.join(root, "target");
  fs.mkdirSync(from); fs.writeFileSync(path.join(from, "content.db"), "database bytes");
  return { root, from, to };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const coded = (code: string): Error => Object.assign(new Error(`${code}: fixture`), { code });
function crossDevice(from: string, to: string, overrides: Partial<typeof fs> = {}): typeof fs {
  return { ...fs, renameSync: (a, b) => { if (String(a) === from && String(b) === to) throw coded("EXDEV"); fs.renameSync(a, b); }, ...overrides };
}

// --- fingerprint -----------------------------------------------------------
test("fingerprint covers symlink targets without following them", () => {
  const { from } = fixture();
  fs.symlinkSync("content.db", path.join(from, "alias"));
  const before = directoryFingerprint({ dir: from });
  fs.unlinkSync(path.join(from, "alias")); fs.symlinkSync("elsewhere", path.join(from, "alias"));
  expect(directoryFingerprint({ dir: from })).not.toBe(before);
});
test("fingerprint covers permission bits", () => {
  const { from } = fixture();
  const before = directoryFingerprint({ dir: from });
  fs.chmodSync(path.join(from, "content.db"), 0o600);
  expect(directoryFingerprint({ dir: from })).not.toBe(before);
});
test("fingerprint excludes named top-level entries only", () => {
  const { from } = fixture();
  const before = directoryFingerprint({ dir: from }, { excluded: ["running.json"] });
  fs.writeFileSync(path.join(from, "running.json"), "{}");
  expect(directoryFingerprint({ dir: from }, { excluded: ["running.json"] })).toBe(before);
  fs.mkdirSync(path.join(from, "nested")); fs.writeFileSync(path.join(from, "nested", "running.json"), "{}");
  expect(directoryFingerprint({ dir: from }, { excluded: ["running.json"] })).not.toBe(before);
});
test("fingerprint refuses a special entry such as a FIFO, naming it", () => {
  const { from } = fixture();
  const filesystem: typeof fs = { ...fs, lstatSync: ((target: fs.PathLike) => {
    const stat = fs.lstatSync(target);
    if (String(target).endsWith("content.db")) { stat.isFile = () => false; }
    return stat;
  }) as typeof fs.lstatSync };
  expect(() => directoryFingerprint({ dir: from }, { filesystem })).toThrow("Cannot move special filesystem entry: content.db");
});

// --- preconditions ---------------------------------------------------------
test("moving a directory onto itself is refused", () => {
  const { from } = fixture();
  expect(() => moveDirectoryVerified({ from, to: from, commit() {} })).toThrow("A directory cannot be moved into itself.");
});
test("moving a directory into its own descendant is refused", () => {
  const { from } = fixture();
  expect(() => moveDirectoryVerified({ from, to: path.join(from, "child"), commit() {} })).toThrow("A directory cannot be moved into itself.");
  expect(fs.readdirSync(from)).toEqual(["content.db"]);
});
test("a sibling whose name extends the source is not treated as a descendant", () => {
  const { from } = fixture();
  moveDirectoryVerified({ from, to: `${from}-renamed`, commit() {} });
  expect(fs.readFileSync(path.join(`${from}-renamed`, "content.db"), "utf8")).toBe("database bytes");
});
test("a non-ENOENT failure probing the target propagates before anything moves", () => {
  const { from, to } = fixture(), error = coded("EACCES");
  const filesystem: typeof fs = { ...fs, lstatSync: ((target: fs.PathLike) => { if (String(target) === to) throw error; return fs.lstatSync(target); }) as typeof fs.lstatSync };
  expect(() => moveDirectoryVerified({ from, to, commit() {} }, { filesystem })).toThrow(error);
  expect(fs.existsSync(from)).toBe(true);
});
test("a non-EXDEV rename failure propagates without copying", () => {
  const { from, to } = fixture(), error = coded("EPERM");
  let commits = 0;
  const filesystem: typeof fs = { ...fs, renameSync: () => { throw error; } };
  expect(() => moveDirectoryVerified({ from, to, commit: () => { commits++; } }, { filesystem })).toThrow(error);
  expect(commits).toBe(0); expect(fs.existsSync(to)).toBe(false); expect(fs.existsSync(from)).toBe(true);
});

// --- relocation and rollback -----------------------------------------------
test("file relocation without a verification port is refused and the rename is rolled back", () => {
  const { from, to } = fixture();
  expect(() => moveDirectoryVerified({ from, to, commit() {} }, { relocateFiles: () => [] })).toThrow("File relocation requires a verification port.");
  expect(fs.existsSync(to)).toBe(false); expect(fs.readFileSync(path.join(from, "content.db"), "utf8")).toBe("database bytes");
});
test("an empty relocation plan with a verifier still moves and commits", () => {
  const { from, to } = fixture();
  let commits = 0;
  moveDirectoryVerified({ from, to, commit: () => { commits++; } }, { relocateFiles: () => [], verifyFile: () => "digest" });
  expect(commits).toBe(1); expect(fs.existsSync(path.join(to, "content.db"))).toBe(true);
});
test("an existing EXDEV backup path is refused; the copy is removed and the source kept", () => {
  const { root, from, to } = fixture();
  fs.mkdirSync(path.join(root, ".relocation-fixture-backup", "source"), { recursive: true });
  expect(() => moveDirectoryVerified({ from, to, commit() {} }, { filesystem: crossDevice(from, to), backupId: () => "fixture" }))
    .toThrow(`Move backup target already exists: ${path.join(root, ".relocation-fixture-backup", "source")}`);
  expect(fs.existsSync(to)).toBe(false); expect(fs.readFileSync(path.join(from, "content.db"), "utf8")).toBe("database bytes");
});
test("an EXDEV commit failure restores the retired source and removes the copy", () => {
  const { root, from, to } = fixture();
  expect(() => moveDirectoryVerified({ from, to, commit: () => { throw new Error("Registry is not writable."); } }, { filesystem: crossDevice(from, to), backupId: () => "fixture" }))
    .toThrow("Registry is not writable.");
  expect(fs.readFileSync(path.join(from, "content.db"), "utf8")).toBe("database bytes");
  expect(fs.existsSync(to)).toBe(false);
  expect(fs.readdirSync(path.join(root, ".relocation-fixture-backup"))).toEqual([]);
});
test("EXDEV copy skips excluded top-level entries", () => {
  const { from, to } = fixture();
  fs.writeFileSync(path.join(from, "running.json"), "lease");
  moveDirectoryVerified({ from, to, commit() {} }, { filesystem: crossDevice(from, to), backupId: () => "fixture", excluded: ["running.json"] });
  expect(fs.readdirSync(to)).toEqual(["content.db"]);
});
test("Windows platform skips directory flushes but still moves", () => {
  const { from, to } = fixture();
  const opened: string[] = [];
  const filesystem: typeof fs = { ...fs, openSync: ((file: fs.PathLike, flags: fs.OpenMode) => { opened.push(String(file)); return fs.openSync(file, flags); }) as typeof fs.openSync };
  moveDirectoryVerified({ from, to, commit() {} }, { filesystem, platform: "win32" });
  expect(opened.filter(file => !file.endsWith("content.db"))).toEqual([]);
  expect(fs.existsSync(path.join(to, "content.db"))).toBe(true);
});
test("fingerprint digests every file byte, not just a prefix", () => {
  const { from } = fixture();
  const before = directoryFingerprint({ dir: from });
  fs.writeFileSync(path.join(from, "content.db"), "database byteZ");
  expect(directoryFingerprint({ dir: from })).not.toBe(before);
});
test("EXDEV retirement uses a random UUID backup folder by default", () => {
  const { root, from, to } = fixture();
  moveDirectoryVerified({ from, to, commit() {} }, { filesystem: crossDevice(from, to) });
  expect(fs.readdirSync(root).filter(name => name !== "target")).toEqual([expect.stringMatching(/^\.relocation-[0-9a-f-]{36}-backup$/)]);
});
test("POSIX moves flush the source/target parent and the EXDEV backup folder", () => {
  const { root, from, to } = fixture();
  const opened: string[] = [];
  const filesystem = crossDevice(from, to, { openSync: ((file: fs.PathLike, flags: fs.OpenMode) => { if (flags === "r" && fs.statSync(file).isDirectory()) opened.push(String(file)); return fs.openSync(file, flags); }) as typeof fs.openSync });
  moveDirectoryVerified({ from, to, commit() {} }, { filesystem, platform: "linux", backupId: () => "fixture" });
  expect(opened).toEqual([path.join(root, ".relocation-fixture-backup"), root]);
});
test("an EXDEV backup-folder fsync failure restores the retired source before removing the copy", () => {
  const { root, from, to } = fixture();
  const backupRoot = path.join(root, ".relocation-fixture-backup");
  const descriptors = new Map<number, string>();
  let committed = false;
  const filesystem = crossDevice(from, to, {
    openSync: ((file: fs.PathLike, flags: fs.OpenMode) => { const fd = fs.openSync(file, flags); descriptors.set(fd, String(file)); return fd; }) as typeof fs.openSync,
    fsyncSync: (fd: number) => { if (descriptors.get(fd) === backupRoot) throw coded("EIO"); fs.fsyncSync(fd); },
  });
  let caught: unknown;
  try { moveDirectoryVerified({ from, to, commit: () => { committed = true; } }, { filesystem, platform: "linux", backupId: () => "fixture" }); }
  catch (error) { caught = error; }
  expect(caught).toMatchObject({ code: "EIO" });
  expect(fs.readFileSync(path.join(from, "content.db"), "utf8")).toBe("database bytes");
  expect(fs.readdirSync(from)).toEqual(["content.db"]);
  expect(fs.existsSync(to)).toBe(false);
  expect(fs.readdirSync(backupRoot)).toEqual([]);
  expect(committed).toBe(false);
});
