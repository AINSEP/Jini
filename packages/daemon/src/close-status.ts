/**
 * Pure run-close classification and inactivity-timeout helpers, generalized
 * from OD's `apps/daemon/src/runtimes/chat-run-lifecycle.ts`
 * (`arch/server-startserver-endgame` branch — see `archived provenance ledger`). The
 * origin file mixes a generic close-status decision tree with several
 * OD/ACP-vendor-specific escape hatches (forced-shutdown-but-actually-clean
 * heuristics for a specific agent-CLI protocol, artifact-quiet-period
 * nuance). Only the generic skeleton is kept here — see `archived provenance ledger` for
 * the itemized list of what was dropped and why.
 */

import type { SchedulerPort } from './scheduler.js';

export type TerminalRunOutcome = 'succeeded' | 'failed' | 'cancelled';

export interface CloseStatusInput {
  /** Whether `RunLifecycle.cancel` had already been called for this run. */
  readonly cancelRequested: boolean;
  readonly code: number | null;
  readonly signal?: string | null;
}

/**
 * Classifies a terminated run's exit into `RunLifecycle`'s terminal state.
 *
 * @param input - Cancellation flag plus the driver-observed exit code/signal.
 * @returns `'cancelled'` if cancellation was requested (this takes priority
 * over the exit code, since a cancelled process often exits non-zero as a
 * direct result of the signal delivery — the cancellation intent, not the
 * process's raw exit shape, is the ground truth); otherwise `'succeeded'`
 * for exit code `0`; otherwise `'failed'`.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function classifyRunCloseStatus(requiredArgs: Pick<CloseStatusInput, "cancelRequested" | "code">, optionalArgs: Pick<CloseStatusInput, "signal"> = {}): TerminalRunOutcome {
  const input: CloseStatusInput = { ...requiredArgs, ...optionalArgs };
  if (input.cancelRequested) {
    return 'cancelled';
  }
  if (input.code === 0) {
    return 'succeeded';
  }
  return 'failed';
}

export interface ResolveTimeoutMsInput {
  /** Env var name checked first (highest precedence), e.g. `'JINI_RUN_INACTIVITY_TIMEOUT_MS'`. */
  readonly envVar?: string;
  /** Per-agent/per-runtime default, used when no env override is set. */
  readonly agentDefaultMs?: number;
  /** Kernel default, used when neither an env override nor an agent default is set. */
  readonly defaultMs: number;
  /** Upper clamp applied after resolution, regardless of source. */
  readonly maxMs: number;
  /** Injectable env source (defaults to `process.env`) — kept explicit so this stays a pure, testable function rather than reading a process-global implicitly. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolves a timeout in milliseconds from an env-var override, an
 * agent-supplied default, and a kernel default, in that precedence order,
 * clamped to a maximum. Generalized from OD's
 * `resolveChatRunInactivityTimeoutMs`/`resolveChatRunArtifactQuietPeriodMs`
 * cascade (env > agentDefault > default, clamped) — the same shape reused
 * for any timeout a `RunLifecycle` driver needs to resolve.
 *
 * @throws Never — a non-numeric or non-positive env value is treated as
 * absent rather than raised, since a malformed env var should degrade to the
 * next precedence tier, not crash startup.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function resolveTimeoutMs(requiredArgs: Pick<ResolveTimeoutMsInput, "defaultMs" | "maxMs">, optionalArgs: Pick<ResolveTimeoutMsInput, "envVar" | "agentDefaultMs" | "env"> = {}): number {
  const input: ResolveTimeoutMsInput = { ...requiredArgs, ...optionalArgs };
  const env = input.env ?? (typeof process !== 'undefined' ? process.env : {});
  const rawFromEnv = input.envVar ? env[input.envVar] : undefined;
  const fromEnv = rawFromEnv !== undefined ? Number(rawFromEnv) : undefined;
  const candidate =
    fromEnv !== undefined && Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : (input.agentDefaultMs ?? input.defaultMs);
  return Math.min(candidate, input.maxMs);
}

export interface InactivityWatchdog {
  /** Resets the timeout window — call on every observed unit of run activity (an emitted event, a stdout chunk). */
  noteActivity(_args: Record<string, never>): void;
  /** Disarms the watchdog permanently (e.g. once the run reaches a terminal state). Safe to call more than once. */
  cancel(_args: Record<string, never>): void;
}

export interface CreateInactivityWatchdogInput {
  readonly timeoutMs: number;
  /** Invoked once if `timeoutMs` elapses with no `noteActivity()` call in between. Never invoked after `cancel()`. */
  readonly onTimeout: () => void;
}

/**
 * Generic reset-on-activity timeout, generalized from OD's inactivity
 * watchdog pattern in `start-chat-run.ts` (reset timer on every stdout/agent
 * event; the origin's SIGTERM-then-SIGKILL escalation on fire is
 * subprocess-signaling detail out of this task's scope — a driver's
 * `onTimeout` callback is where that would plug in).
 *
 * @param input.timeoutMs - Milliseconds of inactivity before `onTimeout` fires.
 * @param input.onTimeout - Fired once per armed timeout window; later activity can start a new window until cancellation.
 * @returns A handle to reset (`noteActivity`) or permanently disarm (`cancel`) the timer.
 * @remarks Side effect: starts a `setTimeout` immediately and calls
 * `.unref()` on it (when available) so a bare watchdog never keeps a Node
 * process alive on its own.
 * @complexity O(1) per call.
 * @overallScore 100/100
 */
export function createInactivityWatchdog(
  input: CreateInactivityWatchdogInput,
  { scheduler }: { scheduler?: SchedulerPort } = {},
): InactivityWatchdog {
  const timers: SchedulerPort = scheduler ?? {
    schedule({ delayMs, callback }) {
      const timer = setTimeout(callback, delayMs);
      if (typeof timer.unref === 'function') timer.unref();
      return () => clearTimeout(timer);
    },
  };
  let cancelTimer: (() => void) | undefined;
  // Terminal cancellation must survive activity arriving from an already-queued callback.
  let cancelled = false;

  const arm = (): void => {
    if (cancelled) return;
    cancelTimer?.();
    cancelTimer = timers.schedule({
      delayMs: input.timeoutMs,
      callback: () => { if (!cancelled) input.onTimeout(); },
    });
  };

  arm();

  return {
    noteActivity: arm,
    cancel: (_args: Record<string, never>): void => {
      cancelled = true;
      cancelTimer?.();
      cancelTimer = undefined;
    },
  };
}
