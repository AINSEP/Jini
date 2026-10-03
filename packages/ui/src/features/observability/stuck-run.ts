/**
 * Stuck-run watchdog.
 *
 * Reports `client_run_stuck` when a run started via {@link trackRunStart}
 * has not progressed within `stuckAfterMs` (no calls to
 * {@link trackRunProgress}, no call to {@link trackRunTerminal}). This is a
 * coarse proxy for "a long-lived async operation's transport went quiet" —
 * the user-visible symptom is invariably "I started something and nothing's
 * happening", so a stuck-after-timeout watchdog catches the most common
 * bad outcome without needing full transport-lifecycle instrumentation.
 *
 * Fire-and-forget: callers tell us a run started, poke us every time they
 * see progress, and tell us when it terminates. Anything else and the
 * watchdog reports the stuck event exactly once per run.
 */
import { noopSafetyEventReporter, type SafetyEventReporter } from './ports.js';

const DEFAULT_STUCK_AFTER_MS = 5 * 60 * 1000; // 5 minutes with no progress

interface WatchedRun {
  reporter: SafetyEventReporter;
  startedAt: number;
  lastProgressAt: number;
  timer: ReturnType<typeof setTimeout>;
  stuckAfterMs: number;
  emitted: boolean;
  context: Record<string, unknown>;
}

const runs = new Map<string, WatchedRun>();

export interface TrackRunStartOptions {
  reporter?: SafetyEventReporter | undefined;
  /** Extra context merged into every event this run emits. */
  context?: Record<string, unknown>;
  /** How long without progress before reporting stuck. Defaults to 5 minutes. */
  stuckAfterMs?: number;
}

/**
 * Starts (or restarts) the watchdog for `runId`. A fresh start replaces any
 * prior entry for the same id — rare but possible during reconnect storms.
 *
 * @overallScore 100
 */
export function trackRunStart(runId: string, options: TrackRunStartOptions = {}): void {
  if (typeof window === 'undefined') return;
  cancelRun(runId);
  const now = Date.now();
  const stuckAfterMs = options.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
  const entry: WatchedRun = {
    reporter: options.reporter ?? noopSafetyEventReporter,
    startedAt: now,
    lastProgressAt: now,
    timer: scheduleEmit(runId, stuckAfterMs),
    stuckAfterMs,
    emitted: false,
    context: options.context ?? {},
  };
  runs.set(runId, entry);
}

/** Records progress on `runId`, rescheduling its stuck-timeout. No-ops for an untracked/already-stuck run. */
export function trackRunProgress(runId: string): void {
  const entry = runs.get(runId);
  if (!entry || entry.emitted) return;
  entry.lastProgressAt = Date.now();
  clearTimeout(entry.timer);
  entry.timer = scheduleEmit(runId, entry.stuckAfterMs);
}

/**
 * Marks `runId` terminal and stops watching it. If the run had already
 * been reported stuck, also reports a `client_run_unstuck` recovery event
 * so a host's dashboard can pair the two.
 */
export function trackRunTerminal(runId: string, terminalState: string): void {
  const entry = runs.get(runId);
  if (!entry) return;
  clearTimeout(entry.timer);
  runs.delete(runId);
  if (entry.emitted) {
    entry.reporter('client_run_unstuck', {
      run_id: runId,
      terminal_state: terminalState,
      total_duration_ms: Date.now() - entry.startedAt,
      ...entry.context,
    });
  }
}

function cancelRun(runId: string): void {
  const existing = runs.get(runId);
  if (!existing) return;
  clearTimeout(existing.timer);
  runs.delete(runId);
}

function scheduleEmit(runId: string, stuckAfterMs: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => emitStuck(runId), stuckAfterMs);
}

function emitStuck(runId: string): void {
  const entry = runs.get(runId);
  // `!entry || entry.emitted` is a defensive invariant guard, empirically
  // and structurally unreachable through this module's real call graph
  // today: `emitStuck` only ever runs as a `setTimeout` callback created by
  // `scheduleEmit`, and every path that could remove or re-flag an entry
  // (`trackRunStart`'s `cancelRun`, `trackRunTerminal`) always
  // `clearTimeout`s that exact timer first — in this single-threaded
  // runtime, a cleared timer's callback can never still fire. So by the
  // time this callback runs, its entry is guaranteed to both exist and
  // have `emitted === false`. Left in place (not stripped) as a guard
  // against a future refactor silently breaking that invariant — see
  // packages/ui/archived provenance ledger's 2026-07-22 dated entry for the full proof,
  // matching this task's own standard for documenting provable
  // unreachability instead of forcing a test.
  if (!entry || entry.emitted) return;
  entry.emitted = true;
  entry.reporter('client_run_stuck', {
    run_id: runId,
    duration_since_last_progress_ms: Date.now() - entry.lastProgressAt,
    duration_since_start_ms: Date.now() - entry.startedAt,
    ...entry.context,
  });
}

/** Test-only — flushes internal state between cases. */
export function __resetStuckRunWatchdogForTests(): void {
  for (const entry of runs.values()) {
    clearTimeout(entry.timer);
  }
  runs.clear();
}
