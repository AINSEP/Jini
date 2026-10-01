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
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { PGlite } from "@electric-sql/pglite";

import { PGLITE_SOCKET_FILE } from "../kernel/index.js";
import { PgliteSocketServer } from "./socket-server.js";
import type { PgliteClass } from "./types.js";

/**
 * @file The PGlite OWNER: the one process that opens a PGlite data dir and serves it on a private
 * Unix socket, so several processes share one database as ordinary Postgres clients
 * (`@jini-ai/db/postgres`'s `openPgliteSocketKernel`).
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

export { PGLITE_SOCKET_FILE };
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
      `the PGlite data dir ${dataDir} is already open by ${pid === undefined ? "another process" : `process ${pid}`}; only one process may own it (connect to its socket instead)`
    );
    this.name = "PgliteOwnerLockedError";
  }
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
export function defaultPgliteSocketDir(required: { dataDir: string; runDirName: string }, optional: { home?: string } = {}): string {
  assertPlainName(required.runDirName, "runDirName");
  const key = dirKey(required.dataDir);
  const inHome = join(optional.home ?? homedir(), `.${required.runDirName}`, "run", key);
  if (Buffer.byteLength(join(inHome, PGLITE_SOCKET_FILE)) <= MAX_SOCKET_PATH_BYTES) return inHome;
  return join(tmpSocketParent(required.runDirName), key);
}

/** A consumer-chosen file or directory name: no separator, no leading dot, so it cannot escape its parent. */
function assertPlainName(name: string, what: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`${what} must be a plain name: '${name}'`);
}

/** The per-user parent of fallback socket dirs. Other users can write `/tmp`, so it is checked, never trusted. */
function tmpSocketParent(runDirName: string): string {
  return join("/tmp", `${runDirName}-${process.getuid?.() ?? "user"}`);
}

/** Throws unless `socketPath` fits in `sun_path`. */
export function assertSocketPathFits(socketPath: string): void {
  const bytes = Buffer.byteLength(socketPath);
  if (bytes > MAX_SOCKET_PATH_BYTES) {
    throw new Error(`socket path is ${bytes} bytes; Unix sockets allow at most ${MAX_SOCKET_PATH_BYTES}: ${socketPath}`);
  }
}

function ownedByOtherUser(uid: number): boolean {
  const own = process.getuid?.();
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
export function ensurePrivateDir(dir: string, optional: { privateParent?: boolean } = {}): void {
  const parent = dirname(resolve(dir));
  if (optional.privateParent ?? dirname(parent) === "/tmp") {
    try {
      mkdirSync(parent, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || ownedByOtherUser(stat.uid) || (stat.mode & 0o077) !== 0) {
      throw new Error(`refusing socket parent ${parent}: not a 0700 directory owned by this user`);
    }
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || ownedByOtherUser(stat.uid)) {
    throw new Error(`refusing socket dir ${dir}: not a directory owned by this user`);
  }
  chmodSync(dir, 0o700);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
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

function readLockPid(lockPath: string): number | undefined {
  try {
    return parsePid(readFileSync(lockPath, "utf8"));
  } catch {
    return undefined;
  }
}

/** A lock with no pid in it (left by an older build between create and write) is stale only after this long. */
const EMPTY_LOCK_STALE_MS = 10_000;

interface LockSeen {
  ino: number;
  pid: number | undefined;
  mtimeMs: number;
}

/** The lock file's inode, pid and age, read through one descriptor; undefined when there is none. */
function inspectLock(lockPath: string): LockSeen | undefined {
  let fd: number;
  try {
    fd = openSync(lockPath, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const { ino, mtimeMs } = fstatSync(fd);
    return { ino, mtimeMs, pid: parsePid(readFileSync(fd, "utf8")) };
  } finally {
    closeSync(fd);
  }
}

/** Creates the lock with our pid already in it (write a temp file, hard-link it in): never visible empty. */
function tryCreateLock(lockPath: string): boolean {
  const temp = `${lockPath}.${process.pid}.${randomBytes(4).toString("hex")}`;
  writeFileSync(temp, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
  try {
    linkSync(temp, lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Removes the stale lock `seen`, and only it: the lock is renamed aside (atomic) and checked by
 * inode, so a lock another starter took over in the meantime is put back, not deleted.
 * @throws PgliteOwnerLockedError when the lock moved aside was a newer one.
 */
function removeStaleLock(dataDir: string, lockPath: string, seen: LockSeen): void {
  const aside = `${lockPath}.stale.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    renameSync(lockPath, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // another starter removed it
    throw error;
  }
  const moved = inspectLock(aside);
  if (moved?.ino === seen.ino) {
    rmSync(aside, { force: true });
    return;
  }
  try {
    linkSync(aside, lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    rmSync(aside, { force: true });
  }
  throw new PgliteOwnerLockedError(dataDir, moved?.pid);
}

/**
 * Takes the data dir's owner lock: created atomically with our pid in it. A lock whose pid is dead
 * (or that has had no pid for {@link EMPTY_LOCK_STALE_MS}) is taken over; a live one — including
 * this process's own — or a fresh one with no pid yet refuses. Returns the release function.
 */
export function acquireOwnerLock(required: { dataDir: string; lockFileName: string }): () => void {
  const { dataDir } = required;
  assertPlainName(required.lockFileName, "lockFileName");
  const lockPath = join(dataDir, required.lockFileName);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (tryCreateLock(lockPath)) {
      return () => {
        if (readLockPid(lockPath) === process.pid) rmSync(lockPath, { force: true });
      };
    }
    const seen = inspectLock(lockPath);
    if (seen === undefined) continue; // released in between
    const stale =
      seen.pid === undefined ? Date.now() - seen.mtimeMs > EMPTY_LOCK_STALE_MS : !pidAlive(seen.pid);
    if (!stale) throw new PgliteOwnerLockedError(dataDir, seen.pid);
    removeStaleLock(dataDir, lockPath, seen);
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
 * @throws PgliteOwnerLockedError when another live owner holds `dataDir`.
 */
export async function startPgliteOwner(
  required: { dataDir: string; PGlite: PgliteClass; lockFileName: string; runDirName: string },
  optional: {
    socketDir?: string;
    idleInTransactionTimeoutMs?: number;
    maxConnections?: number;
    log?: (message: string) => void;
  } = {}
): Promise<PgliteOwner> {
  const dataDir = resolve(required.dataDir);
  const socketDir = optional.socketDir ?? defaultPgliteSocketDir({ dataDir, runDirName: required.runDirName });
  const socketPath = join(socketDir, PGLITE_SOCKET_FILE);
  assertSocketPathFits(socketPath);

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const releaseLock = acquireOwnerLock({ dataDir, lockFileName: required.lockFileName });
  let db: PGlite | undefined;
  let server: PgliteSocketServer | undefined;
  try {
    ensurePrivateDir(socketDir);
    // We hold the lock, so a socket file here was left by a dead owner.
    if (existsSync(socketPath)) unlinkSync(socketPath);
    db = await required.PGlite.create({ dataDir, startParams: pgliteLowMemoryStartParams(required.PGlite) });
    server = new PgliteSocketServer({
      db,
      path: socketPath,
      idleInTransactionTimeoutMs: optional.idleInTransactionTimeoutMs,
      maxConnections: optional.maxConnections,
      log: optional.log,
    });
    await server.start();
    chmodSync(socketPath, 0o600);
    if ((statSync(socketPath).mode & 0o077) !== 0) throw new Error(`socket ${socketPath} is not owner-only`);
  } catch (error) {
    await server?.stop().catch(() => {});
    await db?.close().catch(() => {});
    rmSync(socketPath, { force: true });
    releaseLock();
    throw error;
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
          rmSync(socketPath, { force: true });
          releaseLock();
        }
      })();
      return closing;
    },
  };
  runningOwners.set(dataDir, owner);
  return owner;
}
