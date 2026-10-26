/** Site-plugin graph isolation. A fresh filesystem identity covers relative ESM, dynamic imports
 * and CommonJS requires together; a query on the entry alone covers only that entry.
 * Snapshots live outside discovery and remain available for late dynamic imports until shutdown.
 */
import * as nativeFs from "node:fs/promises";
import { hostname } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { snapshotSitePluginPackage } from "./install.js";
import type { PluginManifest } from "../manifest.js";
import { PLUGIN_MANIFEST_FILENAMES } from "../plugin-format.js";
import { isPluginRelativePath } from "../browser-providers.js";

export class PluginSnapshotIntegrityError extends Error {}

/** Lifecycle failures have a stable category without exposing package paths or file contents. */
export type PluginSnapshotLifecycleErrorCode = "SNAPSHOTS_CLOSED" | "SNAPSHOT_ROOT_MISMATCH" | "SNAPSHOT_CLEANUP_FAILED";
export class PluginSnapshotLifecycleError extends Error {
  readonly code: PluginSnapshotLifecycleErrorCode;
  constructor({ code }: { code: PluginSnapshotLifecycleErrorCode }, options: { cause?: unknown } = {}) {
    super(code, options);
    this.code = code;
    this.name = "PluginSnapshotLifecycleError";
  }
}

type SnapshotStat = Pick<import("node:fs").Stats, "isDirectory" | "isSymbolicLink" | "mtimeMs" | "ino" | "dev">;
/** Native-shaped effects keep filesystem failures and process races directly testable. */
export interface PluginSnapshotFilesystem {
  mkdir(directory: string, options: { recursive: true; mode?: number }): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  lstat(directory: string): Promise<SnapshotStat>;
  readdir(directory: string): Promise<string[]>;
  rm(directory: string, options: { recursive: true; force: true }): Promise<void>;
}
export interface PluginSnapshotProcess {
  readonly pid: number;
  readonly startedAtMs: number;
  readonly hostname: string;
  /** Unknown liveness must return true; only a definitely absent local process is dead. */
  isAlive(required: { pid: number }): boolean;
}
type SnapshotFiles = ReadonlyMap<string, Uint8Array>;
type SnapshotWriteOptions = { writeSnapshotFile?: typeof nativeFs.writeFile };
/** One host retains all its loads, including replaced versions, until its users have stopped. */
export interface PluginModuleSnapshotLifecycle {
  readonly runtimeRoot: string;
  readonly ready: Promise<void>;
  createSnapshot(required: { files: SnapshotFiles }, optional?: SnapshotWriteOptions): Promise<string>;
  dispose(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}

/** Signal zero never kills a process. EPERM and unfamiliar failures retain the snapshot. */
function nativeSnapshotProcess(): PluginSnapshotProcess {
  return { pid: process.pid, startedAtMs: Date.now() - process.uptime() * 1000, hostname: hostname(),
    isAlive: ({ pid }) => {
      try { process.kill(pid, 0); return true; }
      catch (error) { return errorCode(error) !== "ESRCH"; }
    } };
}

/** Inspect only Node's stable error code; opaque errors never authorize removal. */
function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

/** Runtime roots are private directories, never links into another tree. */
async function prepareRuntimeRoot({ runtimeRoot, fs }: { runtimeRoot: string; fs: PluginSnapshotFilesystem }): Promise<void> {
  await fs.mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(runtimeRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new PluginSnapshotIntegrityError("Runtime snapshot root must not be a link.");
}

/** Shared copy owner; removes partial output and propagates copy/cleanup failures.
 * @complexity O(total package bytes) time and O(1) additional space beyond the supplied bytes.
 */
async function writeRuntimeSnapshot(
  { snapshotRoot, files, fs }: { snapshotRoot: string; files: SnapshotFiles; fs: PluginSnapshotFilesystem },
  { writeSnapshotFile = nativeFs.writeFile }: SnapshotWriteOptions = {},
): Promise<string> {
  try {
    for (const [key, bytes] of files) {
      if (!isPluginRelativePath({ path: key })) throw new PluginSnapshotIntegrityError("Snapshot file must remain inside its package.");
      const destination = path.join(snapshotRoot, key);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await writeSnapshotFile(destination, bytes, { flag: "wx", mode: 0o400 });
    }
    return path.join(snapshotRoot, "server/index.mjs");
  } catch (error) {
    await fs.rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Missing entries can race another boot's reap; every other filesystem failure stays visible. */
async function inspectSnapshot({ snapshotRoot, fs }: { snapshotRoot: string; fs: PluginSnapshotFilesystem }): Promise<SnapshotStat | undefined> {
  try { return await fs.lstat(snapshotRoot); }
  catch (error) { if (errorCode(error) !== "ENOENT") throw error; return undefined; }
}

/** Recognize only atomic local ownership names; legacy/foreign snapshots remain unowned. */
function snapshotOwnerPid({ name, ownerPrefix }: { name: string; ownerPrefix: string }): number | undefined {
  if (!name.startsWith(ownerPrefix)) return undefined;
  const match = /^(\d+)-[A-Za-z0-9]+$/.exec(name.slice(ownerPrefix.length));
  if (!match) return undefined;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  return pid;
}

/** Strict age comparison preserves snapshots created during this process and every link. */
function isOlderSnapshot(info: SnapshotStat | undefined, startedAtMs: number): info is SnapshotStat {
  return info !== undefined && info.isDirectory() && !info.isSymbolicLink() && info.mtimeMs < startedAtMs;
}

/** A changed directory identity or timestamp invalidates the first observation. */
function isUnchangedSnapshot(observed: SnapshotStat, current: SnapshotStat | undefined): boolean {
  return current !== undefined && current.ino === observed.ino && current.dev === observed.dev && current.mtimeMs === observed.mtimeMs;
}

/** Recheck identity and liveness immediately before removal. Legacy/foreign names are unowned.
 * @complexity O(1) metadata/probe work plus the removed snapshot's filesystem tree.
 */
async function reapSnapshot({ snapshotRoot, name, ownerPrefix, fs, proc }: {
  snapshotRoot: string; name: string; ownerPrefix: string; fs: PluginSnapshotFilesystem; proc: PluginSnapshotProcess;
}): Promise<void> {
  const pid = snapshotOwnerPid({ name, ownerPrefix });
  if (pid === undefined) return;
  const observed = await inspectSnapshot({ snapshotRoot, fs });
  if (!isOlderSnapshot(observed, proc.startedAtMs)) return;
  if (proc.isAlive({ pid })) return;
  const current = await inspectSnapshot({ snapshotRoot, fs });
  if (!isUnchangedSnapshot(observed, current)) return;
  if (proc.isAlive({ pid })) return;
  await fs.rm(snapshotRoot, { recursive: true, force: true });
}

/** A sequential startup pass avoids an unbounded burst of process probes and filesystem calls.
 * @complexity O(n + deleted bytes) time, O(n) names for n runtime-root entries.
 */
async function reapRuntimeSnapshots(required: { runtimeRoot: string; ownerPrefix: string; fs: PluginSnapshotFilesystem; proc: PluginSnapshotProcess }): Promise<void> {
  await prepareRuntimeRoot(required);
  for (const name of await required.fs.readdir(required.runtimeRoot)) {
    await reapSnapshot({ ...required, name, snapshotRoot: path.join(required.runtimeRoot, name) });
  }
}

/** Drains admitted writes, then attempts every owned removal even if one fails.
 * @complexity O(total owned snapshot bytes) time; O(pending writes) drain results.
 */
async function disposeRuntimeSnapshots({ runtimeRoot, ready, pending, owned, fs }: {
  runtimeRoot: string; ready: Promise<void>; pending: Set<Promise<string>>; owned: Set<string>; fs: PluginSnapshotFilesystem;
}): Promise<void> {
  await ready;
  await Promise.allSettled([...pending]);
  await prepareRuntimeRoot({ runtimeRoot, fs });
  let failure: { cause: unknown } | undefined;
  // Shutdown should not fan out one recursive filesystem operation per historical load.
  for (const snapshotRoot of owned) {
    try { await fs.rm(snapshotRoot, { recursive: true, force: true }); }
    catch (error) { failure ??= { cause: error }; }
  }
  if (failure) throw new PluginSnapshotLifecycleError({ code: "SNAPSHOT_CLEANUP_FAILED" }, failure);
  owned.clear();
}

/** Owns runtime copies for one host. Await `ready` at boot and `dispose` after plugin/provider
 * teardown. Names record host/PID ownership atomically with directory creation, including crashes
 * during a copy. Only older, definitely dead local owners are reaped. Unknown legacy ownership,
 * foreign hosts and recycled/live PIDs are retained because late imports may still need the files.
 * @throws Filesystem errors during boot/copy; PluginSnapshotLifecycleError after closure or failed cleanup.
 * @complexity Startup O(runtime entries); disposal O(owned snapshot bytes); state O(host loads).
 * @example const snapshots = createPluginModuleSnapshotLifecycle({ runtimeRoot }); await snapshots.ready;
 */
export function createPluginModuleSnapshotLifecycle(
  { runtimeRoot }: { runtimeRoot: string },
  { fs = nativeFs, process: proc = nativeSnapshotProcess() }: { fs?: PluginSnapshotFilesystem; process?: PluginSnapshotProcess } = {},
): PluginModuleSnapshotLifecycle {
  const root = path.resolve(runtimeRoot);
  const hostId = createHash("sha256").update(proc.hostname).digest("hex").slice(0, 16);
  const ownerPrefix = `load-${hostId}-`;
  const owned = new Set<string>();
  const pending = new Set<Promise<string>>();
  const ready = reapRuntimeSnapshots({ runtimeRoot: root, ownerPrefix, fs, proc });
  // Composition may await other boot work before observing ready; preserve its rejection without
  // turning an early filesystem failure into an unhandled process-level rejection meanwhile.
  void ready.catch(() => undefined);
  let closed = false;
  let disposal: Promise<void> | undefined;

  /** Track the whole copy so shutdown cannot remove files under an admitted writer. */
  function createSnapshot({ files }: { files: SnapshotFiles }, options: SnapshotWriteOptions = {}): Promise<string> {
    if (closed) return Promise.reject(new PluginSnapshotLifecycleError({ code: "SNAPSHOTS_CLOSED" }));
    const operation = copySnapshot({ files }, options);
    pending.add(operation);
    void operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  }

  /** Ownership is recorded before writing; a failed cleanup remains retryable at the next boot. */
  async function copySnapshot({ files }: { files: SnapshotFiles }, options: SnapshotWriteOptions): Promise<string> {
    await ready;
    await prepareRuntimeRoot({ runtimeRoot: root, fs });
    const snapshotRoot = await fs.mkdtemp(path.join(root, `${ownerPrefix}${proc.pid}-`));
    owned.add(snapshotRoot);
    return writeRuntimeSnapshot({ snapshotRoot, files, fs }, options);
  }

  return { runtimeRoot: root, ready, createSnapshot,
    /** Idempotent closure rejects new loads immediately and waits for all admitted writes. */
    dispose(_required, _optional = {}) {
      closed = true;
      disposal ??= disposeRuntimeSnapshots({ runtimeRoot: root, ready, pending, owned, fs });
      return disposal;
    } };
}

/**
 * Copies a site plugin's verified package into a fresh, read-only runtime snapshot and returns the
 * snapshot's server entry. Every file must match the manifest's integrity map, and every listed file
 * must exist; a failed copy removes the half-written snapshot.
 * @param required.pluginRoot The installed package directory.
 * @param required.manifest The installed manifest whose `integrity` map is enforced.
 * @param optional.writeSnapshotFile File writer for the snapshot; defaults to `fs.writeFile`.
 * @param optional.lifecycle Host owner retaining copies until its shutdown; must match this package's runtime root.
 * @throws {PluginSnapshotIntegrityError} On a changed/missing file or a linked runtime root.
 * @complexity O(total package bytes).
 */
export async function snapshotPluginModuleGraph(
  required: { pluginRoot: string; manifest: PluginManifest },
  optional: SnapshotWriteOptions & { lifecycle?: PluginModuleSnapshotLifecycle } = {},
): Promise<string> {
  const files = await snapshotSitePluginPackage({ sourceDir: required.pluginRoot });
  verifyPluginSnapshotIntegrity({ files, integrity: required.manifest.integrity });
  const cacheRoot = path.dirname(path.dirname(required.pluginRoot)) + "-runtime";
  if (optional.lifecycle) {
    if (optional.lifecycle.runtimeRoot !== path.resolve(cacheRoot)) throw new PluginSnapshotLifecycleError({ code: "SNAPSHOT_ROOT_MISMATCH" });
    return optional.lifecycle.createSnapshot({ files }, optional);
  }
  await prepareRuntimeRoot({ runtimeRoot: cacheRoot, fs: nativeFs });
  const snapshotRoot = await nativeFs.mkdtemp(path.join(cacheRoot, "load-"));
  return writeRuntimeSnapshot({ snapshotRoot, files, fs: nativeFs }, optional);
}

/** The package integrity owner, shared by executable snapshots and retained browser assets.
 * @throws {PluginSnapshotIntegrityError} A retained file differs from a reviewed digest or is missing.
 */
export function verifyPluginSnapshotIntegrity(
  required: { files: ReadonlyMap<string, Uint8Array>; integrity: Readonly<Record<string, string>> },
  _options: Record<string, never> = {},
): void {
  const { files, integrity } = required;
  for (const [key, bytes] of files) {
    if (PLUGIN_MANIFEST_FILENAMES.includes(key)) continue; // legacy alias
    const digest = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
    if (integrity[key] !== digest) throw new PluginSnapshotIntegrityError("Package changed before loading.");
  }
  for (const key of Object.keys(integrity)) {
    if (!files.has(key)) throw new PluginSnapshotIntegrityError("Package file disappeared before loading.");
  }
}
