import path from 'node:path';
import { readClaimsStrict } from './claim-sources.js';
import type { ClaimsRead, PartitionClaimSources, StrictRead } from './claim-sources.js';
import { createHolderRegistry, readHoldersStrict } from './holder-registry.js';
import type { HolderRecord, HolderRegistry, PartitionFsPort, PartitionProcessPort, PartitionSchedulerPort } from './holder-registry.js';
import { resolvePartitionRoot } from './partition-root.js';
import type { PartitionRootRead } from './partition-root.js';

/** The async writer lock, held across every await inside `run` and released in `finally`. */
export interface HeldWriterLock { token: string; assertHeld(): Promise<void> }
export interface WriterLockOptions { staleMs: number; timeoutMs: number; createParent: boolean }
export type WriterLockOwner =
  | { state: 'free' }
  | { state: 'held'; token: string; owner: 'live' | 'dead' | 'unknown' }
  | { state: 'unknown'; reason: string };
export interface PartitionWriterLockPort {
  withFileLock<T>(required: { lockPath: string; run: (held: HeldWriterLock) => Promise<T> }, optional: WriterLockOptions): Promise<T>;
  readToken(required: { lockPath: string }): Promise<WriterLockOwner>;
}
export interface PartitionInterlockMessages {
  busy: string;
  unregistered: (required: { directory: string }) => string;
  refused: string;
}
export type PartitionInterlockLogEvent = { event: string; partition?: string; detail?: string };
export type FenceTarget = string | '*' | null;
export interface PartitionWriterContext {
  assertHeld(): Promise<void>;
  setTarget(required: { target: FenceTarget }): Promise<void>;
  readClaims(): Promise<ClaimsRead>;
  resolveRoot(): Promise<PartitionRootRead>;
}
export type OpenMaintenance = 'ran' | 'already-held' | 'skipped-other-holder' | 'skipped-unknown-holders' | 'failed';

export interface PartitionInterlockRequired<Session> {
  paths: { interlockDir: string; sessionDataDir: string };
  fs: PartitionFsPort;
  lock: PartitionWriterLockPort;
  process: PartitionProcessPort;
  clock: { mono(): number; now(): number };
  scheduler: PartitionSchedulerPort;
  fromPartition: (required: { partition: string }) => Session;
  isManaged: (name: string) => boolean;
  claimSources: PartitionClaimSources;
  invalidateRetirement: (required: { partition: string; subjectDir: string; reason: 'reacquired' }) => Promise<void>;
  openMaintenance: (required: { partition: string; subjectDir: string }) => Promise<void>;
  messages: PartitionInterlockMessages;
  log: (event: PartitionInterlockLogEvent) => void;
}
export interface PartitionInterlockOptional { heartbeatMs?: number; waitCapMs?: number; abandonMs?: number }

export class PartitionBusyError extends Error { override name = 'PartitionBusyError'; }
export class PartitionOpenRefusedError extends Error { override name = 'PartitionOpenRefusedError'; }
export class PartitionNotHeldError extends Error {
  override name = 'PartitionNotHeldError';
  constructor(readonly partition: string) { super(`Partition ${partition} was used before it was acquired.`); }
}

const POLL_MS = 50;
const WRITER_TIMEOUT_MS = 2000;
type Fence = { state: 'clear' } | { state: 'busy'; seq: number | undefined };
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
/** Electron names a persistent partition `persist:<dir>`; claims and files use the directory name. */
export const partitionDirName = (partition: string): string => partition.replace(/^persist:/, '');

function parseTarget(text: string): { lockToken: string; target: FenceTarget; seq: number } | null {
  try {
    const t = JSON.parse(text) as { v?: number; lockToken?: unknown; target?: unknown; seq?: unknown };
    const target = t.target === null || typeof t.target === 'string';
    const valid = t.v === 1 && typeof t.lockToken === 'string' && target && typeof t.seq === 'number';
    return valid ? { lockToken: t.lockToken as string, target: t.target as FenceTarget, seq: t.seq as number } : null;
  } catch { return null; }
}

/**
 * Reads the target fence for `name`. The writer publishes its target before it reads claims and the
 * acquirer publishes its intent before it gets here, so a missing target, a cleared one, a free lock,
 * or a lock token that no longer matches all mean the writer that will act next must still read the
 * intent. Only a live or unknown owner of the matching token keeps the fence.
 */
async function readFence(
  name: string, ctx: { fs: PartitionFsPort; lock: PartitionWriterLockPort; targetPath: string; lockPath: string },
): Promise<Fence> {
  let text: string;
  try { text = await ctx.fs.readFile({ path: ctx.targetPath }); }
  catch (error) { return code(error) === 'ENOENT' ? { state: 'clear' } : { state: 'busy', seq: undefined }; }
  const target = parseTarget(text);
  if (!target) return { state: 'busy', seq: undefined };
  if (target.target !== '*' && target.target !== name) return { state: 'clear' };
  const owner = await ctx.lock.readToken({ lockPath: ctx.lockPath });
  if (owner.state === 'free') return { state: 'clear' };
  if (owner.state === 'unknown') return { state: 'busy', seq: target.seq };
  const fenced = owner.token === target.lockToken && owner.owner !== 'dead';
  return fenced ? { state: 'busy', seq: target.seq } : { state: 'clear' };
}

interface InterlockContext<Session> {
  required: PartitionInterlockRequired<Session>;
  registry: HolderRegistry;
  targetPath: string;
  lockPath: string;
  waitCapMs: number;
  abandonMs: number;
  readHolders(): Promise<StrictRead<HolderRecord[]>>;
}
const describe = (error: unknown) => String(code(error) ?? error);
const refuse = (message: string, cause?: unknown) => new PartitionOpenRefusedError(message, { cause });

async function publishIntent(ctx: InterlockContext<unknown>, name: string): Promise<void> {
  ctx.registry.intents.add(name);
  try { await ctx.registry.publish(); }
  catch (error) {
    ctx.registry.intents.delete(name);
    throw refuse(ctx.required.messages.unregistered({ directory: ctx.required.paths.interlockDir }), error);
  }
}
async function withdrawIntent(ctx: InterlockContext<unknown>, name: string): Promise<void> {
  ctx.registry.intents.delete(name);
  try { await ctx.registry.publish(); } catch (error) { ctx.required.log({ event: 'intent-withdraw-failed', partition: name, detail: describe(error) }); }
}

/**
 * Live or unknown writers keep the fence until the wait cap, then the open is refused as busy.
 * Quiet `seq` is diagnostic only (`abandonMs` logs): a writer suspended by system sleep or a
 * debugger is quiet and alive, so quiet does not mean dead and never authorizes walking past it.
 */
async function waitForFence(ctx: InterlockContext<unknown>, name: string): Promise<void> {
  const { fs, lock, clock, scheduler, log, messages } = ctx.required;
  const start = clock.mono();
  const quiet = { seq: undefined as number | undefined, since: start, logged: false };
  for (;;) {
    const fence = await readFence(name, { fs, lock, targetPath: ctx.targetPath, lockPath: ctx.lockPath });
    if (fence.state === 'clear') return;
    const now = clock.mono();
    if (fence.seq !== quiet.seq) Object.assign(quiet, { seq: fence.seq, since: now });
    if (!quiet.logged && now - quiet.since >= ctx.abandonMs) {
      quiet.logged = true;
      log({ event: 'writer-quiet', partition: name, detail: `${now - quiet.since}ms` });
    }
    if (now - start >= ctx.waitCapMs) throw new PartitionBusyError(messages.busy);
    await scheduler.sleep({ ms: POLL_MS });
  }
}

/** Step 2.5: maintenance only when no other live holder lists the partition; doubt skips maintenance, not the open. */
async function runOpenMaintenance(ctx: InterlockContext<unknown>, name: string, subjectDir: string): Promise<OpenMaintenance> {
  const holders = await ctx.readHolders();
  if (holders.state === 'unknown') {
    ctx.required.log({ event: 'maintenance-skipped', partition: name, detail: holders.reason });
    return 'skipped-unknown-holders';
  }
  const other = holders.value.some(h => h.token !== ctx.registry.token && (h.intents.includes(name) || h.held.includes(name)));
  if (other) return 'skipped-other-holder';
  try { await ctx.required.openMaintenance({ partition: name, subjectDir }); return 'ran'; }
  catch (error) { ctx.required.log({ event: 'maintenance-failed', partition: name, detail: describe(error) }); return 'failed'; }
}

async function markHeld(ctx: InterlockContext<unknown>, name: string): Promise<void> {
  ctx.registry.held.add(name);
  ctx.registry.intents.delete(name);
  // On failure the record still lists the intent, which protects the partition just as well.
  try { await ctx.registry.publish(); } catch (error) { ctx.required.log({ event: 'held-publish-failed', partition: name, detail: describe(error) }); }
}

/**
 * The intent is persisted before the target is read (Dekker ordering over files): if the acquirer
 * read first, a writer could publish its target and read claims in the gap, see no intent, and
 * mutate the partition this process is about to open. Held is sticky and set before any session use.
 */
async function acquireOnce(ctx: InterlockContext<unknown>, name: string, subjectDir: string): Promise<SiteSessionAcquired> {
  if (ctx.registry.held.has(name)) return { state: 'held', partition: name, maintenance: 'already-held' };
  await publishIntent(ctx, name);
  try {
    try { await ctx.required.invalidateRetirement({ partition: name, subjectDir, reason: 'reacquired' }); }
    catch (error) { throw refuse(ctx.required.messages.refused, error); }
    await waitForFence(ctx, name);
  } catch (error) { await withdrawIntent(ctx, name); throw error; }
  const maintenance = await runOpenMaintenance(ctx, name, subjectDir);
  await markHeld(ctx, name);
  return { state: 'held', partition: name, maintenance };
}
export interface SiteSessionAcquired { state: 'held'; partition: string; maintenance: OpenMaintenance }

async function runFenced<T>(ctx: InterlockContext<unknown>, held: HeldWriterLock, run: (context: PartitionWriterContext) => Promise<T>): Promise<T> {
  const { fs, process, paths, claimSources, log } = ctx.required;
  let seq = 0;
  const setTarget = async ({ target }: { target: FenceTarget }) => {
    await held.assertHeld();
    seq += 1;
    const temp = `${ctx.targetPath}.${ctx.registry.token}.${held.token}.${seq}.tmp`;
    await fs.writeFile({ path: temp, data: JSON.stringify({ v: 1, lockToken: held.token, target, seq }) });
    await fs.rename({ oldPath: temp, newPath: ctx.targetPath });
  };
  await setTarget({ target: '*' });
  try {
    return await run({
      assertHeld: () => held.assertHeld(),
      setTarget,
      readClaims: () => readClaimsStrict({ selfPid: process.pid, holders: ctx.readHolders, sources: claimSources }),
      resolveRoot: () => resolvePartitionRoot({ sessionDataDir: paths.sessionDataDir, fs }),
    });
  } finally {
    try { await setTarget({ target: null }); } catch (error) { log({ event: 'target-clear-failed', detail: describe(error) }); }
  }
}

/**
 * Exclusive mutation of the partition set. The lock must be the async one, held through every
 * awaited rename: a sync JSON lock releases when its callback returns, i.e. at the first await.
 */
async function withWriter<T>(
  ctx: InterlockContext<unknown>, run: (context: PartitionWriterContext) => Promise<T>,
): Promise<{ state: 'ran'; value: T } | { state: 'skipped'; reason: 'writer-busy' }> {
  let entered = false;
  try {
    const value = await ctx.required.lock.withFileLock(
      { lockPath: ctx.lockPath, run: async held => { entered = true; return runFenced(ctx, held, run); } },
      { staleMs: Number.POSITIVE_INFINITY, timeoutMs: WRITER_TIMEOUT_MS, createParent: true },
    );
    return { state: 'ran', value };
  } catch (error) {
    if (entered) throw error;
    ctx.required.log({ event: 'writer-busy', detail: describe(error) });
    return { state: 'skipped', reason: 'writer-busy' };
  }
}

/** Startup, synchronous, before any window/guest/session. Never throws: failure blocks every open instead. */
function registerWith(ctx: InterlockContext<unknown>, heartbeatMs: number): { state: 'registered'; heartbeat: { cancel(): void } | null } | { state: 'failed'; reason: string } {
  if (ctx.registry.registered) return { state: 'registered', heartbeat: null };
  try { ctx.registry.register(); }
  catch (error) {
    ctx.required.log({ event: 'register-failed', detail: describe(error) });
    return { state: 'failed', reason: describe(error) };
  }
  const heartbeat = ctx.required.scheduler.every({ ms: heartbeatMs, run: () => {
    ctx.registry.publish().catch(error => ctx.required.log({ event: 'heartbeat-failed', detail: describe(error) }));
  } });
  return { state: 'registered', heartbeat };
}

/** Serializes acquisitions per partition in this process so one intent/held transition runs at a time. */
function acquireSerialized(ctx: InterlockContext<unknown>, inflight: Map<string, Promise<unknown>>, partition: string, subjectDir: string): Promise<SiteSessionAcquired> {
  const name = partitionDirName(partition);
  if (!ctx.registry.registered) return Promise.reject(refuse(ctx.required.messages.unregistered({ directory: ctx.required.paths.interlockDir })));
  if (!ctx.required.isManaged(name)) return Promise.reject(refuse(ctx.required.messages.refused));
  const next = (inflight.get(name) ?? Promise.resolve()).catch(() => {}).then(() => acquireOnce(ctx, name, subjectDir));
  inflight.set(name, next);
  void next.finally(() => { if (inflight.get(name) === next) inflight.delete(name); }).catch(() => {});
  return next;
}

/** @complexity O(1) to construct; see each method. */
export function createPartitionInterlock<Session>(
  required: PartitionInterlockRequired<Session>,
  { heartbeatMs = 5000, waitCapMs = 30_000, abandonMs = 5000 }: PartitionInterlockOptional = {},
) {
  const { paths, fs, process, clock, scheduler } = required;
  const registry = createHolderRegistry({ interlockDir: paths.interlockDir, fs, process, clock });
  const readHolders = () => readHoldersStrict({ interlockDir: paths.interlockDir, fs, process, scheduler });
  const ctx: InterlockContext<unknown> = {
    required, registry, waitCapMs, abandonMs, readHolders,
    targetPath: path.join(paths.interlockDir, 'target.json'), lockPath: path.join(paths.interlockDir, 'writer.lock'),
  };
  const inflight = new Map<string, Promise<unknown>>();
  let heartbeat: { cancel(): void } | null = null;
  const isHeld = (partition: string) => registry.held.has(partitionDirName(partition));
  return {
    registerHolder: () => {
      const result = registerWith(ctx, heartbeatMs);
      if (result.state === 'failed') return result;
      heartbeat = result.heartbeat ?? heartbeat;
      return { state: 'registered' as const };
    },
    unregisterHolder: () => { heartbeat?.cancel(); heartbeat = null; registry.unregister(); },
    acquireSiteSession: ({ partition, subjectDir }: { partition: string; subjectDir: string }, _optional: Record<string, never> = {}) =>
      acquireSerialized(ctx, inflight, partition, subjectDir),
    assertHeld: ({ partition }: { partition: string }, _optional: Record<string, never> = {}) => {
      if (required.isManaged(partitionDirName(partition)) && !isHeld(partition)) throw new PartitionNotHeldError(partition);
    },
    siteSession: ({ partition }: { partition: string }, _optional: Record<string, never> = {}): Session => {
      if (!isHeld(partition)) throw new PartitionNotHeldError(partition);
      return required.fromPartition({ partition });
    },
    withPartitionWriter: <T>({ run }: { run: (context: PartitionWriterContext) => Promise<T> }, _optional: Record<string, never> = {}) => withWriter(ctx, run),
    readHoldersStrict: readHolders,
  };
}
export type PartitionInterlock = ReturnType<typeof createPartitionInterlock>;
