/**
 * Process signal handlers belong to the host boot wrapper, not the spawn loop: registering
 * them on each automatic respawn would leak another set of global listeners. Retry
 * decisions stay in the pure policy so backoff rules need neither real timers nor children.
 * Construction is safe to import in tests because it does not invoke the host bootstrap.
 */
import type { RespawnDecision, RespawnPolicy } from "./respawn-policy.js";

export type DaemonProcessSubscription =
  | { event: "exit"; listener: (input: { code: number | null; signal: NodeJS.Signals | null }) => void }
  | { event: "error"; listener: (input: { error: Error }) => void };

export interface SpawnedDaemonProcess {
  readonly pid?: number | undefined;
  on(input: DaemonProcessSubscription): void;
  kill(requiredArgs: Record<string, never>, optionalArgs?: { signal?: NodeJS.Signals }): boolean;
}

/** Scheduling must defer run until after schedule returns; the returned function cancels it. */
export interface SupervisorScheduler {
  schedule(input: { delayMs: number; run: () => void }): () => void;
}

export type SupervisorEvent =
  | { type: "spawn"; at: number; pid: number | undefined; attempt: number }
  | { type: "exit"; at: number; pid: number | undefined; code: number | null; signal: NodeJS.Signals | null; deliberate: boolean }
  | { type: "failure"; at: number; reason: string; decision?: RespawnDecision };

export interface DaemonSupervisorRequired {
  spawnDaemonProcess: () => SpawnedDaemonProcess;
  terminateProcess: (input: { child: SpawnedDaemonProcess }) => void | Promise<void>;
  policy: RespawnPolicy;
  now: () => number;
  scheduler: SupervisorScheduler;
  classifyExit: (input: { code: number | null; signal: NodeJS.Signals | null }) => { isPortConflict: boolean; reason: string };
  failureReporter: { clear(): void; record(input: { reason: string }): void };
  logger: { emit(event: SupervisorEvent): void };
}
export interface DaemonSupervisorOptions {
  onDemandCooldownMs?: number;
  quietRoutineLifecycle?: boolean;
  formatGiveUp?: (input: { decision: Extract<RespawnDecision, { action: "give-up" }>; lastReason: string }) => string;
}
export interface DaemonSupervisorActionResult { ok: boolean; reason?: string }
export interface DaemonSupervisor {
  start(): void;
  restart(): DaemonSupervisorActionResult;
  ensureStarted(): DaemonSupervisorActionResult;
  shutdown(): void;
}

interface ChildState {
  child: SpawnedDaemonProcess;
  exited: boolean;
  // Deliberate replacement and shutdown exits must not feed the crash/respawn budget.
  deliberate: boolean;
  replaceAfterExit: boolean;
  stopping: boolean;
}

function giveUpReason({ decision, lastReason }: { decision: Extract<RespawnDecision, { action: "give-up" }>; lastReason: string }): string {
  if (decision.kind === "port-conflict") return `gave up after ${decision.attempts} consecutive port conflicts: ${lastReason}`;
  return `gave up after ${decision.attempts} attempts in ${Math.round(decision.windowMs / 1000)}s: ${lastReason}`;
}

/**
 * Wire a caller-owned process lifecycle to retry decisions without global handlers or host defaults.
 * @param deps Required process, policy, clock, scheduler, readiness and observability ports.
 * @param options On-demand cooldown, routine-event suppression and give-up message formatter.
 * @returns Idempotent start, manual replacement, cooldown-limited recovery and terminal shutdown.
 * @throws RangeError for a negative or non-finite cooldown.
 * @complexity O(1) state/work per event, excluding injected ports and policy window pruning.
 */
export function createDaemonSupervisor(deps: DaemonSupervisorRequired, options: DaemonSupervisorOptions = {}): DaemonSupervisor {
  const cooldown = options.onDemandCooldownMs ?? 30000;
  if (!Number.isFinite(cooldown) || cooldown < 0) throw new RangeError("onDemandCooldownMs must be finite and non-negative");
  const formatGiveUp = options.formatGiveUp ?? giveUpReason;
  let current: ChildState | undefined;
  let cancelRetry: (() => void) | undefined;
  // Terminal shutdown is a one-way latch, unlike a tripped retry cap. A restart racing
  // host teardown must not resurrect a child that the host is actively trying to kill.
  let terminating = false;
  let spawnAttempts = 0;
  let lastOnDemandAttemptAt: number | undefined;

  function reportFailure(reason: string, decision?: RespawnDecision): void {
    deps.failureReporter.record({ reason });
    deps.logger.emit({ type: "failure", at: deps.now(), reason, ...(decision === undefined ? {} : { decision }) });
  }

  function cancelPendingRetry(): void { cancelRetry?.(); cancelRetry = undefined; }

  function terminate(state: ChildState): void {
    state.stopping = true;
    function stopped(): void {
      state.stopping = false;
      if (current === state && state.exited && state.replaceAfterExit && !terminating) attemptSpawn();
    }
    function failed(error: unknown): void {
      state.stopping = false;
      state.replaceAfterExit = false;
      if (current === state) reportFailure(`failed to stop daemon: ${String(error)}`);
    }
    try {
      const result = deps.terminateProcess({ child: state.child });
      if (result !== undefined) { void result.then(stopped, failed); return; }
      stopped();
    } catch (error) {
      failed(error);
    }
  }

  function handleUnexpectedExit(code: number | null, signal: NodeJS.Signals | null): void {
    const classification = deps.classifyExit({ code, signal });
    reportFailure(classification.reason);
    const decision = deps.policy.recordFailure({ isPortConflict: classification.isPortConflict });
    if (decision.action === "give-up") {
      reportFailure(formatGiveUp({ decision, lastReason: classification.reason }), decision);
      return;
    }
    cancelRetry = deps.scheduler.schedule({ delayMs: decision.delayMs, run: () => { cancelRetry = undefined; attemptSpawn(); } });
  }

  function attemptSpawn(): void {
    if (terminating || (current !== undefined && (!current.exited || current.stopping))) return;
    // A new attempt must not inherit a stale readiness failure from an earlier child.
    deps.failureReporter.clear();
    let child: SpawnedDaemonProcess;
    try { child = deps.spawnDaemonProcess(); }
    catch (error) { reportFailure(`failed to start daemon: ${error instanceof Error ? error.message : String(error)}`); return; }
    const state: ChildState = { child, exited: false, deliberate: false, replaceAfterExit: false, stopping: false };
    // Assign synchronously: run-to-completion makes request-driven recovery single-flight
    // without a lock or an await between checking the current child and publishing it.
    current = state;
    // A respawn ends every run in flight. Timestamped lifecycle events let operators
    // correlate apparently stalled work with a replacement, including deliberate exits
    // when routine lifecycle logging is enabled.
    spawnAttempts++;
    if (!options.quietRoutineLifecycle || spawnAttempts > 1) {
      deps.logger.emit({ type: "spawn", at: deps.now(), pid: child.pid, attempt: spawnAttempts });
    }
    // Missing scripts/permissions are not transient crashes: repeating the broken spawn
    // on backoff only burns the retry cap. Manual or cooldown-limited recovery can try
    // again after the underlying launch problem is repaired.
    child.on({ event: "error", listener: ({ error }) => {
      if (current !== state || state.exited) return;
      // Spawn failure has no pid and never emits exit. A live child's error may instead be a failed kill.
      if (child.pid === undefined) state.exited = true;
      reportFailure(`failed to start daemon: ${error.message}`);
    } });
    child.on({ event: "exit", listener: ({ code, signal }) => {
      if (current !== state || state.exited) return;
      state.exited = true;
      if (!options.quietRoutineLifecycle || !state.deliberate) {
        deps.logger.emit({ type: "exit", at: deps.now(), pid: child.pid, code, signal, deliberate: state.deliberate });
      }
      if (terminating) return;
      if (state.replaceAfterExit) { if (!state.stopping) attemptSpawn(); return; }
      if (!state.deliberate) handleUnexpectedExit(code, signal);
    } });
  }

  // Wait for a still-live child to exit before replacement: spawning alongside it would
  // collide on its listening port and manufacture the bind failure we are recovering from.
  function forceFreshSpawn(): void {
    if (current?.stopping) { current.replaceAfterExit = true; return; }
    if (current !== undefined && !current.exited) {
      if (current.replaceAfterExit) return;
      current.deliberate = true;
      current.replaceAfterExit = true;
      terminate(current);
      return;
    }
    attemptSpawn();
  }

  return {
    start() { if (cancelRetry === undefined) attemptSpawn(); },
    restart() {
      if (terminating) return { ok: false, reason: "shutting down" };
      cancelPendingRetry(); deps.policy.reset(); forceFreshSpawn();
      return { ok: true };
    },
    ensureStarted() {
      if (terminating) return { ok: false, reason: "shutting down" };
      // A scheduled retry keeps its own backoff; request traffic must not accelerate it.
      if ((current !== undefined && (!current.exited || current.stopping)) || cancelRetry !== undefined) return { ok: true };
      // Single-flight alone cannot stop a storm against a durably broken launch. The 30s
      // default floor matches the standard backoff ceiling, bounding traffic-driven retries
      // to the same worst-case rate as timer-driven recovery after a cap or spawn failure.
      const now = deps.now();
      if (lastOnDemandAttemptAt !== undefined && now - lastOnDemandAttemptAt < cooldown) return { ok: false, reason: "cooling down before trying again" };
      lastOnDemandAttemptAt = now;
      deps.policy.reset(); forceFreshSpawn();
      return { ok: true };
    },
    shutdown() {
      if (terminating) return;
      terminating = true; cancelPendingRetry();
      if (current === undefined) return;
      current.deliberate = true; current.replaceAfterExit = false;
      if (!current.exited && !current.stopping) terminate(current);
    },
  };
}
