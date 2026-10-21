import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeEach, describe, test } from "vitest";

import { PGLITE_SOCKET_FILE } from "../../core/index.js";
import {
  acquireOwnerLock,
  defaultPgliteSocketDir,
  ensurePrivateDir,
  type OwnerFsPort,
  type OwnerProcessPort,
  PgliteOwnerLockedError,
  runningPgliteOwner,
  startPgliteOwner,
} from "../owner.js";

/**
 * @file The owner lock's race and errno paths, reached through the injected filesystem and process
 * ports: what another starter, another user or a failing filesystem can do between two of the
 * lock's own steps. Each fake delegates to the real filesystem in a scratch dir and changes only
 * the one call the scenario is about.
 */

const realFs: OwnerFsPort = {
  openSync: fs.openSync,
  fstatSync: fs.fstatSync,
  readFileSync: fs.readFileSync,
  closeSync: fs.closeSync,
  writeFileSync: fs.writeFileSync,
  linkSync: fs.linkSync,
  rmSync: fs.rmSync,
  renameSync: fs.renameSync,
  mkdirSync: fs.mkdirSync,
  rmdirSync: fs.rmdirSync,
  statSync: fs.statSync,
  lstatSync: fs.lstatSync,
  chmodSync: fs.chmodSync,
  existsSync: fs.existsSync,
  unlinkSync: fs.unlinkSync,
};

const DEAD_PID = 4242;
const NEWER_PID = 5151;
const THIRD_PID = 6161;

/** A process port where only {@link DEAD_PID} is dead; every other pid is alive. */
function fakeProcess(overrides: Partial<OwnerProcessPort> = {}): OwnerProcessPort {
  return {
    pid: process.pid,
    uid: () => 1000,
    homedir: () => "/home/fake",
    nowMs: () => Date.now(),
    kill: (pid) => {
      if (pid === DEAD_PID) throw errno("ESRCH");
    },
    ...overrides,
  };
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

let dir: string;
let lockPath: string;
const lockFileName = "owner.pid";
beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "jini-owner-ports-"));
  lockPath = join(dir, lockFileName);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Replaces the lock with a new inode holding `pid`: created before the old one goes, so the inode differs. */
function replaceLock(pid: number): void {
  const next = `${lockPath}.next`;
  fs.writeFileSync(next, `${pid}\n`);
  fs.renameSync(next, lockPath);
}

describe("acquireOwnerLock through its ports", () => {
  test("an unreadable lock propagates the open error rather than being treated as absent", () => {
    fs.writeFileSync(lockPath, `${process.pid}\n`);
    const denied = errno("EACCES");
    const ports = { fs: { ...realFs, openSync: (path: string, flags: "r") => (path === lockPath ? fail(denied) : realFs.openSync(path, flags)) }, proc: fakeProcess() };

    assert.throws(() => acquireOwnerLock({ dataDir: dir, lockFileName }, ports), (error: unknown) => error === denied);
    assert.deepEqual(fs.readdirSync(dir), [lockFileName], "no temp file is left behind");
  });

  test("a lock released between the failed create and its inspection is retried, not refused", () => {
    fs.writeFileSync(lockPath, `${NEWER_PID}\n`);
    let opened = 0;
    const openSync = (path: string, flags: "r") => {
      if (path === lockPath && opened++ === 0) fs.unlinkSync(lockPath); // its owner released it
      return realFs.openSync(path, flags);
    };

    const release = acquireOwnerLock({ dataDir: dir, lockFileName }, { fs: { ...realFs, openSync }, proc: fakeProcess() });

    assert.equal(fs.readFileSync(lockPath, "utf8"), `${process.pid}\n`);
    release();
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  test("a filesystem without hard links surfaces the link error and leaves neither lock nor temp file", () => {
    const refused = errno("EPERM");
    const ports = { fs: { ...realFs, linkSync: () => fail(refused) }, proc: fakeProcess() };

    assert.throws(() => acquireOwnerLock({ dataDir: dir, lockFileName }, ports), (error: unknown) => error === refused);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  test("a stale lock another starter removes mid-reap is no error: the next attempt takes the lock", () => {
    fs.writeFileSync(lockPath, `${DEAD_PID}\n`);
    const renameSync = (from: string, to: string) => {
      if (from === lockPath) fs.unlinkSync(lockPath); // the other starter got there first
      realFs.renameSync(from, to);
    };
    const release = acquireOwnerLock({ dataDir: dir, lockFileName }, { fs: { ...realFs, renameSync }, proc: fakeProcess() });

    assert.equal(fs.readFileSync(lockPath, "utf8"), `${process.pid}\n`);
    assert.deepEqual(fs.readdirSync(dir), [lockFileName], "no guard or aside file is left behind");
    release();
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  test("a rename failure other than ENOENT propagates and leaves the stale lock in place, with no guard", () => {
    fs.writeFileSync(lockPath, `${DEAD_PID}\n`);
    const busy = errno("EBUSY");

    assert.throws(
      () => acquireOwnerLock({ dataDir: dir, lockFileName }, { fs: { ...realFs, renameSync: () => fail(busy) }, proc: fakeProcess() }),
      (error: unknown) => error === busy
    );
    assert.equal(fs.readFileSync(lockPath, "utf8"), `${DEAD_PID}\n`);
    assert.deepEqual(fs.readdirSync(dir), [lockFileName]);
  });

  test("a newer lock swapped in just before the stale one is moved aside is put back, and the start is refused", () => {
    fs.writeFileSync(lockPath, `${DEAD_PID}\n`);
    const renameSync = (from: string, to: string) => {
      if (from === lockPath) replaceLock(NEWER_PID);
      realFs.renameSync(from, to);
    };

    assert.throws(
      () => acquireOwnerLock({ dataDir: dir, lockFileName }, { fs: { ...realFs, renameSync }, proc: fakeProcess() }),
      (error: unknown) => error instanceof PgliteOwnerLockedError && error.pid === NEWER_PID && error.dataDir === dir
    );
    assert.equal(fs.readFileSync(lockPath, "utf8"), `${NEWER_PID}\n`, "the newer owner's lock is back");
    assert.deepEqual(fs.readdirSync(dir), [lockFileName], "the aside copy and the guard are gone");
  });

  test("putting the newer lock back loses to a third starter: still refused, and the third starter's lock stays", () => {
    fs.writeFileSync(lockPath, `${DEAD_PID}\n`);
    const renameSync = (from: string, to: string) => {
      if (from === lockPath) replaceLock(NEWER_PID);
      realFs.renameSync(from, to);
    };
    const linkSync = (existing: string, target: string) => {
      if (existing.includes(".stale.")) fs.writeFileSync(lockPath, `${THIRD_PID}\n`); // the third starter's lock
      realFs.linkSync(existing, target);
    };

    assert.throws(
      () => acquireOwnerLock({ dataDir: dir, lockFileName }, { fs: { ...realFs, renameSync, linkSync }, proc: fakeProcess() }),
      (error: unknown) => error instanceof PgliteOwnerLockedError && error.pid === NEWER_PID
    );
    assert.equal(fs.readFileSync(lockPath, "utf8"), `${THIRD_PID}\n`);
    assert.deepEqual(fs.readdirSync(dir), [lockFileName]);
  });

  test("a put-back link failure other than EEXIST propagates, and the guard is still removed", () => {
    fs.writeFileSync(lockPath, `${DEAD_PID}\n`);
    const io = errno("EIO");
    const renameSync = (from: string, to: string) => {
      if (from === lockPath) replaceLock(NEWER_PID);
      realFs.renameSync(from, to);
    };
    const linkSync = (existing: string, target: string) => (existing.includes(".stale.") ? fail(io) : realFs.linkSync(existing, target));

    assert.throws(
      () => acquireOwnerLock({ dataDir: dir, lockFileName }, { fs: { ...realFs, renameSync, linkSync }, proc: fakeProcess() }),
      (error: unknown) => error === io
    );
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes(".reaping-")), []);
  });

  test("a guard that cannot be created for a reason other than EEXIST propagates and leaves the stale lock", () => {
    fs.writeFileSync(lockPath, `${DEAD_PID}\n`);
    const full = errno("ENOSPC");
    const mkdirSync = (path: string, options: { recursive?: boolean; mode: number }) =>
      path.includes(".reaping-") ? fail(full) : realFs.mkdirSync(path, options);

    assert.throws(
      () => acquireOwnerLock({ dataDir: dir, lockFileName }, { fs: { ...realFs, mkdirSync }, proc: fakeProcess() }),
      (error: unknown) => error === full
    );
    assert.deepEqual(fs.readdirSync(dir), [lockFileName]);
    assert.equal(fs.readFileSync(lockPath, "utf8"), `${DEAD_PID}\n`);
  });

  test("a lock that came alive (same inode, live pid) while the reaper took its guard is refused, not removed", () => {
    fs.writeFileSync(lockPath, `${DEAD_PID}\n`);
    const mkdirSync = (path: string, options: { recursive?: boolean; mode: number }) => {
      if (path.includes(".reaping-")) fs.writeFileSync(lockPath, `${NEWER_PID}\n`); // rewritten in place
      return realFs.mkdirSync(path, options);
    };

    assert.throws(
      () => acquireOwnerLock({ dataDir: dir, lockFileName }, { fs: { ...realFs, mkdirSync }, proc: fakeProcess() }),
      (error: unknown) => error instanceof PgliteOwnerLockedError && error.pid === NEWER_PID
    );
    assert.equal(fs.readFileSync(lockPath, "utf8"), `${NEWER_PID}\n`);
    assert.deepEqual(fs.readdirSync(dir), [lockFileName]);
  });

  test("an empty lock is contended up to exactly the 10 s grace period by the injected clock, and taken over after it", () => {
    fs.writeFileSync(lockPath, "");
    const { mtimeMs } = fs.statSync(lockPath);

    assert.throws(
      () => acquireOwnerLock({ dataDir: dir, lockFileName }, { proc: fakeProcess({ nowMs: () => mtimeMs + 10_000 }) }),
      (error: unknown) => error instanceof PgliteOwnerLockedError && error.pid === undefined
    );
    assert.equal(fs.readFileSync(lockPath, "utf8"), "");

    const release = acquireOwnerLock({ dataDir: dir, lockFileName }, { proc: fakeProcess({ nowMs: () => mtimeMs + 10_001 }) });
    assert.equal(fs.readFileSync(lockPath, "utf8"), `${process.pid}\n`);
    release();
  });

  test("the lock records the injected pid, and release removes only a lock carrying that pid", () => {
    const other = fakeProcess({ pid: NEWER_PID });
    const release = acquireOwnerLock({ dataDir: dir, lockFileName }, { proc: other });
    assert.equal(fs.readFileSync(lockPath, "utf8"), `${NEWER_PID}\n`);
    release();
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

describe("the process port's uid and home", () => {
  const longHome = `/${"h".repeat(120)}`;

  test("the /tmp fallback names the uid, or `user` where the platform has none", () => {
    const required = { dataDir: "/srv/site", runDirName: "app" };
    const withUid = defaultPgliteSocketDir(required, { home: longHome, proc: fakeProcess({ uid: () => 1234 }) });
    const withoutUid = defaultPgliteSocketDir(required, { home: longHome, proc: fakeProcess({ uid: () => undefined }) });

    assert.match(withUid, /^\/tmp\/app-1234\/[0-9a-f]{8}$/);
    assert.match(withoutUid, /^\/tmp\/app-user\/[0-9a-f]{8}$/);
    assert.equal(withUid.slice(-8), withoutUid.slice(-8), "the per-data-dir key does not depend on the uid");
  });

  test("with no explicit home, the socket dir is under the process port's home", () => {
    const socketDir = defaultPgliteSocketDir({ dataDir: "/srv/site", runDirName: "app" }, { proc: fakeProcess() });
    assert.match(socketDir, /^\/home\/fake\/\.app\/run\/[0-9a-f]{8}$/);
  });

  test("without uids, a socket dir is never refused as another user's", () => {
    const socketDir = join(dir, "sockets");
    const lstatSync = (path: string) => Object.assign(realFs.lstatSync(path), { uid: 99_999 });

    assert.throws(
      () => ensurePrivateDir(socketDir, { privateParent: false, fs: { ...realFs, lstatSync }, proc: fakeProcess({ uid: () => 1000 }) }),
      /refusing socket dir/
    );
    ensurePrivateDir(socketDir, { privateParent: false, fs: { ...realFs, lstatSync }, proc: fakeProcess({ uid: () => undefined }) });
    assert.equal(fs.statSync(socketDir).mode & 0o777, 0o700);
  });
});

describe("startPgliteOwner through its ports", () => {
  // One data dir for the whole block: initdb takes seconds, and each test closes its owner.
  const root = fs.mkdtempSync(join(tmpdir(), "jini-owner-start-"));
  const dataDir = join(root, "data");
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const required = { dataDir, PGlite, lockFileName: "owner.pid", runDirName: "jinitest" };
  /** The real uid, so the scratch dirs this process creates count as its own. */
  const realUid = () => process.getuid?.();

  test("serves under the default socket dir of the process port's home, and is findable in-process until closed", async () => {
    const home = join(root, "home");
    const owner = await startPgliteOwner(required, { proc: fakeProcess({ homedir: () => home, uid: realUid }) });
    try {
      assert.equal(owner.socketDir, defaultPgliteSocketDir({ dataDir, runDirName: "jinitest" }, { home }));
      assert.equal(owner.socketPath, join(owner.socketDir, PGLITE_SOCKET_FILE));
      assert.equal(fs.statSync(owner.socketPath).isSocket(), true);
      assert.equal(runningPgliteOwner(relative(process.cwd(), dataDir)), owner, "found by an unresolved path too");
      assert.equal(runningPgliteOwner(join(root, "other")), undefined);
    } finally {
      const closing = owner.close();
      assert.equal(owner.close(), closing, "close is idempotent: one shutdown");
      await closing;
    }
    assert.equal(runningPgliteOwner(dataDir), undefined);
    assert.equal(fs.existsSync(owner.socketPath), false);
    assert.equal(fs.existsSync(join(dataDir, "owner.pid")), false);
  });

  test("a socket left group/world-accessible after chmod is refused, and the failed start leaves nothing held", async () => {
    const socketDir = join(root, "s1");
    const socketPath = join(socketDir, PGLITE_SOCKET_FILE);
    const statSync = (path: string) => (path === socketPath ? { ...realFs.statSync(path), mode: 0o140666 } : realFs.statSync(path));

    await assert.rejects(
      startPgliteOwner(required, { socketDir, fs: { ...realFs, statSync }, proc: fakeProcess({ uid: realUid }) }),
      (error: unknown) => error instanceof Error && error.message === `socket ${socketPath} is not owner-only`
    );
    assert.equal(fs.existsSync(socketPath), false);
    assert.equal(fs.existsSync(join(dataDir, "owner.pid")), false);
    assert.equal(runningPgliteOwner(dataDir), undefined);

    // Lock released and PGlite closed: the same data dir opens again at once.
    const owner = await startPgliteOwner(required, { socketDir });
    const [row] = await owner.runExclusive((db) => db.query<{ answer: number }>("SELECT 42 AS answer").then((result) => result.rows));
    assert.deepEqual(row, { answer: 42 });
    await owner.close();
  });
});

function fail(error: Error): never {
  throw error;
}
