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
import { readBootIdentity, type BootIdentity } from "./boot-identity.js";
import fs from "node:fs";
import * as asyncFs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname as nodeHostname } from "node:os";
import path from "node:path";
import { createSystemClock, type Clock } from "@jini-ai/core/primitives";
import { defaultPlatformMessages, type PlatformMessages } from "../messages.js";

export const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
export const DEFAULT_LOCK_STALE_AFTER_MS = 10_000;
export interface FileLockHolder { readonly pid: number; readonly hostname: string; readonly token: string; readonly acquiredAt: string; readonly bootId?: string; }
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
  process?: { pid: number; isAlive(required: { pid: number }): boolean; bootIdentity?: () => BootIdentity | undefined };
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
function isAbsentOrContended(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || isContendedLockError({ code, platform: process.platform });
}
function rethrowUnlessMissing(error: unknown): void { if (errorCode(error) !== "ENOENT") throw error; }
function validPid(pid: unknown): pid is number { return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0; }
function isHolderRecord(value: unknown): value is Omit<FileLockHolder, "bootId"> & { bootId?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return validPid(row.pid) && typeof row.hostname === "string" && typeof row.token === "string" && typeof row.acquiredAt === "string";
}
function parseHolder(raw: string): FileLockHolder | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isHolderRecord(value)) return undefined;
    return { pid: value.pid, hostname: value.hostname, token: value.token, acquiredAt: value.acquiredAt, ...(typeof value.bootId === "string" ? { bootId: value.bootId } : {}) };
  } catch { return undefined; }
}
interface LockSnapshot { raw: string; holder: FileLockHolder | undefined; mtimeMs: number; ino: number; dev: number; }
interface FileIdentity { ino: number; dev: number; }
/** One pure stale decision serves both I/O adapters. Invalid/foreign pids have unknown liveness,
 * never false liveness; otherwise kill(0/negative, 0) would address a process group. */
export function isLockStale(required: { nowMs: number; mtimeMs: number; staleMs: number; ownerAlive: boolean | undefined; observedInode: number; currentInode: number; observedDevice: number; currentDevice: number }): boolean {
  return (required.ownerAlive === false || required.nowMs - required.mtimeMs > required.staleMs) && required.observedInode === required.currentInode && required.observedDevice === required.currentDevice;
}
function intervalsValid({ timeoutMs, staleMs, pollMs }: { timeoutMs: number; staleMs: number; pollMs: number }): boolean {
  return Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && (Number.isSafeInteger(staleMs) || staleMs === Infinity) && staleMs > 0 && Number.isSafeInteger(pollMs) && pollMs > 0;
}
function intervals(options: FileLockOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_AFTER_MS, pollMs = options.pollMs ?? 10;
  if (!intervalsValid({ timeoutMs, staleMs, pollMs })) throw new RangeError((options.messages ?? defaultPlatformMessages).fileLockIntervalsInvalid());
  return { timeoutMs, staleMs, pollMs };
}
function defaultProcessPort(): NonNullable<FileLockOptions["process"]> {
  return { pid: process.pid, bootIdentity: () => readBootIdentity({}), isAlive: ({ pid }: { pid: number }) => { try { process.kill(pid, 0); return true; } catch (error) { return errorCode(error) !== "ESRCH"; } } };
}
function settings(options: FileLockOptions) {
  const checked = intervals(options);
  const processPort = options.process ?? defaultProcessPort();
  const clock = options.clock ?? createSystemClock();
  const monotonicMs = options.monotonicMs ?? (() => clock.nowMs());
  return { ...checked, processPort, clock, monotonicMs, boot: processPort.bootIdentity?.(), hostname: (options.hostname ?? nodeHostname)(), token: (options.token ?? randomUUID)() };
}
type Settings = ReturnType<typeof settings>;
function ownership(s: Settings, options: FileLockOptions): string {
  return options.format === "token" ? `${s.processPort.pid}:${s.token}${s.boot ? ":" + s.boot.id : ""}` : JSON.stringify({ pid: s.processPort.pid, hostname: s.hostname, token: s.token, acquiredAt: new Date(s.clock.nowMs()).toISOString(), ...(s.boot ? { bootId: s.boot.id } : {}) });
}
/** A recorded boot id decides; without one, only an acquisition before this boot proves a restart. */
function fromEarlierBoot(boot: BootIdentity | undefined, recorded: { bootId: string | undefined; atMs: number }): boolean {
  if (!boot) return false;
  return recorded.bootId !== undefined ? recorded.bootId !== boot.id : recorded.atMs < boot.startedAtMs;
}
function holderAlive(holder: FileLockHolder, s: Settings): boolean | undefined {
  if (holder.hostname !== s.hostname) return undefined;
  if (fromEarlierBoot(s.boot, { bootId: holder.bootId, atMs: Date.parse(holder.acquiredAt) })) return false;
  return s.processPort.isAlive({ pid: holder.pid });
}
// Legacy synchronous stores wrote pid:random rather than JSON. Malformed pids remain unknown.
function legacyOwnerAlive(snapshot: LockSnapshot, s: Settings): boolean | undefined {
  if (!/^\d+:/.test(snapshot.raw)) return undefined;
  const parts = snapshot.raw.split(":");
  const pid = Number(parts[0]);
  if (!validPid(pid)) return undefined;
  if (fromEarlierBoot(s.boot, { bootId: parts[2] || undefined, atMs: snapshot.mtimeMs })) return false;
  return s.processPort.isAlive({ pid });
}
function ownerAlive(snapshot: LockSnapshot, s: Settings): boolean | undefined {
  return snapshot.holder ? holderAlive(snapshot.holder, s) : legacyOwnerAlive(snapshot, s);
}
function sameFile(a: FileIdentity, b: FileIdentity): boolean { return a.ino === b.ino && a.dev === b.dev; }
function sameStat(a: FileIdentity & { mtimeMs: number }, b: FileIdentity & { mtimeMs: number }): boolean { return sameFile(a, b) && a.mtimeMs === b.mtimeMs; }
function unchanged(a: LockSnapshot, b: LockSnapshot): boolean { return sameStat(a, b) && a.raw === b.raw; }
function stale(observed: LockSnapshot, current: LockSnapshot, s: Settings): boolean {
  return unchanged(observed, current) && isLockStale({ nowMs: s.clock.nowMs(), mtimeMs: observed.mtimeMs, staleMs: s.staleMs, ownerAlive: ownerAlive(current, s), observedInode: observed.ino, currentInode: current.ino, observedDevice: observed.dev, currentDevice: current.dev });
}
function messagesOption(options: FileLockOptions): { messages?: PlatformMessages } { return options.messages ? { messages: options.messages } : {}; }
function checkTimeout(lockPath: string, holder: FileLockHolder | undefined, start: number, s: Settings, options: FileLockOptions): void {
  const waitedMs = s.monotonicMs() - start;
  if (waitedMs >= s.timeoutMs) {
    const message = options.timeoutMessage?.({ lockPath, waitMs: s.timeoutMs });
    throw new FileLockTimeoutError({ lockPath, holder, waitedMs }, { ...messagesOption(options), ...(message !== undefined ? { message } : {}) });
  }
}
function ownsSnapshot(current: LockSnapshot | undefined, raw: string, identity: FileIdentity): boolean {
  return current !== undefined && current.raw === raw && sameFile(current, identity);
}
// A failed critical section keeps its original error; durable hosts also suppress release-only failures.
function rethrowReleaseError(error: unknown, completed: boolean, options: FileLockOptions): void {
  if (completed && !options.suppressReleaseErrors) rethrowUnlessMissing(error);
}
interface LockContext<Filesystem> { lockPath: string; raw: string; filesystem: Filesystem; s: Settings; options: FileLockOptions; }
function inspectSync(lockPath: string, filesystem: FileLockSyncFilesystem): LockSnapshot | undefined {
  let descriptor: number;
  try { descriptor = filesystem.openSync(lockPath, "r"); } catch (error) { if (isAbsentOrContended(error)) return undefined; throw error; }
  try {
    const info = filesystem.fstatSync(descriptor), raw = filesystem.readFileSync(descriptor, "utf8");
    return { raw, holder: parseHolder(raw), mtimeMs: info.mtimeMs, ino: info.ino, dev: info.dev };
  } finally { filesystem.closeSync(descriptor); }
}
async function inspectAsync(lockPath: string, filesystem: FileLockAsyncFilesystem): Promise<LockSnapshot | undefined> {
  let handle: Awaited<ReturnType<FileLockAsyncFilesystem["open"]>>;
  try { handle = await filesystem.open(lockPath, "r"); } catch (error) { if (isAbsentOrContended(error)) return undefined; throw error; }
  try {
    const info = await handle.stat(), raw = await handle.readFile("utf8");
    return { raw, holder: parseHolder(raw), mtimeMs: info.mtimeMs, ino: info.ino, dev: info.dev };
  } finally { await handle.close(); }
}
function writeOwnershipSync({ raw, filesystem, options }: LockContext<FileLockSyncFilesystem>, descriptor: number): void {
  const bytes = Buffer.from(raw); let offset = 0;
  while (offset < bytes.length) {
    const written = filesystem.writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written === 0) throw new Error((options.messages ?? defaultPlatformMessages).fileLockWriteNoProgress());
    offset += written;
  }
}
/** Exclusive create; undefined means another owner holds the path. */
function tryCreateSync(ctx: LockContext<FileLockSyncFilesystem>): FileIdentity | undefined {
  const { lockPath, filesystem } = ctx;
  let descriptor: number;
  try { descriptor = filesystem.openSync(lockPath, "wx", 0o600); }
  catch (error) { if (!isContendedLockError({ code: errorCode(error), platform: process.platform })) throw error; return undefined; }
  let identity: FileIdentity;
  try {
    identity = filesystem.fstatSync(descriptor);
    // An unidentifiable lock would wedge writers until stale timeout; clean a failed creation
    // only while its inode still matches, rather than deleting a replacement owner.
    writeOwnershipSync(ctx, descriptor);
  } catch (error) {
    try { if (sameFile(filesystem.fstatSync(descriptor), filesystem.statSync(lockPath))) filesystem.rmSync(lockPath, { force: true }); } catch { /* preserve creation failure */ }
    throw error;
  } finally { filesystem.closeSync(descriptor); }
  return identity;
}
function removeIfStaleSync(observed: LockSnapshot, { lockPath, filesystem, s, options }: LockContext<FileLockSyncFilesystem>): void {
  const current = inspectSync(lockPath, filesystem);
  if (!current || !stale(observed, current, s)) return;
  const last = filesystem.statSync(lockPath, { throwIfNoEntry: false });
  if (!last || !sameStat(last, current)) return;
  try { filesystem.rmSync(lockPath, { force: true }); options.onStaleLockRemoved?.({ holder: current.holder }); } catch (error) { rethrowUnlessMissing(error); }
}
function acquireSync(ctx: LockContext<FileLockSyncFilesystem>, start: number, sleep: (required: { durationMs: number }) => void): FileIdentity {
  for (;;) {
    const identity = tryCreateSync(ctx);
    if (identity) return identity;
    const observed = inspectSync(ctx.lockPath, ctx.filesystem);
    if (observed) removeIfStaleSync(observed, ctx);
    // Every contention path, including repeated stale breaks and release races, is bounded.
    checkTimeout(ctx.lockPath, observed?.holder, start, ctx.s, ctx.options);
    sleep({ durationMs: ctx.s.pollMs });
  }
}
function runHeldSync<T>({ lockPath, raw, filesystem, options }: LockContext<FileLockSyncFilesystem>, identity: FileIdentity, run: (lock: HeldFileLockSync) => T): T {
  const held = () => ownsSnapshot(inspectSync(lockPath, filesystem), raw, identity);
  let completed = false;
  try {
    const value = run({ lockPath, assertHeld: (_required) => { if (!held()) throw new FileLockLostError({ lockPath }, messagesOption(options)); } });
    completed = true; return value;
  } finally {
    try { if (held()) filesystem.rmSync(lockPath, { force: true }); } catch (error) { rethrowReleaseError(error, completed, options); }
  }
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
  const ctx = { lockPath, raw, filesystem, s, options };
  const identity = acquireSync(ctx, start, options.sleep ?? (({ durationMs }) => { Atomics.wait(waitCell, 0, 0, durationMs); }));
  return runHeldSync(ctx, identity, run);
}
type AsyncHandle = Awaited<ReturnType<FileLockAsyncFilesystem["open"]>>;
async function removeFailedCreationAsync({ lockPath, filesystem }: LockContext<FileLockAsyncFilesystem>, handle: AsyncHandle): Promise<void> {
  try {
    const created = await handle.stat(), current = await inspectAsync(lockPath, filesystem);
    if (current && sameFile(created, current)) await filesystem.rm(lockPath, { force: true });
  } catch { /* preserve creation failure */ }
}
/** Exclusive create; undefined means another owner holds the path. */
async function tryCreateAsync(ctx: LockContext<FileLockAsyncFilesystem>): Promise<FileIdentity | undefined> {
  let handle: AsyncHandle;
  try { handle = await ctx.filesystem.open(ctx.lockPath, "wx", 0o600); }
  catch (error) { if (!isContendedLockError({ code: errorCode(error), platform: process.platform })) throw error; return undefined; }
  let identity: FileIdentity;
  try { identity = await handle.stat(); await handle.writeFile(ctx.raw, "utf8"); }
  catch (error) { await removeFailedCreationAsync(ctx, handle); throw error; }
  finally { await handle.close(); }
  return identity;
}
async function removeIfStaleAsync(observed: LockSnapshot, { lockPath, filesystem, s, options }: LockContext<FileLockAsyncFilesystem>): Promise<void> {
  const current = await inspectAsync(lockPath, filesystem);
  if (!current || !stale(observed, current, s)) return;
  const last = await inspectAsync(lockPath, filesystem);
  if (!last || !unchanged(current, last)) return;
  // Reading a descriptor pins an inode, not the pathname. Re-stat the pathname after the
  // final descriptor closes, so replacement during awaited inspection cannot be stolen.
  try {
    if (!sameStat(await filesystem.stat(lockPath), last)) return;
    await filesystem.rm(lockPath, { force: true }); options.onStaleLockRemoved?.({ holder: current.holder });
  } catch (error) { rethrowUnlessMissing(error); }
}
async function acquireAsync(ctx: LockContext<FileLockAsyncFilesystem>, start: number, sleep: (required: { durationMs: number }) => void | Promise<void>): Promise<FileIdentity> {
  for (;;) {
    const identity = await tryCreateAsync(ctx);
    if (identity) return identity;
    const observed = await inspectAsync(ctx.lockPath, ctx.filesystem);
    if (observed) await removeIfStaleAsync(observed, ctx);
    checkTimeout(ctx.lockPath, observed?.holder, start, ctx.s, ctx.options);
    await sleep({ durationMs: ctx.s.pollMs });
  }
}
async function runHeldAsync<T>({ lockPath, raw, filesystem, options }: LockContext<FileLockAsyncFilesystem>, identity: FileIdentity, run: (lock: HeldFileLock) => Promise<T> | T): Promise<T> {
  const held = async () => ownsSnapshot(await inspectAsync(lockPath, filesystem), raw, identity);
  let completed = false;
  try {
    const value = await run({ lockPath, assertHeld: async (_required) => { if (!await held()) throw new FileLockLostError({ lockPath }, messagesOption(options)); } });
    completed = true; return value;
  } finally {
    try { if (await held()) await filesystem.rm(lockPath, { force: true }); } catch (error) { rethrowReleaseError(error, completed, options); }
  }
}
/** Async adapter of the same stale and ownership policy; polling yields to other writers. */
export async function withFileLock<T>(
  { lockPath, run }: { lockPath: string; run: (lock: HeldFileLock) => Promise<T> | T },
  options: FileLockOptions & { filesystem?: FileLockAsyncFilesystem } = {},
): Promise<T> {
  const filesystem = options.filesystem ?? asyncFs, s = settings(options), start = s.monotonicMs(), raw = ownership(s, options);
  if (options.createParent) await filesystem.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const ctx = { lockPath, raw, filesystem, s, options };
  const identity = await acquireAsync(ctx, start, options.sleep ?? (({ durationMs }) => new Promise<void>(resolve => setTimeout(resolve, durationMs))));
  return runHeldAsync(ctx, identity, run);
}
