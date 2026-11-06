
export interface CommerceWorkerRequired {
  /** Only the serving owner schedules jobs; daemon/client compositions never do. */
  owner: boolean;
  active(): Promise<boolean>;
  hasPending(): Promise<boolean>;
  run(): Promise<void>;
  warn(message: string): void;
}
export interface CommerceWorkerOptional {
  /** Native PostgreSQL reserves a session advisory lock for the owner's whole lifetime. */
  withOwnership: (run: (lease?: { assertOwned(): Promise<void> }) => Promise<void>) => Promise<{ acquired: boolean }>;
  schedule: (run: () => void, delayMs: number) => () => void;
}

/** Bind existing host ownership to one serialized settlement owner, active or draining.
 * No transaction spans provider HTTP: kernel dispatch snapshots commit independently.
 * @complexity One cycle/5s while active/draining, no idle timers; one owner lock held while running. */
export function createSettlementWorker(required: CommerceWorkerRequired, optional: CommerceWorkerOptional): {
  kick(): Promise<void>; close(): Promise<void>;
} {
  const own = optional.withOwnership;
  const schedule = optional.schedule;
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
    try { await assertOwned?.(); return true; } catch {
      required.warn('Payment settlement ownership was lost; this process stopped its worker.'); return false;
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
    } catch {
      if (!delayed) required.warn('Payment settlement is delayed; recorded payments will retry automatically.');
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
    } catch { required.warn('Payment settlement ownership retry is delayed; recorded work remains queued.'); }
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
        if (!result.acquired && !ownershipBlocked) required.warn('Another serving process owns payment settlement for this database.');
        ownershipBlocked = !result.acquired;
      }).catch(() => {
        if (!ownershipBlocked) required.warn('Payment settlement ownership could not be acquired; recorded payments remain queued.');
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
