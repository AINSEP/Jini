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

/** Bind existing host ownership to one serialized settlement owner, active or draining.
 * No transaction spans provider HTTP: kernel dispatch snapshots commit independently.
 * @complexity One cycle/5s while active/draining, no idle timers; one owner lock held while running. */
export function createSettlementWorker(required: CommerceWorkerRequired & CommerceWorkerOptional, _optional: Record<string, never> = {}): {
  kick(): Promise<void>; close(): Promise<void>;
} {
  const own = required.withOwnership;
  const schedule = required.schedule;
  let cancel: (() => void) | undefined;
  let current: Promise<void> | undefined;
  let holding: Promise<void> | undefined;
  let checking: Promise<void> | undefined;
  let finish: (() => void) | undefined;
  let closed = false;
  let assertOwned: (() => Promise<void>) | undefined;
  let delayed = false;
  let ownershipBlocked = false;
  async function stillOwner(): Promise<boolean> {
    if (closed) return false;
    try { await assertOwned?.(); return true; } catch (error) {
      required.warn({ message: `Payment settlement ownership was lost; this process stopped its worker. Cause: ${describeErrorForLog({ err: error })}` }, { error }); return false;
    }
  }
  async function hasWork(): Promise<boolean> {
    try { if (await required.active()) return true; } catch { /* Activation governs new work; durable work still drains. */ }
    return required.hasPending();
  }
  async function step(): Promise<void> {
    if (!await stillOwner()) { finish?.(); return; }
    try {
      if (!await hasWork()) { finish?.(); return; }
      await required.run(); delayed = false;
    } catch (error) {
      if (!delayed) required.warn({ message: `Payment settlement is delayed; recorded payments will retry automatically. Cause: ${describeErrorForLog({ err: error })}` }, { error });
      delayed = true;
    }
    if (!closed) cancel = schedule(() => {
      cancel = undefined;
      current = step().finally(() => { current = undefined; });
    }, 5000);
  }
  async function retryOwnership(): Promise<void> {
    if (closed) return;
    try {
      if (!await hasWork()) return;
      if (!closed) cancel = schedule(() => { cancel = undefined; void worker.kick(); }, 5000);
    } catch (error) { required.warn({ message: `Payment settlement ownership retry is delayed; recorded work remains queued. Cause: ${describeErrorForLog({ err: error })}` }, { error }); }
  }
  const worker = {
    async kick() {
      if (!required.owner || closed || holding) return;
      cancel?.(); cancel = undefined;
      let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const done = new Promise<void>(resolve => { finish = resolve; });
      holding = own(async (lease?: { assertOwned(): Promise<void> }) => {
        ownershipBlocked = false;
        assertOwned = lease?.assertOwned;
        current = step().finally(() => { current = undefined; started(); });
        await current; await done;
      }).then(result => {
        if (!result.acquired && !ownershipBlocked) required.warn({ message: 'Another serving process owns payment settlement for this database.' });
        ownershipBlocked = !result.acquired;
      }).catch((error: unknown) => {
        if (!ownershipBlocked) required.warn({ message: `Payment settlement ownership could not be acquired; recorded payments remain queued. Cause: ${describeErrorForLog({ err: error })}` }, { error });
        ownershipBlocked = true;
      })
        .finally(async () => { holding = undefined; started(); checking = retryOwnership(); await checking; checking = undefined; });
      await ready;
    },
    async close() {
      closed = true; cancel?.(); cancel = undefined;
      await current; finish?.(); await holding; await checking;
    },
  };
  return worker;
}
