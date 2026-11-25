import path from 'node:path';
import { readClaimsStrict } from './claim-sources.js';
import type { ClaimsRead, PartitionClaimSources, StrictRead } from './claim-sources.js';
import { createHolderRegistry, readHoldersStrict } from './holder-registry.js';
import type { HolderRecord, PartitionFsPort, PartitionProcessPort, PartitionSchedulerPort } from './holder-registry.js';
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
    return t.v === 1 && typeof t.lockToken === 'string' && target && typeof t.seq === 'number'
      ? { lockToken: t.lockToken, target: t.target as FenceTarget, seq: t.seq } : null;
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
  return owner.token === target.lockToken && owner.owner !== 'dead' ? { state: 'busy', seq: target.seq } : { state: 'clear' };
}

/** @complexity O(1) to construct; see each method. */
export function createPartitionInterlock<Session>(
  required: PartitionInterlockRequired<Session>,
  { heartbeatMs = 5000, waitCapMs = 30_000, abandonMs = 5000 }: PartitionInterlockOptional = {},
) {
  const { paths, fs, lock, process, clock, scheduler, messages, log } = required;
  const targetPath = path.join(paths.interlockDir, 'target.json');
  const lockPath = path.join(paths.interlockDir, 'writer.lock');
  const registry = createHolderRegistry({ interlockDir: paths.interlockDir, fs, process, clock });
  const inflight = new Map<string, Promise<unknown>>();
  let heartbeat: { cancel(): void } | null = null;
  let targetWrites = 0;

  const readHolders = (): Promise<StrictRead<HolderRecord[]>> =>
    readHoldersStrict({ interlockDir: paths.interlockDir, fs, process, scheduler });
  const refuse = (message: string, cause?: unknown) => new PartitionOpenRefusedError(message, { cause });

  /** Startup, synchronous, before any window/guest/session. Never throws: failure blocks every open instead. */
  function registerHolder(): { state: 'registered' } | { state: 'failed'; reason: string } {
    if (registry.registered) return { state: 'registered' };
    try { registry.register(); }
    catch (error) {
      log({ event: 'register-failed', detail: String(code(error) ?? error) });
      return { state: 'failed', reason: String(code(error) ?? error) };
    }
    heartbeat = scheduler.every({ ms: heartbeatMs, run: () => {
      registry.publish().catch(error => log({ event: 'heartbeat-failed', detail: String(code(error) ?? error) }));
    } });
    return { state: 'registered' };
  }
  function unregisterHolder(): void { heartbeat?.cancel(); heartbeat = null; registry.unregister(); }

  async function publishIntent(name: string): Promise<void> {
    registry.intents.add(name);
    try { await registry.publish(); }
    catch (error) { registry.intents.delete(name); throw refuse(messages.unregistered({ directory: paths.interlockDir }), error); }
  }
  async function withdrawIntent(name: string): Promise<void> {
    registry.intents.delete(name);
    try { await registry.publish(); } catch (error) { log({ event: 'intent-withdraw-failed', partition: name, detail: String(error) }); }
  }

  /** Quiet `seq` is diagnostic only: a writer suspended by sleep or a debugger is quiet and alive. */
  async function waitForFence(name: string): Promise<void> {
    const start = clock.mono();
    let lastSeq: number | undefined, quietSince = start, logged = false;
    for (;;) {
      const fence = await readFence(name, { fs, lock, targetPath, lockPath });
      if (fence.state === 'clear') return;
      const now = clock.mono();
      if (fence.seq !== lastSeq) { lastSeq = fence.seq; quietSince = now; }
      else if (!logged && now - quietSince >= abandonMs) { logged = true; log({ event: 'writer-quiet', partition: name, detail: `${now - quietSince}ms` }); }
      if (now - start >= waitCapMs) throw new PartitionBusyError(messages.busy);
      await scheduler.sleep({ ms: POLL_MS });
    }
  }

  async function runOpenMaintenance(name: string, subjectDir: string): Promise<OpenMaintenance> {
    const holders = await readHolders();
    if (holders.state === 'unknown') { log({ event: 'maintenance-skipped', partition: name, detail: holders.reason }); return 'skipped-unknown-holders'; }
    const other = holders.value.some(h => h.token !== registry.token && (h.intents.includes(name) || h.held.includes(name)));
    if (other) return 'skipped-other-holder';
    try { await required.openMaintenance({ partition: name, subjectDir }); return 'ran'; }
    catch (error) { log({ event: 'maintenance-failed', partition: name, detail: String(error) }); return 'failed'; }
  }

  async function markHeld(name: string): Promise<void> {
    registry.held.add(name);
    registry.intents.delete(name);
    // On failure the record still lists the intent, which protects the partition just as well.
    try { await registry.publish(); } catch (error) { log({ event: 'held-publish-failed', partition: name, detail: String(error) }); }
  }

  /**
   * The intent is persisted before the target is read (Dekker ordering): if the acquirer read first,
   * a writer could publish its target and read claims in the gap, see no intent, and mutate the
   * partition this process is about to open.
   */
  async function acquireOnce(name: string, subjectDir: string): Promise<{ state: 'held'; partition: string; maintenance: OpenMaintenance }> {
    if (registry.held.has(name)) return { state: 'held', partition: name, maintenance: 'already-held' };
    await publishIntent(name);
    try {
      try { await required.invalidateRetirement({ partition: name, subjectDir, reason: 'reacquired' }); }
      catch (error) { throw refuse(messages.refused, error); }
      await waitForFence(name);
    } catch (error) { await withdrawIntent(name); throw error; }
    const maintenance = await runOpenMaintenance(name, subjectDir);
    await markHeld(name);
    return { state: 'held', partition: name, maintenance };
  }

  function acquireSiteSession({ partition, subjectDir }: { partition: string; subjectDir: string }, _optional: Record<string, never> = {}) {
    const name = partitionDirName(partition);
    if (!registry.registered) return Promise.reject(refuse(messages.unregistered({ directory: paths.interlockDir })));
    if (!required.isManaged(name)) return Promise.reject(refuse(messages.refused));
    const previous = inflight.get(name) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => acquireOnce(name, subjectDir));
    inflight.set(name, next);
    void next.finally(() => { if (inflight.get(name) === next) inflight.delete(name); }).catch(() => {});
    return next;
  }

  function assertHeld({ partition }: { partition: string }, _optional: Record<string, never> = {}): void {
    const name = partitionDirName(partition);
    if (required.isManaged(name) && !registry.held.has(name)) throw new PartitionNotHeldError(partition);
  }
  function siteSession({ partition }: { partition: string }, _optional: Record<string, never> = {}): Session {
    if (!registry.held.has(partitionDirName(partition))) throw new PartitionNotHeldError(partition);
    return required.fromPartition({ partition });
  }

  async function runFenced<T>(held: HeldWriterLock, run: (context: PartitionWriterContext) => Promise<T>): Promise<T> {
    let seq = 0;
    const setTarget = async ({ target }: { target: FenceTarget }) => {
      await held.assertHeld();
      seq += 1;
      const temp = `${targetPath}.${registry.token}.${(targetWrites += 1)}.tmp`;
      await fs.writeFile({ path: temp, data: JSON.stringify({ v: 1, lockToken: held.token, target, seq }) });
      await fs.rename({ oldPath: temp, newPath: targetPath });
    };
    await setTarget({ target: '*' });
    try {
      return await run({
        assertHeld: () => held.assertHeld(),
        setTarget,
        readClaims: () => readClaimsStrict({ selfPid: process.pid, holders: readHolders, sources: required.claimSources }),
        resolveRoot: () => resolvePartitionRoot({ sessionDataDir: paths.sessionDataDir, fs }),
      });
    } finally {
      try { await setTarget({ target: null }); } catch (error) { log({ event: 'target-clear-failed', detail: String(error) }); }
    }
  }

  /**
   * Exclusive mutation of the partition set. The lock must be the async one, held through every
   * awaited rename: a sync JSON lock releases when its callback returns, i.e. at the first await.
   */
  async function withPartitionWriter<T>(
    { run }: { run: (context: PartitionWriterContext) => Promise<T> }, _optional: Record<string, never> = {},
  ): Promise<{ state: 'ran'; value: T } | { state: 'skipped'; reason: 'writer-busy' }> {
    let entered = false;
    try {
      const value = await lock.withFileLock(
        { lockPath, run: async held => { entered = true; return runFenced(held, run); } },
        { staleMs: Number.POSITIVE_INFINITY, timeoutMs: WRITER_TIMEOUT_MS, createParent: true },
      );
      return { state: 'ran', value };
    } catch (error) {
      if (entered) throw error;
      log({ event: 'writer-busy', detail: String(error) });
      return { state: 'skipped', reason: 'writer-busy' };
    }
  }

  return { registerHolder, unregisterHolder, acquireSiteSession, siteSession, assertHeld, withPartitionWriter, readHoldersStrict: readHolders };
}
export type PartitionInterlock = ReturnType<typeof createPartitionInterlock>;
