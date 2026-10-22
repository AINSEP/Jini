/** Real-file regression probes with controlled interleaving at the stale-lock rename boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";
import { acquireOwnerLock, PgliteOwnerLockedError } from "../pglite/index.js";

vi.mock("node:fs", async () => {
  const real = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...real, renameSync: vi.fn(real.renameSync), mkdirSync: vi.fn(real.mkdirSync) };
});
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
let dir: string;
const lockFileName = "owner.pid";
beforeEach(() => {
  vi.mocked(fs.renameSync).mockImplementation(realFs.renameSync);
  vi.mocked(fs.mkdirSync).mockImplementation(realFs.mkdirSync);
  dir = fs.mkdtempSync(join(tmpdir(), "jini-owner-lock-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("stale reapers interleaved with new starters never acknowledge two owners", () => {
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  assert.equal(dead.status, 0);
  const lockPath = join(dir, lockFileName);
  fs.writeFileSync(lockPath, `${dead.stdout}\n`);
  const releases: (() => void)[] = [];
  const acquire = () => {
    try { releases.push(acquireOwnerLock({ dataDir: dir, lockFileName })); }
    catch (error) { assert.ok(error instanceof PgliteOwnerLockedError); }
  };
  const rename = realFs.renameSync;
  let interleaved = false;
  vi.mocked(fs.renameSync).mockImplementation((from, to) => {
    if (interleaved) return rename(from, to);
    interleaved = true;
    acquire(); // A second reaper wins after the first observed the dead inode.
    rename(from, to);
    acquire(); // A third starter tries during the first reaper's rename gap.
  });
  acquire();
  assert.equal(interleaved, true, "the stale-lock mutation boundary was exercised");
  assert.equal(releases.length, 1, "only one starter may receive an owner release handle");
  assert.equal(fs.readFileSync(lockPath, "utf8"), `${process.pid}\n`);
  releases[0]!();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("a released handle cannot release a later lock owned by the same process", () => {
  const required = { dataDir: dir, lockFileName };
  const first = acquireOwnerLock(required);
  first();
  const second = acquireOwnerLock(required);
  first();
  assert.throws(() => acquireOwnerLock(required), PgliteOwnerLockedError);
  assert.equal(fs.readFileSync(join(dir, lockFileName), "utf8"), `${process.pid}\n`);
  second();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("an interrupted stale reaper fails closed and leaves the dead lock intact", () => {
  const lockPath = join(dir, lockFileName);
  fs.writeFileSync(lockPath, "");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, old, old);
  const guard = `${lockPath}.reaping-${fs.statSync(lockPath).ino}`;
  fs.mkdirSync(guard);
  assert.throws(() => acquireOwnerLock({ dataDir: dir, lockFileName }), PgliteOwnerLockedError);
  assert.equal(fs.readFileSync(lockPath, "utf8"), "");
  assert.deepEqual(fs.readdirSync(guard), []);
});

test("a delayed reaper rechecks the inode after acquiring its guard", () => {
  const lockPath = join(dir, lockFileName);
  fs.writeFileSync(lockPath, "");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, old, old);
  let winner: (() => void) | undefined;
  vi.mocked(fs.mkdirSync).mockImplementation((path, options) => {
    // The other starter removes the stale inode before this starter gets the guard.
    fs.renameSync(lockPath, join(dir, "retired"));
    winner = acquireOwnerLock({ dataDir: dir, lockFileName });
    return realFs.mkdirSync(path, options);
  });
  assert.throws(() => acquireOwnerLock({ dataDir: dir, lockFileName }), PgliteOwnerLockedError);
  assert.equal(typeof winner, "function");
  assert.equal(fs.readFileSync(lockPath, "utf8"), `${process.pid}\n`);
  winner!();
  assert.deepEqual(fs.readdirSync(dir), ["retired"]);
});

test("release is bound to the inode even when a replacement has the same pid", () => {
  const required = { dataDir: dir, lockFileName };
  const first = acquireOwnerLock(required);
  const lockPath = join(dir, lockFileName);
  fs.renameSync(lockPath, join(dir, "retired"));
  const second = acquireOwnerLock(required);
  first();
  assert.throws(() => acquireOwnerLock(required), PgliteOwnerLockedError);
  second();
  assert.deepEqual(fs.readdirSync(dir), ["retired"]);
});
