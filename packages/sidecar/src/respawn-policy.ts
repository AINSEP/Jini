/** Rolling failure-window backoff with an independent consecutive port-conflict cap. */
/**
 * Keep retry decisions free of process I/O and timers so an injected clock can exercise the
 * policy without real delays or child processes. Backoff uses the same rolling window as the
 * crash-loop cap, rather than lifetime attempts: hosts without a healthy-start acknowledgment
 * still self-heal after quiet periods, and an isolated late crash starts at the fast end again.
 * Consecutive port conflicts get a separate, tighter cap. A leaked port either clears during
 * the first short retries or does not; climbing the entire crash ladder cannot fix a stuck port.
 * A different failure resets that counter because it tracks this specific problem, not general health.
 */
export interface RespawnPolicyOptions {
  backoffScheduleMs?: readonly number[];
  crashLoopWindowMs?: number;
  crashLoopMaxFailures?: number;
  portConflictMaxAttempts?: number;
}

export interface RespawnFailureInput { isPortConflict: boolean }

export type RespawnDecision =
  | { action: "retry"; delayMs: number; attempt: number }
  | { action: "give-up"; kind: "crash-loop"; attempts: number; windowMs: number }
  | { action: "give-up"; kind: "port-conflict"; attempts: number };

export interface RespawnPolicy {
  recordFailure(input: RespawnFailureInput): RespawnDecision;
  /** Manual recovery clears counters and the trip so an operator can force a fresh attempt. */
  reset(): void;
  isTripped(): boolean;
}

/**
 * Create an independent retry policy; a caller-owned clock is mandatory.
 * @param required Clock port, read once for each recorded failure.
 * @param options Backoff ladder and rolling/consecutive failure thresholds.
 * @returns Stateful policy with explicit reset for manual recovery.
 * @throws RangeError for empty/negative backoff or invalid thresholds.
 * @complexity O(w) per failure for w retained timestamps; reset is O(1).
 */
export function createRespawnPolicy(
  { now }: { now: () => number },
  options: RespawnPolicyOptions = {},
): RespawnPolicy {
  const backoffScheduleMs = [...(options.backoffScheduleMs ?? [1000, 2000, 4000, 8000, 16000, 30000])];
  const crashLoopWindowMs = options.crashLoopWindowMs ?? 60000;
  const crashLoopMaxFailures = options.crashLoopMaxFailures ?? 5;
  const portConflictMaxAttempts = options.portConflictMaxAttempts ?? 3;
  if (backoffScheduleMs.length === 0 || backoffScheduleMs.some((delay) => !Number.isFinite(delay) || delay < 0)) {
    throw new RangeError("backoffScheduleMs must contain finite non-negative delays");
  }
  if (!Number.isFinite(crashLoopWindowMs) || crashLoopWindowMs <= 0) throw new RangeError("crashLoopWindowMs must be positive and finite");
  for (const count of [crashLoopMaxFailures, portConflictMaxAttempts]) {
    if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("failure thresholds must be positive safe integers");
  }

  let timestamps: number[] = [];
  let consecutivePortConflicts = 0;
  let tripped = false;
  return {
    recordFailure({ isPortConflict }) {
      consecutivePortConflicts = isPortConflict ? consecutivePortConflicts + 1 : 0;
      const time = now();
      timestamps = [...timestamps.filter((stamp) => stamp > time - crashLoopWindowMs), time];
      if (consecutivePortConflicts >= portConflictMaxAttempts) {
        tripped = true;
        return { action: "give-up", kind: "port-conflict", attempts: consecutivePortConflicts };
      }
      if (timestamps.length >= crashLoopMaxFailures) {
        tripped = true;
        return { action: "give-up", kind: "crash-loop", attempts: timestamps.length, windowMs: crashLoopWindowMs };
      }
      const attempt = timestamps.length;
      return { action: "retry", delayMs: backoffScheduleMs[Math.min(attempt - 1, backoffScheduleMs.length - 1)]!, attempt };
    },
    reset() { timestamps = []; consecutivePortConflicts = 0; tripped = false; },
    isTripped() { return tripped; },
  };
}
