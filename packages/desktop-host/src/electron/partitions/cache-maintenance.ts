import path from 'node:path';
import type { StrictRead } from './claim-sources.js';
import type { HolderRecord, PartitionFsPort } from './holder-registry.js';
import type { CodeCacheMark } from './maintenance-marker.js';
import { listCandidates } from './partition-root.js';
import { DEFAULT_ASIDE_DIR_NAME } from './partition-pass.js';
import type { PartitionInterlock, PartitionWriterContext } from './profile-interlock.js';

/**
 * Cache maintenance for site partitions. Every mutation here is cache-only (`Cache`, `Code Cache`) and
 * gated by packaged evidence that the bundled Electron keeps sign-in stores (Cookies, Local Storage,
 * IndexedDB) when that exact operation runs. Only `'go'` permits a mutation; `'no-go'` and `'unknown'`
 * leave everything as it is.
 */
export type EvidenceVerdict = 'go' | 'no-go' | 'unknown';
export interface PackagedEvidence {
  cap: EvidenceVerdict;
  clearOps: { clearCache: EvidenceVerdict; clearCodeCaches: EvidenceVerdict };
}
export type SizeRead = { state: 'measured'; bytes: number } | { state: 'unknown'; reason: string };
export interface CacheFsPort {
  /** Recursive; must not fail when the folder exists. */
  mkdir(required: { path: string }): Promise<void>;
  rename(required: { oldPath: string; newPath: string }): Promise<void>;
}
export interface TimeoutClock { sleep(required: { ms: number }): Promise<void> }
export type CacheClearMark =
  | { state: 'done'; capBytes: number }
  | { state: 'pending'; capBytes: number; attempts: number; lastReason: string }
  | { state: 'absent' }
  | { state: 'unknown'; reason: string };
export interface CacheClearMarker {
  readCacheClear(required: { partition: string }): Promise<CacheClearMark>;
  markCacheClear(required: { partition: string; capBytes: number; outcome: { state: 'done' } | { state: 'pending'; reason: string } }): Promise<void>;
}
export interface PartitionLocation { name: string; dir: string }
/** Boot: the partition is unheld and the caller holds the writer lock (the partition pass `maintenance` hook). */
export interface BootCacheInterlock {
  phase: 'boot';
  writer: Pick<PartitionWriterContext, 'assertHeld' | 'setTarget'>;
  readHoldersStrict: () => Promise<StrictRead<HolderRecord[]>>;
  /** Lowercase hex; names the aside folder so the next pass sweeps it as cache-only. */
  newToken: () => string;
}
/** Open: runs only as the interlock's `openMaintenance` hook, after its other-holder check and before first use. */
export interface OpenCacheInterlock { phase: 'open'; session: { clearCache(): Promise<void> }; clock: TimeoutClock }
export type Settlement = { state: 'resolved' } | { state: 'rejected'; reason: string };
export type PendingReason = 'busy' | 'held' | 'holders-unknown' | 'unmeasured' | 'missing' | 'failed' | 'timeout';
export type CacheClearMode = 'one-time' | 'periodic';
export type CacheClearResult =
  | { state: 'cleared'; mode: CacheClearMode; bytes: number; aside: string | null }
  | { state: 'below-threshold'; mode: CacheClearMode; bytes: number }
  | { state: 'already-done' }
  | { state: 'pending'; reason: PendingReason; settlement?: Promise<Settlement> }
  | { state: 'skipped'; reason: 'evidence-no-go' | 'evidence-unknown' };
export interface ClearPartitionCacheRequired {
  partition: PartitionLocation;
  interlock: BootCacheInterlock | OpenCacheInterlock;
  fs: CacheFsPort;
  measure: (required: { path: string }) => Promise<SizeRead>;
  marker: CacheClearMarker;
  evidence: PackagedEvidence;
  capBytes: number;
}
export interface ClearPartitionCacheOptional { fallbackMultiplier?: number; timeoutMs?: number; asideDirName?: string }

type Act = { state: 'cleared'; aside: string | null } | { state: 'pending'; reason: PendingReason; settlement?: Promise<Settlement> };
const BUSY: readonly string[] = ['EBUSY', 'EPERM', 'EACCES'];
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const describe = (error: unknown) => String(code(error) ?? (error instanceof Error ? error.message : error));
const evidenceSkip = (verdict: unknown) => ({ state: 'skipped' as const, reason: verdict === 'no-go' ? 'evidence-no-go' as const : 'evidence-unknown' as const });

/**
 * Before `app` is ready: cap the HTTP disk cache, only when packaged evidence shows the switch bounds
 * every persistent partition. Anything other than `'go'` (including a missing or mismatched evidence
 * file, which the host reports as `'unknown'`) sets no switch and claims no bound.
 * @complexity O(1).
 */
export function applyDesktopCacheLimits(
  { appendSwitch, evidence, cacheBytes }: { appendSwitch: (name: string, value: string) => void; evidence: PackagedEvidence; cacheBytes: number },
  _optional: Record<string, never> = {},
): { state: 'applied'; cacheBytes: number } | { state: 'skipped'; reason: 'evidence-no-go' | 'evidence-unknown' | 'invalid-bytes' } {
  if (evidence.cap !== 'go') return evidenceSkip(evidence.cap);
  if (!Number.isSafeInteger(cacheBytes) || cacheBytes <= 0) return { state: 'skipped', reason: 'invalid-bytes' };
  appendSwitch('disk-cache-size', String(cacheBytes));
  return { state: 'applied', cacheBytes };
}

/** Races the real operation against the clock; the result keeps the actual settlement apart from the observed timeout. */
export async function settleWithin(
  { run, clock, timeoutMs }: { run: () => Promise<void>; clock: TimeoutClock; timeoutMs: number },
): Promise<Settlement | { state: 'timed-out'; settlement: Promise<Settlement> }> {
  const settlement: Promise<Settlement> = Promise.resolve().then(run)
    .then(() => ({ state: 'resolved' as const }), error => ({ state: 'rejected' as const, reason: describe(error) }));
  const timer = clock.sleep({ ms: timeoutMs }).then(() => 'timeout' as const);
  const first = await Promise.race([settlement, timer]);
  return first === 'timeout' ? { state: 'timed-out', settlement } : first;
}

/** True when any live holder record (this process included) lists the partition as intended or held. */
export function listedByHolder(holders: readonly HolderRecord[], name: string): boolean {
  return holders.some(h => h.intents.includes(name) || h.held.includes(name));
}

/**
 * Renames one cache folder of an unheld partition into the aside folder, under the writer lock with the
 * target fence on this partition and a fresh holder read after it. The partition pass deletes it later,
 * outside the lock, by its cache-only aside name. Sign-in stores in the partition are never touched.
 */
export async function renameCacheAside(
  { partition, sub, interlock, fs }: { partition: PartitionLocation; sub: 'Cache' | 'Code Cache'; interlock: BootCacheInterlock; fs: CacheFsPort },
  { asideDirName = DEFAULT_ASIDE_DIR_NAME }: { asideDirName?: string } = {},
): Promise<{ state: 'cleared'; aside: string } | { state: 'pending'; reason: 'busy' | 'held' | 'holders-unknown' | 'missing' | 'failed' }> {
  const asideDir = path.join(path.dirname(partition.dir), asideDirName);
  const aside = path.join(asideDir, `${partition.name}.${sub}.${interlock.newToken()}`);
  try {
    await interlock.writer.setTarget({ target: partition.name });
    const holders = await interlock.readHoldersStrict();
    if (holders.state === 'unknown') return { state: 'pending', reason: 'holders-unknown' };
    if (listedByHolder(holders.value, partition.name)) return { state: 'pending', reason: 'held' };
    await interlock.writer.assertHeld();
    await fs.mkdir({ path: asideDir });
    await fs.rename({ oldPath: path.join(partition.dir, sub), newPath: aside });
    return { state: 'cleared', aside };
  } catch (error) {
    const errno = code(error);
    if (errno === 'ENOENT') return { state: 'pending', reason: 'missing' };
    return { state: 'pending', reason: errno !== undefined && BUSY.includes(errno) ? 'busy' : 'failed' };
  }
}

async function clearAtOpen(interlock: OpenCacheInterlock, timeoutMs: number): Promise<Act> {
  const outcome = await settleWithin({ run: () => interlock.session.clearCache(), clock: interlock.clock, timeoutMs });
  if (outcome.state === 'resolved') return { state: 'cleared', aside: null };
  if (outcome.state === 'rejected') return { state: 'pending', reason: 'failed' };
  return { state: 'pending', reason: 'timeout', settlement: outcome.settlement };
}

/**
 * GO cap: the switch bounds the cache, so one clear brings an old oversized cache under it and is latched
 * per profile and cap. NO-GO cap with GO clear evidence: periodic enforcement at `capBytes × multiplier`,
 * re-measured every boot and open and never latched. Periodic enforcement is not a disk bound: between
 * checks Chromium may grow the cache without limit, a busy or held partition is skipped, and a site left
 * open never reaches the next check, so savings are reported as periodic and no cap is claimed.
 */
function planClear(evidence: PackagedEvidence, capBytes: number, multiplier: number): { mode: CacheClearMode; threshold: number } {
  return evidence.cap === 'go' ? { mode: 'one-time', threshold: capBytes } : { mode: 'periodic', threshold: capBytes * multiplier };
}

/** A marker that cannot be read counts as not done: clearing a re-creatable cache twice is harmless. */
async function alreadyDone(marker: CacheClearMarker, name: string, capBytes: number): Promise<boolean> {
  try {
    const mark = await marker.readCacheClear({ partition: name });
    return mark.state === 'done' && mark.capBytes === capBytes;
  } catch { return false; }
}

/** Marker writes never block boot or open; a lost write leaves the partition pending, never falsely done. */
async function mark(required: ClearPartitionCacheRequired, mode: CacheClearMode, outcome: { state: 'done' } | { state: 'pending'; reason: string }): Promise<void> {
  if (mode !== 'one-time') return;
  try { await required.marker.markCacheClear({ partition: required.partition.name, capBytes: required.capBytes, outcome }); }
  catch { /* stays pending: the next start re-measures */ }
}

/**
 * Clears one partition's HTTP `Cache` when it is over the threshold. Boot renames the folder of an unheld
 * partition aside; open awaits the measured `session.clearCache()` before first use. Done is written only
 * after that clear succeeded or a measurement verified the cache is under the threshold; busy, held,
 * unmeasured, failed and timed-out clears stay pending and are retried next start.
 * @complexity O(1) fs operations plus one measurement.
 */
export async function clearPartitionCacheOnce(
  required: ClearPartitionCacheRequired,
  { fallbackMultiplier = 2, timeoutMs = 10_000, asideDirName = DEFAULT_ASIDE_DIR_NAME }: ClearPartitionCacheOptional = {},
): Promise<CacheClearResult> {
  const { partition, interlock, evidence, capBytes } = required;
  if (evidence.clearOps.clearCache !== 'go') return evidenceSkip(evidence.clearOps.clearCache);
  const plan = planClear(evidence, capBytes, fallbackMultiplier);
  if (plan.mode === 'one-time' && (await alreadyDone(required.marker, partition.name, capBytes))) return { state: 'already-done' };
  const size = await required.measure({ path: path.join(partition.dir, 'Cache') }).catch((error): SizeRead => ({ state: 'unknown', reason: describe(error) }));
  if (size.state === 'unknown') {
    await mark(required, plan.mode, { state: 'pending', reason: 'unmeasured' });
    return { state: 'pending', reason: 'unmeasured' };
  }
  if (size.bytes <= plan.threshold) {
    await mark(required, plan.mode, { state: 'done' });
    return { state: 'below-threshold', mode: plan.mode, bytes: size.bytes };
  }
  const act: Act = interlock.phase === 'boot'
    ? await renameCacheAside({ partition, sub: 'Cache', interlock, fs: required.fs }, { asideDirName })
    : await clearAtOpen(interlock, timeoutMs);
  if (act.state === 'cleared') {
    await mark(required, plan.mode, { state: 'done' });
    return { state: 'cleared', mode: plan.mode, bytes: size.bytes, aside: act.aside };
  }
  await mark(required, plan.mode, { state: 'pending', reason: act.reason });
  return act;
}

export interface CodeCacheMarker {
  readCodeCache(): Promise<CodeCacheMark>;
  writeCodeCachePending(required: { forVersion: string; pending: string[] }): Promise<void>;
  writeLaunchVersion(required: { version: string }): Promise<void>;
  settleCodeCache(required: { partition: string }): Promise<void>;
}
export interface CodeCacheInterlock {
  withPartitionWriter: PartitionInterlock['withPartitionWriter'];
  readHoldersStrict: () => Promise<StrictRead<HolderRecord[]>>;
  isManaged: (name: string) => boolean;
  newToken: () => string;
}
export type CodeCacheFsPort = CacheFsPort & Pick<PartitionFsPort, 'readdir' | 'lstat' | 'realpath'>;
export interface ClearCodeCacheOnUpdateRequired {
  interlock: CodeCacheInterlock; fs: CodeCacheFsPort; marker: CodeCacheMarker;
  evidence: PackagedEvidence; version: string; isUpdate: boolean;
}
export type CodeCacheUpdateResult =
  | { state: 'ran'; update: boolean; cleared: string[]; kept: Array<{ partition: string; reason: PendingReason }> }
  | { state: 'skipped'; reason: 'evidence-no-go' | 'evidence-unknown' | 'writer-busy' | 'root-unknown' | 'marker-failed' };
type CodeCacheRun = Exclude<CodeCacheUpdateResult, { state: 'skipped'; reason: 'writer-busy' }>;
interface CodeCachePass { required: ClearCodeCacheOnUpdateRequired; ctx: PartitionWriterContext; asideDirName: string }

/** The managed, contained partition folders under the root; `null` when the root cannot be read for sure. */
async function listManaged(pass: CodeCachePass): Promise<{ root: string; names: string[] } | null> {
  const root = await pass.ctx.resolveRoot();
  if (root.state === 'absent') return { root: '', names: [] };
  if (root.state !== 'ok') return null;
  const list = await listCandidates({ root: root.root, fs: pass.required.fs, isManaged: pass.required.interlock.isManaged });
  return list.state === 'ok' ? { root: root.root, names: list.candidates.map(c => c.name) } : null;
}

/**
 * Pending is durable before the launch version moves: a crash between the two re-detects the update next
 * start and re-adds the same partitions (idempotent), whereas the reverse order could lose the clears.
 */
async function recordUpdate(pass: CodeCachePass, pending: readonly string[], names: readonly string[]): Promise<string[] | null> {
  const next = [...new Set([...pending, ...names])];
  try {
    await pass.required.marker.writeCodeCachePending({ forVersion: pass.required.version, pending: next });
    await pass.required.marker.writeLaunchVersion({ version: pass.required.version });
    return next;
  } catch { return null; }
}

/** Renames `Code Cache` of each pending, unheld partition; busy and held ones stay pending for the next start. */
async function clearPending(pass: CodeCachePass, root: string, pending: readonly string[], present: ReadonlySet<string>) {
  const { interlock, fs, marker } = pass.required;
  const boot: BootCacheInterlock = { phase: 'boot', writer: pass.ctx, readHoldersStrict: interlock.readHoldersStrict, newToken: interlock.newToken };
  const cleared: string[] = [], kept: Array<{ partition: string; reason: PendingReason }> = [];
  for (const name of pending) {
    // A pending partition that is gone, or no longer a contained managed folder, has nothing to clear here.
    if (!present.has(name)) { await marker.settleCodeCache({ partition: name }).catch(() => {}); continue; }
    const result = await renameCacheAside({ partition: { name, dir: path.join(root, name) }, sub: 'Code Cache', interlock: boot, fs }, { asideDirName: pass.asideDirName });
    // ENOENT: no code cache from the old version remains, which is what the update clear is for.
    if (result.state === 'pending' && result.reason !== 'missing') { kept.push({ partition: name, reason: result.reason }); continue; }
    await marker.settleCodeCache({ partition: name }).catch(() => {});
    cleared.push(name);
  }
  return { cleared, kept };
}

async function codeCacheUnderWriter(pass: CodeCachePass): Promise<CodeCacheRun> {
  const { marker, evidence, version, isUpdate } = pass.required;
  const read = await marker.readCodeCache();
  // An unreadable record counts as an update launch: strictly more clears of a re-creatable cache.
  const state = read.state === 'ok' ? read : { lastLaunchVersion: null, pending: [] as string[] };
  const update = isUpdate || state.lastLaunchVersion !== version;
  const managed = await listManaged(pass);
  if (!managed) return { state: 'skipped', reason: 'root-unknown' };
  const pending = update ? await recordUpdate(pass, state.pending, managed.names) : state.pending;
  if (!pending) return { state: 'skipped', reason: 'marker-failed' };
  if (evidence.clearOps.clearCodeCaches !== 'go') return evidenceSkip(evidence.clearOps.clearCodeCaches);
  const { cleared, kept } = await clearPending(pass, managed.root, pending, new Set(managed.names));
  return { state: 'ran', update, cleared, kept };
}

/**
 * Boot: on an update launch (flag or version change) every managed partition's `Code Cache` becomes
 * pending; then, under the writer lock, each pending partition no holder lists is renamed aside. The
 * rename runs only with `'go'` evidence for the code-cache clear. Never throws.
 * @complexity O(partitions) fs operations.
 */
export async function clearCodeCacheOnUpdate(
  required: ClearCodeCacheOnUpdateRequired,
  { asideDirName = DEFAULT_ASIDE_DIR_NAME }: { asideDirName?: string } = {},
): Promise<CodeCacheUpdateResult> {
  try {
    const outcome = await required.interlock.withPartitionWriter({ run: ctx => codeCacheUnderWriter({ required, ctx, asideDirName }) });
    return outcome.state === 'ran' ? outcome.value : { state: 'skipped', reason: 'writer-busy' };
  } catch { return { state: 'skipped', reason: 'writer-busy' }; }
}

export interface MaybeClearCodeCacheAtOpenRequired {
  session: { clearCodeCaches(options: Record<string, never>): Promise<void> };
  /** Size of this partition's `Code Cache`; a bounded walk that answers unknown rather than guessing. */
  measure: () => Promise<SizeRead>;
  evidence: PackagedEvidence;
  /** Bound to this partition: drops it from the update-pending list. */
  marker: { settle(): Promise<void> };
  clock: TimeoutClock;
}
export type CodeCacheOpenResult =
  | { state: 'cleared'; bytes: number }
  | { state: 'below-threshold'; bytes: number }
  | { state: 'pending'; reason: 'failed' | 'timeout'; settlement?: Promise<Settlement> }
  | { state: 'skipped'; reason: 'evidence-no-go' | 'evidence-unknown' | 'unmeasured' };

/**
 * Open-time code-cache clear. It runs only as the interlock's `openMaintenance` hook (step 2.5), which
 * already found no other holder and has not yet marked the partition held, so no window or guest uses the
 * session while it clears; it does no holders check of its own. A second window of a held site must skip
 * it: that window shares the live session, whose pages are already running and may be compiling into the
 * code cache, and the clear would race them; the interlock returns `already-held` without calling it.
 * Success is marked only when `clearCodeCaches` resolves; a timeout is reported apart from the settlement.
 * @complexity O(1) plus one measurement.
 */
export async function maybeClearCodeCacheAtOpen(
  { session, measure, evidence, marker, clock }: MaybeClearCodeCacheAtOpenRequired,
  { maxBytes = 64 * 2 ** 20, timeoutMs = 10_000 }: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<CodeCacheOpenResult> {
  if (evidence.clearOps.clearCodeCaches !== 'go') return evidenceSkip(evidence.clearOps.clearCodeCaches);
  const size = await measure().catch((error): SizeRead => ({ state: 'unknown', reason: describe(error) }));
  if (size.state === 'unknown') return { state: 'skipped', reason: 'unmeasured' };
  if (size.bytes <= maxBytes) return { state: 'below-threshold', bytes: size.bytes };
  const outcome = await settleWithin({ run: () => session.clearCodeCaches({}), clock, timeoutMs });
  if (outcome.state === 'rejected') return { state: 'pending', reason: 'failed' };
  if (outcome.state === 'timed-out') return { state: 'pending', reason: 'timeout', settlement: outcome.settlement };
  await marker.settle().catch(() => {});
  return { state: 'cleared', bytes: size.bytes };
}
