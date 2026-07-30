import type {
  RunFailureCategory,
  RunFailureDetail,
  RunFailureStage,
  RunFailureResult,
  RunRetryStrategy,
  RunRetrySuppressedReason,
} from './failure-taxonomy.js';

/** @module run/core/retry — Retry backoff constants and policy decision logic for safe run retries. */

// Counts automatic same-run retry attempts, not the initial run. The default
// scopes automatic recovery to at most one same-run retry, so `attemptCount >=
// 1` suppresses with `attempt_limit_reached`.
/** Maximum number of automatic same-run retry attempts allowed per run (not counting the initial attempt). */
export const DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS = 1;
/** Retry strategy label emitted in analytics for all automatic same-run transient retries. */
export const SAFE_RUN_RETRY_STRATEGY: RunRetryStrategy = 'same_run_transient';

// Backoff before a same-run retry restart. An immediate retry of a transient
// failure — especially a 429 — tends to re-hit the same limit, so the policy
// waits before restarting. `rate_limit` gets a larger base than other
// transient classes because the upstream is explicitly asking us to slow down.
// The delay grows exponentially by attempt index and is capped, then equal
// jitter (half fixed + half random) is applied to avoid synchronized retries
// across concurrent runs.
/** Base backoff delay in milliseconds for rate-limit retries; larger than the transient base because the upstream is explicitly asking us to slow down. */
export const RATE_LIMIT_RETRY_BASE_DELAY_MS = 1_000;
/** Base backoff delay in milliseconds for non-rate-limit transient retries. */
export const TRANSIENT_RETRY_BASE_DELAY_MS = 500;
/** Exponential multiplier applied per retry attempt index to grow the backoff delay. */
export const RETRY_BACKOFF_MULTIPLIER = 2;
/** Maximum backoff delay in milliseconds after exponential growth and before jitter is applied. */
export const MAX_RETRY_BACKOFF_DELAY_MS = 8_000;

function backoffBaseDelayMs(category: RunFailureCategory | undefined): number {
  return category === 'rate_limit'
    ? RATE_LIMIT_RETRY_BASE_DELAY_MS
    : TRANSIENT_RETRY_BASE_DELAY_MS;
}

// Pure, deterministic when `random` is supplied. `attemptIndex` is 1-based (the
// index of the attempt about to be scheduled), so the first retry uses the base
// delay and each subsequent attempt doubles it up to the cap. Equal jitter
// returns a value in [delay/2, delay].
/**
 * Computes an exponentially backed-off delay with equal jitter for a retry attempt.
 * @param attemptIndex - 1-based index of the attempt about to be scheduled.
 * @param category - Failure category used to select the base delay; rate-limit failures use a larger base.
 * @param random - Optional jitter source; defaults to `Math.random` for production use.
 * @returns Backoff duration in milliseconds, capped at `MAX_RETRY_BACKOFF_DELAY_MS`.
 */
export function computeRetryBackoffMs(
  attemptIndex: number,
  category: RunFailureCategory | undefined,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.floor(attemptIndex) - 1);
  const raw = backoffBaseDelayMs(category) * RETRY_BACKOFF_MULTIPLIER ** exponent;
  const capped = Math.min(raw, MAX_RETRY_BACKOFF_DELAY_MS);
  const half = capped / 2;
  const sample = random();
  const jitter = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0;
  return Math.round(half + jitter * half);
}

/** Failure signal fields extracted from a run's error state, used by the retry policy. */
export interface RunRetryFailureSignal {
  failure_category?: RunFailureCategory;
  failure_detail?: RunFailureDetail;
  failure_stage?: RunFailureStage;
  retryable?: boolean;
}

/** Observable side-effects from the current run attempt that can suppress a retry to avoid double-work. */
export interface RunRetrySideEffectState {
  cancelRequested?: boolean;
  userVisibleOutputSeen?: boolean;
  toolCallSeen?: boolean;
  artifactWriteSeen?: boolean;
  liveArtifactSeen?: boolean;
}

/** Full input to `decideSafeRunRetry`, combining run outcome, failure signal, attempt count, and side-effect guards. */
export interface RunRetryPolicyInput {
  result: RunFailureResult;
  failure?: RunRetryFailureSignal;
  attemptCount: number;
  maxAttempts?: number;
  sideEffects?: RunRetrySideEffectState;
  // Injectable jitter source for deterministic tests; defaults to Math.random.
  random?: () => number;
}

/** Discriminated union output of `decideSafeRunRetry`; either a retry schedule or a suppression reason. */
export type RunRetryPolicyDecision =
  | {
      shouldRetry: true;
      retryAttemptIndex: number;
      retryMaxAttempts: number;
      retryStrategy: RunRetryStrategy;
      retryReason: 'transient_failure';
      retryDelayMs: number;
    }
  | {
      shouldRetry: false;
      retryAttemptIndex: number;
      retryMaxAttempts: number;
      retryStrategy: RunRetryStrategy;
      retrySuppressedReason: RunRetrySuppressedReason;
    };

/**
 * Classifies a terminated child process's raw `code`/`signal` into the `process_exit` category
 * this module's own policy understands — the only signal cheaply available to
 * `@jini-ai/daemon`'s `ClassifyFailure` port (see `agent-executor.ts`'s `FailureClassificationContext`
 * doc for why richer signal, like a detected 429 or protocol error, isn't available there without
 * new stderr/stdout buffering machinery this pass deliberately does not add).
 * @param code - The child process's exit code, or `null` if it was terminated by a signal.
 * @param signal - The OS signal that terminated the child, or `null` if it exited normally.
 * @returns A `RunRetryFailureSignal` suitable for {@link decideSafeRunRetry}.
 * @complexity O(1).
 */
export function classifyProcessExitFailure(code: number | null, signal: string | null): RunRetryFailureSignal {
  if (signal !== null) {
    return { failure_category: 'process_exit', failure_detail: 'signal_killed', retryable: true };
  }
  if (code !== null && code !== 0) {
    return { failure_category: 'process_exit', failure_detail: 'exit_nonzero', retryable: false };
  }
  return { failure_category: 'process_exit', failure_detail: 'terminated_unknown', retryable: false };
}

/**
 * `@jini-ai/daemon`'s `ClassifyFailure` port needs a plain `boolean`, not a full
 * {@link RunRetryPolicyDecision} — gap 4 only sets a failed run's `resumable` flag (informational
 * metadata a host reads for its own later follow-up run, see `RunEndPayload.sessionRef`'s own doc),
 * it does not schedule an automatic in-process retry the way {@link decideSafeRunRetry}'s full
 * `attemptCount`/`sideEffects` machinery is built for. This composes the two: classifies the raw
 * exit info via {@link classifyProcessExitFailure}, then asks {@link decideSafeRunRetry} whether a
 * *first* attempt (`attemptCount: 0`) would be safe to retry, and returns that verdict.
 *
 * `attemptCount: 0` is always correct here, not a stand-in: no automatic same-run retry *loop*
 * exists anywhere in this codebase (gap 4's `resumable` flag is read-only metadata for a host's own
 * later follow-up run, never consumed to actually spawn attempt #2 — see this function's own doc
 * above) — so every real call to this function genuinely is evaluating the first and only attempt
 * made so far. A future auto-retry loop would need to supply its own real count, not reuse this.
 *
 * `sideEffects` (2026-07-22, optional — `agent-executor.ts`'s three `wire*Lifecycle` drivers supply
 * `userVisibleOutputSeen`/`toolCallSeen`, derived live from the translated agent-event stream each
 * already processes; see `FailureClassificationContext`'s own doc for why those two specifically,
 * and why `cancelRequested`/`artifactWriteSeen`/`liveArtifactSeen` aren't threaded through this
 * call at all) makes two of `decideSafeRunRetry`'s four side-effect-suppression guards genuinely
 * exercised. Omitting it (`undefined`) preserves this function's original no-observed-side-effects
 * behavior for any other caller.
 * @complexity O(1).
 */
export function resumableFromProcessExit(
  code: number | null,
  signal: string | null,
  sideEffects?: Pick<RunRetrySideEffectState, 'userVisibleOutputSeen' | 'toolCallSeen'>,
): boolean {
  const decision = decideSafeRunRetry({
    result: 'failed',
    failure: classifyProcessExitFailure(code, signal),
    attemptCount: 0,
    ...(sideEffects !== undefined ? { sideEffects } : {}),
  });
  return decision.shouldRetry;
}

function normalizeAttemptCount(attemptCount: number): number {
  if (!Number.isFinite(attemptCount) || attemptCount < 0) return 0;
  return Math.floor(attemptCount);
}

function normalizeMaxAttempts(maxAttempts: number | undefined): number {
  if (maxAttempts === undefined) return DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS;
  if (!Number.isFinite(maxAttempts) || maxAttempts < 0) return 0;
  return Math.floor(maxAttempts);
}

/**
 * Categories whose transience is decided by the failure *detail*: the listed details are the
 * presumptively-transient ones, and any other detail (including `undefined`) suppresses with
 * `non_retryable_category`. A category absent from this table is not detail-gated.
 *
 * `process_exit`'s `signal_killed` entry was added 2026-07-22 (gap 4's real default classifier —
 * see {@link classifyProcessExitFailure}): a process terminated by an OS signal
 * (SIGKILL/SIGTERM/etc) was never the agent's own choice to fail — an OOM-kill or an infra-level
 * eviction is the common real-world cause, and both are presumptively transient. A plain non-zero
 * exit code, by contrast, is the agent's own process deciding to fail (a config problem, a
 * deterministic bug) and is not retried here.
 */
const TRANSIENT_DETAILS_BY_CATEGORY: Partial<
  Record<RunFailureCategory, ReadonlySet<RunFailureDetail | undefined>>
> = {
  rate_limit: new Set(['rate_limit_429']),
  upstream_unavailable: new Set([
    'stream_disconnected',
    'upstream_5xx',
    'provider_high_demand',
    'provider_routing_error',
    'network_error',
  ]),
  process_exit: new Set([
    'agent_protocol_error',
    'qoder_stop_sequence',
    'session_resume_expired',
    'stream_error',
    'fatal_rpc_error',
    'signal_killed',
  ]),
};

/**
 * Categories whose transience is decided by the failure *stage* instead: the listed stages are the
 * ones at which a retry is safe, and any other stage suppresses with `unsafe_failure_stage`.
 * `empty_output` lists `undefined` explicitly because an unknown stage is treated as safe there
 * (the run produced nothing, so nothing can be duplicated), whereas `timeout` requires a positively
 * known `first_token_wait` stage.
 */
const SAFE_STAGES_BY_CATEGORY: Partial<
  Record<RunFailureCategory, ReadonlySet<RunFailureStage | undefined>>
> = {
  empty_output: new Set([undefined, 'first_token_wait']),
  timeout: new Set(['first_token_wait']),
};

function transientSuppressedReason(
  category: RunFailureCategory | undefined,
  detail: RunFailureDetail | undefined,
  stage: RunFailureStage | undefined,
): RunRetrySuppressedReason | null {
  if (category === undefined) return 'missing_failure_signal';
  const transientDetails = TRANSIENT_DETAILS_BY_CATEGORY[category];
  if (transientDetails !== undefined) {
    return transientDetails.has(detail) ? null : 'non_retryable_category';
  }
  const safeStages = SAFE_STAGES_BY_CATEGORY[category];
  if (safeStages !== undefined) {
    return safeStages.has(stage) ? null : 'unsafe_failure_stage';
  }
  return 'non_retryable_category';
}

/**
 * Decides whether a failed run should be automatically retried and, if so, schedules the delay.
 * Suppresses retries when the run was cancelled, emitted user-visible output, or hit a non-transient failure.
 * @param input - Run outcome, failure classification, attempt count, and observable side effects.
 * @returns A `RunRetryPolicyDecision` with `shouldRetry: true` and a delay, or `shouldRetry: false` with a suppression reason.
 */
export function decideSafeRunRetry(
  input: RunRetryPolicyInput,
): RunRetryPolicyDecision {
  const attemptCount = normalizeAttemptCount(input.attemptCount);
  const retryMaxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const retryAttemptIndex = attemptCount + 1;
  const base = {
    retryAttemptIndex,
    retryMaxAttempts,
    retryStrategy: SAFE_RUN_RETRY_STRATEGY,
  };
  const suppress = (
    retrySuppressedReason: RunRetrySuppressedReason,
  ): RunRetryPolicyDecision => ({
    ...base,
    shouldRetry: false,
    retrySuppressedReason,
  });

  if (input.result !== 'failed') return suppress('not_failed');

  const sideEffects = input.sideEffects ?? {};
  if (sideEffects.cancelRequested) return suppress('cancel_requested');

  const failure = input.failure;
  if (!failure) return suppress('missing_failure_signal');
  if (failure.failure_detail === 'hard_quota') return suppress('hard_quota');
  const transientReason = transientSuppressedReason(
    failure.failure_category,
    failure.failure_detail,
    failure.failure_stage,
  );
  if (transientReason === 'non_retryable_category') return suppress(transientReason);
  if (!failure.retryable) return suppress('not_retryable');
  if (transientReason) return suppress(transientReason);
  if (attemptCount >= retryMaxAttempts) return suppress('attempt_limit_reached');
  if (sideEffects.userVisibleOutputSeen) return suppress('user_visible_output_seen');
  if (sideEffects.toolCallSeen) return suppress('tool_call_seen');
  if (sideEffects.artifactWriteSeen) return suppress('artifact_write_seen');
  if (sideEffects.liveArtifactSeen) return suppress('live_artifact_seen');

  return {
    ...base,
    shouldRetry: true,
    retryReason: 'transient_failure',
    retryDelayMs: computeRetryBackoffMs(
      retryAttemptIndex,
      failure.failure_category,
      input.random,
    ),
  };
}
