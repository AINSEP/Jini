import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
  MAX_RETRY_BACKOFF_DELAY_MS,
  RATE_LIMIT_RETRY_BASE_DELAY_MS,
  SAFE_RUN_RETRY_STRATEGY,
  TRANSIENT_RETRY_BASE_DELAY_MS,
  classifyProcessExitFailure,
  computeRetryBackoffMs,
  decideSafeRunRetry,
  resumableFromProcessExit,
} from '../retry.js';
import type {
  RunFailureCategory,
  RunFailureDetail,
  RunFailureStage,
} from '../failure-taxonomy.js';
import type { RunRetryFailureSignal, RunRetrySideEffectState } from '../retry.js';

describe('constants', () => {
  it('caps automatic same-run retries at one attempt with the transient strategy', () => {
    expect(DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS).toBe(1);
    expect(SAFE_RUN_RETRY_STRATEGY).toBe('same_run_transient');
    expect(RATE_LIMIT_RETRY_BASE_DELAY_MS).toBeGreaterThan(TRANSIENT_RETRY_BASE_DELAY_MS);
  });
});

describe('computeRetryBackoffMs', () => {
  it('applies equal jitter around the base transient delay on the first attempt', () => {
    expect(computeRetryBackoffMs({ attemptIndex: 1, category: undefined }, { random: () => 0 })).toBe(250); // half only
    expect(computeRetryBackoffMs({ attemptIndex: 1, category: undefined }, { random: () => 1 })).toBe(500); // full delay
    expect(computeRetryBackoffMs({ attemptIndex: 1, category: undefined }, { random: () => 0.5 })).toBe(375);
  });

  it('uses the larger rate-limit base delay', () => {
    expect(computeRetryBackoffMs({ attemptIndex: 1, category: 'rate_limit' }, { random: () => 0 })).toBe(RATE_LIMIT_RETRY_BASE_DELAY_MS / 2);
  });

  it('grows exponentially by attempt index and caps at the maximum', () => {
    // attemptIndex 10, rate_limit: 1000 * 2^9 far exceeds the 8s cap.
    expect(computeRetryBackoffMs({ attemptIndex: 10, category: 'rate_limit' }, { random: () => 0 })).toBe(MAX_RETRY_BACKOFF_DELAY_MS / 2);
    // attemptIndex 2, transient: 500 * 2^1 = 1000 → half 500.
    expect(computeRetryBackoffMs({ attemptIndex: 2, category: undefined }, { random: () => 0 })).toBe(500);
  });

  it('floors a sub-one or fractional attempt index to exponent zero', () => {
    expect(computeRetryBackoffMs({ attemptIndex: 0, category: undefined }, { random: () => 0 })).toBe(250);
    expect(computeRetryBackoffMs({ attemptIndex: 1.9, category: undefined }, { random: () => 0 })).toBe(250);
  });

  it('clamps a jitter sample outside [0,1] and treats a non-finite sample as zero jitter', () => {
    expect(computeRetryBackoffMs({ attemptIndex: 1, category: undefined }, { random: () => -1 })).toBe(250); // clamped to 0
    expect(computeRetryBackoffMs({ attemptIndex: 1, category: undefined }, { random: () => 2 })).toBe(500); // clamped to 1
    expect(computeRetryBackoffMs({ attemptIndex: 1, category: undefined }, { random: () => Number.NaN })).toBe(250); // no jitter
  });

  it('defaults the jitter source to Math.random', () => {
    const ms = computeRetryBackoffMs({ attemptIndex: 1, category: undefined });
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThanOrEqual(500);
  });
});

function transient(
  overrides: Partial<RunRetryFailureSignal> = {},
): RunRetryFailureSignal {
  return { failure_category: 'rate_limit', failure_detail: 'rate_limit_429', retryable: true, ...overrides };
}

describe('decideSafeRunRetry — suppression paths', () => {
  it('suppresses a non-failed run', () => {
    const decision = decideSafeRunRetry({ result: 'success', attemptCount: 0 });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: 'not_failed' });
  });

  it('suppresses when cancellation was requested', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { failure: transient(), sideEffects: { cancelRequested: true } });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: 'cancel_requested' });
  });

  it('suppresses when the failure signal is entirely absent', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: 'missing_failure_signal' });
  });

  it('suppresses a hard-quota detail regardless of category', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { failure: { failure_category: 'rate_limit', failure_detail: 'hard_quota', retryable: true } });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: 'hard_quota' });
  });

  it('suppresses a non-retryable category ahead of the retryable flag', () => {
    // category 'auth' hits the default → non_retryable_category, even though retryable=true.
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { failure: { failure_category: 'auth', failure_detail: 'auth_required', retryable: true } });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: 'non_retryable_category' });
  });

  it('suppresses a transient-shaped failure that is flagged not retryable', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { failure: transient({ retryable: false }) });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: 'not_retryable' });
  });

  it('suppresses an unsafe failure stage for a retryable transient category', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { failure: { failure_category: 'timeout', failure_detail: 'timeout', failure_stage: 'child_close', retryable: true } });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: 'unsafe_failure_stage' });
  });

  it('suppresses a retryable failure that carries no category via the transient reason', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { failure: { retryable: true } });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: 'missing_failure_signal' });
  });

  it('suppresses once the attempt limit is reached', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 1 }, { failure: transient() });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: 'attempt_limit_reached' });
  });

  it.each<[keyof RunRetrySideEffectState, string]>([
    ['userVisibleOutputSeen', 'user_visible_output_seen'],
    ['toolCallSeen', 'tool_call_seen'],
    ['artifactWriteSeen', 'artifact_write_seen'],
    ['liveArtifactSeen', 'live_artifact_seen'],
  ])('suppresses when side-effect %s was observed', (flag, reason) => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { failure: transient(), sideEffects: { [flag]: true } });
    expect(decision).toMatchObject({ shouldRetry: false, retrySuppressedReason: reason });
  });
});

describe('decideSafeRunRetry — transient category/detail/stage matrix', () => {
  const retryable = (
    category: RunFailureCategory,
    detail?: RunFailureDetail,
    stage?: RunFailureStage,
  ) =>
    decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { random: () => 0, failure: {
        failure_category: category,
        ...(detail ? { failure_detail: detail } : {}),
        ...(stage ? { failure_stage: stage } : {}),
        retryable: true,
      } });

  it('retries a rate_limit_429', () => {
    expect(retryable('rate_limit', 'rate_limit_429').shouldRetry).toBe(true);
  });

  it('suppresses a rate_limit whose detail is not a 429', () => {
    expect(retryable('rate_limit', 'workspace_credits_exhausted')).toMatchObject({
      retrySuppressedReason: 'non_retryable_category',
    });
  });

  it.each<RunFailureDetail>([
    'stream_disconnected',
    'upstream_5xx',
    'provider_high_demand',
    'provider_routing_error',
    'network_error',
  ])('retries an upstream_unavailable %s', (detail) => {
    expect(retryable('upstream_unavailable', detail).shouldRetry).toBe(true);
  });

  it('suppresses an upstream_unavailable with a non-transient detail', () => {
    expect(retryable('upstream_unavailable', 'upstream_client_error')).toMatchObject({
      retrySuppressedReason: 'non_retryable_category',
    });
  });

  it('retries empty_output at the first-token wait or with no stage, and suppresses later stages', () => {
    expect(retryable('empty_output', 'empty_output').shouldRetry).toBe(true); // no stage
    expect(retryable('empty_output', 'empty_output', 'first_token_wait').shouldRetry).toBe(true);
    expect(retryable('empty_output', 'empty_output', 'tool_execution')).toMatchObject({
      retrySuppressedReason: 'unsafe_failure_stage',
    });
  });

  it('retries timeout only at the first-token wait', () => {
    expect(retryable('timeout', 'timeout', 'first_token_wait').shouldRetry).toBe(true);
    expect(retryable('timeout', 'timeout', 'tool_execution')).toMatchObject({
      retrySuppressedReason: 'unsafe_failure_stage',
    });
  });

  it.each<RunFailureDetail>([
    'agent_protocol_error',
    'qoder_stop_sequence',
    'session_resume_expired',
    'stream_error',
    'fatal_rpc_error',
    // signal_killed added 2026-07-22: an OS-signal-terminated process (OOM-kill, infra eviction)
    // was never the agent's own choice to fail — see classifyProcessExitFailure's own doc.
    'signal_killed',
  ])('retries a transient process_exit %s', (detail) => {
    expect(retryable('process_exit', detail).shouldRetry).toBe(true);
  });

  it('suppresses a non-transient process_exit detail (the agent process exited on its own, not via an external signal)', () => {
    expect(retryable('process_exit', 'exit_nonzero')).toMatchObject({
      retrySuppressedReason: 'non_retryable_category',
    });
  });

  it('suppresses an unknown category via the default branch', () => {
    expect(retryable('unknown', 'unknown')).toMatchObject({
      retrySuppressedReason: 'non_retryable_category',
    });
  });
});

describe('decideSafeRunRetry — success path and input normalization', () => {
  it('schedules a retry with a computed delay for an eligible transient failure', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { failure: transient(), random: () => 1 });
    expect(decision).toEqual({
      shouldRetry: true,
      retryAttemptIndex: 1,
      retryMaxAttempts: 1,
      retryStrategy: 'same_run_transient',
      retryReason: 'transient_failure',
      retryDelayMs: RATE_LIMIT_RETRY_BASE_DELAY_MS, // full delay with random()=1
    });
  });

  it('falls back to Math.random when no jitter source is supplied on the retry path', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { failure: transient() });
    expect(decision.shouldRetry).toBe(true);
    if (decision.shouldRetry) {
      expect(decision.retryDelayMs).toBeGreaterThanOrEqual(RATE_LIMIT_RETRY_BASE_DELAY_MS / 2);
      expect(decision.retryDelayMs).toBeLessThanOrEqual(RATE_LIMIT_RETRY_BASE_DELAY_MS);
    }
  });

  it('floors fractional attempt and max-attempt inputs', () => {
    const decision = decideSafeRunRetry({ result: 'failed', attemptCount: 2.9 }, { maxAttempts: 5.9, failure: transient(), random: () => 0 });
    expect(decision).toMatchObject({ shouldRetry: true, retryAttemptIndex: 3, retryMaxAttempts: 5 });
  });

  it('normalizes a negative or non-finite attempt count to zero', () => {
    const negative = decideSafeRunRetry({ result: 'failed', attemptCount: -5 }, { failure: transient(), random: () => 0 });
    expect(negative).toMatchObject({ shouldRetry: true, retryAttemptIndex: 1 });
    const nan = decideSafeRunRetry({ result: 'failed', attemptCount: Number.NaN }, { failure: transient(), random: () => 0 });
    expect(nan).toMatchObject({ shouldRetry: true, retryAttemptIndex: 1 });
  });

  it('normalizes a negative or non-finite max-attempts to zero, forcing an immediate limit', () => {
    const negative = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { maxAttempts: -1, failure: transient() });
    expect(negative).toMatchObject({ retryMaxAttempts: 0, retrySuppressedReason: 'attempt_limit_reached' });
    const nan = decideSafeRunRetry({ result: 'failed', attemptCount: 0 }, { maxAttempts: Number.NaN, failure: transient() });
    expect(nan).toMatchObject({ retryMaxAttempts: 0, retrySuppressedReason: 'attempt_limit_reached' });
  });
});

describe('classifyProcessExitFailure', () => {
  it('classifies a signal-terminated process as retryable process_exit/signal_killed', () => {
    expect(classifyProcessExitFailure({ code: null, signal: 'SIGKILL' })).toEqual({
      failure_category: 'process_exit',
      failure_detail: 'signal_killed',
      retryable: true,
    });
    expect(classifyProcessExitFailure({ code: null, signal: 'SIGTERM' })).toMatchObject({ failure_detail: 'signal_killed', retryable: true });
  });

  it('a signal takes precedence over a code when Node somehow reports both', () => {
    expect(classifyProcessExitFailure({ code: 1, signal: 'SIGKILL' })).toMatchObject({ failure_detail: 'signal_killed', retryable: true });
  });

  it('classifies a plain non-zero exit code (no signal) as non-retryable process_exit/exit_nonzero', () => {
    expect(classifyProcessExitFailure({ code: 1, signal: null })).toEqual({
      failure_category: 'process_exit',
      failure_detail: 'exit_nonzero',
      retryable: false,
    });
    expect(classifyProcessExitFailure({ code: 127, signal: null })).toMatchObject({ failure_detail: 'exit_nonzero', retryable: false });
  });

  it('classifies code 0 with no signal (an ambiguous "failed" outcome with no actual failing exit info) as non-retryable process_exit/terminated_unknown', () => {
    expect(classifyProcessExitFailure({ code: 0, signal: null })).toEqual({
      failure_category: 'process_exit',
      failure_detail: 'terminated_unknown',
      retryable: false,
    });
  });

  it('classifies null code and null signal as non-retryable process_exit/terminated_unknown', () => {
    expect(classifyProcessExitFailure({ code: null, signal: null })).toMatchObject({ failure_detail: 'terminated_unknown', retryable: false });
  });
});

describe('resumableFromProcessExit', () => {
  it('returns true for a signal-terminated process (routes through decideSafeRunRetry, first attempt)', () => {
    expect(resumableFromProcessExit({ code: null, signal: 'SIGKILL' })).toBe(true);
  });

  it('returns false for a plain non-zero exit code', () => {
    expect(resumableFromProcessExit({ code: 1, signal: null })).toBe(false);
  });

  it('returns false for an ambiguous code-0/no-signal outcome', () => {
    expect(resumableFromProcessExit({ code: 0, signal: null })).toBe(false);
  });

  it('threads real sideEffects through to decideSafeRunRetry — userVisibleOutputSeen suppresses an otherwise-retryable signal kill', () => {
    expect(resumableFromProcessExit({ code: null, signal: 'SIGKILL' }, { sideEffects: { userVisibleOutputSeen: true, toolCallSeen: false } })).toBe(false);
  });

  it('threads real sideEffects through to decideSafeRunRetry — toolCallSeen suppresses an otherwise-retryable signal kill', () => {
    expect(resumableFromProcessExit({ code: null, signal: 'SIGKILL' }, { sideEffects: { userVisibleOutputSeen: false, toolCallSeen: true } })).toBe(false);
  });

  it('a signal kill with no observed side effects stays retryable when sideEffects is explicitly all-false', () => {
    expect(resumableFromProcessExit({ code: null, signal: 'SIGKILL' }, { sideEffects: { userVisibleOutputSeen: false, toolCallSeen: false } })).toBe(true);
  });
});
