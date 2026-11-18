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
  /** Child refused intake before its normal park exit. Demand waits for exit before replacing it. */
  markParking(requiredArgs: { pid: number }, optionalArgs?: Record<string, never>): void;
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
  parking: boolean;
}

function giveUpReason({ decision, lastReason }: { decision: Extract<RespawnDecision, { action: "give-up" }>; lastReason: string }): string {
  if (decision.kind === "port-conflict") return `gave up after ${decision.attempts} consecutive port conflicts: ${lastReason}`;
  return `gave up after ${decision.attempts} attempts in ${Math.round(decision.windowMs / 1000)}s: ${lastReason}`;
}

type SupervisorContext = {
  deps: DaemonSupervisorRequired; options: DaemonSupervisorOptions; cooldown: number;
  formatGiveUp: NonNullable<DaemonSupervisorOptions['formatGiveUp']>; parkedExitCodes: Set<number>;
  parked: boolean; current: ChildState | undefined; cancelRetry: (() => void) | undefined;
  terminating: boolean; spawnAttempts: number; lastOnDemandAttemptAt: number | undefined;
  readyChild: ChildState | undefined; readyWork: Promise<void> | undefined; discoveryWork: Promise<void> | undefined;
  cancelReadiness: ((error?: Error) => void) | undefined; supervisor: DaemonSupervisor;
};

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
  const context: SupervisorContext = {
    deps, options, cooldown, formatGiveUp, parkedExitCodes, parked: false, current: undefined, cancelRetry: undefined,
    // Terminal shutdown is a one-way latch, unlike a tripped retry cap. A restart racing
    // host teardown must not resurrect a child that the host is actively trying to kill.
    terminating: false, spawnAttempts: 0, lastOnDemandAttemptAt: undefined,
    readyChild: undefined, readyWork: undefined, discoveryWork: undefined, cancelReadiness: undefined,
    get supervisor() { return supervisor; },
  };
  const supervisor = createSupervisorActions(context);
  return supervisor;
}

function isCurrentLive(context: SupervisorContext, { candidate }: { candidate: ChildState | undefined }): boolean {
  return candidate !== undefined && context.current === candidate && !context.terminating && !candidate.exited && !candidate.stopping && !candidate.parking;
}

function isReady(context: SupervisorContext): boolean {
  return context.readyChild !== undefined && isCurrentLive(context, { candidate: context.readyChild });
}

/** An exited child can still own unfinished termination work. O(1), no process effects. */
function hasUnreapedChild(context: SupervisorContext): boolean {
  return context.current !== undefined && (!context.current.exited || context.current.stopping);
}

/** Discovery outlives individual request deadlines; never re-enter the demand cooldown.
 * O(1) state and at most one discovery read per 250ms, excluding the injected read itself. */
function waitForReady(context: SupervisorContext): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const polling: ReadinessPoll = { settled: false, cancelPoll: undefined, finish };
    context.cancelReadiness = (error = new Error("shutting down")) => finish(error);
    function finish(error?: Error): void {
      if (polling.settled) return;
      polling.settled = true; polling.cancelPoll?.(); context.cancelReadiness = undefined;
      if (error) reject(error); else resolve();
    }
    void poll(context, polling);
  });
}

type ReadinessPoll = { settled: boolean; cancelPoll: (() => void) | undefined; finish: (error?: Error) => void };

async function poll(context: SupervisorContext, polling: ReadinessPoll): Promise<void> {
  const { deps } = context;
  if (polling.settled) return;
  const candidate = context.current;
  try {
    if (candidate?.child.pid !== undefined && isCurrentLive(context, { candidate })) {
      const discovered = await deps.readiness!.isReady({ pid: candidate.child.pid });
      // The read may have crossed an exit/replacement or terminal shutdown.
      if (discovered && !polling.settled && isCurrentLive(context, { candidate })) {
        context.readyChild = candidate; deps.failureReporter.clear(); polling.finish(); return;
      }
    }
  } catch { /* Missing or partly-published discovery is not readiness; keep waiting. */ }
  if (!polling.settled) polling.cancelPoll = deps.scheduler.schedule({ delayMs: 250, run: () => { void poll(context, polling); } });
}

/** One monitor spans demand and replacement; background shutdown rejection is observed.
 * @complexity O(1) state; one PID probe immediately, then at most once per 250ms until ready.
 */
function discoverReadiness(context: SupervisorContext): Promise<void> {
  if (!context.discoveryWork) {
    const discovery = waitForReady(context).finally(() => { if (context.discoveryWork === discovery) context.discoveryWork = undefined; });
    context.discoveryWork = discovery;
    void discovery.catch(() => { /* Parking or shutdown also ends caller-free discovery. */ });
  }
  return context.discoveryWork;
}

/** Return immediate readiness outcomes before starting or joining discovery. O(1) time/space. */
function readinessPreflight(context: SupervisorContext,
  { signal }: { signal: AbortSignal | undefined }, _optional: Record<string, never> = {}
): Promise<void> | undefined {
  const { deps } = context;
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (context.terminating) return Promise.reject(new Error("shutting down"));
  if (isReady(context)) return Promise.resolve();
  if (!deps.readiness) return Promise.reject(new Error("readiness port is not configured"));
  return undefined;
}

function ensureReady(context: SupervisorContext, _required: Record<string, never>, { signal }: { signal?: AbortSignal } = {}): Promise<void> {
  const { deps } = context;
  const preflight = readinessPreflight(context, { signal });
  if (preflight !== undefined) return preflight;
  // A shared discovery may already exist; this demand still has to request replacement after
  // the retiring child exits. Reuse that discovery rather than canceling its current waiters.
  if (context.current?.parking) context.supervisor.ensureStarted();
  if (!context.readyWork) {
    const start = context.supervisor.ensureStarted();
    if (!start.ok) return Promise.reject(new Error(start.reason));
    // A slow healthy child must keep being discovered after an HTTP caller gives up.
    // Share the monitor across subsequent demands; shutdown or parking cancels polling.
    // A parked waiter's cleanup must not clear a fresh wake's discovery or request work.
    const ready = readinessDeadline({ work: discoverReadiness(context), scheduler: deps.scheduler }).finally(() => { if (context.readyWork === ready) context.readyWork = undefined; });
    context.readyWork = ready;
  }
  return signal ? awaitForCaller({ work: context.readyWork, signal }) : context.readyWork;
}

function reportFailure(context: SupervisorContext, reason: string, decision?: RespawnDecision): void {
  const { deps } = context;
  deps.failureReporter.record({ reason });
  deps.logger.emit({ type: "failure", at: deps.now(), reason, ...(decision === undefined ? {} : { decision }) });
}

function cancelPendingRetry(context: SupervisorContext): void { context.cancelRetry?.(); context.cancelRetry = undefined; }

function terminate(context: SupervisorContext, state: ChildState): void {
  const { deps } = context;
  state.stopping = true;
  function stopped(): void {
    state.stopping = false;
    if (context.current === state && state.exited && state.replaceAfterExit && !context.terminating) attemptSpawn(context);
  }
  function failed(error: unknown): void {
    state.stopping = false;
    state.replaceAfterExit = false;
    // A failed replacement must not suppress recovery from a later crash.
    state.deliberate = false;
    if (context.current === state) reportFailure(context, `failed to stop daemon: ${String(error)}`);
  }
  try {
    const result = deps.terminateProcess({ child: state.child });
    if (result !== undefined) { void result.then(stopped, failed); return; }
    stopped();
  } catch (error) {
    failed(error);
  }
}

function handleUnexpectedExit(context: SupervisorContext, code: number | null, signal: NodeJS.Signals | null): void {
  const { deps, formatGiveUp, parkedExitCodes } = context;
  // Recognize the host's normal park code before classification can charge a crash or bind failure.
  if (code !== null && parkedExitCodes.has(code)) {
    context.parked = true; cancelPendingRetry(context); context.cancelReadiness?.(new Error("daemon parked"));
    context.readyChild = undefined; context.readyWork = undefined; context.discoveryWork = undefined;
    return;
  }
  const classification = deps.classifyExit({ code, signal });
  reportFailure(context, classification.reason);
  const decision = deps.policy.recordFailure({ isPortConflict: classification.isPortConflict });
  if (decision.action === "give-up") {
    reportFailure(context, formatGiveUp({ decision, lastReason: classification.reason }), decision);
    return;
  }
  context.cancelRetry = deps.scheduler.schedule({ delayMs: decision.delayMs, run: () => { context.cancelRetry = undefined; attemptSpawn(context); } });
}

function attemptSpawn(context: SupervisorContext): void {
  const { deps } = context;
  if (context.terminating || context.parked || hasUnreapedChild(context)) return;
  // A new attempt must not inherit a stale readiness failure from an earlier child.
  deps.failureReporter.clear();
  let child: SpawnedDaemonProcess;
  try { child = deps.spawnDaemonProcess(); }
  catch (error) { reportFailure(context, `failed to start daemon: ${error instanceof Error ? error.message : String(error)}`); return; }
  const state: ChildState = { child, exited: false, deliberate: false, replaceAfterExit: false, stopping: false, parking: false };
  // Assign synchronously: run-to-completion makes request-driven recovery single-flight
  // without a lock or an await between checking the current child and publishing it.
  context.current = state;
  context.spawnAttempts++;
  logSpawn(context, child);
  // Missing scripts/permissions are not transient crashes: repeating the broken spawn
  // on backoff only burns the retry cap. Manual or cooldown-limited recovery can try
  // again after the underlying launch problem is repaired.
  child.on({ event: "error", listener: ({ error }) => handleChildError(context, state, error) });
  child.on({ event: "exit", listener: input => handleChildExit(context, state, input) });
  // Cold construction and an idle park do no discovery. A replacement must still publish
  // readiness when no caller is waiting; reuse the current monitor if startup is ongoing.
  if (context.spawnAttempts > 1 && deps.readiness) void discoverReadiness(context);
}

function logSpawn(context: SupervisorContext, child: SpawnedDaemonProcess): void {
  const { deps, options } = context;
  // A respawn ends every run in flight. Timestamped lifecycle events let operators
  // correlate apparently stalled work with a replacement, including deliberate exits
  // when routine lifecycle logging is enabled.
  if (!options.quietRoutineLifecycle || context.spawnAttempts > 1) {
    deps.logger.emit({ type: "spawn", at: deps.now(), pid: child.pid, attempt: context.spawnAttempts });
  }
}

function handleChildError(context: SupervisorContext, state: ChildState, error: Error): void {
  if (context.current !== state || state.exited) return;
  // Spawn failure has no pid and never emits exit. A live child's error may instead be a failed kill.
  if (state.child.pid === undefined) state.exited = true;
  reportFailure(context, `failed to start daemon: ${error.message}`);
}

function handleChildExit(context: SupervisorContext, state: ChildState, { code, signal }: { code: number | null; signal: NodeJS.Signals | null }): void {
  const { deps, options } = context;
  if (context.current !== state || state.exited) return;
  state.exited = true;
  if (!options.quietRoutineLifecycle || !state.deliberate) {
    deps.logger.emit({ type: "exit", at: deps.now(), pid: state.child.pid, code, signal, deliberate: state.deliberate });
  }
  if (context.terminating) return;
  if (state.replaceAfterExit) {
    if (!state.stopping) attemptSpawn(context);
    return;
  }
  if (!state.deliberate) handleUnexpectedExit(context, code, signal);
}

// Wait for a still-live child to exit before replacement: spawning alongside it would
// collide on its listening port and manufacture the bind failure we are recovering from.
function forceFreshSpawn(context: SupervisorContext): void {
  context.parked = false;
  if (context.current?.stopping) { context.current.replaceAfterExit = true; return; }
  if (context.current !== undefined && !context.current.exited) {
    if (context.current.replaceAfterExit) return;
    context.current.deliberate = true;
    context.current.replaceAfterExit = true;
    terminate(context, context.current);
    return;
  }
  attemptSpawn(context);
}

function createSupervisorActions(context: SupervisorContext): DaemonSupervisor {
  const { deps } = context;
  return {
    isReady: () => isReady(context),
    ensureReady: (_required, options = {}) => ensureReady(context, _required, options),
    markParking({ pid }, _optional = {}) {
      if (!context.current || context.current.child.pid !== pid || context.current.exited || context.terminating) return;
      context.current.parking = true;
      context.readyChild = undefined;
    },
    getState() {
      if (context.terminating) return "shutting-down";
      if (context.parked) return "parked";
      return context.current !== undefined && !context.current.exited ? "running" : "stopped";
    },
    start() { if (context.cancelRetry === undefined) attemptSpawn(context); },
    restart() {
      if (context.terminating) return { ok: false, reason: "shutting down" };
      cancelPendingRetry(context); deps.policy.reset(); forceFreshSpawn(context);
      return { ok: true };
    },
    ensureStarted: () => ensureStarted(context),
    shutdown() {
      if (context.terminating) return;
      context.terminating = true; cancelPendingRetry(context); context.cancelReadiness?.();
      if (context.current === undefined) return;
      context.current.deliberate = true; context.current.replaceAfterExit = false;
      if (!context.current.exited && !context.current.stopping) terminate(context, context.current);
    },
  };
}

function ensureStarted(context: SupervisorContext): DaemonSupervisorActionResult {
  const { deps } = context;
  if (context.terminating) return { ok: false, reason: "shutting down" };
  if (context.current?.parking && !context.current.exited) {
    context.current.replaceAfterExit = true;
    return { ok: true };
  }
  // A scheduled retry keeps its own backoff; request traffic must not accelerate it.
  if (hasUnreapedChild(context) || context.cancelRetry !== undefined) return { ok: true };
  // Parking is healthy idleness: wake immediately, retaining all earlier crash history.
  if (context.parked) {
    context.lastOnDemandAttemptAt = deps.now(); forceFreshSpawn(context);
    return { ok: true };
  }
  return tryOnDemandSpawn(context);
}

function tryOnDemandSpawn(context: SupervisorContext): DaemonSupervisorActionResult {
  const { deps, cooldown } = context;
  // Single-flight alone cannot stop a storm against a durably broken launch. The 30s
  // default floor matches the standard backoff ceiling, bounding traffic-driven retries
  // to the same worst-case rate as timer-driven recovery after a cap or spawn failure.
  const now = deps.now();
  if (context.lastOnDemandAttemptAt !== undefined && now - context.lastOnDemandAttemptAt < cooldown) return { ok: false, reason: "cooling down before trying again" };
  context.lastOnDemandAttemptAt = now;
  deps.policy.reset(); forceFreshSpawn(context);
  return { ok: true };
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
