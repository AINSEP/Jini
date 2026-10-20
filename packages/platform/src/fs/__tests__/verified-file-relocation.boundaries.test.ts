import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { stageVerifiedFileRelocation } from "../verified-file-relocation.js";

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "relocation-bounds-"))); roots.push(root);
  const from = path.join(root, "old", "content.db"), to = path.join(root, "new", "content.db");
  fs.mkdirSync(path.dirname(from)); fs.writeFileSync(from, "database"); fs.writeFileSync(`${from}-wal`, "journal");
  return { root, from, to };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const verify = ({ path: file }: { path: string }): string => fs.readFileSync(file, "utf8");
const listing = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];

test("a symlinked sidecar is refused before any marker or copy is created", () => {
  const { root, from, to } = fixture();
  fs.symlinkSync(from, `${from}-shm`);
  expect(() => stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: ["-wal", "-shm"] }], verify }, { backupId: () => "fixture" }))
    .toThrow(`Database move requires a regular file: ${from}-shm`);
  expect(listing(path.join(root, "old"))).toEqual(["content.db", "content.db-shm", "content.db-wal"]);
  expect(fs.existsSync(path.join(root, "new"))).toBe(false);
});
test("absent sidecars are skipped and only existing files are copied", () => {
  const { root, from, to } = fixture();
  const staged = stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: ["-wal", "-shm"] }], verify }, { backupId: () => "fixture" });
  expect(listing(path.join(root, "new"))).toEqual(["content.db", "content.db-wal"]);
  staged.finalize();
  expect(listing(path.join(root, "old"))).toEqual(["content.db-wal.relocation-fixture-backup", "content.db.relocation-fixture-backup"]);
});
test("an existing relocation marker aborts without removing it", () => {
  const { root, from, to } = fixture();
  fs.writeFileSync(`${from}.home2-relocation.json`, "other move");
  expect(() => stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: ["-wal"] }], verify }, { backupId: () => "fixture" })).toThrow(expect.objectContaining({ code: "EEXIST" }));
  expect(fs.readFileSync(`${from}.home2-relocation.json`, "utf8")).toBe("other move");
  expect(listing(path.join(root, "new"))).toEqual([]);
});
test("the marker records the destination and the backup name", () => {
  const { from, to } = fixture();
  stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: [] }], verify }, { backupId: () => "fixture" });
  expect(JSON.parse(fs.readFileSync(`${from}.home2-relocation.json`, "utf8"))).toEqual({ to, backup: `${from}.relocation-fixture-backup` });
});
test("a destination collision aborts, keeps the other data and removes only our partial copies", () => {
  const { root, from, to } = fixture();
  fs.mkdirSync(path.dirname(to)); fs.writeFileSync(`${to}-wal`, "someone else's journal");
  expect(() => stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: ["-wal"] }], verify }, { backupId: () => "fixture" })).toThrow(expect.objectContaining({ code: "EEXIST" }));
  expect(listing(path.join(root, "new"))).toEqual(["content.db-wal"]);
  expect(fs.readFileSync(`${to}-wal`, "utf8")).toBe("someone else's journal");
  expect(listing(path.join(root, "old"))).toEqual(["content.db", "content.db-wal"]);
});
test("a verification mismatch names the destination file and restores everything", () => {
  const { root, from, to } = fixture();
  let calls = 0;
  expect(() => stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: ["-wal"] }], verify: () => String(calls++) }, { backupId: () => "fixture" }))
    .toThrow("Database row counts changed while moving content.db.");
  expect(listing(path.join(root, "old"))).toEqual(["content.db", "content.db-wal"]);
  expect(listing(path.join(root, "new"))).toEqual([]);
});
test("a later group's failure restores an earlier group's retired files", () => {
  const { root, from, to } = fixture();
  const second = path.join(root, "old", "other.db"); fs.writeFileSync(second, "other");
  fs.writeFileSync(`${second}.relocation-fixture-backup`, "existing recovery");
  expect(() => stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: [] }, { from: second, to: path.join(root, "new", "other.db"), sidecars: [] }], verify }, { backupId: () => "fixture" }))
    .toThrow(`Database backup target already exists: ${second}.relocation-fixture-backup`);
  expect(fs.readFileSync(from, "utf8")).toBe("database");
  expect(fs.readFileSync(`${second}.relocation-fixture-backup`, "utf8")).toBe("existing recovery");
  expect(listing(path.join(root, "new"))).toEqual([]);
});
test("finalize removes backups the caller reports as covered, plus the markers", () => {
  const { root, from, to } = fixture();
  const staged = stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: ["-wal"] }], verify }, { backupId: () => "fixture", backupCovered: ({ from: file }) => file === from });
  staged.finalize();
  expect(listing(path.join(root, "old"))).toEqual(["content.db-wal.relocation-fixture-backup"]);
});
test("rollback after staging restores live names and removes copies and markers", () => {
  const { root, from, to } = fixture();
  stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: ["-wal"] }], verify }, { backupId: () => "fixture" }).rollback();
  expect(listing(path.join(root, "old"))).toEqual(["content.db", "content.db-wal"]);
  expect(listing(path.join(root, "new"))).toEqual([]);
});
test("the default backup suffix is a random UUID", () => {
  const { root, from, to } = fixture();
  stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: [] }], verify }).finalize();
  expect(listing(path.join(root, "old"))).toEqual(["content.db-wal", expect.stringMatching(/^content\.db\.relocation-[0-9a-f-]{36}-backup$/)]);
});
test("POSIX staging flushes parent directories; Windows does not open them", () => {
  for (const platform of ["linux", "win32"] as const) {
    const { from, to } = fixture();
    const opened: string[] = [];
    const filesystem: typeof fs = { ...fs, openSync: ((file: fs.PathLike, flags: fs.OpenMode) => { if (flags === "r") opened.push(String(file)); return fs.openSync(file, flags); }) as typeof fs.openSync };
    stageVerifiedFileRelocation({ groups: [{ from, to, sidecars: [] }], verify }, { filesystem, platform, backupId: () => "fixture" });
    expect(opened).toEqual(platform === "linux" ? [path.dirname(from), path.dirname(to), path.dirname(from)] : []);
  }
});
