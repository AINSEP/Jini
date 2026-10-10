import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { directoryFingerprint, moveDirectoryVerified } from "../verified-directory-move.js";

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jini-directory-move-")));
  const from = path.join(root, "source"), to = path.join(root, "target");
  fs.mkdirSync(from); fs.writeFileSync(path.join(from, "content.db"), "database bytes");
  fs.mkdirSync(path.join(from, "uploads")); fs.writeFileSync(path.join(from, "uploads", "asset.txt"), "asset bytes");
  return { root, from, to };
}
it("moves all bytes, verifies before commit, and rolls back a failed registry commit", () => {
  const { root, from, to } = fixture();
  try {
    const before = directoryFingerprint({ dir: from });
    expect(() => moveDirectoryVerified({ from, to, commit: () => { throw new Error("Registry is not writable."); } })).toThrow("Registry is not writable.");
    expect(directoryFingerprint({ dir: from })).toBe(before); expect(fs.existsSync(to)).toBe(false);
    moveDirectoryVerified({ from, to, commit: () => expect(directoryFingerprint({ dir: to })).toBe(before) });
    expect(fs.existsSync(from)).toBe(false); expect(directoryFingerprint({ dir: to })).toBe(before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it("cross-device verification failure preserves the source and never commits", () => {
  const { root, from, to } = fixture();
  try {
    const before = directoryFingerprint({ dir: from }); let commits = 0;
    const filesystem: typeof fs = { ...fs, renameSync: (a, b) => { if (String(a) === from && String(b) === to) throw Object.assign(new Error("cross-device"), { code: "EXDEV" }); fs.renameSync(a, b); },
      cpSync: (source, target, options) => { fs.cpSync(source, target, options); fs.writeFileSync(path.join(String(target), "content.db"), "torn copy"); } };
    expect(() => moveDirectoryVerified({ from, to, commit: () => { commits++; } }, { filesystem })).toThrow("Moved directory verification failed.");
    expect(commits).toBe(0); expect(directoryFingerprint({ dir: from })).toBe(before); expect(fs.existsSync(to)).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it("an occupied target is never overwritten", () => {
  const { root, from, to } = fixture();
  try {
    fs.mkdirSync(to); fs.writeFileSync(path.join(to, "owner.txt"), "keep");
    expect(() => moveDirectoryVerified({ from, to, commit() {} })).toThrow("Move target already exists");
    expect(fs.readFileSync(path.join(to, "owner.txt"), "utf8")).toBe("keep"); expect(fs.existsSync(from)).toBe(true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("reserves a cross-device destination before copying any site bytes", () => {
  const { root, from, to } = fixture();
  try {
    const filesystem: typeof fs = { ...fs, renameSync: (a, b) => { if (String(a) === from && String(b) === to) throw Object.assign(new Error("cross-device"), { code: "EXDEV" }); fs.renameSync(a, b); },
      cpSync: (source, target, options) => {
        expect(fs.readFileSync(path.join(String(target), "running.json"), "utf8")).toBe("reserved");
        expect(fs.existsSync(path.join(String(target), "content.db"))).toBe(false);
        fs.cpSync(source, target, options);
      } };
    moveDirectoryVerified({ from, to, commit() {} }, { filesystem, excluded: ["running.json"], prepareDestination: ({ path: target }) => fs.writeFileSync(path.join(target, "running.json"), "reserved") });
    expect(fs.readFileSync(path.join(to, "content.db"), "utf8")).toBe("database bytes");
    expect(fs.existsSync(from)).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("EXDEV retires the source into a hidden recovery parent before committing", () => {
  const { root, from, to } = fixture();
  try {
    const backup = path.join(root, ".home2-backup", "source");
    const filesystem: typeof fs = { ...fs, renameSync: (a, b) => {
      if (String(a) === from && String(b) === to) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
      fs.renameSync(a, b);
    } };
    moveDirectoryVerified({ from, to, commit: () => {
      expect(fs.existsSync(from)).toBe(false);
      expect(fs.readFileSync(path.join(backup, "content.db"), "utf8")).toBe("database bytes");
    } }, { filesystem });
    expect(fs.existsSync(path.join(root, ".home2-backup", "content.db"))).toBe(false);
    expect(fs.readFileSync(path.join(to, "content.db"), "utf8")).toBe("database bytes");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
