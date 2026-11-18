/** @module agent-protocol/acp/session-run
 * Per-session run context and lifecycle helpers for `attachAcpSession`.
 * Holds the mutable session flags (finished/fatal/aborted, stage watchdog,
 * suppression diagnostics, pending permission requests) as one `AcpRun`
 * object so each concern is a small function instead of a closure inside one
 * giant function. Only types are imported from `./session.js`, so there is no
 * runtime import cycle.
 */
import path from 'node:path';
import type { JsonRpcId, UnknownRecord, TimerHandle, AcpChildProcess } from './types.js';
import {
  createToolCallTextSuppressor,
  type ArtifactTextSuppressor,
} from './text-suppression.js';
import type { createJsonLineStream } from '../core/index.js';
import {
  ACP_RAW_EVENT_SHAPE_DIAGNOSTIC_LIMIT,
  ACP_PROTOCOL_VERSION,
  AMR_STDERR_RETRY_TAIL_LIMIT,
} from './constants.js';
import { errorMessage, asObject } from './json.js';
import {
  sendRpc,
  sendRpcResult,
  formatUsage,
} from './rpc.js';
import { acpRawEventShape, promotedAmrStderrPayload } from './updates.js';
import { buildPromptBlocks } from './session-params.js';
import { createAcpSessionState } from './session-state.js';
import type {
  AcpSessionController,
  AcpSessionEffects,
  AcpSessionState,
  AttachAcpSessionOptions,
  ResolvedAcpSessionOptions,
} from './session.js';

/** `source` tag on every diagnostic this session reports about the ACP JSON-RPC stream. */
const ACP_JSON_RPC_SOURCE = 'acp-json-rpc';
interface SuppressionSummary {
  suppressedChars: number;
  suppressedChunks: number;
  openedBlocks: number;
  closedBlocks: number;
}

type SuppressionStats = SuppressionSummary & { pendingCandidateChars: number; suppressing: boolean };

/** Mutable state of one attached ACP session, shared by the helpers below. */
export interface AcpRun {
  options: AttachAcpSessionOptions;
  resolved: ResolvedAcpSessionOptions;
  child: AcpChildProcess;
  stdin: NonNullable<AcpChildProcess['stdin']>;
  state: AcpSessionState;
  runStartedAt: number;
  effectiveCwd: string;
  emittedFirstTokenStatus: boolean;
  rawAcpShapeDiagnosticCount: number;
  artifactSuppressionDiagnosticCount: number;
  amrStderrRetryTail: string;
  finished: boolean;
  fatal: boolean;
  aborted: boolean;
  stageTimer: TimerHandle | null;
  pendingPermissionRequests: Map<JsonRpcId, () => void>;
  toolCallTextSuppressor: ArtifactTextSuppressor;
  toolCallTextSuppressorLastSuppressedChars: number;
  artifactTextSuppressionSummary: SuppressionSummary;
  toolCallTextSuppressionSummary: SuppressionSummary;
}

type FailOptions = { forceModelUnavailable?: boolean; details?: unknown; retryable?: boolean };

function emptySuppressionSummary(): SuppressionSummary {
  return { suppressedChars: 0, suppressedChunks: 0, openedBlocks: 0, closedBlocks: 0 };
}

/** Builds the run context, rejecting a child without piped stdin/stdout. */
export function createAcpRun({ options, resolved }: {
  options: AttachAcpSessionOptions;
  resolved: ResolvedAcpSessionOptions;
}): AcpRun {
  const { child, cwd, resumeSessionId } = options;
  if (!child.stdin || !child.stdout) {
    const error = new Error('ACP child process must expose stdin and stdout streams');
    if (resumeSessionId) Object.assign(error, {
      details: { kind: 'resume_failed', sessionId: resumeSessionId },
    });
    throw error;
  }
  return {
    options, resolved, child, stdin: child.stdin,
    state: createAcpSessionState(),
    runStartedAt: Date.now(),
    effectiveCwd: path.resolve(cwd || process.cwd()),
    emittedFirstTokenStatus: false,
    rawAcpShapeDiagnosticCount: 0,
    artifactSuppressionDiagnosticCount: 0,
    amrStderrRetryTail: '',
    finished: false,
    fatal: false,
    aborted: false,
    stageTimer: null,
    pendingPermissionRequests: new Map(),
    toolCallTextSuppressor: createToolCallTextSuppressor(),
    toolCallTextSuppressorLastSuppressedChars: 0,
    artifactTextSuppressionSummary: emptySuppressionSummary(),
    toolCallTextSuppressionSummary: emptySuppressionSummary(),
  };
}

export function sendAgent(run: AcpRun, { payload }: { payload: unknown }): void {
  run.options.send({ event: 'agent', payload });
}

export function clearStageTimer(run: AcpRun): void {
  if (run.stageTimer) clearTimeout(run.stageTimer);
  run.stageTimer = null;
}

export function resetStageTimer(run: AcpRun, { label }: { label: string }): void {
  if (run.stageTimer) clearTimeout(run.stageTimer);
  const { stageTimeoutMs } = run.resolved;
  // `stageTimeoutMs <= 0` disables the watchdog. Mirrors a typical outer
  // run-level inactivity watchdog's escape hatch. Without this, a caller
  // passing a zero stage timeout would schedule a 0ms timeout that fires on
  // the next tick and kills the session immediately.
  if (stageTimeoutMs <= 0 || run.pendingPermissionRequests.size > 0) return;
  run.stageTimer = setTimeout(() => {
    failRun(run, { message: `ACP ${label} timed out after ${stageTimeoutMs}ms` });
  }, stageTimeoutMs);
}

function amrModelUnavailablePayload(message: string) {
  return {
    message,
    error: {
      code: 'AMR_MODEL_UNAVAILABLE',
      message,
      retryable: false,
      details: { kind: 'amr_model', action: 'choose_model' },
    },
  };
}

function isModelUnavailableError(message: string): boolean {
  const value = message.toLowerCase();
  return (
    value.includes('model not found') ||
    value.includes('providermodelnotfounderror') ||
    value.includes('unknown model') ||
    value.includes('invalid model')
  );
}

/** Emits a failure, tagging an unacknowledged resume without losing its cause.
 * The session id is only set by a valid load acknowledgement, so the same
 * boundary covers initialize/load RPC errors, watchdogs, and transport loss.
 * Fresh sessions and errors after load keep their existing payloads.
 * @complexity O(1), excluding the host's event sink.
 */
function sendFailure(run: AcpRun, payload: UnknownRecord): void {
  const { resumeSessionId, send } = run.options;
  if (!resumeSessionId || run.state.sessionId) {
    send({ event: 'error', payload });
    return;
  }
  const originalError = asObject(payload.error);
  send({ event: 'error', payload: {
    ...payload,
    error: {
      code: 'AGENT_EXECUTION_FAILED',
      message: payload.message,
      retryable: false,
      ...originalError,
      details: {
        kind: 'resume_failed',
        sessionId: resumeSessionId,
        ...(originalError?.details === undefined ? {} : { cause: originalError.details }),
      },
    },
  } });
}

// Both call sites of `failWithPayload` (the session/update retry-status promotion and the
// stderr promotion) are already nested inside a scope gated by `finished`
// at their own entry point (the parser callback's own `if (aborted ||
// finished) return;`, and the stderr handler's `if (!modelUnavailableErrorCode
// || finished) return;`), and neither is re-entrant within a single
// synchronous call — so `failWithPayload` can never actually be invoked a
// second time once `finished` is true. The origin file carried its own
// `if (finished) return;` re-entry guard here anyway; removed per this
// package's coverage-driven dead-branch discipline (verified unreachable
// by tracing every call site — see archived provenance ledger), not suppressed.
export function failWithPayload(run: AcpRun, payload: UnknownRecord): void {
  run.finished = true;
  run.fatal = true;
  clearStageTimer(run);
  sendFailure(run, payload);
  if (!run.child.killed) run.child.kill('SIGTERM');
}

function buildFailurePayload({ message, options }: { message: string; options: FailOptions }): UnknownRecord {
  const bareFailure = options.details === undefined && options.retryable === undefined;
  if (bareFailure) return { message };
  return {
    message,
    error: {
      code: 'AGENT_EXECUTION_FAILED',
      message,
      retryable: options.retryable ?? false,
      // Every real call site that reaches this branch (the
      // RPC-error path and the no-visible-output path) always
      // supplies `details` whenever it supplies `retryable`, and
      // `retryable` is itself derived from the same `details`
      // source at the RPC-error call site — so `options.details`
      // is never actually undefined here. Spreading it
      // unconditionally (rather than conditionally omitting the
      // key) is behaviorally identical for every real caller;
      // simplified per this package's coverage-driven
      // dead-branch discipline. See archived provenance ledger.
      details: options.details,
    },
  };
}

export function failRun(run: AcpRun, { message }: { message: string }, options: FailOptions = {}): void {
  if (run.finished) return;
  run.finished = true;
  run.fatal = true;
  clearStageTimer(run);
  const useModelUnavailable =
    run.options.modelUnavailableErrorCode &&
    (options.forceModelUnavailable || isModelUnavailableError(message));
  sendFailure(run, useModelUnavailable
    ? amrModelUnavailablePayload(message)
    : buildFailurePayload({ message, options }));
  if (!run.child.killed) run.child.kill('SIGTERM');
}

export function writeRpc(run: AcpRun, rpc: { id: JsonRpcId; method: string; params: unknown; timeoutLabel: string }): void {
  resetStageTimer(run, { label: rpc.timeoutLabel });
  try {
    sendRpc(run.stdin, rpc.id, rpc.method, rpc.params);
  } catch (err) {
    failRun(run, { message: `stdin write failed: ${errorMessage(err)}` });
  }
}

function emitAcpRawShapeDiagnostic(run: AcpRun, update: UnknownRecord): void {
  if (!run.options.modelUnavailableErrorCode) return;
  if (run.rawAcpShapeDiagnosticCount >= ACP_RAW_EVENT_SHAPE_DIAGNOSTIC_LIMIT) return;
  run.rawAcpShapeDiagnosticCount += 1;
  sendAgent(run, {
    payload: {
    type: 'diagnostic',
    name: 'acp_raw_event_shape',
    source: ACP_JSON_RPC_SOURCE,
    elapsedMs: Date.now() - run.runStartedAt,
    shape: acpRawEventShape(update),
  },
  });
}

// All three call sites guard against an empty `delta` before calling this
// (the finishCleanPrompt flush, the `if (outputDelta)` branch, and the
// plain-else branch which is only reached after an earlier `if
// (!toolCallStrippedDelta) return;` already ruled out emptiness) — so the
// origin file's own `if (!delta) return;` guard here can never actually
// fire. Removed per this package's coverage-driven dead-branch
// discipline (verified unreachable by tracing every call site — see
// archived provenance ledger), not suppressed.
function emitVisibleTextDelta(run: AcpRun, { delta }: { delta: string }): void {
  run.state.emittedVisibleTextChunk = true;
  if (!run.emittedFirstTokenStatus) {
    run.emittedFirstTokenStatus = true;
    sendAgent(run, {
      payload: {
      type: 'status',
      label: 'streaming',
      ttftMs: Date.now() - run.runStartedAt,
    },
    });
  }
  sendAgent(run, { payload: { type: 'text_delta', delta } });
}

function applySuppressionStats({ summary, stats, delta }: {
  summary: SuppressionSummary;
  stats: SuppressionStats;
  delta: number;
}): void {
  summary.suppressedChars += delta;
  summary.suppressedChunks = stats.suppressedChunks;
  summary.openedBlocks = stats.openedBlocks;
  summary.closedBlocks = stats.closedBlocks;
}

function sendSuppressionDiagnostic(run: AcpRun, diagnostic: {
  name: string;
  reason: string;
  summary: SuppressionSummary;
  stats: SuppressionStats;
}): void {
  if (run.artifactSuppressionDiagnosticCount >= ACP_RAW_EVENT_SHAPE_DIAGNOSTIC_LIMIT) return;
  run.artifactSuppressionDiagnosticCount += 1;
  const { summary, stats } = diagnostic;
  sendAgent(run, {
    payload: {
    type: 'diagnostic',
    name: diagnostic.name,
    source: ACP_JSON_RPC_SOURCE,
    elapsedMs: Date.now() - run.runStartedAt,
    reason: diagnostic.reason,
    suppressedChars: summary.suppressedChars,
    suppressedChunks: summary.suppressedChunks,
    openedBlocks: summary.openedBlocks,
    closedBlocks: summary.closedBlocks,
    pendingCandidateChars: stats.pendingCandidateChars,
    suppressing: stats.suppressing,
  },
  });
}

function noteArtifactTextSuppression(run: AcpRun, { reason }: { reason: string }): void {
  const { state } = run;
  if (!state.dsmlArtifactSuppressor) return;
  const stats = state.dsmlArtifactSuppressor.stats();
  const suppressedDelta = stats.suppressedChars - state.dsmlArtifactSuppressorLastSuppressedChars;
  if (suppressedDelta <= 0) return;
  state.dsmlArtifactSuppressorLastSuppressedChars = stats.suppressedChars;
  applySuppressionStats({ summary: run.artifactTextSuppressionSummary, stats, delta: suppressedDelta });
  sendSuppressionDiagnostic(run, {
    name: 'acp_artifact_text_suppression', reason, summary: run.artifactTextSuppressionSummary, stats,
  });
}

function emitArtifactTextSuppressionSummary(run: AcpRun): void {
  const summary = run.artifactTextSuppressionSummary;
  if (summary.suppressedChars <= 0) return;
  if (run.resolved.executionProfile === 'filesystem') {
    sendAgent(run, {
      payload: {
      type: 'diagnostic',
      name: 'unexpected_text_artifact_in_filesystem_run',
      source: ACP_JSON_RPC_SOURCE,
      elapsedMs: Date.now() - run.runStartedAt,
      suppressedChars: summary.suppressedChars,
      suppressedChunks: summary.suppressedChunks,
      openedBlocks: summary.openedBlocks,
      closedBlocks: summary.closedBlocks,
    },
    });
  }
  sendAgent(run, {
    payload: {
    type: 'diagnostic',
    name: 'acp_artifact_text_suppression_summary',
    source: ACP_JSON_RPC_SOURCE,
    elapsedMs: Date.now() - run.runStartedAt,
    ...summary,
  },
  });
}

function noteToolCallTextSuppression(run: AcpRun, { reason }: { reason: string }): void {
  const stats = run.toolCallTextSuppressor.stats();
  const suppressedDelta = stats.suppressedChars - run.toolCallTextSuppressorLastSuppressedChars;
  if (suppressedDelta <= 0) return;
  run.toolCallTextSuppressorLastSuppressedChars = stats.suppressedChars;
  applySuppressionStats({ summary: run.toolCallTextSuppressionSummary, stats, delta: suppressedDelta });
  sendSuppressionDiagnostic(run, {
    name: 'acp_tool_call_text_suppression', reason, summary: run.toolCallTextSuppressionSummary, stats,
  });
}

function emitToolCallTextSuppressionSummary(run: AcpRun): void {
  if (run.toolCallTextSuppressionSummary.suppressedChars <= 0) return;
  sendAgent(run, {
    payload: {
    type: 'diagnostic',
    name: 'acp_tool_call_text_suppression_summary',
    source: ACP_JSON_RPC_SOURCE,
    elapsedMs: Date.now() - run.runStartedAt,
    ...run.toolCallTextSuppressionSummary,
  },
  });
}

function sendPrompt(run: AcpRun): void {
  const { state } = run;
  state.promptRequestId = state.nextId;
  state.expectedId = state.promptRequestId;
  writeRpc(run, {
    id: state.promptRequestId,
    method: 'session/prompt',
    params: {
      sessionId: state.sessionId,
      prompt: buildPromptBlocks(run.options.prompt, run.resolved.imagePaths),
    },
    timeoutLabel: 'session/prompt',
  });
  sendAgent(run, {
    payload: {
    type: 'status',
    label: 'waiting_for_first_output',
    elapsedMs: Date.now() - run.runStartedAt,
  },
  });
  state.nextId += 1;
}

function flushPendingVisibleText(run: AcpRun): void {
  const flushedToolText = run.toolCallTextSuppressor.flush();
  noteToolCallTextSuppression(run, { reason: 'tool_call_xml_flush' });
  const flushedText = flushedToolText
    ? (run.state.dsmlArtifactSuppressor?.strip(flushedToolText) ?? flushedToolText)
    : '';
  if (flushedText) {
    emitVisibleTextDelta(run, { delta: flushedText });
  }
  noteArtifactTextSuppression(run, { reason: 'artifact_flush' });
  emitToolCallTextSuppressionSummary(run);
  emitArtifactTextSuppressionSummary(run);
}

// `finishCleanPrompt` has exactly one call site (`handlePromptResult`,
// called only from `routeResultById`'s promptRequestId-match branch),
// which is itself only ever reached from the parser callback's own `if
// (aborted || finished) return;` guard at entry — so this function can
// never actually be invoked once `finished` is true. The origin file
// carried its own re-entry guard here anyway; removed per this package's
// coverage-driven dead-branch discipline. See archived provenance ledger.
function finishCleanPrompt(run: AcpRun, { usageSource }: { usageSource?: unknown } = {}): void {
  flushPendingVisibleText(run);
  const usage = formatUsage(usageSource);
  if (usage) {
    sendAgent(run, {
      payload: {
      type: 'usage',
      usage,
      durationMs: Date.now() - run.runStartedAt,
    },
    });
  }
  run.finished = true;
  clearStageTimer(run);
  run.stdin.end();
  // Some ACP agents keep the child process alive after stdin closes,
  // waiting for another prompt. Each run owns one process per turn, so
  // close it once this prompt is cleanly complete.
  const { child } = run;
  const cleanExitTimer = setTimeout(() => {
    if (!child.killed) child.kill('SIGTERM');
  }, 500);
  child.once('close', () => clearTimeout(cleanExitTimer));
}

function recoverFromModelSelectionError(run: AcpRun): void {
  const { state } = run;
  state.setModelRequestId = null;
  state.activeModel = state.activeModel || 'default';
  sendAgent(run, { payload: { type: 'status', label: 'model', model: state.activeModel } });
  sendPrompt(run);
}

/** Binds the run to the side-effect bundle the exported ACP handlers consume. */
export function buildAcpEffects(run: AcpRun): AcpSessionEffects {
  const { options, resolved } = run;
  return {
    send: options.send,
    fail: (message, failOptions) => failRun(run, { message }, failOptions),
    failWithPayload: (payload) => failWithPayload(run, payload),
    writeRpc: (id, method, params, timeoutLabel) => writeRpc(run, { id, method, params, timeoutLabel }),
    sendPrompt: () => sendPrompt(run),
    recoverFromModelSelectionError: () => recoverFromModelSelectionError(run),
    finishCleanPrompt: (usageSource) => finishCleanPrompt(run, { usageSource }),
    emitVisibleTextDelta: (delta) => emitVisibleTextDelta(run, { delta }),
    noteArtifactTextSuppression: (reason) => noteArtifactTextSuppression(run, { reason }),
    noteToolCallTextSuppression: (reason) => noteToolCallTextSuppression(run, { reason }),
    emitAcpRawShapeDiagnostic: (update) => emitAcpRawShapeDiagnostic(run, update),
    toolCallTextSuppressor: run.toolCallTextSuppressor,
    runStartedAt: run.runStartedAt,
    modelUnavailableErrorCode: options.modelUnavailableErrorCode,
    accountFailureClassifier: resolved.accountFailureClassifier,
    model: options.model,
    onSessionInit: options.onSessionInit,
    resumeSessionId: options.resumeSessionId,
    effectiveCwd: run.effectiveCwd,
    mcpServers: options.mcpServers,
    envFormat: resolved.envFormat,
  };
}

type JsonLineParser = ReturnType<typeof createJsonLineStream>;

function handleStderrChunk(run: AcpRun, { chunk }: { chunk: string }): void {
  if (!run.options.modelUnavailableErrorCode || run.finished) return;
  run.amrStderrRetryTail = `${run.amrStderrRetryTail}${String(chunk)}`.slice(
    -AMR_STDERR_RETRY_TAIL_LIMIT,
  );
  const promotedPayload = promotedAmrStderrPayload(run.amrStderrRetryTail, run.resolved.accountFailureClassifier);
  if (promotedPayload) failWithPayload(run, promotedPayload);
}

function handleChildClose(run: AcpRun, { parser, exit }: {
  parser: JsonLineParser;
  exit: { code: number | null; signal: NodeJS.Signals | null };
}): void {
  clearStageTimer(run);
  parser.flush();
  if (!run.finished && !run.aborted && !run.fatal) {
    failRun(run, {
      message: `ACP session exited before completion (code=${exit.code ?? 'null'}, signal=${exit.signal ?? 'none'})`,
    });
  }
}

/** Connects the child's streams and lifecycle events to the parser and failure paths. */
export function wireAcpProcessListeners({ run, parser }: { run: AcpRun; parser: JsonLineParser }): void {
  const { child, stdin } = run;
  child.stdout?.on('data', (chunk: string) => parser.feed({ chunk: chunk }));
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => handleStderrChunk(run, { chunk }));
  child.on('close', (code, signal) => handleChildClose(run, { parser, exit: { code, signal } }));
  child.on('error', (err: Error) => failRun(run, { message: err.message }));
  stdin.on('error', (err: Error) => failRun(run, { message: `stdin error: ${err.message}` }));
}

/** Sends the `initialize` request that opens the ACP handshake. */
export function sendInitialize(run: AcpRun): void {
  writeRpc(run, {
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { terminal: false },
      clientInfo: { name: run.resolved.clientName, version: run.resolved.clientVersion },
    },
    timeoutLabel: 'initialize',
  });
}

// ACP requires pending permission requests to receive a terminal
// `cancelled` response when the prompt turn is cancelled. Called before
// closing stdin, which may otherwise make the response impossible to
// deliver.
function cancelPendingPermissionRequests(run: AcpRun): void {
  for (const [requestId, logCancellation] of run.pendingPermissionRequests) {
    try {
      sendRpcResult(run.stdin, requestId, { outcome: { outcome: 'cancelled' } });
    } catch {
      // Closing stdin/process signalling below remains the fallback.
    }
    logCancellation();
  }
  run.pendingPermissionRequests.clear();
}

// Only cancel an established session; before session/new resolves there is
// no sessionId to cancel, but the caller still closes stdin below.
function sendSessionCancelIfEstablished(run: AcpRun, activeStdin: NonNullable<AcpChildProcess['stdin']>): void {
  const { state } = run;
  if (!state.sessionId) return;
  try {
    sendRpc(activeStdin, state.nextId, 'session/cancel', { sessionId: state.sessionId });
    state.nextId += 1;
  } catch {
    // The caller owns process-signal fallback if the ACP transport is gone.
  }
}

function abortRun(run: AcpRun): void {
  if (run.aborted || run.finished) return;
  run.aborted = true;
  run.finished = true;
  clearStageTimer(run);
  cancelPendingPermissionRequests(run);
  const { stdin } = run.child;
  if (!stdin || stdin.destroyed || stdin.writableEnded)
    return;
  sendSessionCancelIfEstablished(run, stdin);
  // Always close stdin so the agent receives EOF and shuts down its own
  // runtime — some ACP bridges tear down a private backing server on EOF —
  // instead of lingering (and leaking that server) until the caller's
  // SIGTERM fallback fires. This also covers aborts during ACP startup,
  // before session/new returns. Mirrors the clean-completion path above.
  try {
    stdin.end();
  } catch {
    // Best effort; the caller still owns the SIGTERM/SIGKILL fallback.
  }
}

/** The public handle `attachAcpSession` returns for one run. */
export function buildAcpController(run: AcpRun): AcpSessionController {
  return {
    /** Returns `true` when the session ended with a fatal protocol or transport error, allowing the caller to surface the failure. */
    hasFatalError() {
      return run.fatal;
    },
    // The durable upstream session handle to persist for resume, or null when
    // none was reported (older agents, or a handshake that never established a
    // session). Mirrors pi-rpc's getLastSessionPath().
    /** Returns the durable upstream session id (e.g. a vendor bridge's own session id) to persist for next-turn resume, or `null` when the agent did not report one. */
    getDurableSessionId() {
      return run.state.durableSessionId;
    },
    /** Returns `true` when the prompt request resolved cleanly without a fatal error and without an abort, even if the child process later exited via SIGTERM. */
    completedSuccessfully() {
      // Returns true when the prompt request resolved without a fatal error
      // and was not aborted. The chat consumer treats this as a successful
      // run even if the child process subsequently exited via SIGTERM
      // (which is expected for agents that don't shut down on stdin.end()).
      return run.finished && !run.fatal && !run.aborted;
    },
    /**
     * Aborts an in-progress ACP session. Sends `session/cancel` when a session
     * id has already been established, then always closes stdin so the agent
     * receives EOF and can tear down its own runtime (e.g. a vendor bridge's
     * private backing server). Idempotent — subsequent calls are no-ops.
     */
    abort() {
      abortRun(run);
    },
  };
}
