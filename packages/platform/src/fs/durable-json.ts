/**
 * Shared stores once wrote JSON directly, treated torn reads as empty, then persisted the empty
 * state on the next write, erasing recoverable records. One mechanism keeps stores from drifting:
 * atomic replacement, explicit unreadable state, quarantine, and locks for shared read-modify-write.
 * Recovery policy stays with each store: salvage, restart, or leave untouched is not decided here.
 * Native effects are Electron-free so desktop, CLI, and bridge processes can share the mechanism.
 */
import { readBootIdentity, type BootIdentity } from "./boot-identity.js";
import nodeFs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Clock } from "@jini-ai/core/primitives";
import { createNodeAtomicFilesystem, writeJsonFileAtomic } from "./atomic-write.js";
import { withFileLockSync } from "./file-lock.js";
// Missing is not unreadable: a damaged file holds unknown records, not a valid empty list. Retain
// text for salvage when reading succeeded but parsing failed; I/O failure supplies no recoverable text.
export type JsonFileRead = { state: "ok"; value: unknown } | { state: "missing" } | { state: "unreadable"; text?: string };
export interface QuarantineNotice { label: string; consequence: string; }
export interface FileLockOptions { waitMs?: number; }
export interface DurableJsonPorts {
  filesystem: Pick<typeof nodeFs, "readFileSync" | "mkdirSync" | "openSync" | "writeFileSync" | "fsyncSync" | "closeSync" | "renameSync" | "rmSync" | "writeSync" | "statSync" | "fstatSync" | "lstatSync" | "chmodSync">;
  clock: Clock;
  sleep: { sleep(required: { durationMs: number }): void };
  process: { pid: number; isAlive(required: { pid: number }): boolean; bootIdentity?: () => BootIdentity | undefined };
  random: { token(_required: Record<string, never>): string };
  report: { error(required: { message: string }): void };
}
export interface DurableJsonNotices { prefix: string; lockTimeout(required: { lockPath: string; waitMs: number }): string; }
/** Native synchronous adapters. Liveness probes treat permission errors as alive. */
export function createNodeDurableJsonPorts(_required: Record<string, never>): DurableJsonPorts {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  return {
    filesystem: nodeFs,
    clock: { nowMs: () => Date.now() },
    // Synchronous store/IPC writers cannot await lock polling without changing all callers' ABI.
    sleep: { sleep: ({ durationMs }) => { Atomics.wait(cell, 0, 0, durationMs); } },
    process: { pid: process.pid, bootIdentity: () => readBootIdentity({}), isAlive: ({ pid }) => {
      // Signal zero sends nothing. Only ESRCH proves death; permission failure must count as alive
      // because a false "dead" authorizes breaking a lock still owned by another process.
      try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
    } },
    random: { token: (_required) => randomBytes(4).toString("hex") },
    report: { error: ({ message }) => console.error(message) },
  };
}
export interface DurableJsonFile {
  read(required: Record<string, never>): JsonFileRead;
  tempPath(required: Record<string, never>, optional?: { pid?: number }): string;
  write(required: { value: unknown }): void;
  quarantine(required: { notice: QuarantineNotice }): boolean;
  withLock<T>(required: { critical: () => T }, optional?: FileLockOptions): T;
}
/** Atomic replacement, distinct corrupt reads, quarantine, and token-owned synchronous locks.
 * Lock stealing rechecks inode, bytes and mtime; conditional unlink is not available on all hosts.
 * File fsync precedes rename; directory flush afterwards is best-effort: skipped on Windows,
 * unsupported-code failures ignored (EPERM/EISDIR/EINVAL/EACCES/ENOTSUP), other failures reported
 * after replacement. Persistence remains filesystem-dependent.
 */
export function createDurableJsonFile(
  { filePath, filesystem: fs, clock, sleep, process, random, report, notices }: DurableJsonPorts & { filePath: string; notices: DurableJsonNotices },
  { pollMs = 10, staleMs = 30000 }: { pollMs?: number; staleMs?: number } = {},
): DurableJsonFile {
  if (!filePath) throw new TypeError("filePath is required");
  const validPoll = Number.isSafeInteger(pollMs) && pollMs > 0;
  const validStale = (Number.isSafeInteger(staleMs) || staleMs === Infinity) && staleMs > 0;
  if (!validPoll || !validStale) throw new TypeError("lock intervals must be positive safe integers");
  // A synchronous read-modify-write normally takes milliseconds; five seconds allows contention
  // while refusing a wedged change. Short ten-millisecond polling fits those short critical sections.
  // Thirty-second staleness also handles pid reuse after a crash:
  // an unrelated live process must not hold the abandoned file forever merely by inheriting its pid.
  const LOCK_WAIT_MS = 5000, LOCK_POLL_MS = pollMs, LOCK_STALE_MS = staleMs;
function readJsonFile(filePath: string): JsonFileRead {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" } : { state: "unreadable" };
  }
  try {
    return { state: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { state: "unreadable", text };
  }
}

// Per-process sibling temps prevent one writer truncating another's pending replacement. Writes
// within one process are synchronous, so it cannot collide with itself; its next write reuses the temp.
function tempPathFor(filePath: string, pid: number = process.pid): string {
  return `${filePath}.${pid}.tmp`;
}

// Same-directory rename gives readers complete old/new versions rather than a torn intermediate.
// Flush bytes before rename so metadata cannot precede content. The canonical writer's parent
// directory flush is best-effort: skipped on Windows, unsupported-code failures ignored
// (EPERM/EISDIR/EINVAL/EACCES/ENOTSUP), other failures reported after replacement.
// Keep the legacy temp path, pretty JSON bytes and new-file create mode for these shared stores.
function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonFileAtomic({ filePath, data: value, fs: createNodeAtomicFilesystem({}, { filesystem: fs }) }, {
    defaultMode: 0o666 & ~globalThis.process.umask(), tempPath: () => tempPathFor(filePath),
  });
}

// Preserve damaged bytes for inspection instead of deleting/overwriting them. False means callers
// must leave the original alone; an already-moved file is safe because another process cleared it.
function quarantineUnreadableFile(filePath: string, notice: QuarantineNotice): boolean {
  const asidePath = `${filePath}.corrupt-${clock.nowMs()}`;
  try {
    fs.renameSync(filePath, asidePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    report.error({ message: `${notices.prefix}: ${notice.label} ${filePath} is unreadable and could not be moved aside (${String(error)}). Left untouched; nothing was written over it.` });
    return false;
  }
  report.error({ message: `${notices.prefix}: ${notice.label} ${filePath} was unreadable (torn or corrupt). Moved it aside to ${asidePath}; ${notice.consequence}` });
  return true;
}

// Atomic replacement prevents tears; this lock serializes shared read-modify-write operations.
// Deliberately non-reentrant. Token-owned release must not evict a later owner after a stale break.
// The canonical lock rechecks the inode at steal time; its documented check-to-unlink race remains.
  return {
    read: (_required) => readJsonFile(filePath),
    tempPath: (_required, { pid = process.pid } = {}) => tempPathFor(filePath, pid),
    write: ({ value }) => writeJson(filePath, value),
    quarantine: ({ notice }) => quarantineUnreadableFile(filePath, notice),
    withLock: ({ critical }, optional = {}) => {
      if (optional.waitMs !== undefined && (!Number.isSafeInteger(optional.waitMs) || optional.waitMs < 0)) throw new TypeError("waitMs must be a nonnegative safe integer");
      return withFileLockSync({ lockPath: `${filePath}.lock`, run: critical }, {
        timeoutMs: optional.waitMs ?? LOCK_WAIT_MS, staleMs: LOCK_STALE_MS, pollMs: LOCK_POLL_MS,
        filesystem: fs, clock, sleep: ({ durationMs }) => sleep.sleep({ durationMs }), process,
        token: () => random.token({}), format: "token", createParent: true,
        timeoutMessage: notices.lockTimeout, suppressReleaseErrors: true,
      });
    },
  };
}

/** Recovers the longest completed string/object/array prefix with bounded parse attempts. */
interface PrefixCut {
  end: number;
  closers: string;
}

// Bound recovery to the latest 1,000 parse attempts by default, rather than parsing once per quoted
// character in a large damaged file. Stores must validate recovered values normally: partial objects
// are not trustworthy merely because their brackets can be closed into syntactically valid JSON.
export function salvageJsonPrefix({ text }: { text: string }, { maxAttempts = 1000 }: { maxAttempts?: number } = {}): unknown {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) throw new TypeError("maxAttempts must be a positive safe integer");
  const cuts = elementEnds(text);
  const floor = Math.max(0, cuts.length - maxAttempts);
  for (let index = cuts.length - 1; index >= floor; index -= 1) {
    const cut = cuts[index]!;
    try {
      return JSON.parse(text.slice(0, cut.end) + cut.closers) as unknown;
    } catch {
      // A cut after an object key cannot close validly; try an earlier completed value.

    }
  }
  return undefined;
}

// Cut only at completed strings/objects/arrays, sufficient for string-valued lists. Damage inside a
// bare number/boolean falls back to the previous cut and loses that element rather than guessing it.
const CLOSER_FOR: ReadonlyMap<string, string> = new Map([["{", "}"], ["[", "]"]]);
const CLOSERS: ReadonlySet<string> = new Set(["}", "]"]);

function elementEnds(text: string): PrefixCut[] {
  const open: string[] = [];
  const cuts: PrefixCut[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    const closer = CLOSER_FOR.get(char);
    // An opener only records its closer; a completed string or container is a cut point.
    if (closer !== undefined) open.push(closer);
    if (CLOSERS.has(char)) open.pop();
    if (char === '"') index = endOfString(text, index);
    if (char === '"' || CLOSERS.has(char)) cuts.push({ end: index + 1, closers: [...open].reverse().join("") });
    index += 1;
  }
  return cuts;
}

function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') return index;
    // A backslash escapes the next character, whatever it is.
    index += char === "\\" ? 2 : 1;
  }
  return text.length;
}

export interface DurableJsonChange {
  filePath: string;
  /** Missing optional references stay missing; transforms must reject unreadable schemas. */
  transform: (value: unknown | undefined) => unknown | undefined;
}

/** Update related JSON pointers under their existing locks, with atomic replacement per file.
 * Compute every change before writing; a failed write restores prior bytes before releasing locks.
 * The host supplies schema transforms, so this owner knows nothing about product catalogs.
 * @throws Unreadable input, transform, lock or persistence failures (including rollback failures).
 * @example updateDurableJsonFiles({ changes, fileAt, remove });
 * @complexity O(total JSON bytes), O(total JSON bytes) rollback storage, one lock per file.
 */
export function updateDurableJsonFiles(
  { changes, fileAt, remove }: { changes: readonly DurableJsonChange[]; fileAt: (path: string) => DurableJsonFile; remove: (required: { filePath: string }) => void },
  _options = {},
): void {
  if (new Set(changes.map((change) => change.filePath)).size !== changes.length) throw new Error("Duplicate JSON transaction path.");
  const ordered = [...changes].sort((a, b) => a.filePath.localeCompare(b.filePath));
  const files = ordered.map((change) => fileAt(change.filePath));
  withLocksInOrder({ files, critical: () => applyJsonUpdates({ updates: planJsonUpdates({ ordered, files }), remove }) });
}

interface PlannedJsonUpdate { file: DurableJsonFile; filePath: string; previous: unknown; next: unknown; }
type RemoveJsonFile = (required: { filePath: string }) => void;

/** Nests each file's lock in path order, then runs the critical section with all of them held. */
function withLocksInOrder({ files, critical }: { files: readonly DurableJsonFile[]; critical: () => void }, { index = 0 }: { index?: number } = {}): void {
  if (index >= files.length) { critical(); return; }
  files[index]!.withLock({ critical: () => withLocksInOrder({ files, critical }, { index: index + 1 }) });
}

/** Every transform runs before any write, so a refusal leaves all participants untouched. */
function planJsonUpdates({ ordered, files }: { ordered: readonly DurableJsonChange[]; files: readonly DurableJsonFile[] }): PlannedJsonUpdate[] {
  return ordered.map((change, i) => {
    const before = files[i]!.read({});
    if (before.state === "unreadable") throw new Error(`JSON reference is unreadable: ${change.filePath}. Nothing was moved.`);
    const previous = before.state === "ok" ? before.value : undefined;
    return { file: files[i]!, filePath: change.filePath, previous, next: change.transform(previous) };
  }).filter((item) => JSON.stringify(item.previous) !== JSON.stringify(item.next));
}

/** Undefined means the file is absent, so it is removed rather than written. */
function persistJsonValue({ item, value, remove }: { item: PlannedJsonUpdate; value: unknown; remove: RemoveJsonFile }): void {
  if (value === undefined) remove({ filePath: item.filePath });
  else item.file.write({ value });
}

function applyJsonUpdates({ updates, remove }: { updates: readonly PlannedJsonUpdate[]; remove: RemoveJsonFile }): void {
  const attempted: PlannedJsonUpdate[] = [];
  try {
    for (const item of updates) {
      attempted.push(item); // A write can fail after its rename; include it in rollback.
      persistJsonValue({ item, value: item.next, remove });
    }
  } catch (failure) {
    rollbackJsonUpdates({ attempted, remove, failure });
  }
}

/** Restores prior bytes newest-first; keeps going past individual rollback failures. */
function rollbackJsonUpdates({ attempted, remove, failure }: { attempted: PlannedJsonUpdate[]; remove: RemoveJsonFile; failure: unknown }): never {
  const errors: unknown[] = [failure];
  for (const item of attempted.reverse()) {
    try { persistJsonValue({ item, value: item.previous, remove }); } catch (error) { errors.push(error); }
  }
  if (errors.length > 1) throw new AggregateError(errors, "JSON reference rollback failed.");
  throw failure;
}
