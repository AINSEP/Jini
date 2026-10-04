/**
 * Atomic writes prevent tears but not lost updates between shared read-modify-writes. Plain readers
 * need no lock. Deliberately non-reentrant: nesting times out rather than silently sharing an
 * exclusive section; compose store operations from unlocked internals instead.
 * Kernel exclusive create chooses the winner. A unique token AND inode identify that owner;
 * pid alone cannot distinguish a later owner after a stale break. Signal-zero liveness probes
 * treat only ESRCH as death: permission failure must never authorize evicting a live process.
 * Stale removal rechecks inode, bytes and mtime immediately before unlink. There is still a residual
 * check-to-unlink race on filesystems without conditional unlink; rename/restore chains create wider
 * multi-process races and are deliberately avoided. Atomic file replacement independently prevents
 * torn content. Hosts whose operations can legitimately exceed the stale budget use staleMs: Infinity.
 */
import fs from "node:fs";
import * as asyncFs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname as nodeHostname } from "node:os";
import path from "node:path";
import { createSystemClock, type Clock } from "@jini-ai/core/primitives";
import { defaultPlatformMessages, type PlatformMessages } from "../messages.js";

export const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
export const DEFAULT_LOCK_STALE_AFTER_MS = 10_000;
export interface FileLockHolder { readonly pid: number; readonly hostname: string; readonly token: string; readonly acquiredAt: string; }
export interface HeldFileLock { readonly lockPath: string; assertHeld(required: Record<string, never>): Promise<void>; }
export interface HeldFileLockSync { readonly lockPath: string; assertHeld(required: Record<string, never>): void; }
export type FileLockSyncFilesystem = Pick<typeof fs, "mkdirSync" | "openSync" | "writeSync" | "fstatSync" | "readFileSync" | "statSync" | "closeSync" | "rmSync">;
export type FileLockAsyncFilesystem = Pick<typeof asyncFs, "mkdir" | "open" | "stat" | "rm">;
export interface FileLockOptions {
  timeoutMs?: number;
  /** Infinity disables age stealing; dead local owners remain reclaimable. */
  staleMs?: number;
  pollMs?: number;
  clock?: Clock;
  /** Times the wait budget (start and timeout check). Defaults to `clock.nowMs`; hosts with a
   * monotonic source pass it so a wall-clock jump can neither end nor stretch the wait. Stale age
   * stays on `clock.nowMs`, because lock-file mtimes are wall-clock times. */
  monotonicMs?: () => number;
  sleep?: (required: { durationMs: number }) => void | Promise<void>;
  process?: { pid: number; isAlive(required: { pid: number }): boolean };
  token?: () => string;
  hostname?: () => string;
  onStaleLockRemoved?: (required: { holder: FileLockHolder | undefined }) => void;
  createParent?: boolean;
  format?: "json" | "token";
  /** Host stores keep their existing user-facing timeout copy. */
  timeoutMessage?: (required: { lockPath: string; waitMs: number }) => string;
  messages?: PlatformMessages;
  /** Durable stores historically ignored release failures to avoid masking their critical section. */
  suppressReleaseErrors?: boolean;
}
export class FileLockTimeoutError extends Error {
  readonly lockPath: string;
  readonly holder: FileLockHolder | undefined;
  readonly waitedMs: number;
  constructor(required: { lockPath: string; holder: FileLockHolder | undefined; waitedMs: number }, optional: { message?: string; messages?: PlatformMessages } = {}) {
    super(optional.message ?? (optional.messages ?? defaultPlatformMessages).fileLockTimeout({ waitedMs: required.waitedMs }));
    this.name = "FileLockTimeoutError"; this.lockPath = required.lockPath; this.holder = required.holder; this.waitedMs = required.waitedMs;
  }
}
export class FileLockLostError extends Error {
  readonly lockPath: string;
  constructor({ lockPath }: { lockPath: string }, { messages = defaultPlatformMessages }: { messages?: PlatformMessages } = {}) {
    super(messages.fileLockLost()); this.name = "FileLockLostError"; this.lockPath = lockPath;
  }
}
/** Platform-specific contention classification retains the Windows exclusive-open behavior. */
export function isContendedLockError({ code, platform }: { code: string | undefined; platform: NodeJS.Platform }): boolean {
  return code === "EEXIST" || (code === "EPERM" && platform === "win32");
}
function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function validPid(pid: unknown): pid is number { return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0; }
function parseHolder(raw: string): FileLockHolder | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("pid" in value) || !validPid(value.pid) || !("hostname" in value) || typeof value.hostname !== "string" || !("token" in value) || typeof value.token !== "string" || !("acquiredAt" in value) || typeof value.acquiredAt !== "string") return undefined;
    return { pid: value.pid, hostname: value.hostname, token: value.token, acquiredAt: value.acquiredAt };
  } catch { return undefined; }
}
interface LockSnapshot { raw: string; holder: FileLockHolder | undefined; mtimeMs: number; ino: number; dev: number; }
/** One pure stale decision serves both I/O adapters. Invalid/foreign pids have unknown liveness,
 * never false liveness; otherwise kill(0/negative, 0) would address a process group. */
export function isLockStale(required: { nowMs: number; mtimeMs: number; staleMs: number; ownerAlive: boolean | undefined; observedInode: number; currentInode: number; observedDevice: number; currentDevice: number }): boolean {
  return (required.ownerAlive === false || required.nowMs - required.mtimeMs > required.staleMs) && required.observedInode === required.currentInode && required.observedDevice === required.currentDevice;
}
function settings(options: FileLockOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_AFTER_MS, pollMs = options.pollMs ?? 10;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || (!Number.isSafeInteger(staleMs) && staleMs !== Infinity) || staleMs <= 0 || !Number.isSafeInteger(pollMs) || pollMs <= 0) throw new RangeError((options.messages ?? defaultPlatformMessages).fileLockIntervalsInvalid());
  const processPort = options.process ?? { pid: process.pid, isAlive: ({ pid }: { pid: number }) => { try { process.kill(pid, 0); return true; } catch (error) { return errorCode(error) !== "ESRCH"; } } };
  const clock = options.clock ?? createSystemClock();
  const monotonicMs = options.monotonicMs ?? (() => clock.nowMs());
  return { timeoutMs, staleMs, pollMs, processPort, clock, monotonicMs, hostname: (options.hostname ?? nodeHostname)(), token: (options.token ?? randomUUID)() };
}
type Settings = ReturnType<typeof settings>;
function ownership(s: Settings, options: FileLockOptions): string {
  return options.format === "token" ? `${s.processPort.pid}:${s.token}` : JSON.stringify({ pid: s.processPort.pid, hostname: s.hostname, token: s.token, acquiredAt: new Date(s.clock.nowMs()).toISOString() });
}
function ownerAlive(snapshot: LockSnapshot, s: Settings): boolean | undefined {
  const holder = snapshot.holder;
  if (holder) return holder.hostname === s.hostname ? s.processPort.isAlive({ pid: holder.pid }) : undefined;
  // Legacy synchronous stores wrote pid:random rather than JSON. Malformed pids remain unknown.
  if (!/^\d+:/.test(snapshot.raw)) return undefined;
  const pid = Number(snapshot.raw.split(":", 1)[0]);
  return validPid(pid) ? s.processPort.isAlive({ pid }) : undefined;
}
function unchanged(a: LockSnapshot, b: LockSnapshot): boolean { return a.ino === b.ino && a.dev === b.dev && a.raw === b.raw && a.mtimeMs === b.mtimeMs; }
function stale(observed: LockSnapshot, current: LockSnapshot, s: Settings): boolean {
  return unchanged(observed, current) && isLockStale({ nowMs: s.clock.nowMs(), mtimeMs: observed.mtimeMs, staleMs: s.staleMs, ownerAlive: ownerAlive(current, s), observedInode: observed.ino, currentInode: current.ino, observedDevice: observed.dev, currentDevice: current.dev });
}
function checkTimeout(lockPath: string, holder: FileLockHolder | undefined, start: number, s: Settings, options: FileLockOptions): void {
  const waitedMs = s.monotonicMs() - start;
  if (waitedMs >= s.timeoutMs) {
    const message = options.timeoutMessage?.({ lockPath, waitMs: s.timeoutMs });
    throw new FileLockTimeoutError({ lockPath, holder, waitedMs }, { ...(options.messages ? { messages: options.messages } : {}), ...(message !== undefined ? { message } : {}) });
  }
}
function inspectSync(lockPath: string, filesystem: FileLockSyncFilesystem): LockSnapshot | undefined {
  let descriptor: number;
  try { descriptor = filesystem.openSync(lockPath, "r"); } catch (error) { if (errorCode(error) === "ENOENT" || isContendedLockError({ code: errorCode(error), platform: process.platform })) return undefined; throw error; }
  try {
    const info = filesystem.fstatSync(descriptor), raw = filesystem.readFileSync(descriptor, "utf8");
    return { raw, holder: parseHolder(raw), mtimeMs: info.mtimeMs, ino: info.ino, dev: info.dev };
  } finally { filesystem.closeSync(descriptor); }
}
async function inspectAsync(lockPath: string, filesystem: FileLockAsyncFilesystem): Promise<LockSnapshot | undefined> {
  let handle: Awaited<ReturnType<FileLockAsyncFilesystem["open"]>>;
  try { handle = await filesystem.open(lockPath, "r"); } catch (error) { if (errorCode(error) === "ENOENT" || isContendedLockError({ code: errorCode(error), platform: process.platform })) return undefined; throw error; }
  try {
    const info = await handle.stat(), raw = await handle.readFile("utf8");
    return { raw, holder: parseHolder(raw), mtimeMs: info.mtimeMs, ino: info.ino, dev: info.dev };
  } finally { await handle.close(); }
}
const waitCell = new Int32Array(new SharedArrayBuffer(4));
/** Synchronous read-modify-write guard. Durable stores pass their former 5s/30s/10ms values.
 * Release never evicts a later owner, even when the old owner reaches finally after a steal. */
export function withFileLockSync<T>(
  { lockPath, run }: { lockPath: string; run: (lock: HeldFileLockSync) => T },
  options: Omit<FileLockOptions, "sleep"> & { sleep?: (required: { durationMs: number }) => void; filesystem?: FileLockSyncFilesystem } = {},
): T {
  const filesystem = options.filesystem ?? fs, s = settings(options), start = s.monotonicMs(), raw = ownership(s, options);
  if (options.createParent) filesystem.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let identity: { ino: number; dev: number };
  for (;;) {
    let descriptor: number | undefined;
    try { descriptor = filesystem.openSync(lockPath, "wx", 0o600); }
    catch (error) { if (!isContendedLockError({ code: errorCode(error), platform: process.platform })) throw error; }
    if (descriptor !== undefined) {
      try {
        identity = filesystem.fstatSync(descriptor);
        // An unidentifiable lock would wedge writers until stale timeout; clean a failed creation
        // only while its inode still matches, rather than deleting a replacement owner.
        const bytes = Buffer.from(raw); let offset = 0;
        while (offset < bytes.length) { const written = filesystem.writeSync(descriptor, bytes, offset, bytes.length - offset); if (written === 0) throw new Error((options.messages ?? defaultPlatformMessages).fileLockWriteNoProgress()); offset += written; }
      } catch (error) {
        try { const created = filesystem.fstatSync(descriptor), current = filesystem.statSync(lockPath); if (created.ino === current.ino && created.dev === current.dev) filesystem.rmSync(lockPath, { force: true }); } catch { /* preserve creation failure */ }
        throw error;
      } finally { filesystem.closeSync(descriptor); }
      break;
    }
    const observed = inspectSync(lockPath, filesystem);
    if (observed) {
      const current = inspectSync(lockPath, filesystem);
      if (current && stale(observed, current, s)) {
        const last = filesystem.statSync(lockPath, { throwIfNoEntry: false });
        if (last && last.ino === current.ino && last.dev === current.dev && last.mtimeMs === current.mtimeMs) {
          try { filesystem.rmSync(lockPath, { force: true }); options.onStaleLockRemoved?.({ holder: current.holder }); } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
        }
      }
    }
    // Every contention path, including repeated stale breaks and release races, is bounded.
    checkTimeout(lockPath, observed?.holder, start, s, options);
    (options.sleep ?? (({ durationMs }) => { Atomics.wait(waitCell, 0, 0, durationMs); }))({ durationMs: s.pollMs });
  }
  const held = () => { const current = inspectSync(lockPath, filesystem); return current && current.raw === raw && current.ino === identity.ino && current.dev === identity.dev; };
  let completed = false;
  try {
    const value = run({ lockPath, assertHeld: (_required) => { if (!held()) throw new FileLockLostError({ lockPath }, options.messages ? { messages: options.messages } : {}); } });
    completed = true; return value;
  } finally {
    try { if (held()) filesystem.rmSync(lockPath, { force: true }); }
    // A failed critical section keeps its original error; durable hosts also suppress release-only failures.
    catch (error) { if (completed && !options.suppressReleaseErrors && errorCode(error) !== "ENOENT") throw error; }
  }
}
/** Async adapter of the same stale and ownership policy; polling yields to other writers. */
export async function withFileLock<T>(
  { lockPath, run }: { lockPath: string; run: (lock: HeldFileLock) => Promise<T> | T },
  options: FileLockOptions & { filesystem?: FileLockAsyncFilesystem } = {},
): Promise<T> {
  const filesystem = options.filesystem ?? asyncFs, s = settings(options), start = s.monotonicMs(), raw = ownership(s, options);
  if (options.createParent) await filesystem.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let identity: { ino: number; dev: number };
  for (;;) {
    let handle: Awaited<ReturnType<FileLockAsyncFilesystem["open"]>> | undefined;
    try { handle = await filesystem.open(lockPath, "wx", 0o600); }
    catch (error) { if (!isContendedLockError({ code: errorCode(error), platform: process.platform })) throw error; }
    if (handle) {
      try { identity = await handle.stat(); await handle.writeFile(raw, "utf8"); }
      catch (error) {
        try { const created = await handle.stat(), current = await inspectAsync(lockPath, filesystem); if (current && created.ino === current.ino && created.dev === current.dev) await filesystem.rm(lockPath, { force: true }); } catch { /* preserve creation failure */ }
        throw error;
      } finally { await handle.close(); }
      break;
    }
    const observed = await inspectAsync(lockPath, filesystem);
    if (observed) {
      const current = await inspectAsync(lockPath, filesystem);
      if (current && stale(observed, current, s)) {
        const last = await inspectAsync(lockPath, filesystem);
        if (last && unchanged(current, last)) {
          // Reading a descriptor pins an inode, not the pathname. Re-stat the pathname after the
          // final descriptor closes, so replacement during awaited inspection cannot be stolen.
          try {
            const atPath = await filesystem.stat(lockPath);
            if (atPath.ino === last.ino && atPath.dev === last.dev && atPath.mtimeMs === last.mtimeMs) {
              await filesystem.rm(lockPath, { force: true }); options.onStaleLockRemoved?.({ holder: current.holder });
            }
          } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
        }
      }
    }
    checkTimeout(lockPath, observed?.holder, start, s, options);
    await (options.sleep ?? (({ durationMs }) => new Promise<void>(resolve => setTimeout(resolve, durationMs))))({ durationMs: s.pollMs });
  }
  const held = async () => { const current = await inspectAsync(lockPath, filesystem); return current && current.raw === raw && current.ino === identity.ino && current.dev === identity.dev; };
  let completed = false;
  try {
    const value = await run({ lockPath, assertHeld: async (_required) => { if (!await held()) throw new FileLockLostError({ lockPath }, options.messages ? { messages: options.messages } : {}); } });
    completed = true; return value;
  } finally {
    try { if (await held()) await filesystem.rm(lockPath, { force: true }); }
    // A failed critical section keeps its original error; durable hosts also suppress release-only failures.
    catch (error) { if (completed && !options.suppressReleaseErrors && errorCode(error) !== "ENOENT") throw error; }
  }
}
