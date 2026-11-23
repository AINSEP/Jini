/**
 * @file A host-neutral storage retention runner: it schedules passes over host-supplied policies and
 * never touches the filesystem itself. Every collaborator (clock, scheduler, error sink, policies) is
 * injected; the host decides which policies exist, where their files live and whether scheduled
 * passes may clean or only measure.
 *
 * Pass rules:
 * - Passes are serialized. A request that matches the running pass's mode joins it; a request of the
 *   other mode waits for it and then runs its own pass (at most one waiting pass, joined the same way).
 *   So a dry run always gets a measurement-only result, even when it arrives during a cleanup, and a
 *   confirmed cleanup always gets the result of an actual sweep, even when it arrives during a dry run.
 * - A dry run calls `measure()` only and never enters `sweep()`.
 * - A failing policy is reported in plain words and the next policy still runs.
 * - `stop()` clears the timer, cancels a waiting pass and resolves once the running pass has finished,
 *   so the host can close storage right after it.
 */

/** Daily, matching the plan's default pass cadence; hosts can pass their own `intervalMs`. */
export const RETENTION_DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The only data a runner may clean automatically. There is deliberately no `"content"` (owner data
 * is removed only by an explicit owner action) and no `"history"` (chats are content). */
export type RetentionPolicyKind = 'cache' | 'derived' | 'old-copy';
const RETENTION_POLICY_KINDS: ReadonlySet<string> = new Set<RetentionPolicyKind>(['cache', 'derived', 'old-copy']);

/** `bytes: null` means the policy could not tell (for example an unreadable folder), never zero. */
export interface RetentionMeasurement { readonly bytes: number | null; readonly items?: number }
export interface RetentionSweepResult { readonly freedBytes: number | null; readonly removed: number }

export interface RetentionPolicy {
  readonly id: string;
  readonly kind: RetentionPolicyKind;
  measure(): Promise<RetentionMeasurement>;
  sweep(input: { readonly now: number }): Promise<RetentionSweepResult>;
}

export type RetentionPolicyOutcome =
  | { readonly id: string; readonly kind: RetentionPolicyKind; readonly status: 'measured'; readonly measurement: RetentionMeasurement }
  | { readonly id: string; readonly kind: RetentionPolicyKind; readonly status: 'swept'; readonly result: RetentionSweepResult }
  | { readonly id: string; readonly kind: RetentionPolicyKind; readonly status: 'failed'; readonly message: string };

export type RetentionPassResult =
  | { readonly status: 'completed'; readonly dryRun: boolean; readonly startedAt: number; readonly finishedAt: number; readonly policies: readonly RetentionPolicyOutcome[] }
  | { readonly status: 'stopped'; readonly dryRun: boolean };

export interface RetentionScheduler {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface RetentionRunnerRequired {
  readonly policies: readonly RetentionPolicy[];
  readonly clock: { now(): number };
  readonly scheduler: RetentionScheduler;
  /** Receives plain-words errors; `policyId` is absent for pass-level failures (a scheduled pass that
   * could not run, or a report that could not be delivered). */
  readonly reportError: (error: Error, context: { readonly policyId?: string }) => void;
}

export interface RetentionRunnerOptional {
  readonly intervalMs?: number;
  /** Scheduled (boot and timer) passes only measure unless the host explicitly opts in to cleaning. */
  readonly scheduledDryRun?: boolean;
  readonly onReport?: (report: RetentionPassResult) => void;
}

export interface RetentionRunner {
  runOnce(input: { readonly dryRun: boolean }): Promise<RetentionPassResult>;
  start(): void;
  stop(): Promise<void>;
}

/**
 * Creates a runner over the given policies. Nothing runs until `start()` or `runOnce()`.
 * @throws TypeError for a duplicate policy id or a kind outside cache/derived/old-copy (a JS caller
 *   can bypass the type, so the kind rule is enforced at runtime as well).
 * @throws RangeError for an interval that is not a positive finite number.
 * @complexity O(p) per pass in policies, run one at a time.
 * @example createRetentionRunner({ policies, clock: Date, scheduler: globalThis, reportError }, { onReport });
 */
export function createRetentionRunner(
  required: RetentionRunnerRequired,
  { intervalMs = RETENTION_DEFAULT_INTERVAL_MS, scheduledDryRun = true, onReport }: RetentionRunnerOptional = {},
): RetentionRunner {
  const policies = validatePolicies({ policies: required.policies });
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError(`The storage cleanup interval must be a positive number of milliseconds (got ${intervalMs}).`);
  }
  const queue = createPassQueue({ execute: dryRun => executePass({ ...required, policies, dryRun, onReport }) });
  let timer: { handle: unknown } | undefined;
  const scheduledPass = () => {
    queue.request({ dryRun: scheduledDryRun }).catch((error: unknown) => {
      report({ reportError: required.reportError, error: new Error('A scheduled storage cleanup pass could not run.', { cause: error }) });
    });
  };
  return {
    runOnce: ({ dryRun }) => queue.request({ dryRun }),
    start() {
      if (queue.isStopped()) throw new Error('This storage cleanup runner was stopped; create a new one to start again.');
      if (timer) return;
      timer = { handle: required.scheduler.setInterval(scheduledPass, intervalMs) };
      scheduledPass();
    },
    async stop() {
      if (timer) required.scheduler.clearInterval(timer.handle);
      await queue.stop();
    },
  };
}

function validatePolicies(
  { policies }: { policies: readonly RetentionPolicy[] },
  _optional: Record<string, never> = {},
): readonly RetentionPolicy[] {
  const seen = new Set<string>();
  for (const policy of policies) {
    if (!RETENTION_POLICY_KINDS.has(policy.kind)) {
      throw new TypeError(`Storage policy "${policy.id}" has kind "${String(policy.kind)}". Only cache, derived and old-copy data may be cleaned automatically.`);
    }
    if (seen.has(policy.id)) throw new TypeError(`Storage policy "${policy.id}" is listed twice.`);
    seen.add(policy.id);
  }
  // A private copy: a host mutating its array later cannot change what a running pass iterates.
  return [...policies];
}

interface PendingPass {
  readonly dryRun: boolean;
  readonly promise: Promise<RetentionPassResult>;
  readonly resolve: (result: RetentionPassResult) => void;
  readonly reject: (error: unknown) => void;
}

function pendingPass(
  { dryRun }: { dryRun: boolean },
  _optional: Record<string, never> = {},
): PendingPass {
  let resolve!: PendingPass['resolve'];
  let reject!: PendingPass['reject'];
  const promise = new Promise<RetentionPassResult>((settle, fail) => { resolve = settle; reject = fail; });
  return { dryRun, promise, resolve, reject };
}

/** The serialization core: one running pass, at most one waiting pass of the other mode.
 * The running slot is published before `execute` is called, so a collaborator that synchronously
 * requests another pass joins or queues behind this one instead of starting an overlapping pass. The
 * queue advances whether the pass fulfils or rejects, so a failed pass never strands a waiter. */
function createPassQueue(
  { execute }: { execute: (dryRun: boolean) => Promise<RetentionPassResult> },
  _optional: Record<string, never> = {},
) {
  let running: PendingPass | undefined;
  let waiting: PendingPass | undefined;
  let stopped = false;

  const begin = (pass: PendingPass): void => {
    running = pass;
    const advance = (settle: () => void) => {
      running = undefined;
      const next = waiting;
      waiting = undefined;
      if (next) begin(next);
      settle();
    };
    // The executor runs synchronously, so a synchronous throw becomes this pass's rejection.
    new Promise<RetentionPassResult>(resolve => resolve(execute(pass.dryRun)))
      .then(result => advance(() => pass.resolve(result)), (error: unknown) => advance(() => pass.reject(error)));
  };

  return {
    isStopped: () => stopped,
    request({ dryRun }: { dryRun: boolean }): Promise<RetentionPassResult> {
      if (stopped) return Promise.resolve({ status: 'stopped', dryRun });
      if (!running) {
        const pass = pendingPass({ dryRun });
        begin(pass);
        return pass.promise;
      }
      if (running.dryRun === dryRun) return running.promise;
      // The waiting pass is always the other mode from the running one, so a same-mode request joins it.
      waiting ??= pendingPass({ dryRun });
      return waiting.promise;
    },
    async stop(): Promise<void> {
      stopped = true;
      const cancelled = waiting;
      waiting = undefined;
      cancelled?.resolve({ status: 'stopped', dryRun: cancelled.dryRun });
      // The pass's own requester observes a failure; stop only waits for the pass to end.
      if (running) await running.promise.catch(() => undefined);
    },
  };
}

/** Runs one pass to completion. It never rejects: every failure becomes an outcome plus a report. */
async function executePass(
  { policies, clock, reportError, dryRun, onReport }: Omit<RetentionRunnerRequired, 'scheduler'> & {
    dryRun: boolean;
    onReport: RetentionRunnerOptional['onReport'];
  },
  _optional: Record<string, never> = {},
): Promise<RetentionPassResult> {
  const startedAt = clock.now();
  const outcomes: RetentionPolicyOutcome[] = [];
  for (const policy of policies) outcomes.push(await runPolicy({ policy, dryRun, now: startedAt, reportError }));
  const result: RetentionPassResult = { status: 'completed', dryRun, startedAt, finishedAt: clock.now(), policies: outcomes };
  try {
    onReport?.(result);
  } catch (error) {
    report({ reportError, error: new Error('Storage cleanup report could not be delivered.', { cause: error }) });
  }
  return result;
}

async function runPolicy(
  { policy, dryRun, now, reportError }: { policy: RetentionPolicy; dryRun: boolean; now: number; reportError: RetentionRunnerRequired['reportError'] },
  _optional: Record<string, never> = {},
): Promise<RetentionPolicyOutcome> {
  const { id, kind } = policy;
  try {
    if (dryRun) return { id, kind, status: 'measured', measurement: await policy.measure() };
    return { id, kind, status: 'swept', result: await policy.sweep({ now }) };
  } catch (error) {
    // Fixed outcome text: a raw message can quote a path or a secret, so nothing from the error reaches
    // the outcome; the host's error sink still receives the full error as `cause`.
    const message = `Storage cleanup "${id}" failed while ${dryRun ? 'measuring' : 'cleaning up'}.`;
    report({ reportError, error: new Error(message, { cause: error }), policyId: id });
    return { id, kind, status: 'failed', message };
  }
}

function report(
  { reportError, error, policyId }: { reportError: RetentionRunnerRequired['reportError']; error: Error; policyId?: string },
  _optional: Record<string, never> = {},
): void {
  try {
    reportError(error, policyId === undefined ? {} : { policyId });
  } catch {
    // A broken error sink must not turn into a failed pass or an unhandled rejection on a timer. The
    // injected reporter is the only outlet this runner has, so its own failure is dropped here.
  }
}
