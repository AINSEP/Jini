// Turns a run's terminal status into the `result` + `error_code` shape that
// downstream analytics / lifecycle events expect.
//
// The invariant this enforces — `result === 'failed'` MUST carry a non-empty
// `error_code` — is exercisable in isolation. Several failure paths in the
// child-process lifecycle finish a run as `failed` directly without first
// emitting an `error` event (fatal RPC, stream-error fall-through, a child
// error with no diagnostic, etc.), leaving `errorCode === null`. The fallback
// chain below derives an `AGENT_SIGNAL_*` / `AGENT_EXIT_*` /
// `AGENT_TERMINATED_UNKNOWN` value for those cases so a failed run always
// carries an `error_code` and dashboards keyed on it never see a blank cell.

/** @module run/core/result — Run result and status-code primitives shared by all run-domain concerns. */

/** Terminal outcome of a run as reported in analytics and lifecycle events. */
export type RunResult = 'success' | 'failed' | 'cancelled';

/** Minimal run-status shape required to derive analytics result and error codes. */
export interface RunStatusForAnalytics {
  status: string;
  errorCode?: string | null;
  exitCode?: number | null;
  signal?: string | null;
}

/**
 * Maps a raw run status string to the canonical `RunResult` used by analytics.
 * @param status - Raw status string from the run record (e.g. 'succeeded', 'canceled').
 * @returns 'success', 'cancelled', or 'failed'.
 */
export function runResultFromStatus({ status }: { readonly status: string | undefined }): RunResult {
  if (status === 'succeeded') return 'success';
  if (status === 'canceled') return 'cancelled';
  return 'failed';
}

/**
 * Derives a non-empty `error_code` for analytics whenever `result === 'failed'`.
 * Prefers the structured code stamped on the run; falls back to signal, exit
 * code, or a sentinel so dashboards never see a blank cell.
 * @param status - Run status fields including any stamped error code, exit code, and signal.
 * @returns An error code string, or `undefined` when the run succeeded.
 */
export function deriveRunErrorCode({ status }: { readonly status: RunStatusForAnalytics }
): string | undefined {
  const result = runResultFromStatus({ status: status.status });
  if (result === 'success') return undefined;
  // Cancellation usually carries no error; only forward an explicit one
  // when the daemon stamped it (e.g. cancel during error recovery).
  if (result === 'cancelled') return status.errorCode ?? undefined;
  // Failure path: prefer the structured code stamped on the run. When the run
  // reached `failed` without going through an `error` emission, derive the best
  // signal we have.
  const explicit = status.errorCode;
  if (explicit) return explicit;
  if (status.signal) return `AGENT_SIGNAL_${status.signal}`;
  if (typeof status.exitCode === 'number' && status.exitCode !== 0) {
    return `AGENT_EXIT_${status.exitCode}`;
  }
  return 'AGENT_TERMINATED_UNKNOWN';
}
