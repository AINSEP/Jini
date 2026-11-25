/**
 * Writer-owned temporary roots: a short-lived folder whose owner is provable, so a sweeper can tidy
 * what a crashed writer left behind without ever touching a root that is still in use.
 *
 * Protocol (every writer): take `<root>.lock` first, then write the provenance marker
 * `<root>.owner`, then create `<root>` (mode 0700, name = host prefix + exact UUID). The writer
 * stays inside the lock until its work (child processes, reads, publication) settles, removes the
 * root in `finally`, and removes the marker only once the root is gone. A root therefore never
 * exists without an owner, and a failed removal keeps the writer's provenance on disk.
 *
 * Sweep: only exact `<prefix><uuid>` names in the named parent; links and roots outside the parent
 * are skipped; roots without a marker (written before this protocol, or unconfirmed) are only
 * reported; a marked root is removed only after acquiring its lock (which succeeds only when the
 * recorded owner is proven dead, or released) and re-checking its dev/ino under that exclusion.
 *
 * Accepted deviation from ALGO-P11 §9.7: the design placed this helper in the host
 * (`platform/temp/owned-root.ts`). The protocol is generic, so it lives here; hosts supply the
 * product-specific prefixes, parents, the lock adapter (and through it the liveness probe).
 */
import { basename, dirname, join } from "node:path";
import type * as nodeFs from "node:fs/promises";
import { FileLockTimeoutError } from "@jini-ai/core/contracts/runtime";
import type { Clock } from "@jini-ai/core/primitives";
import { errorCodeOf } from "./errno.js";

export const OWNED_TEMP_ROOT_LOCK_SUFFIX = ".lock";
export const OWNED_TEMP_ROOT_MARKER_SUFFIX = ".owner";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EXACT_UUID = new RegExp(`^${UUID}$`);
const PLAIN_PREFIX = /^[A-Za-z0-9._-]+$/;
const DAY_MS = 86_400_000;

export type OwnedTempRootFilesystem = Pick<typeof nodeFs, "mkdir" | "rm" | "writeFile" | "readdir" | "lstat" | "realpath">;
/** A lock adapter shaped like `withFileLock`; the host binds its process/liveness port into it. */
export type OwnedTempRootLock = <T>(required: { lockPath: string; run: () => Promise<T> }, options: { timeoutMs?: number; staleMs: number }) => Promise<T>;
export interface OwnedTempRootRemovalError { root: string; error: unknown }

function ownedRootName(prefix: string, id: string): string {
  if (!PLAIN_PREFIX.test(prefix) || !EXACT_UUID.test(id)) throw new RangeError("A temporary folder needs a plain name prefix and an exact lowercase UUID.");
  return prefix + id;
}

async function removeOwnedRoot(root: string, fs: OwnedTempRootFilesystem, onRemovalError?: (failure: OwnedTempRootRemovalError) => void): Promise<void> {
  try { await fs.rm(root, { recursive: true, force: true }); }
  catch (error) {
    // The marker is the writer's durable provenance: kept, the sweeper can finish this removal later.
    onRemovalError?.({ root, error });
    return;
  }
  await fs.rm(root + OWNED_TEMP_ROOT_MARKER_SUFFIX, { force: true });
}

/**
 * Runs `work` inside a fresh owned root, holding the root's lock for the whole call.
 * @param required.parent existing folder that holds the roots; @param required.prefix host prefix.
 * @param required.id UUID source; @param required.lock lock adapter; @param required.work the job.
 * @param optional.onRemovalError observer for a failed cleanup (the root and marker then stay).
 * @returns what `work` returns. @throws RangeError for a non-plain prefix or a non-UUID id.
 * @complexity O(work) plus one lock, two creates and two removals.
 */
export async function withOwnedTempRoot<T>(
  required: { parent: string; prefix: string; id: () => string; fs: OwnedTempRootFilesystem; lock: OwnedTempRootLock; work: (owned: { root: string }) => Promise<T> },
  optional: { onRemovalError?: (failure: OwnedTempRootRemovalError) => void } = {},
): Promise<T> {
  const { parent, prefix, fs, work } = required;
  const root = join(parent, ownedRootName(prefix, required.id()));
  const run = async (): Promise<T> => {
    await fs.writeFile(root + OWNED_TEMP_ROOT_MARKER_SUFFIX, JSON.stringify({ version: 1, prefix }), { flag: "wx", mode: 0o600 });
    try {
      await fs.mkdir(root, { mode: 0o700 });
      return await work({ root });
    } finally { await removeOwnedRoot(root, fs, optional.onRemovalError); }
  };
  // staleMs Infinity: a slow writer is never age-evicted; only a proven-dead owner loses its lock.
  return required.lock({ lockPath: root + OWNED_TEMP_ROOT_LOCK_SUFFIX, run }, { staleMs: Infinity });
}

export type OwnedTempRootOutcome = "removed" | "kept" | "report-only";
export type OwnedTempRootReason = "dead-owner" | "orphan-lock" | "young" | "owner-alive" | "not-a-directory" | "outside-root" | "changed" | "busy" | "legacy" | "unconfirmed";
export interface OwnedTempRootEntry { path: string; outcome: OwnedTempRootOutcome; reason: OwnedTempRootReason }
export interface OwnedTempRootSweepReport { entries: OwnedTempRootEntry[]; truncated: boolean; aborted: boolean }
interface SweepContext { fs: OwnedTempRootFilesystem; lock: OwnedTempRootLock; nowMs: number; olderThanMs: number }
type Stat = Awaited<ReturnType<OwnedTempRootFilesystem["lstat"]>>;

const entry = (path: string, outcome: OwnedTempRootOutcome, reason: OwnedTempRootReason): OwnedTempRootEntry => ({ path, outcome, reason });
async function lstatOrUndefined(fs: OwnedTempRootFilesystem, path: string): Promise<Stat | undefined> {
  try { return await fs.lstat(path); } catch (error) { if (errorCodeOf({ error }) === "ENOENT") return undefined; throw error; }
}
function escapeRegExp(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Distinct exact root names in `names` (from the root itself, its lock or its marker). O(n). */
function exactRootNames(names: readonly string[], prefix: string): string[] {
  const exact = new RegExp(`^(${escapeRegExp(prefix)}${UUID})(\\.lock|\\.owner)?$`);
  const bases = new Set<string>();
  for (const name of names) { const match = exact.exec(name); if (match) bases.add(match[1]!); }
  return [...bases].sort();
}

/** Acquire without waiting; `undefined` means another owner is alive or its liveness is unknown. */
async function tryExclusive<T>(ctx: SweepContext, lockPath: string, run: () => Promise<T>): Promise<T | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await ctx.lock({ lockPath, run }, { timeoutMs: 0, staleMs: Infinity }); }
    catch (error) {
      // withFileLock checks its deadline right after breaking a dead owner's lock, before creating
      // its own; with a zero wait that first attempt reports a timeout. One retry then acquires,
      // while a live (or foreign, unprovable) owner times out again.
      if (!(error instanceof FileLockTimeoutError) && (error as { name?: unknown } | null)?.name !== "FileLockTimeoutError") throw error;
    }
  }
  return undefined;
}

async function contained(ctx: SweepContext, parent: string, root: string): Promise<boolean> {
  const [realParent, realRoot] = await Promise.all([ctx.fs.realpath(parent), ctx.fs.realpath(root)]);
  return dirname(realRoot) === realParent && basename(realRoot) === basename(root);
}

async function removeUnderLock(ctx: SweepContext, root: string, seen: Stat): Promise<OwnedTempRootEntry> {
  const result = await tryExclusive(ctx, root + OWNED_TEMP_ROOT_LOCK_SUFFIX, async () => {
    const again = await lstatOrUndefined(ctx.fs, root);
    if (!again?.isDirectory() || again.dev !== seen.dev || again.ino !== seen.ino) return entry(root, "kept", "changed");
    await ctx.fs.rm(root, { recursive: true, force: true });
    await ctx.fs.rm(root + OWNED_TEMP_ROOT_MARKER_SUFFIX, { force: true });
    return entry(root, "removed", "dead-owner");
  });
  return result ?? entry(root, "kept", "owner-alive");
}

/** A lock/marker whose root is absent: a writer died between taking its lock and creating the root. */
async function sweepOrphan(ctx: SweepContext, root: string): Promise<OwnedTempRootEntry | undefined> {
  const files = await Promise.all([OWNED_TEMP_ROOT_LOCK_SUFFIX, OWNED_TEMP_ROOT_MARKER_SUFFIX].map((suffix) => lstatOrUndefined(ctx.fs, root + suffix)));
  const present = files.filter((info): info is Stat => info !== undefined);
  if (present.length === 0) return undefined;
  if (present.some((info) => !info.isFile())) return entry(root, "kept", "not-a-directory");
  if (present.some((info) => ctx.nowMs - info.mtimeMs < ctx.olderThanMs)) return entry(root, "kept", "young");
  // Same stale-break path as a root: acquiring breaks a dead owner's lock; ours is released on exit.
  const result = await tryExclusive(ctx, root + OWNED_TEMP_ROOT_LOCK_SUFFIX, async () => {
    if (await lstatOrUndefined(ctx.fs, root)) return entry(root, "kept", "changed");
    await ctx.fs.rm(root + OWNED_TEMP_ROOT_MARKER_SUFFIX, { force: true });
    return entry(root, "removed", "orphan-lock");
  });
  return result ?? entry(root, "kept", "owner-alive");
}

async function sweepOne(ctx: SweepContext, parent: string, root: string): Promise<OwnedTempRootEntry | undefined> {
  const info = await lstatOrUndefined(ctx.fs, root);
  if (!info) return sweepOrphan(ctx, root);
  // lstat never follows links: a symlink named like a root is not a directory here.
  if (!info.isDirectory()) return entry(root, "kept", "not-a-directory");
  if (!await contained(ctx, parent, root)) return entry(root, "kept", "outside-root");
  const marker = await lstatOrUndefined(ctx.fs, root + OWNED_TEMP_ROOT_MARKER_SUFFIX);
  if (!marker?.isFile()) return entry(root, "report-only", await lstatOrUndefined(ctx.fs, root + OWNED_TEMP_ROOT_LOCK_SUFFIX) ? "unconfirmed" : "legacy");
  // Age is only a cheap prefilter. It cannot establish that the owner died: a live writer may hold
  // a root for days (a long import, a paused laptop), so removal still requires the lock below,
  // which only a proven-dead or released owner yields.
  if (ctx.nowMs - info.mtimeMs < ctx.olderThanMs) return entry(root, "kept", "young");
  return removeUnderLock(ctx, root, info);
}

async function sweepOneSafely(ctx: SweepContext, parent: string, root: string): Promise<OwnedTempRootEntry | undefined> {
  try { return await sweepOne(ctx, parent, root); }
  catch (error) {
    // Windows reports an open handle as EBUSY/EPERM/EACCES; the next pass retries.
    if (["EBUSY", "EPERM", "EACCES"].includes(errorCodeOf({ error }) ?? "")) return entry(root, "kept", "busy");
    throw error;
  }
}

/**
 * Tidies owned roots left by dead writers in the named parents, reporting everything else.
 * @param required.roots `{ parent, prefix }` pairs; nothing outside them is read or touched.
 * @param required.lock lock adapter whose liveness probe proves owner death; @param required.signal stops between roots.
 * @param optional.olderThanMs minimum root age (default one day); @param optional.limit roots per pass (default 20).
 * @returns one entry per examined root; `truncated` when the limit stopped the pass.
 * @complexity O(n) directory entries plus O(limit) lock attempts and removals.
 */
export async function sweepOwnedTempRoots(
  required: { roots: ReadonlyArray<{ parent: string; prefix: string }>; fs: OwnedTempRootFilesystem; lock: OwnedTempRootLock; clock: Pick<Clock, "nowMs">; signal: AbortSignal },
  optional: { olderThanMs?: number; limit?: number } = {},
): Promise<OwnedTempRootSweepReport> {
  const ctx: SweepContext = { fs: required.fs, lock: required.lock, nowMs: required.clock.nowMs(), olderThanMs: optional.olderThanMs ?? DAY_MS };
  const limit = optional.limit ?? 20, entries: OwnedTempRootEntry[] = [];
  for (const { parent, prefix } of required.roots) {
    for (const name of exactRootNames(await required.fs.readdir(parent), prefix)) {
      if (required.signal.aborted) return { entries, truncated: false, aborted: true };
      if (entries.length >= limit) return { entries, truncated: true, aborted: false };
      const result = await sweepOneSafely(ctx, parent, join(parent, name));
      if (result) entries.push(result);
    }
  }
  return { entries, truncated: false, aborted: false };
}
