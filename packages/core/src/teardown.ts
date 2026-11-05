/** A cleanup step may be synchronous or asynchronous; failures are reported after all steps run. */
export type TeardownStep = () => unknown;
/** Injected lifecycle registration; core has no dependency on a particular test runner or host. */
export interface TeardownHost { after(fn: () => unknown): void }

const queues = new WeakMap<TeardownHost, TeardownStep[]>();

/**
 * Attempt every step in reverse registration order. Preserve a single failure's identity;
 * report several as an AggregateError only after attempting the remaining cleanup.
 * @param requiredArgs Steps owned by one lifecycle context; the input array is not mutated.
 * @returns Resolves after cleanup, or rejects with the collected failure(s).
 * @complexity O(n) time and space for n registered steps, excluding each step's own work.
 * @example await runTeardownSteps({ steps: [closeDatabase, closeServer] });
 */
export async function runTeardownSteps({ steps }: { steps: readonly TeardownStep[] }, _options = {}): Promise<void> {
  const failures: unknown[] = [];
  for (const step of [...steps].reverse()) {
    try { await step(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "test teardown failed", { cause: failures[0] });
}

/**
 * Queue a step on the host's single cleanup hook. Hosts that stop at the first throwing hook
 * still attempt every registered resource cleanup before this hook reports a failure.
 * @param requiredArgs Lifecycle host and a step to run when that host finishes.
 * @returns Nothing; registers one hook on first use, then appends to that host's queue.
 * @complexity O(1) registration; cleanup is O(n) time/space for n registered steps.
 * @example onTeardown({ t: context, step: closeServer });
 */
export function onTeardown({ t, step }: { t: TeardownHost; step: TeardownStep }, _options = {}): void {
  const queued = queues.get(t);
  if (queued) {
    queued.push(step);
    return;
  }
  const steps = [step];
  queues.set(t, steps);
  t.after(() => runTeardownSteps({ steps }));
}
