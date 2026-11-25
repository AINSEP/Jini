import path from 'node:path';
import type { PartitionFsPort } from './holder-registry.js';
import { listCandidates } from './partition-root.js';
import { isAmbiguousPartitionEligible } from './partition-inventory.js';
import type { PartitionCandidate } from './partition-root.js';
import { partitionDirName } from './profile-interlock.js';
import type { PartitionInterlock, PartitionWriterContext } from './profile-interlock.js';
import type { ErasedRetirementCandidate, RetirementLedger, RetirementRecord } from './retirement-ledger.js';

export interface PartitionPassStat { isDirectory(): boolean; isSymbolicLink(): boolean; dev: number }
/** `rm` is recursive and not forced; `rename` stays on one filesystem (the aside folder is a child of the root). */
export interface PartitionPassFsPort extends Pick<PartitionFsPort, 'readdir' | 'realpath' | 'rename'> {
  lstat(required: { path: string }): Promise<PartitionPassStat>;
  mkdir(required: { path: string }): Promise<void>;
  rm(required: { path: string }): Promise<void>;
}
export type PartitionPassInterlock = Pick<PartitionInterlock, 'withPartitionWriter' | 'readHoldersStrict'>;
export type PartitionPassLedger = Pick<RetirementLedger, 'profile' | 'readStrict' | 'transition' | 'append'>;
export interface PartitionPassRoot { isManaged(name: string): boolean }
export interface PartitionPassReport {
  result: 'done' | 'skipped' | 'failed'; reason?: string;
  removed: string[]; cacheCleared: string[]; restored: string[];
  kept: Array<{ partition: string; reason: string }>; skipped: Array<{ name: string; reason: string }>;
}
/** Boot cache work (one-time and update clears) for unheld partitions; runs under the target fence. */
/** `writer` is the pass's writer context, so cache-only renames can recheck holders and assert the lock. */
export type PartitionMaintenance = (required: { partition: string; path: string; classification: 'tracked' | 'ambiguous'; writer: PartitionWriterContext }) => Promise<void>;
export interface PartitionPassRequired {
  interlock: PartitionPassInterlock; ledger: PartitionPassLedger; fs: PartitionPassFsPort; root: PartitionPassRoot;
  maintenance: PartitionMaintenance; report: (required: { report: PartitionPassReport }) => void;
  scheduler: { sleep(required: { ms: number }): Promise<void> }; newToken: () => string;
}
export interface PartitionPassOptional { budgetMs?: number; asideDirName?: string }
export type PartitionPassOutcome = { state: 'finished'; report: PartitionPassReport } | { state: 'continuing'; done: Promise<PartitionPassReport> };
export interface PartitionRemovalConfirmation { partition: string; confirmed: true; evidence: 'owner-dialog' }
export interface ManualRemovalRequired {
  partition: string; interlock: PartitionPassInterlock; ledger: PartitionPassLedger; fs: PartitionPassFsPort;
  root: PartitionPassRoot; confirmation: PartitionRemovalConfirmation; newToken: () => string;
}
export type ManualRemovalResult =
  | { state: 'removed' }
  | { state: 'kept'; reason: 'protected' | 'busy' | 'unknown' | 'missing' }
  | { state: 'refused'; reason: 'unconfirmed' | 'not-managed' };

export const DEFAULT_ASIDE_DIR_NAME = '.removing';
const CACHE_DIRS = ['Cache', 'Code Cache'] as const;
const CACHE_ASIDE = /^(.+)\.(?:Cache|Code Cache)\.[0-9a-f]+$/;
const WHOLE_ASIDE = /^(.+)\.[0-9a-f]+$/;
const HOLD_PREFIX = 'hold-';

interface Shared { interlock: PartitionPassInterlock; ledger: PartitionPassLedger; fs: PartitionPassFsPort; isManaged: (name: string) => boolean; newToken: () => string; asideDirName: string }
interface Pass extends Shared {
  ctx: PartitionWriterContext; root: string; asideRoot: string; records: RetirementRecord[];
  others: number[]; claimed: Set<string>; held: Set<string>; report: PartitionPassReport; deleteQueue: string[];
}
type Verdict = { to: 'pending' | 'invalidated'; reason: string };

const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const describe = (error: unknown) => String(code(error) ?? (error instanceof Error ? error.message : error));
const emptyReport = (): PartitionPassReport => ({ result: 'done', removed: [], cacheCleared: [], restored: [], kept: [], skipped: [] });

async function lstatOr(fs: PartitionPassFsPort, target: string): Promise<PartitionPassStat | 'absent' | 'error'> {
  try { return await fs.lstat({ path: target }); } catch (error) { return code(error) === 'ENOENT' ? 'absent' : 'error'; }
}

/** Absence counts only when the recorded parent is present on the recorded device and the child is ENOENT. */
async function absentForSure(fs: PartitionPassFsPort, rec: ErasedRetirementCandidate): Promise<'absent' | 'exists' | 'uncertain'> {
  const parent = await lstatOr(fs, rec.parentDir);
  if (typeof parent === 'string' || !parent.isDirectory() || parent.dev !== rec.parentDev) return 'uncertain';
  const subject = await lstatOr(fs, rec.subjectDir);
  if (subject === 'absent') return 'absent';
  return subject === 'error' ? 'uncertain' : 'exists';
}
function absenceVerdict(absence: 'absent' | 'exists' | 'uncertain'): Verdict | null {
  if (absence === 'absent') return null;
  return absence === 'exists' ? { to: 'invalidated', reason: 'site-exists' } : { to: 'pending', reason: 'absence-uncertain' };
}

function safeTransition(S: Pass, input: Parameters<PartitionPassLedger['transition']>[0]): boolean {
  try { return S.ledger.transition(input, {}).state === 'ok'; } catch { return false; }
}
function settle(S: Pass, rec: RetirementRecord, verdict: Verdict): void {
  safeTransition(S, { id: rec.id, from: 'pending', to: verdict.to, reason: verdict.reason });
  S.report.kept.push({ partition: rec.partition, reason: verdict.reason });
}

async function heldNow(S: Pass, partition: string): Promise<boolean> {
  const holders = await S.interlock.readHoldersStrict();
  return holders.state === 'unknown' || holders.value.some(h => h.intents.includes(partition) || h.held.includes(partition));
}
/** A fresh strict read of every claim source; anything other than "no claim at all" keeps the partition. */
async function freshClaimVerdict(S: Pass, partition: string): Promise<Verdict | null> {
  const claims = await S.ctx.readClaims();
  if (claims.state === 'unknown') return { to: 'pending', reason: 'unknown-claims' };
  if (claims.otherInstances.length > 0) return { to: 'pending', reason: 'other-instance' };
  if (!claims.claimed.includes(partition)) return null;
  return { to: 'pending', reason: (await heldNow(S, partition)) ? 'held' : 'tracked' };
}

async function renameAside(S: Pass, from: string, to: string): Promise<boolean> {
  try {
    await S.ctx.assertHeld();
    await S.fs.mkdir({ path: S.asideRoot });
    await S.fs.rename({ oldPath: from, newPath: to });
    return true;
  } catch { return false; }
}

/** Puts an uncommitted aside back. If something now occupies the name, the aside becomes a protected hold. */
async function restoreAside(S: Pass, partition: string, asidePath: string): Promise<void> {
  try {
    await S.ctx.setTarget({ target: partition });
    const occupied = await lstatOr(S.fs, path.join(S.root, partition));
    const dest = occupied === 'absent' ? path.join(S.root, partition) : path.join(S.asideRoot, `${HOLD_PREFIX}${path.basename(asidePath)}`);
    await S.fs.rename({ oldPath: asidePath, newPath: dest });
    if (occupied === 'absent') S.report.restored.push(partition);
    else S.report.skipped.push({ name: path.basename(dest), reason: 'hold' });
  } catch (error) {
    S.report.skipped.push({ name: path.basename(asidePath), reason: `restore-failed (${describe(error)})` });
  }
}

/**
 * Shared by automatic and owner removal: record the aside name, rename, recheck, then commit by CAS on
 * the record ID and exact aside name. The CAS is the only commit point; anything else restores.
 */
async function asideAndCommit(S: Pass, rec: RetirementRecord, recheck: () => Promise<Verdict | null>): Promise<boolean> {
  const aside = `${rec.partition}.${S.newToken()}`, asidePath = path.join(S.asideRoot, aside);
  if (!safeTransition(S, { id: rec.id, from: 'pending', to: 'pending', reason: 'renaming', asideIdentity: aside })) {
    S.report.kept.push({ partition: rec.partition, reason: 'ledger-unavailable' });
    return false;
  }
  if (!(await renameAside(S, path.join(S.root, rec.partition), asidePath))) { settle(S, rec, { to: 'pending', reason: 'busy' }); return false; }
  let committed = false;
  try {
    const verdict = await recheck();
    if (verdict) settle(S, rec, verdict);
    else committed = safeTransition(S, { id: rec.id, from: 'pending', to: 'removed', asideIdentity: aside });
  } catch (error) { S.report.skipped.push({ name: rec.partition, reason: `recheck-failed (${describe(error)})` }); }
  if (!committed) { await restoreAside(S, rec.partition, asidePath); return false; }
  S.deleteQueue.push(asidePath);
  return true;
}

async function precheck(S: Pass, rec: RetirementRecord): Promise<Verdict | null> {
  if (rec.basis !== 'erased') return { to: 'invalidated', reason: 'owner-interrupted' };
  if (rec.profile !== S.ledger.profile || rec.sessionRoot !== S.root) return { to: 'invalidated', reason: 'profile-mismatch' };
  if (S.others.length > 0) return { to: 'pending', reason: 'other-instance' };
  if (S.claimed.has(rec.partition)) return { to: 'pending', reason: S.held.has(rec.partition) ? 'held' : 'tracked' };
  return absenceVerdict(await absentForSure(S.fs, rec));
}

async function recheckRetired(S: Pass, rec: ErasedRetirementCandidate): Promise<Verdict | null> {
  return (await freshClaimVerdict(S, rec.partition)) ?? absenceVerdict(await absentForSure(S.fs, rec));
}

async function retireOne(S: Pass, rec: RetirementRecord): Promise<void> {
  const verdict = await precheck(S, rec);
  if (verdict || rec.basis !== 'erased') { settle(S, rec, verdict ?? { to: 'invalidated', reason: 'owner-interrupted' }); return; }
  await S.ctx.setTarget({ target: rec.partition });
  // Dekker read: the target is on disk before claims are re-read, and an acquirer publishes its intent
  // before it reads the target, so at least one side sees the other.
  const fresh = await freshClaimVerdict(S, rec.partition);
  if (fresh) settle(S, rec, fresh);
  else if (await asideAndCommit(S, rec, () => recheckRetired(S, rec))) S.report.removed.push(rec.partition);
  await S.ctx.setTarget({ target: '*' });
}

/** Ambiguous partitions lose only measured cache folders; sign-in stores are never touched. */
async function cleanAmbiguous(S: Pass, partition: string): Promise<void> {
  for (const sub of CACHE_DIRS) {
    const from = path.join(S.root, partition, sub);
    const stat = await lstatOr(S.fs, from);
    if (typeof stat === 'string' || stat.isSymbolicLink() || !stat.isDirectory()) continue;
    await S.ctx.setTarget({ target: partition });
    if (await freshClaimVerdict(S, partition)) { S.report.kept.push({ partition, reason: 'held' }); return; }
    const to = path.join(S.asideRoot, `${partition}.${sub}.${S.newToken()}`);
    if (!(await renameAside(S, from, to))) { S.report.skipped.push({ name: `${partition}/${sub}`, reason: 'busy' }); continue; }
    S.deleteQueue.push(to);
    if (!S.report.cacheCleared.includes(partition)) S.report.cacheCleared.push(partition);
  }
}

async function runMaintenance(S: Pass, partition: string, classification: 'tracked' | 'ambiguous', maintenance: PartitionMaintenance): Promise<void> {
  if (S.others.length > 0) return;
  await S.ctx.setTarget({ target: partition });
  if (await heldNow(S, partition)) return;
  try { await maintenance({ partition, path: path.join(S.root, partition), classification, writer: S.ctx }); }
  catch (error) { S.report.skipped.push({ name: partition, reason: `maintenance-failed (${describe(error)})` }); }
}

async function classifyOne(S: Pass, candidate: PartitionCandidate, maintenance: PartitionMaintenance): Promise<void> {
  const p = candidate.name;
  const rec = S.records.find(r => r.state === 'pending' && r.partition === p);
  if (S.claimed.has(p)) {
    const reason = S.held.has(p) ? 'held' : 'tracked';
    if (rec) settle(S, rec, { to: 'pending', reason }); else S.report.kept.push({ partition: p, reason });
    if (reason === 'tracked') await runMaintenance(S, p, 'tracked', maintenance);
    return;
  }
  if (rec) { await retireOne(S, rec); return; }
  if (S.others.length > 0) { S.report.kept.push({ partition: p, reason: 'other-instance' }); return; }
  await cleanAmbiguous(S, p);
  await runMaintenance(S, p, 'ambiguous', maintenance);
}

/**
 * An aside folder is not deletion authority: its name says which partition it came from, not that the
 * removal was proven. Only a `removed` record naming this exact folder, or a cache-only aside name,
 * lets it be deleted; every other whole aside is restored, and unrecognised entries are left alone.
 */
async function sweepOne(S: Pass, name: string): Promise<void> {
  const full = path.join(S.asideRoot, name);
  if (name.startsWith(HOLD_PREFIX)) { S.report.skipped.push({ name, reason: 'hold' }); return; }
  const cache = CACHE_ASIDE.exec(name);
  if (cache && S.isManaged(cache[1]!)) { S.deleteQueue.push(full); return; }
  const whole = WHOLE_ASIDE.exec(name);
  if (!whole || !S.isManaged(whole[1]!)) { S.report.skipped.push({ name, reason: 'unknown-aside' }); return; }
  const committed = S.records.some(r => r.state === 'removed' && r.partition === whole[1] && r.asideIdentity === name);
  if (committed) S.deleteQueue.push(full); else await restoreAside(S, whole[1]!, full);
}
async function sweepAsides(S: Pass): Promise<void> {
  let names: string[];
  try { names = await S.fs.readdir({ path: S.asideRoot }); }
  catch (error) {
    if (code(error) !== 'ENOENT') S.report.skipped.push({ name: S.asideDirName, reason: 'unreadable' });
    return;
  }
  for (const name of names) await sweepOne(S, name);
}

async function loadClaims(S: Pass): Promise<boolean> {
  const claims = await S.ctx.readClaims();
  const holders = await S.interlock.readHoldersStrict();
  if (claims.state === 'unknown' || holders.state === 'unknown') return false;
  claims.claimed.forEach(p => S.claimed.add(p));
  S.others.push(...claims.otherInstances);
  for (const h of holders.value) [...h.intents, ...h.held].forEach(p => S.held.add(p));
  return true;
}

/** A damaged ledger leaves the retired class empty: no proof, so nothing is removed whole. */
function readRecords(shared: Shared, report: PartitionPassReport): RetirementRecord[] {
  const read = shared.ledger.readStrict({}, {});
  if (read.state === 'ok') return read.records;
  report.skipped.push({ name: 'ledger', reason: read.reason });
  return [];
}

function openPass(shared: Shared, ctx: PartitionWriterContext, root: string, report: PartitionPassReport, deleteQueue: string[]): Pass {
  return {
    ...shared, ctx, root, asideRoot: path.join(root, shared.asideDirName), records: readRecords(shared, report),
    others: [], claimed: new Set(), held: new Set(), report, deleteQueue,
  };
}
const skip = (report: PartitionPassReport, reason: string) => Object.assign(report, { result: 'skipped', reason });

async function passUnderWriter(shared: Shared, ctx: PartitionWriterContext, report: PartitionPassReport, deleteQueue: string[], maintenance: PartitionMaintenance): Promise<void> {
  const rootRead = await ctx.resolveRoot();
  if (rootRead.state === 'absent') return;
  if (rootRead.state === 'unknown') { skip(report, 'unknown-root'); return; }
  const S = openPass(shared, ctx, rootRead.root, report, deleteQueue);
  // Restoring uncommitted asides first is always safe and must not wait for claims to become readable.
  await sweepAsides(S);
  if (!(await loadClaims(S))) { skip(report, 'unknown-claims'); return; }
  const list = await listCandidates({ root: S.root, fs: S.fs, isManaged: S.isManaged });
  if (list.state === 'unknown') { skip(report, 'unknown-root'); return; }
  report.skipped.push(...list.skipped);
  for (const candidate of list.candidates) await classifyOne(S, candidate, maintenance);
}

/** Deletion happens outside the writer lock, and only for committed or cache-only asides. */
async function drainDeleteQueue(fs: PartitionPassFsPort, queue: readonly string[], report: PartitionPassReport): Promise<void> {
  for (const target of queue) {
    try { await fs.rm({ path: target }); } catch (error) { report.skipped.push({ name: path.basename(target), reason: `delete-failed (${describe(error)})` }); }
  }
}

const sharedFrom = (r: { interlock: PartitionPassInterlock; ledger: PartitionPassLedger; fs: PartitionPassFsPort; root: PartitionPassRoot; newToken: () => string }, asideDirName: string): Shared =>
  ({ interlock: r.interlock, ledger: r.ledger, fs: r.fs, isManaged: name => r.root.isManaged(name), newToken: r.newToken, asideDirName });

async function executePass(required: PartitionPassRequired, asideDirName: string): Promise<PartitionPassReport> {
  const report = emptyReport(), deleteQueue: string[] = [];
  const shared = sharedFrom(required, asideDirName);
  try {
    const outcome = await required.interlock.withPartitionWriter({ run: ctx => passUnderWriter(shared, ctx, report, deleteQueue, required.maintenance) });
    if (outcome.state === 'skipped') skip(report, outcome.reason);
  } catch (error) { Object.assign(report, { result: 'failed', reason: describe(error) }); }
  await drainDeleteQueue(required.fs, deleteQueue, report);
  required.report({ report });
  return report;
}

/**
 * Next-start partition pass: restore uncommitted asides, then remove proven-retired partitions whole and
 * clear cache folders of ambiguous ones. Resolves at the budget at the latest; the pass keeps running.
 * @complexity O(candidates + asides) fs operations.
 */
export async function runPartitionPass(
  required: PartitionPassRequired,
  { budgetMs = 3000, asideDirName = DEFAULT_ASIDE_DIR_NAME }: PartitionPassOptional = {},
): Promise<PartitionPassOutcome> {
  const done = executePass(required, asideDirName);
  const budget = required.scheduler.sleep({ ms: budgetMs }).then(() => ({ state: 'continuing' as const, done }));
  return Promise.race([done.then(report => ({ state: 'finished' as const, report })), budget]);
}

function isConfirmed(confirmation: PartitionRemovalConfirmation | undefined, name: string): boolean {
  const c = confirmation as Partial<PartitionRemovalConfirmation> | undefined;
  return c?.confirmed === true && c.evidence === 'owner-dialog' && typeof c.partition === 'string' && partitionDirName(c.partition) === name;
}

const keptBecause = (reason: string | undefined): ManualRemovalResult => {
  if (reason === 'busy') return { state: 'kept', reason: 'busy' };
  if (reason === 'ledger-unavailable' || reason === 'unknown-claims') return { state: 'kept', reason: 'unknown' };
  return { state: 'kept', reason: 'protected' };
};

/** Pre-write checks for owner-confirmed removal, in order: claims readable, no other holders, not claimed, a real directory. `null` means proceed. */
async function manualPreflight(S: Pass, partition: string): Promise<ManualRemovalResult | null> {
  if (!(await loadClaims(S))) return { state: 'kept', reason: 'unknown' };
  const ledger = S.ledger.readStrict({}, {});
  if (ledger.state === 'unknown') return { state: 'kept', reason: 'unknown' };
  if (S.others.length > 0) return { state: 'kept', reason: 'busy' };
  const claims = { state: 'ok' as const, claimed: [...S.claimed, ...S.held], otherInstances: S.others };
  if (!isAmbiguousPartitionEligible({ partition, claims, ledger })) return { state: 'kept', reason: 'protected' };
  const list = await listCandidates({ root: S.root, fs: S.fs, isManaged: S.isManaged });
  if (list.state === 'unknown') return { state: 'kept', reason: 'unknown' };
  if (!list.candidates.some(candidate => candidate.name === partition)) return { state: 'kept', reason: 'missing' };
  return null;
}

async function manualUnderWriter(shared: Shared, ctx: PartitionWriterContext, partition: string, deleteQueue: string[]): Promise<ManualRemovalResult> {
  const rootRead = await ctx.resolveRoot();
  if (rootRead.state !== 'ok') return { state: 'kept', reason: rootRead.state === 'absent' ? 'missing' : 'unknown' };
  const S = openPass(shared, ctx, rootRead.root, emptyReport(), deleteQueue);
  const notRemovable = await manualPreflight(S, partition);
  if (notRemovable) return notRemovable;
  await ctx.setTarget({ target: partition });
  const fresh = await freshClaimVerdict(S, partition);
  if (fresh) return keptBecause(fresh.reason);
  const rec = S.ledger.append({ candidate: { basis: 'owner-dialog', profile: S.ledger.profile, sessionRoot: S.root, partition } }, {});
  const recheck = async (): Promise<Verdict | null> => {
    const verdict = await freshClaimVerdict(S, partition);
    return verdict && { to: 'invalidated', reason: verdict.reason };
  };
  if (await asideAndCommit(S, rec, recheck)) return { state: 'removed' };
  return keptBecause(S.report.kept.at(-1)?.reason);
}

/**
 * Owner-confirmed removal of one ambiguous partition (its sign-ins), with the same fence, rename,
 * post-rename recheck and CAS commit as automatic removal. A missing or mismatched confirmation is refused.
 * @complexity O(1) partitions; O(claims) per recheck.
 */
export async function removeAmbiguousPartition(
  required: ManualRemovalRequired,
  { asideDirName = DEFAULT_ASIDE_DIR_NAME }: { asideDirName?: string } = {},
): Promise<ManualRemovalResult> {
  const name = partitionDirName(required.partition);
  if (!isConfirmed(required.confirmation, name)) return { state: 'refused', reason: 'unconfirmed' };
  if (!required.root.isManaged(name)) return { state: 'refused', reason: 'not-managed' };
  const deleteQueue: string[] = [];
  let result: ManualRemovalResult = { state: 'kept', reason: 'busy' };
  try {
    const shared = sharedFrom(required, asideDirName);
    const outcome = await required.interlock.withPartitionWriter({ run: async ctx => { result = await manualUnderWriter(shared, ctx, name, deleteQueue); } });
    if (outcome.state === 'skipped') result = { state: 'kept', reason: 'busy' };
  } catch { result = deleteQueue.length > 0 ? { state: 'removed' } : { state: 'kept', reason: 'unknown' }; }
  await drainDeleteQueue(required.fs, deleteQueue, emptyReport());
  return result;
}
