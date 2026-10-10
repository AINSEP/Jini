import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { moveDirectoryVerified } from "../verified-directory-move.js";
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verified-db-move-"))), from = path.join(root, "old"), to = path.join(root, "new");
  fs.mkdirSync(from); fs.writeFileSync(path.join(from, "content.db"), "database"); fs.writeFileSync(path.join(from, "content.db-wal"), "journal");
  return { root, from, to, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
it("stages main + sidecars, retains every backup and verifies before committing", () => {
  const f = fixture(); let verified = 0, commits = 0;
  try {
    const target = path.join(f.to, "data.nosync", "content.db");
    moveDirectoryVerified({ from: f.from, to: f.to, commit: () => { expect(verified).toBe(2); commits++; } }, {
      relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(target, "data.nosync", "content.db"), sidecars: ["-wal", "-shm"] }],
      verifyFile: ({ path: file }) => { verified++; return fs.readFileSync(file, "utf8") + fs.readFileSync(file + "-wal", "utf8"); },
    });
    expect(commits).toBe(1); expect(fs.existsSync(path.join(f.to, "content.db"))).toBe(false);
    expect(fs.readFileSync(target + ".home2-backup", "utf8")).toBe("database"); expect(fs.readFileSync(target + "-wal.home2-backup", "utf8")).toBe("journal");
  } finally { f.cleanup(); }
});
it("rolls back both the site and external database files when destination verification differs", () => {
  const f = fixture(), external = path.join(f.root, "app-data", "id");
  try {
    let calls = 0;
    expect(() => moveDirectoryVerified({ from: f.from, to: f.to, commit: () => { throw new Error("Must not commit"); } }, {
      relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(external, "content.db"), sidecars: ["-wal"] }],
      verifyFile: () => ++calls === 1 ? "one-row" : "two-rows",
    })).toThrow("Database row counts changed while moving content.db.");
    expect(fs.readFileSync(path.join(f.from, "content.db"), "utf8")).toBe("database"); expect(fs.existsSync(f.to)).toBe(false);
    expect(fs.readdirSync(external)).toEqual([]);
  } finally { f.cleanup(); }
});
it("does not delete an existing collision when backup reservation fails", () => {
  const f = fixture(), external = path.join(f.root, "data");
  try {
    fs.mkdirSync(external); const backup = path.join(external, "content.db.home2-backup"); fs.writeFileSync(backup, "keep");
    expect(() => moveDirectoryVerified({ from: f.from, to: f.to, commit: () => {} }, {
      relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(external, "content.db"), sidecars: [] }], verifyFile: () => "ok",
    })).toThrow();
    expect(fs.readFileSync(backup, "utf8")).toBe("keep"); expect(fs.existsSync(f.from)).toBe(true);
  } finally { f.cleanup(); }
});
it('registry commit failure rolls back staged app-data copies and keeps the original sidecars', () => {
  const f = fixture(), external = path.join(f.root, 'app-data', 'id');
  try {
    expect(() => moveDirectoryVerified({ from: f.from, to: f.to, commit: () => { throw new Error('Registry disk is full'); } }, {
      relocateFiles: ({ target }) => [{ from: path.join(target, 'content.db'), to: path.join(external, 'content.db'), sidecars: ['-wal'] }],
      verifyFile: ({ path: file }) => fs.readFileSync(file, 'utf8'),
    })).toThrow('Registry disk is full');
    expect(fs.readFileSync(path.join(f.from, 'content.db-wal'), 'utf8')).toBe('journal');
    expect(fs.existsSync(f.to)).toBe(false); expect(fs.readdirSync(external)).toEqual([]);
  } finally { f.cleanup(); }
});

it("retires all old live DB names before commit even when final marker cleanup fails", () => {
  const f = fixture();
  try {
    const old = path.join(f.to, "content.db"), target = path.join(f.to, "data.nosync", "content.db");
    const filesystem: typeof fs = { ...fs, rmSync: (file, options) => {
      if (String(file).endsWith(".home2-relocation.json")) throw new Error("Cleanup denied"); fs.rmSync(file, options);
    } };
    expect(() => moveDirectoryVerified({ from: f.from, to: f.to, commit: () => {
      expect(fs.existsSync(old)).toBe(false); expect(fs.existsSync(old + "-wal")).toBe(false);
      expect(fs.readFileSync(target, "utf8")).toBe("database");
    } }, { filesystem, relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(target, "data.nosync", "content.db"), sidecars: ["-wal"] }], verifyFile: ({ path }) => fs.readFileSync(path, "utf8") })).toThrow("Cleanup denied");
    expect(fs.existsSync(f.from)).toBe(false); expect(fs.existsSync(old)).toBe(false);
    expect(fs.readFileSync(old + ".home2-backup", "utf8")).toBe("database");
    expect(JSON.parse(fs.readFileSync(old + ".home2-relocation.json", "utf8"))).toEqual({ to: target });
  } finally { f.cleanup(); }
});
