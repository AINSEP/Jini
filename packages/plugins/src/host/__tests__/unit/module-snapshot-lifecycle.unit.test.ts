/** Snapshot ownership contract: reap only old dead local owners; drain loads before shutdown.
 * All effects are injected fakes. These cases intentionally mix reclaimable and retained entries.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { test } from "vitest";
import {
  createPluginModuleSnapshotLifecycle, PluginSnapshotIntegrityError, PluginSnapshotLifecycleError,
  type PluginSnapshotFilesystem, type PluginSnapshotProcess,
} from "../../node/module-snapshot.js";

const ROOT = path.resolve("/fake/plugins-runtime");
const HOST = "snapshot-fixture-host";
const PREFIX = `load-${createHash("sha256").update(HOST).digest("hex").slice(0, 16)}-`;
const FILES = new Map([["server/index.mjs", Buffer.from("export default 1;")]]);
type Stat = Awaited<ReturnType<PluginSnapshotFilesystem["lstat"]>>;

/** A directory entry's identity and timestamp; links/files exercise the refusal boundary. */
function stat({ ino = 1, mtimeMs = 1, directory = true, link = false } = {}): Stat {
  return { ino, dev: 1, mtimeMs, isDirectory: () => directory, isSymbolicLink: () => link };
}

/** Deterministic in-memory filesystem with visible output, removals, and controllable races. */
function fixture() {
  const entries = new Map<string, Stat>([[ROOT, stat()]]);
  const removed: string[] = [];
  const writes = new Map<string, unknown>();
  let sequence = 0;
  const fs: PluginSnapshotFilesystem = {
    mkdir: async (directory) => { if (!entries.has(directory)) entries.set(directory, stat()); },
    mkdtemp: async (prefix) => {
      const directory = prefix + (++sequence).toString();
      entries.set(directory, stat({ ino: 100 + sequence, mtimeMs: 200 }));
      return directory;
    },
    lstat: async (directory) => {
      const entry = entries.get(directory);
      if (!entry) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return entry;
    },
    readdir: async () => [...entries.keys()].filter(key => path.dirname(key) === ROOT).map(key => path.basename(key)),
    rm: async (directory) => {
      removed.push(directory);
      for (const key of entries.keys()) if (key === directory || key.startsWith(directory + path.sep)) entries.delete(key);
      for (const key of writes.keys()) if (key.startsWith(directory + path.sep)) writes.delete(key);
    },
  };
  const proc: PluginSnapshotProcess = { pid: 42, startedAtMs: 100, hostname: HOST, isAlive: ({ pid }) => pid === 42 || pid === 11 };
  const options = { fs, process: proc };
  const writeSnapshotFile: typeof import("node:fs/promises").writeFile =
    async (file, data) => { writes.set(String(file), data); };
  return { fs, proc, options, entries, removed, writes, writeSnapshotFile };
}

test('unsafe owner PIDs and malformed ownership suffixes never authorize deletion', async () => {
  const f = fixture();
  const names = ['9007199254740992-overflow', '0-zero', '10-has-dash', '10-', '-1-negative'];
  for (const name of names) f.entries.set(path.join(ROOT, PREFIX + name), stat());
  const owner = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  await owner.ready;
  assert.deepEqual(f.removed, []);
  for (const name of names) assert.equal(f.entries.has(path.join(ROOT, PREFIX + name)), true);
  await owner.dispose({});
});

test('an invalid snapshot path leaves no partial snapshot and does not escape its runtime root', async () => {
  const f = fixture();
  const owner = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  await owner.ready;
  await assert.rejects(owner.createSnapshot({ files: new Map([['../escape', Buffer.from('private')]]) },
    { writeSnapshotFile: f.writeSnapshotFile }),
  { name: 'Error', message: 'Snapshot file must remain inside its package.' });
  assert.equal(f.writes.size, 0);
  assert.equal(f.removed.length, 1);
  await owner.dispose({});
});

test("boot reaps only old dead local ownership, retaining live, new, foreign, legacy and unsafe entries", async () => {
  const f = fixture();
  const oldDead = path.join(ROOT, `${PREFIX}10-dead`);
  f.entries.set(oldDead, stat({ ino: 10 }));
  for (const [name, info] of [
    [`${PREFIX}11-live`, stat()], [`${PREFIX}12-new`, stat({ mtimeMs: 100 })],
    ["load-foreign-10-other", stat()], ["load-legacy", stat()], [`${PREFIX}0-invalid`, stat()],
    [`${PREFIX}13-link`, stat({ link: true })], [`${PREFIX}14-file`, stat({ directory: false })],
  ] as const) f.entries.set(path.join(ROOT, name), info);
  const owner = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  await owner.ready;
  assert.deepEqual(f.removed, [oldDead]);
  assert.equal(f.entries.has(path.join(ROOT, `${PREFIX}11-live`)), true);
});

test("a PID that becomes live at the second probe and an entry replaced during inspection survive", async () => {
  const f = fixture();
  const candidate = path.join(ROOT, `${PREFIX}10-raced`);
  f.entries.set(candidate, stat());
  let probes = 0;
  f.proc.isAlive = () => ++probes === 2;
  await createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options).ready;
  assert.deepEqual(f.removed, []);
  assert.equal(probes, 2);

  f.proc.isAlive = () => { f.entries.set(candidate, stat({ ino: 2 })); return false; };
  await createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options).ready;
  assert.deepEqual(f.removed, []);
});

test("a concurrent reap may remove an entry, while an unreadable entry fails boot visibly", async () => {
  const f = fixture();
  const candidate = path.join(ROOT, `${PREFIX}10-raced`);
  f.entries.set(candidate, stat());
  f.proc.isAlive = () => { f.entries.delete(candidate); return false; };
  await createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options).ready;
  assert.deepEqual(f.removed, []);
  f.entries.set(candidate, stat());
  const original = f.fs.lstat;
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  f.fs.lstat = async directory => { if (directory === candidate) throw denied; return original(directory); };
  await assert.rejects(createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options).ready, error => error === denied);
});

test("a linked runtime root is refused before listing or deleting anything", async () => {
  const f = fixture();
  f.entries.set(ROOT, stat({ link: true }));
  await assert.rejects(createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options).ready, PluginSnapshotIntegrityError);
  assert.deepEqual(f.removed, []);
});

test("a runtime root replaced by a link after boot is refused by the next copy", async () => {
  const f = fixture();
  const owner = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  await owner.ready;
  f.entries.set(ROOT, stat({ link: true }));
  await assert.rejects(owner.createSnapshot({ files: FILES }, { writeSnapshotFile: f.writeSnapshotFile }), PluginSnapshotIntegrityError);
  assert.equal(f.writes.size, 0);
  assert.deepEqual(f.removed, []);
});

test("shutdown refuses a runtime root replaced by a link instead of removing through it", async () => {
  const f = fixture();
  const owner = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  const entry = await owner.createSnapshot({ files: FILES }, { writeSnapshotFile: f.writeSnapshotFile });
  f.entries.set(ROOT, stat({ link: true }));
  await assert.rejects(owner.dispose({}), PluginSnapshotIntegrityError);
  assert.deepEqual(f.removed, []);
  assert.equal(f.writes.has(entry), true);
});

test("late file users retain copied bytes until disposal, which removes only this host instance's loads", async () => {
  const f = fixture();
  const first = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  const second = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  const entry = await first.createSnapshot({ files: FILES }, { writeSnapshotFile: f.writeSnapshotFile });
  const other = await second.createSnapshot({ files: FILES }, { writeSnapshotFile: f.writeSnapshotFile });
  assert.equal(f.writes.get(entry), FILES.get("server/index.mjs"));
  assert.notEqual(entry, other);
  await first.dispose({});
  await first.dispose({});
  assert.equal(f.writes.has(entry), false);
  assert.equal(f.writes.has(other), true);
  assert.equal(f.removed.filter(root => entry.startsWith(root + path.sep)).length, 1);
  await assert.rejects(first.createSnapshot({ files: FILES }), { code: "SNAPSHOTS_CLOSED" });
});

test("shutdown waits for an admitted write and refuses a later load immediately", async () => {
  const f = fixture();
  const owner = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const copy = owner.createSnapshot({ files: FILES }, { writeSnapshotFile: async () => { started(); await gate; } });
  await writing;
  const disposal = owner.dispose({});
  assert.deepEqual(f.removed, []);
  await assert.rejects(owner.createSnapshot({ files: FILES }), PluginSnapshotLifecycleError);
  release();
  const entry = await copy;
  await disposal;
  assert.deepEqual(f.removed, [path.dirname(path.dirname(entry))]);
});

test("failed writes clean partial output and shutdown still attempts every removal after a failure", async () => {
  const f = fixture();
  const owner = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  const failure = new Error("disk full");
  await assert.rejects(owner.createSnapshot({ files: FILES }, { writeSnapshotFile: async () => { throw failure; } }), error => error === failure);
  assert.equal(f.removed.length, 1);
  const entry = await owner.createSnapshot({ files: FILES }, { writeSnapshotFile: f.writeSnapshotFile });
  const remove = f.fs.rm;
  f.fs.rm = async (directory, options) => {
    if (directory.endsWith("1")) throw failure;
    return remove(directory, options);
  };
  await assert.rejects(owner.dispose({}), { code: "SNAPSHOT_CLEANUP_FAILED" });
  assert.equal(f.writes.has(entry), false, "one failure must not prevent cleaning a sibling load");
});

test("a raw lifecycle copy cannot write a path outside its package", async () => {
  const f = fixture();
  const owner = createPluginModuleSnapshotLifecycle({ runtimeRoot: ROOT }, f.options);
  await assert.rejects(owner.createSnapshot({ files: new Map([["../outside.mjs", Buffer.from("unsafe")]]) }, { writeSnapshotFile: f.writeSnapshotFile }), PluginSnapshotIntegrityError);
  assert.equal(f.writes.size, 0);
  assert.equal(f.removed.length, 1);
});
