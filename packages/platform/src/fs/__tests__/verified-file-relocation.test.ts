import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { stageVerifiedFileRelocation } from "../verified-file-relocation.js";
import { moveDirectoryVerified } from "../verified-directory-move.js";
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verified-db-move-"))), from = path.join(root, "old"), to = path.join(root, "new");
  fs.mkdirSync(from); fs.writeFileSync(path.join(from, "content.db"), "database"); fs.writeFileSync(path.join(from, "content.db-wal"), "journal");
  return { root, from, to, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
it("stages main + sidecars, retains exactly one source backup per file and verifies before committing", () => {
  const f = fixture(); let verified = 0, commits = 0;
  try {
    const target = path.join(f.to, "data.nosync", "content.db");
    moveDirectoryVerified({ from: f.from, to: f.to, commit: () => { expect(verified).toBe(2); commits++; } }, {
      backupId: () => "fixture", relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(target, "data.nosync", "content.db"), sidecars: ["-wal", "-shm"] }],
      verifyFile: ({ path: file }) => { verified++; return fs.readFileSync(file, "utf8") + fs.readFileSync(file + "-wal", "utf8"); },
    });
    expect(commits).toBe(1); expect(fs.existsSync(path.join(f.to, "content.db"))).toBe(false);
    expect(fs.readFileSync(path.join(f.to, "content.db.relocation-fixture-backup"), "utf8")).toBe("database"); expect(fs.readFileSync(path.join(f.to, "content.db-wal.relocation-fixture-backup"), "utf8")).toBe("journal");
    expect(fs.existsSync(target + ".home2-backup")).toBe(false); expect(fs.existsSync(target + "-wal.home2-backup")).toBe(false);
  } finally { f.cleanup(); }
});
it("rolls back both the site and external database files when destination verification differs", () => {
  const f = fixture(), external = path.join(f.root, "app-data", "id");
  try {
    let calls = 0;
    expect(() => moveDirectoryVerified({ from: f.from, to: f.to, commit: () => { throw new Error("Must not commit"); } }, {
      backupId: () => "fixture", relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(external, "content.db"), sidecars: ["-wal"] }],
      verifyFile: () => ++calls === 1 ? "one-row" : "two-rows",
    })).toThrow("Database row counts changed while moving content.db.");
    expect(fs.readFileSync(path.join(f.from, "content.db"), "utf8")).toBe("database"); expect(fs.existsSync(f.to)).toBe(false);
    expect(fs.readdirSync(external)).toEqual([]);
  } finally { f.cleanup(); }
});
it("retains old home2 backups while moving into a destination with its own old backup", () => {
  const f = fixture(), external = path.join(f.root, "data");
  try {
    fs.mkdirSync(external);
    const backup = path.join(external, "content.db.home2-backup"); fs.writeFileSync(backup, "keep destination");
    fs.writeFileSync(path.join(f.from, "content.db.home2-backup"), "keep source");
    moveDirectoryVerified({ from: f.from, to: f.to, commit: () => {} }, {
      backupId: () => "fixture", relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(external, "content.db"), sidecars: [] }], verifyFile: ({ path: file }) => fs.readFileSync(file, "utf8"),
    });
    expect(fs.readFileSync(backup, "utf8")).toBe("keep destination");
    expect(fs.readFileSync(path.join(f.to, "content.db.home2-backup"), "utf8")).toBe("keep source");
    expect(fs.readFileSync(path.join(f.to, "content.db.relocation-fixture-backup"), "utf8")).toBe("database");
    expect(fs.readFileSync(path.join(external, "content.db"), "utf8")).toBe("database");
  } finally { f.cleanup(); }
});
it('registry commit failure rolls back staged app-data copies and keeps the original sidecars', () => {
  const f = fixture(), external = path.join(f.root, 'app-data', 'id');
  try {
    expect(() => moveDirectoryVerified({ from: f.from, to: f.to, commit: () => { throw new Error('Registry disk is full'); } }, {
      backupId: () => "fixture", relocateFiles: ({ target }) => [{ from: path.join(target, 'content.db'), to: path.join(external, 'content.db'), sidecars: ['-wal'] }],
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
    } }, { filesystem, backupId: () => "fixture", relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(target, "data.nosync", "content.db"), sidecars: ["-wal"] }], verifyFile: ({ path }) => fs.readFileSync(path, "utf8") })).toThrow("Cleanup denied");
    expect(fs.existsSync(f.from)).toBe(false); expect(fs.existsSync(old)).toBe(false);
    expect(fs.readFileSync(old + ".relocation-fixture-backup", "utf8")).toBe("database");
    expect(JSON.parse(fs.readFileSync(old + ".home2-relocation.json", "utf8"))).toEqual({ to: target, backup: old + ".relocation-fixture-backup" });
  } finally { f.cleanup(); }
});

it("unchanged database paths verify without making copies, including pre-existing backups", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.from, "content.db.home2-backup"), "keep");
    let copies = 0, verified = 0;
    const filesystem: typeof fs = { ...fs, copyFileSync: (...args) => { copies++; fs.copyFileSync(...args); } };
    moveDirectoryVerified({ from: f.from, to: f.to, commit: () => expect(verified).toBe(2) }, {
      filesystem, relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(target, "content.db"), sidecars: ["-wal"] }],
      verifyFile: ({ path: file }) => { verified++; return fs.readFileSync(file, "utf8"); },
    });
    expect(copies).toBe(0);
    expect(fs.readdirSync(f.to).sort()).toEqual(["content.db", "content.db-wal", "content.db.home2-backup"]);
    expect(fs.readFileSync(path.join(f.to, "content.db.home2-backup"), "utf8")).toBe("keep");
  } finally { f.cleanup(); }
});

it("sequential database-placement moves retain distinct backups and leave earlier recovery bytes intact", () => {
  const f = fixture();
  try {
    const first = path.join(f.root, "first.db"), second = path.join(f.root, "second.db");
    const verify = ({ path: file }: { path: string }) => fs.readFileSync(file, "utf8");
    const staged = stageVerifiedFileRelocation({ groups: [{ from: path.join(f.from, "content.db"), to: first, sidecars: [] }], verify }); staged.finalize();
    const next = stageVerifiedFileRelocation({ groups: [{ from: first, to: second, sidecars: [] }], verify }); next.finalize();
    const firstBackups = fs.readdirSync(f.from).filter((name) => name.startsWith("content.db.relocation-") && name.endsWith("-backup"));
    const secondBackups = fs.readdirSync(f.root).filter((name) => name.startsWith("first.db.relocation-") && name.endsWith("-backup"));
    expect(firstBackups).toHaveLength(1); expect(secondBackups).toHaveLength(1);
    expect(firstBackups[0]!.split(".relocation-")[1]).not.toBe(secondBackups[0]!.split(".relocation-")[1]);
    expect(fs.readFileSync(path.join(f.from, firstBackups[0]!), "utf8")).toBe("database");
    expect(fs.readFileSync(path.join(f.root, secondBackups[0]!), "utf8")).toBe("database");
    expect(fs.readFileSync(second, "utf8")).toBe("database");
  } finally { f.cleanup(); }
});

it("a generated backup-name collision rolls back without deleting the existing recovery file", () => {
  const f = fixture(), external = path.join(f.root, "data");
  try {
    const existing = path.join(f.from, "content.db.relocation-fixture-backup"); fs.writeFileSync(existing, "earlier recovery");
    expect(() => moveDirectoryVerified({ from: f.from, to: f.to, commit: () => { throw new Error("Must not commit"); } }, {
      backupId: () => "fixture", relocateFiles: ({ target }) => [{ from: path.join(target, "content.db"), to: path.join(external, "content.db"), sidecars: [] }],
      verifyFile: ({ path: file }) => fs.readFileSync(file, "utf8"),
    })).toThrow("Database backup target already exists");
    expect(fs.readFileSync(existing, "utf8")).toBe("earlier recovery");
    expect(fs.readFileSync(path.join(f.from, "content.db"), "utf8")).toBe("database");
    expect(fs.existsSync(f.to)).toBe(false); expect(fs.readdirSync(external)).toEqual([]);
  } finally { f.cleanup(); }
});
