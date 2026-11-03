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
  /** Close the host-owned stdin pipe to request graceful shutdown on Windows. */
  closeStdin?(requiredArgs: Record<string, never>, optionalArgs?: Record<string, never>): void;
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
  /** Discovery is host-owned; true only for this live child identity. */
  readiness?: { isReady(input: { pid: number }): Promise<boolean> };
}
export interface DaemonSupervisorOptions {
  onDemandCooldownMs?: number;
  quietRoutineLifecycle?: boolean;
  /** Normal exit codes that park until demand or manual restart, without charging the retry budget. */
  parkedExitCodes?: readonly number[];
  formatGiveUp?: (input: { decision: Extract<RespawnDecision, { action: "give-up" }>; lastReason: string }) => string;
}
export interface DaemonSupervisorActionResult { ok: boolean; reason?: string }
/** Lifecycle inspection; running describes a child, not discovery readiness. */
export type DaemonSupervisorState = "stopped" | "running" | "parked" | "shutting-down";
export interface DaemonSupervisor {
  /** Inspect lifecycle synchronously without starting a child or changing retry policy. */
  getState(): DaemonSupervisorState;
  start(): void;
  restart(): DaemonSupervisorActionResult;
  ensureStarted(): DaemonSupervisorActionResult;
  shutdown(): void;
  isReady(): boolean;
  ensureReady(requiredArgs: Record<string, never>, optionalArgs?: { signal?: AbortSignal }): Promise<void>;
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
 * @param options On-demand cooldown, park exit codes, routine-event suppression and give-up formatter.
 * @returns Inspectable lifecycle with idempotent start, demand wake, manual replacement and terminal shutdown.
 * @throws RangeError for a negative or non-finite cooldown.
 * @complexity O(1) state/work per event, excluding injected ports and policy window pruning.
 */
export function createDaemonSupervisor(deps: DaemonSupervisorRequired, options: DaemonSupervisorOptions = {}): DaemonSupervisor {
  const cooldown = options.onDemandCooldownMs ?? 30000;
  if (!Number.isFinite(cooldown) || cooldown < 0) throw new RangeError("onDemandCooldownMs must be finite and non-negative");
  const formatGiveUp = options.formatGiveUp ?? giveUpReason;
  const parkedExitCodes = new Set(options.parkedExitCodes);
  let parked = false;
  let current: ChildState | undefined;
  let cancelRetry: (() => void) | undefined;
  // Terminal shutdown is a one-way latch, unlike a tripped retry cap. A restart racing
  // host teardown must not resurrect a child that the host is actively trying to kill.
  let terminating = false;
  let spawnAttempts = 0;
  let lastOnDemandAttemptAt: number | undefined;
  let readyChild: ChildState | undefined;
  let readyWork: Promise<void> | undefined;
  let discoveryWork: Promise<void> | undefined;
  let cancelReadiness: ((error?: Error) => void) | undefined;

  function isCurrentLive({ candidate }: { candidate: ChildState | undefined }): boolean {
    return candidate !== undefined && current === candidate && !terminating && !candidate.exited && !candidate.stopping;
  }

  function isReady(): boolean {
    return readyChild !== undefined && isCurrentLive({ candidate: readyChild });
  }

  /** Discovery outlives individual request deadlines; never re-enter the demand cooldown.
   * O(1) state and at most one discovery read per 250ms, excluding the injected read itself. */
  function waitForReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let cancelPoll: (() => void) | undefined;
      cancelReadiness = (error = new Error("shutting down")) => finish(error);
      function finish(error?: Error): void {
        if (settled) return;
        settled = true; cancelPoll?.(); cancelReadiness = undefined;
        if (error) reject(error); else resolve();
      }
      async function poll(): Promise<void> {
        if (settled) return;
        const candidate = current;
        try {
          if (candidate?.child.pid !== undefined && isCurrentLive({ candidate })) {
            const discovered = await deps.readiness!.isReady({ pid: candidate.child.pid });
            // The read may have crossed an exit/replacement or terminal shutdown.
            if (discovered && !settled && isCurrentLive({ candidate })) {
              readyChild = candidate; deps.failureReporter.clear(); finish(); return;
            }
          }
        } catch { /* Missing or partly-published discovery is not readiness; keep waiting. */ }
        if (!settled) cancelPoll = deps.scheduler.schedule({ delayMs: 250, run: () => { void poll(); } });
      }
      void poll();
    });
  }

  function ensureReady(_required: Record<string, never>, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (terminating) return Promise.reject(new Error("shutting down"));
    if (isReady()) return Promise.resolve();
    if (!deps.readiness) return Promise.reject(new Error("readiness port is not configured"));
    if (!readyWork) {
      const start = supervisor.ensureStarted();
      if (!start.ok) return Promise.reject(new Error(start.reason));
      // A slow healthy child must keep being discovered after an HTTP caller gives up.
      // Share the monitor across subsequent demands; shutdown or parking cancels polling.
      // A parked waiter's cleanup must not clear a fresh wake's discovery or request work.
      if (!discoveryWork) {
        const discovery = waitForReady().finally(() => { if (discoveryWork === discovery) discoveryWork = undefined; });
        discoveryWork = discovery;
      }
      const ready = readinessDeadline({ work: discoveryWork, scheduler: deps.scheduler }).finally(() => { if (readyWork === ready) readyWork = undefined; });
      readyWork = ready;
    }
    return signal ? awaitForCaller({ work: readyWork, signal }) : readyWork;
  }

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
      // A failed replacement must not suppress recovery from a later crash.
      state.deliberate = false;
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
    // Recognize the host's normal park code before classification can charge a crash or bind failure.
    if (code !== null && parkedExitCodes.has(code)) {
      parked = true; cancelPendingRetry(); cancelReadiness?.(new Error("daemon parked"));
      readyChild = undefined; readyWork = undefined; discoveryWork = undefined;
      return;
    }
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
    if (terminating || parked || (current !== undefined && (!current.exited || current.stopping))) return;
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
      if (state.replaceAfterExit) {
        if (!state.stopping) attemptSpawn();
        return;
      }
      if (!state.deliberate) handleUnexpectedExit(code, signal);
    } });
  }

  // Wait for a still-live child to exit before replacement: spawning alongside it would
  // collide on its listening port and manufacture the bind failure we are recovering from.
  function forceFreshSpawn(): void {
    parked = false;
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

  const supervisor: DaemonSupervisor = {
    isReady, ensureReady,
    getState() {
      if (terminating) return "shutting-down";
      if (parked) return "parked";
      return current !== undefined && !current.exited ? "running" : "stopped";
    },
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
      // Parking is healthy idleness: wake immediately, retaining all earlier crash history.
      if (parked) {
        lastOnDemandAttemptAt = deps.now(); forceFreshSpawn();
        return { ok: true };
      }
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
      terminating = true; cancelPendingRetry(); cancelReadiness?.();
      if (current === undefined) return;
      current.deliberate = true; current.replaceAfterExit = false;
      if (!current.exited && !current.stopping) terminate(current);
    },
  };
  return supervisor;
}

/** Bound demand waits without cancelling shared discovery. O(1) timers and handlers per wait. */
function readinessDeadline({ work, scheduler }: { work: Promise<void>; scheduler: SupervisorScheduler }, _options = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = scheduler.schedule({ delayMs: 30_000, run: () => reject(new Error("daemon readiness timed out")) });
    work.then(() => { cancel(); resolve(); }, error => { cancel(); reject(error); });
  });
}

/** Cancellation belongs to one caller; it cannot cancel another caller's startup. */
function awaitForCaller({ work, signal }: { work: Promise<void>; signal: AbortSignal }): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
