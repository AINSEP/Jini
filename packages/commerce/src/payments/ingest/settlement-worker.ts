import { describeErrorForLog } from '@jini-ai/core';

export interface CommerceWorkerRequired {
  /** Only the serving owner schedules jobs; daemon/client compositions never do. */
  owner: boolean;
  active(): Promise<boolean>;
  hasPending(): Promise<boolean>;
  run(): Promise<void>;
  /** `message` is plain words + the cause's class/code (safe metadata only). `optional.error` is the
   *  original error for the host's own sink and redaction policy; never print it raw. */
  warn(required: { readonly message: string }, optional?: { readonly error?: unknown }): void;
}
export interface CommerceWorkerOptional {
  /** Native PostgreSQL reserves a session advisory lock for the owner's whole lifetime. */
  withOwnership: (run: (lease?: { assertOwned(): Promise<void> }) => Promise<void>) => Promise<{ acquired: boolean }>;
  schedule: (run: () => void, delayMs: number) => () => void;
}

/** Mutable lifecycle of one worker; owned by `createSettlementWorker` and only touched through the helpers below. */
interface WorkerState {
  cancel: (() => void) | undefined;
  current: Promise<void> | undefined;
  holding: Promise<void> | undefined;
  checking: Promise<void> | undefined;
  finish: (() => void) | undefined;
  closed: boolean;
  assertOwned: (() => Promise<void>) | undefined;
  delayed: boolean;
  ownershipBlocked: boolean;
}
/** `own`/`schedule` are captured once at creation, exactly as the host handed them over. */
interface WorkerContext { required: CommerceWorkerRequired; own: CommerceWorkerOptional['withOwnership']; schedule: CommerceWorkerOptional['schedule']; state: WorkerState }

async function stillOwner({ required, state }: WorkerContext): Promise<boolean> {
  if (state.closed) return false;
  try { await state.assertOwned?.(); return true; } catch (error) {
    required.warn({ message: `Payment settlement ownership was lost; this process stopped its worker. Cause: ${describeErrorForLog({ err: error })}` }, { error }); return false;
  }
}
async function hasWork({ required }: Pick<WorkerContext, 'required'>): Promise<boolean> {
  try { if (await required.active()) return true; } catch { /* Activation governs new work; durable work still drains. */ }
  return required.hasPending();
}
async function step(context: WorkerContext): Promise<void> {
  const { required, schedule, state } = context;
  if (!await stillOwner(context)) { state.finish?.(); return; }
  try {
    if (!await hasWork(context)) { state.finish?.(); return; }
    await required.run(); state.delayed = false;
  } catch (error) {
    if (!state.delayed) required.warn({ message: `Payment settlement is delayed; recorded payments will retry automatically. Cause: ${describeErrorForLog({ err: error })}` }, { error });
    state.delayed = true;
  }
  if (!state.closed) state.cancel = schedule(() => {
    state.cancel = undefined;
    state.current = step(context).finally(() => { state.current = undefined; });
  }, 5000);
}
async function retryOwnership(context: WorkerContext, kick: () => Promise<void>): Promise<void> {
  const { required, schedule, state } = context;
  if (state.closed) return;
  try {
    if (!await hasWork(context)) return;
    if (!state.closed) state.cancel = schedule(() => { state.cancel = undefined; void kick(); }, 5000);
  } catch (error) { required.warn({ message: `Payment settlement ownership retry is delayed; recorded work remains queued. Cause: ${describeErrorForLog({ err: error })}` }, { error }); }
}
async function kickWorker(context: WorkerContext, kick: () => Promise<void>): Promise<void> {
  const { required, own, state } = context;
  if (!required.owner || state.closed || state.holding) return;
  state.cancel?.(); state.cancel = undefined;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const done = new Promise<void>(resolve => { state.finish = resolve; });
  state.holding = own(async (lease?: { assertOwned(): Promise<void> }) => {
    state.ownershipBlocked = false;
    state.assertOwned = lease?.assertOwned;
    state.current = step(context).finally(() => { state.current = undefined; started(); });
    await state.current; await done;
  }).then(result => {
    if (!result.acquired && !state.ownershipBlocked) required.warn({ message: 'Another serving process owns payment settlement for this database.' });
    state.ownershipBlocked = !result.acquired;
  }).catch((error: unknown) => {
    if (!state.ownershipBlocked) required.warn({ message: `Payment settlement ownership could not be acquired; recorded payments remain queued. Cause: ${describeErrorForLog({ err: error })}` }, { error });
    state.ownershipBlocked = true;
  })
    .finally(async () => { state.holding = undefined; started(); state.checking = retryOwnership(context, kick); await state.checking; state.checking = undefined; });
  await ready;
}
async function closeWorker({ state }: Pick<WorkerContext, 'state'>): Promise<void> {
  state.closed = true; state.cancel?.(); state.cancel = undefined;
  await state.current; state.finish?.(); await state.holding; await state.checking;
}

/** Bind existing host ownership to one serialized settlement owner, active or draining.
 * No transaction spans provider HTTP: kernel dispatch snapshots commit independently.
 * @complexity One cycle/5s while active/draining, no idle timers; one owner lock held while running. */
export function createSettlementWorker(required: CommerceWorkerRequired & CommerceWorkerOptional, _optional: Record<string, never> = {}): {
  kick(): Promise<void>; close(): Promise<void>;
} {
  const context: WorkerContext = { required, own: required.withOwnership, schedule: required.schedule, state: { cancel: undefined, current: undefined, holding: undefined, checking: undefined,
    finish: undefined, closed: false, assertOwned: undefined, delayed: false, ownershipBlocked: false } };
  const worker = { kick: () => kickWorker(context, worker.kick), close: () => closeWorker(context) };
  return worker;
}
