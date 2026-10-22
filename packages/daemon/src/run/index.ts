/**
 * @module run — Public API for generic run-orchestration primitives: result and
 * error-code derivation, the safe-retry policy and its failure taxonomy, and
 * post-run diagnostic tail collection.
 *
 * These are the product-neutral run-orchestration helpers extracted from the
 * daemon's run capability barrel. Product telemetry (runtime-type / usage /
 * timing analytics), the vendor-specific failure classifier, artifact
 * filesystem snapshotting, and MCP tool-bundle resolution are deliberately
 * out of scope here — see `archived provenance ledger`.
 */

// core — result derivation, failure taxonomy, and retry policy
export {
  runResultFromStatus,
  deriveRunErrorCode,
  DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS,
  SAFE_RUN_RETRY_STRATEGY,
  RATE_LIMIT_RETRY_BASE_DELAY_MS,
  TRANSIENT_RETRY_BASE_DELAY_MS,
  RETRY_BACKOFF_MULTIPLIER,
  MAX_RETRY_BACKOFF_DELAY_MS,
  computeRetryBackoffMs,
  decideSafeRunRetry,
  classifyProcessExitFailure,
  resumableFromProcessExit,
} from './core/index.js';
export type {
  RunResult,
  RunStatusForAnalytics,
  RunFailureResult,
  RunFailureCategory,
  RunFailureDetail,
  RunFailureStage,
  RunRetryStrategy,
  RunRetrySuppressedReason,
  RunRetryFailureSignal,
  RunRetrySideEffectState,
  RunRetryPolicyInput,
  RunRetryPolicyDecision,
} from './core/index.js';

// diagnostics — stderr/stdout tail summaries and diagnostic analytics
export {
  stderrLineCountBucket,
  collectStderrTailSummary,
  collectStdoutTailSummary,
  summarizeRunDiagnosticsForAnalytics,
} from './diagnostics/index.js';
export type {
  RunEventForDiagnostics,
  RunDiagnosticSource,
  StderrLineCountBucket,
  RunCloseReason,
  RunDiagnosticsAnalytics,
  StreamTailSummary,
  StderrTailSummary,
  StdoutTailSummary,
  TailRedactor,
} from './diagnostics/index.js';
