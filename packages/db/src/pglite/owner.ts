import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { PGlite } from "@electric-sql/pglite";

import { PGLITE_SOCKET_FILE } from "../core/index.js";
import { PgliteSocketServer } from "./socket-server.js";
import type { PgliteClass } from "./types.js";

/**
 * @file The PGlite OWNER: the one process that opens a PGlite data dir and serves it on a private
 * Unix socket, so several processes share one database as ordinary Postgres clients
 * (`@jini-ai/db/kernel/postgres`'s `openPgliteSocketKernel`).
 *
 * The consumer passes its own `PGlite` class (this package never imports `@electric-sql/pglite`)
 * and names its lock file and run directory, so two apps never share either.
 *
 * - One owner per data dir: a pid lock file inside it. A second owner for the same dir — another
 *   process or this one — is refused; a lock left by a dead pid (kill -9) is taken over. Different
 *   data dirs run side by side.
 * - The socket lives in a short private runtime dir (0700, socket 0600), never the site dir: macOS
 *   caps a socket path at 103 bytes. Never TCP.
 * - Low-memory Postgres settings (~110-120 MB steady instead of ~245 MB). Expect a
 *   400-700 MB peak for ~10 s after open while V8 tiers up the WASM; that is not a leak.
 * - While serving, the owner reaches the database only through {@link PgliteOwner.runExclusive}
 *   (or as a socket client like everyone else).
 */

/** The low-memory settings added to `PGlite.defaultStartParams` (`initialMemory` stays at its 128 MB minimum). */
export const PGLITE_LOW_MEMORY_SETTINGS: readonly string[] = [
  "-c",
  "shared_buffers=16MB",
  "-c",
  "work_mem=1MB",
  "-c",
  "maintenance_work_mem=8MB",
  "-c",
  "wal_buffers=256kB",
  "-c",
  "max_connections=1",
];

/** `PGlite.defaultStartParams` plus {@link PGLITE_LOW_MEMORY_SETTINGS}, for the consumer's `PGlite` class. */
export function pgliteLowMemoryStartParams(pglite: Pick<PgliteClass, "defaultStartParams">): string[] {
  return [...pglite.defaultStartParams, ...PGLITE_LOW_MEMORY_SETTINGS];
}

/** `sun_path` is 104 bytes on macOS including the terminating NUL. */
const MAX_SOCKET_PATH_BYTES = 103;

export interface PgliteOwner {
  readonly socketPath: string;
  /** Directory to give a Postgres client as `host`. */
  readonly socketDir: string;
  /** Runs `fn` alone on the database: after any open client transaction, before the next client message. */
  runExclusive<T>(fn: (db: PGlite) => Promise<T>): Promise<T>;
  /** Stops serving (open client transactions roll back), closes PGlite, removes the socket, releases the lock. */
  close(): Promise<void>;
}

export class PgliteOwnerLockedError extends Error {
  constructor(
    readonly dataDir: string,
    /** Undefined while the other starter's lock has no pid in it yet. */
    readonly pid: number | undefined
  ) {
    super(
      `the PGlite data dir ${dataDir} is already open by ${pid === undefined ? "another process" : "process " + pid}; only one process may own it (connect to its socket instead)`
    );
    this.name = "PgliteOwnerLockedError";
  }
}

/**
 * The filesystem calls the owner makes on its lock file, socket dir and socket. Defaults to
 * `node:fs`; a test passes a fake to reach the races and errno paths a real filesystem cannot be
 * made to produce on demand (another starter renaming the lock mid-reap, EIO on a hard link).
 */
export interface OwnerFsPort {
  openSync(path: string, flags: "r"): number;
  fstatSync(fd: number): { ino: number; mtimeMs: number };
  readFileSync(fd: number, encoding: "utf8"): string;
  closeSync(fd: number): void;
  writeFileSync(path: string, data: string, options: { flag: "wx"; mode: number }): void;
  linkSync(existingPath: string, newPath: string): void;
  rmSync(path: string, options: { force: true }): void;
  renameSync(oldPath: string, newPath: string): void;
  mkdirSync(path: string, options: { recursive?: boolean; mode: number }): unknown;
  rmdirSync(path: string): void;
  statSync(path: string): { ino: number; mode: number };
  lstatSync(path: string): { isDirectory(): boolean; isSymbolicLink(): boolean; uid: number; mode: number };
  chmodSync(path: string, mode: number): void;
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
}

/** The process facts the owner reads: its own pid and uid, the home dir, the clock, and other pids' liveness. */
export interface OwnerProcessPort {
  readonly pid: number;
  /** Undefined where the platform has no uids (Windows). */
  uid(): number | undefined;
  homedir(): string;
  nowMs(): number;
  /** `process.kill(pid, 0)`: throws ESRCH for a dead pid, EPERM for another user's live one. */
  kill(pid: number, signal: 0): void;
}

/** Optional ports for the owner's filesystem and process access; both default to Node's own. */
export interface OwnerPorts {
  fs?: OwnerFsPort;
  proc?: OwnerProcessPort;
}

const nodeOwnerFs: OwnerFsPort = {
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
  writeFileSync,
  linkSync,
  rmSync,
  renameSync,
  mkdirSync,
  rmdirSync,
  statSync,
  lstatSync,
  chmodSync,
  existsSync,
  unlinkSync,
};

const nodeOwnerProcess: OwnerProcessPort = {
  pid: process.pid,
  uid: () => process.getuid?.(),
  homedir,
  nowMs: () => Date.now(),
  kill: (pid, signal) => {
    process.kill(pid, signal);
  },
};

/** The ports one call works with: the caller's, else Node's. */
interface OwnerIo {
  readonly fs: OwnerFsPort;
  readonly proc: OwnerProcessPort;
}

function ownerIo(ports: OwnerPorts): OwnerIo {
  return { fs: ports.fs ?? nodeOwnerFs, proc: ports.proc ?? nodeOwnerProcess };
}

/** The owners this process runs, by resolved data dir (a second owner in-process is refused by the lock). */
const runningOwners = new Map<string, PgliteOwner>();

/**
 * The owner THIS process runs for `dataDir`, if any: how an in-process caller (duplicating the site
 * it serves) reaches {@link PgliteOwner.runExclusive} without a second open.
 */
export function runningPgliteOwner(dataDir: string): PgliteOwner | undefined {
  return runningOwners.get(resolve(dataDir));
}

/** 8 hex characters naming a data dir, stable across runs so clients can find its socket. */
function dirKey(dataDir: string): string {
  return createHash("sha256").update(resolve(dataDir)).digest("hex").slice(0, 8);
}

/**
 * Where the owner of `dataDir` puts its socket: `~/.<runDirName>/run/<key>/`, or
 * `/tmp/<runDirName>-<uid>/<key>/` when the home path is too long for a socket.
 *
 * @param required.runDirName the consumer's own directory name (e.g. its app name), so two apps'
 *   sockets never share a directory. A plain name: no slash, no leading dot.
 */
export function defaultPgliteSocketDir(
  required: { dataDir: string; runDirName: string },
  optional: { home?: string; proc?: OwnerProcessPort } = {}
): string {
  assertPlainName(required.runDirName, "runDirName");
  const { proc } = ownerIo(optional);
  const key = dirKey(required.dataDir);
  const inHome = join(optional.home ?? proc.homedir(), `.${required.runDirName}`, "run", key);
  if (Buffer.byteLength(join(inHome, PGLITE_SOCKET_FILE)) <= MAX_SOCKET_PATH_BYTES) return inHome;
  return join(tmpSocketParent(required.runDirName, proc), key);
}

/** A consumer-chosen file or directory name: no separator, no leading dot, so it cannot escape its parent. */
function assertPlainName(name: string, what: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`${what} must be a plain name: '${name}'`);
}

/** The per-user parent of fallback socket dirs. Other users can write `/tmp`, so it is checked, never trusted. */
function tmpSocketParent(runDirName: string, proc: OwnerProcessPort): string {
  return join("/tmp", `${runDirName}-${proc.uid() ?? "user"}`);
}

/** Throws unless `socketPath` fits in `sun_path`. */
export function assertSocketPathFits(socketPath: string): void {
  const bytes = Buffer.byteLength(socketPath);
  if (bytes > MAX_SOCKET_PATH_BYTES) {
    throw new Error(`socket path is ${bytes} bytes; Unix sockets allow at most ${MAX_SOCKET_PATH_BYTES}: ${socketPath}`);
  }
}

function ownedByOtherUser(uid: number, proc: OwnerProcessPort): boolean {
  const own = proc.uid();
  return own !== undefined && uid !== own;
}

/**
 * Creates `dir` (and missing parents) owner-only, and refuses one that is a symlink or belongs to
 * another user (a pre-created `/tmp/<app>-<uid>` would otherwise let that user reach the socket).
 *
 * @param optional.privateParent also create-or-check `dir`'s parent, refusing one that is not a
 *   0700 non-symlink directory of ours (else its owner could swap `dir` for their own). Default:
 *   on when the parent sits directly in `/tmp` (the `/tmp/<app>-<uid>` fallback).
 */
export function ensurePrivateDir(dir: string, optional: { privateParent?: boolean } & OwnerPorts = {}): void {
  const io = ownerIo(optional);
  const parent = dirname(resolve(dir));
  if (optional.privateParent ?? dirname(parent) === "/tmp") {
    ensurePrivateParent({ parent, io });
  }
  io.fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = io.fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || ownedByOtherUser(stat.uid, io.proc)) {
    throw new Error(`refusing socket dir ${dir}: not a directory owned by this user`);
  }
  io.fs.chmodSync(dir, 0o700);
}

function ensurePrivateParent({ parent, io }: { parent: string; io: OwnerIo }, _optional = {}): void {
  try {
    io.fs.mkdirSync(parent, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = io.fs.lstatSync(parent);
  if (!stat.isDirectory() || ownedByOtherUser(stat.uid, io.proc) || (stat.mode & 0o077) !== 0) {
    throw new Error(`refusing socket parent ${parent}: not a 0700 directory owned by this user`);
  }
}

function pidAlive(pid: number, proc: OwnerProcessPort): boolean {
  try {
    proc.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the pid exists but belongs to another user — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parsePid(text: string): number | undefined {
  const pid = Number.parseInt(text.trim(), 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/** A lock with no pid in it (left by an older build between create and write) is stale only after this long. */
const EMPTY_LOCK_STALE_MS = 10_000;

interface LockSeen {
  ino: number;
  pid: number | undefined;
  mtimeMs: number;
}

/** The lock file's inode, pid and age, read through one descriptor; undefined when there is none. */
function inspectLock(lockPath: string, fs: OwnerFsPort): LockSeen | undefined {
  let fd: number;
  try {
    fd = fs.openSync(lockPath, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const { ino, mtimeMs } = fs.fstatSync(fd);
    return { ino, mtimeMs, pid: parsePid(fs.readFileSync(fd, "utf8")) };
  } finally {
    fs.closeSync(fd);
  }
}

/** Hard-links `existingPath` at `newPath`: false when `newPath` already exists; any other failure throws. */
function linkUnlessExists(existingPath: string, newPath: string, fs: OwnerFsPort): boolean {
  try {
    fs.linkSync(existingPath, newPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  return true;
}

/** Creates the lock with our pid already in it (write a temp file, hard-link it in): never visible empty. */
function tryCreateLock(lockPath: string, { fs, proc }: OwnerIo): boolean {
  const temp = `${lockPath}.${proc.pid}.${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temp, `${proc.pid}\n`, { flag: "wx", mode: 0o600 });
  try {
    return linkUnlessExists(temp, lockPath, fs);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/**
 * Removes the stale lock `seen`, and only it: the lock is renamed aside (atomic) and checked by
 * inode, so a lock another starter took over in the meantime is put back, not deleted.
 * @throws PgliteOwnerLockedError when the lock moved aside was a newer one.
 */
function moveStaleLock(dataDir: string, lockPath: string, seen: LockSeen, { fs, proc }: OwnerIo): void {
  const aside = `${lockPath}.stale.${proc.pid}.${randomBytes(4).toString("hex")}`;
  try {
    fs.renameSync(lockPath, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // another starter removed it
    throw error;
  }
  const moved = inspectLock(aside, fs);
  if (moved?.ino === seen.ino) {
    fs.rmSync(aside, { force: true });
    return;
  }
  try {
    linkUnlessExists(aside, lockPath, fs); // a lock another starter created since stays theirs
  } finally {
    fs.rmSync(aside, { force: true });
  }
  throw new PgliteOwnerLockedError(dataDir, moved?.pid);
}

/** Whether an observed lock is eligible for takeover; a fresh empty file remains contended. */
function isStaleLock(seen: LockSeen, proc: OwnerProcessPort): boolean {
  if (seen.pid === undefined) return proc.nowMs() - seen.mtimeMs > EMPTY_LOCK_STALE_MS;
  return !pidAlive(seen.pid, proc);
}

/**
 * Serializes removal of one observed inode, then rechecks it before renaming. Without this guard,
 * a delayed reaper can rename a newer live lock and let a third starter into that temporary gap.
 * @throws PgliteOwnerLockedError if another reaper holds the guard or the lock became live.
 * @complexity O(L) time/space for L bytes in the pid file, with a bounded number of filesystem calls.
 * @tradeoffs An interrupted reaper can leave this empty guard directory. Fail closed: an operator
 * must confirm no starter is running before removing it; automatic guard takeover would recreate
 * the same compare/rename race on the guard itself.
 */
function removeStaleLock(dataDir: string, lockPath: string, seen: LockSeen, io: OwnerIo): void {
  const guard = `${lockPath}.reaping-${seen.ino}`;
  try {
    io.fs.mkdirSync(guard, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new PgliteOwnerLockedError(dataDir, undefined);
    throw error;
  }
  try {
    const current = inspectLock(lockPath, io.fs);
    if (current?.ino !== seen.ino) return; // a previous reaper already removed this inode
    if (!isStaleLock(current, io.proc)) throw new PgliteOwnerLockedError(dataDir, current.pid);
    moveStaleLock(dataDir, lockPath, current, io);
  } finally {
    io.fs.rmdirSync(guard);
  }
}

/**
 * Takes the data dir's owner lock: created atomically with our pid in it. A lock whose pid is dead
 * (or that has had no pid for {@link EMPTY_LOCK_STALE_MS}) is taken over; a live one — including
 * this process's own — or a fresh one with no pid yet refuses. Returns an idempotent release
 * function that only removes the inode acquired by this call.
 * @complexity O(L) time/space for L bytes in a pid file; at most five acquisition attempts.
 */
export function acquireOwnerLock(required: { dataDir: string; lockFileName: string }, optional: OwnerPorts = {}): () => void {
  const { dataDir } = required;
  assertPlainName(required.lockFileName, "lockFileName");
  const io = ownerIo(optional);
  const { fs, proc } = io;
  const lockPath = join(dataDir, required.lockFileName);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (tryCreateLock(lockPath, io)) {
      const acquiredInode = fs.statSync(lockPath).ino;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = inspectLock(lockPath, fs);
        if (current?.ino === acquiredInode && current.pid === proc.pid) fs.rmSync(lockPath, { force: true });
      };
    }
    const seen = inspectLock(lockPath, fs);
    if (seen === undefined) continue; // released in between
    if (!isStaleLock(seen, proc)) throw new PgliteOwnerLockedError(dataDir, seen.pid);
    removeStaleLock(dataDir, lockPath, seen, io);
  }
  throw new Error(`could not take the PGlite owner lock ${lockPath}`);
}

/**
 * Opens `dataDir` (creating it on first use — initdb takes several seconds) and serves it on a
 * private Unix socket.
 *
 * @param required.PGlite the consumer's `PGlite` class (pin `@electric-sql/pglite` 0.5.8: the socket
 *   server's ReadyForQuery filter is written against it).
 * @param required.lockFileName the pid lock file kept inside `dataDir` (e.g. `myapp-owner.pid`).
 * @param required.runDirName names the default socket dir; see {@link defaultPgliteSocketDir}.
 * @param optional.socketDir default {@link defaultPgliteSocketDir}.
 * @param optional.idleInTransactionTimeoutMs default 30 s; see `PgliteSocketServer`.
 * @param optional.fs / optional.proc see {@link OwnerPorts}; default Node's own.
 * @throws PgliteOwnerLockedError when another live owner holds `dataDir`.
 */
export async function startPgliteOwner(
  required: { dataDir: string; PGlite: PgliteClass; lockFileName: string; runDirName: string },
  optional: {
    socketDir?: string;
    idleInTransactionTimeoutMs?: number;
    maxConnections?: number;
    log?: (message: string) => void;
  } & OwnerPorts = {}
): Promise<PgliteOwner> {
  const io = ownerIo(optional);
  const { fs } = io;
  const dataDir = resolve(required.dataDir);
  const socketDir = optional.socketDir ?? defaultPgliteSocketDir({ dataDir, runDirName: required.runDirName }, io);
  const socketPath = join(socketDir, PGLITE_SOCKET_FILE);
  assertSocketPathFits(socketPath);

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const releaseLock = acquireOwnerLock({ dataDir, lockFileName: required.lockFileName }, io);
  let db: PGlite | undefined;
  let server: PgliteSocketServer | undefined;
  // WASM initialization can await native work with no referenced Node handle. Until the socket
  // starts, keep this awaited boot alive; otherwise a CLI exits with only the owner lock written.
  // Release on both success and failure, so an idle or refused boot retains no extra timer.
  const startupRef = setInterval(() => {}, 1_000);
  try {
    ensurePrivateDir(socketDir, io);
    // We hold the lock, so a socket file here was left by a dead owner.
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    db = await required.PGlite.create({ dataDir, startParams: pgliteLowMemoryStartParams(required.PGlite) });
    server = new PgliteSocketServer({
      db,
      path: socketPath,
      idleInTransactionTimeoutMs: optional.idleInTransactionTimeoutMs,
      maxConnections: optional.maxConnections,
      log: optional.log,
    });
    await server.start();
    fs.chmodSync(socketPath, 0o600);
    if ((fs.statSync(socketPath).mode & 0o077) !== 0) throw new Error(`socket ${socketPath} is not owner-only`);
  } catch (error) {
    await server?.stop().catch(() => {});
    await db?.close().catch(() => {});
    fs.rmSync(socketPath, { force: true });
    releaseLock();
    throw error;
  } finally {
    clearInterval(startupRef);
  }

  const serving = server;
  const open = db;
  let closing: Promise<void> | undefined;
  const owner: PgliteOwner = {
    socketPath,
    socketDir,
    runExclusive: (fn) => serving.runExclusive(fn),
    close() {
      closing ??= (async () => {
        runningOwners.delete(dataDir);
        try {
          await serving.stop();
          await open.close();
        } finally {
          fs.rmSync(socketPath, { force: true });
          releaseLock();
        }
      })();
      return closing;
    },
  };
  runningOwners.set(dataDir, owner);
  return owner;
}
