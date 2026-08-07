/** @module agent-protocol/acp/session
 * ACP session orchestrator: performs the full initialize → session/new (or
 * session/load) → session/prompt handshake with an already-spawned ACP
 * subprocess, streams updates to the daemon event bus, handles permission
 * replies, artifact-write mirroring, DSML text suppression, and clean abort.
 * Depends on every other acp/ file and the core JSON-line stream. Consumed by
 * connection-test and server entry points (via the acp/ barrel).
 *
 * The `session/update` and result-routing message-kind handlers below
 * (`handleSessionUpdate`, `routeResultById`, and everything they call) are
 * exported as free functions over an explicit `AcpSessionState` +
 * `AcpSessionEffects` pair rather than closures, specifically so they are
 * directly unit-testable without spinning up a whole session. They are not
 * re-exported from the package barrel — only `attachAcpSession` and the
 * public types are part of this package's supported surface.
 */
import path from 'node:path';
import type { ExecutionProfile } from './types.js';
import {
  createDsmlArtifactTextSuppressor,
  createToolCallTextSuppressor,
  type ArtifactTextSuppressor,
} from './text-suppression.js';
import { createJsonLineStream } from '../core/index.js';
import type { JsonRpcId, JsonObject, TimerHandle, AcpChildProcess } from './types.js';
import {
  ACP_PROTOCOL_VERSION,
  DEFAULT_STAGE_TIMEOUT_MS,
  ACP_ARTIFACT_ECHO_START_RE,
  ACP_RAW_EVENT_SHAPE_DIAGNOSTIC_LIMIT,
  AMR_STDERR_RETRY_TAIL_LIMIT,
} from './constants.js';
import { errorMessage, asObject, extractAcpUpdateText } from './json.js';
import {
  sendRpc,
  sendRpcResult,
  isJsonRpcId,
  rpcErrorMessage,
  rpcErrorData,
  rpcErrorRetryable,
  promotedOpenCodeSessionErrorPayload,
  formatUsage,
} from './rpc.js';
import {
  acpRawEventShape,
  isAcpCompletedStatus,
  isAcpTerminalFailureStatus,
  acpToolCallId,
  isAcpArtifactWriteLabel,
  isAcpArtifactWriteUpdate,
  acpArtifactWritePath,
  promotedAmrRetryStatusPayload,
  promotedAmrStderrPayload,
} from './updates.js';
import {
  findModelConfigOption,
  currentModelFromSessionResult,
  modelSelectionErrorIsRecoverable,
} from './models.js';
import { buildAcpSessionNewParams, buildPromptBlocks, type AcpMcpServerInput } from './session-params.js';
import { noopAccountFailureClassifier, type AccountFailureClassifier } from './account-failure.js';

/** One option offered by an ACP agent for a pending tool permission request. */
export interface AcpPermissionOption {
  readonly optionId: string;
  readonly kind?: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}

/**
 * The complete, host-auditable context for an ACP agent's request to perform
 * one of *its own* tool calls. Selecting an option authorizes or rejects the
 * agent's native tool execution; it is intentionally distinct from Jini's
 * `ToolExecutor`, which only executes Jini-registered delegated tools.
 */
export interface AcpPermissionRequest {
  readonly requestId: JsonRpcId;
  readonly sessionId: string | null;
  readonly toolCall: JsonObject | null;
  readonly options: readonly AcpPermissionOption[];
  /** Original ACP request parameters for forward-compatible audit storage. */
  readonly rawParams: JsonObject;
}

/** A host's response to an {@link AcpPermissionRequest}. */
export type AcpPermissionDecision =
  | { readonly outcome: 'selected'; readonly optionId: string }
  | { readonly outcome: 'cancelled' };

/**
 * Injected ACP authorization seam. It may be async so a host can persist an
 * audit record or await an interactive policy decision before replying.
 */
export type AcpPermissionHandler = (
  request: AcpPermissionRequest,
) => AcpPermissionDecision | Promise<AcpPermissionDecision>;

/** Public state/abort handle returned by {@link attachAcpSession}. */
export interface AcpSessionController {
  hasFatalError(): boolean;
  getDurableSessionId(): string | null;
  completedSuccessfully(): boolean;
  abort(): void;
}

/**
 * Options for `attachAcpSession`. All fields except `child`, `prompt`, and
 * `send` are optional and carry sensible defaults.
 */
export interface AttachAcpSessionOptions {
  child: AcpChildProcess;
  prompt: string;
  cwd?: string;
  model?: string | null;
  imagePaths?: string[];
  mcpServers?: AcpMcpServerInput[];
  // Passed through to buildAcpSessionNewParams — see AcpSessionOptions.
  envFormat?: 'array' | 'map';
  send: (event: string, payload: unknown) => void;
  /**
   * Receives every native ACP tool-permission request before the agent can
   * execute it. Omit it only when the host intends the session to fail closed
   * on its first permission request; a runnable ACP host injects a policy
   * that records and selects an offered option.
   */
  onPermissionRequest?: AcpPermissionHandler;
  clientName?: string;
  clientVersion?: string;
  stageTimeoutMs?: number;
  executionProfile?: ExecutionProfile;
  modelUnavailableErrorCode?: 'AMR_MODEL_UNAVAILABLE';
  // Classifies AMR retry-status updates and stderr tails into a structured
  // account-failure error (auth required, insufficient balance, etc.). A host
  // application injects its own provider-specific classifier here; the
  // default `noopAccountFailureClassifier` never matches, which reproduces
  // not having this feature at all. See acp/account-failure.ts.
  accountFailureClassifier?: AccountFailureClassifier;
  // When set, resume an existing upstream session instead of creating a new
  // one: the handshake sends `session/load { sessionId }` (the durable handle
  // captured from a prior run via `getDurableSessionId()`) rather than
  // `session/new`. The agent verifies the session and, if it is gone, returns a
  // structured `resume_failed` error the caller maps to its reseed path.
  resumeSessionId?: string | null;
  // Subsegment timing markers for spawn->first-token attribution.
  // `onCliReady` fires once on the first well-formed ACP JSON-RPC message
  // (the CLI is up and speaking the protocol); `onSessionInit` fires once when
  // the `session/new` handshake is acknowledged (a session id is established).
  // Both are best-effort and the caller dedupes, so extra calls are harmless.
  onCliReady?: () => void;
  onSessionInit?: () => void;
}

// ---------------------------------------------------------------------------
// Exported session-update / result-routing state machine.
//
// `attachAcpSession` owns exactly one `AcpSessionState` + `AcpSessionEffects`
// pair per session and threads them through every handler call below. This
// is what lets the per-message-kind handlers be free, exported, and
// independently unit-testable (construct a state, a fake effects bundle with
// `vi.fn()` stubs, and call the handler directly) instead of closures baked
// into one giant function.
// ---------------------------------------------------------------------------

/**
 * Mutable per-session state shared by the exported ACP handlers below.
 * `attachAcpSession` creates one instance per session via
 * {@link createAcpSessionState} and mutates it in place as messages arrive.
 */
export interface AcpSessionState {
  // Handshake / JSON-RPC id routing.
  expectedId: JsonRpcId;
  nextId: number;
  promptRequestId: JsonRpcId | null;
  setModelRequestId: JsonRpcId | null;
  sessionId: string | null;
  // The durable upstream session handle reported by the agent on session/new
  // or session/load (e.g. a vendor bridge's own session id). Distinct from
  // `sessionId`, which is the ACP wrapper id.
  durableSessionId: string | null;
  activeModel: string | null;
  modelConfigId: string | null;
  // session/update: agent_thought_chunk / agent_message_chunk streaming.
  emittedThinkingStart: boolean;
  emittedTextChunk: boolean;
  emittedVisibleTextChunk: boolean;
  emittedTextBuffer: string;
  // session/update: tool_call / tool_call_update.
  emittedToolCall: boolean;
  emittedConcreteToolEvent: boolean;
  dsmlArtifactSuppressor: ArtifactTextSuppressor | null;
  dsmlArtifactSuppressorLastSuppressedChars: number;
  dsmlArtifactSuppressorToolCallId: string | null;
  dsmlArtifactSuppressorArmedAfterText: boolean;
  dsmlArtifactSuppressorSawIncrementalProse: boolean;
  acpArtifactWriteToolCallIds: Set<string>;
  // Per artifact-write tool call, accumulate the best concrete file path seen
  // across its frames and whether we have already mirrored it into canonical
  // tool_use/tool_result events. See `mirrorArtifactWriteToolEvent`.
  acpArtifactRunEventState: Map<string, { path: string | null; emitted: boolean }>;
}

/** Builds a fresh {@link AcpSessionState} with every field at its initial value. */
export function createAcpSessionState(): AcpSessionState {
  return {
    expectedId: 1,
    nextId: 2,
    promptRequestId: null,
    setModelRequestId: null,
    sessionId: null,
    durableSessionId: null,
    activeModel: null,
    modelConfigId: null,
    emittedThinkingStart: false,
    emittedTextChunk: false,
    emittedVisibleTextChunk: false,
    emittedTextBuffer: '',
    emittedToolCall: false,
    emittedConcreteToolEvent: false,
    dsmlArtifactSuppressor: null,
    dsmlArtifactSuppressorLastSuppressedChars: 0,
    dsmlArtifactSuppressorToolCallId: null,
    dsmlArtifactSuppressorArmedAfterText: false,
    dsmlArtifactSuppressorSawIncrementalProse: false,
    acpArtifactWriteToolCallIds: new Set<string>(),
    acpArtifactRunEventState: new Map(),
  };
}

/**
 * The narrow slice of `attachAcpSession`'s side-effect closures and
 * read-only session config that the exported handlers below need.
 * `attachAcpSession` builds exactly one of these per session; tests
 * construct a fake one with `vi.fn()` stubs for the callbacks.
 */
export interface AcpSessionEffects {
  send: (event: string, payload: unknown) => void;
  fail: (
    message: string,
    options?: { forceModelUnavailable?: boolean; details?: unknown; retryable?: boolean },
  ) => void;
  failWithPayload: (payload: unknown) => void;
  writeRpc: (id: JsonRpcId, method: string, params: unknown, timeoutLabel: string) => void;
  sendPrompt: () => void;
  recoverFromModelSelectionError: () => void;
  finishCleanPrompt: (usageSource?: unknown) => void;
  emitVisibleTextDelta: (delta: string) => void;
  noteArtifactTextSuppression: (reason: string) => void;
  noteToolCallTextSuppression: (reason: string) => void;
  emitAcpRawShapeDiagnostic: (update: JsonObject) => void;
  toolCallTextSuppressor: ArtifactTextSuppressor;
  runStartedAt: number;
  modelUnavailableErrorCode?: 'AMR_MODEL_UNAVAILABLE' | undefined;
  accountFailureClassifier: AccountFailureClassifier;
  model?: string | null | undefined;
  onSessionInit?: (() => void) | undefined;
  resumeSessionId?: string | null | undefined;
  effectiveCwd: string;
  mcpServers?: AcpMcpServerInput[] | undefined;
  envFormat: 'array' | 'map';
}

/** `typeof value === 'string' ? value : null` as a named predicate — too trivial to export on its own. */
function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Fires the optional `onSessionInit` callback; kept as a one-liner so the optional-chaining call is scored against this function, not its caller. */
function notifySessionInit(effects: AcpSessionEffects): void {
  effects.onSessionInit?.();
}

/** Resolves a `session/new` response's model config id, if any. */
function resolveModelConfigId(modelConfig: { configId?: string } | null | undefined): string | null {
  return modelConfig?.configId ?? null;
}

/**
 * Handles a JSON-RPC error frame from the agent.
 *
 * -32603 unexpected-id errors are cleanup noise. Expected-id model selection
 * failures are recoverable; all other RPC errors are real protocol failures
 * for initialize/session/new/session/prompt.
 */
export function handleRpcError({
  state,
  effects,
  obj,
  error,
  rpcErr,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  obj: JsonObject;
  error: JsonObject | null;
  rpcErr: string;
}): void {
  if (
    obj.id === state.setModelRequestId &&
    modelSelectionErrorIsRecoverable(error?.code) &&
    state.promptRequestId === null
  ) {
    effects.recoverFromModelSelectionError();
    return;
  }
  if (error?.code === -32603 && obj.id !== state.expectedId) {
    return;
  }
  const details = rpcErrorData(obj);
  const promotedPayload = promotedOpenCodeSessionErrorPayload(details, rpcErr);
  if (promotedPayload) {
    effects.failWithPayload(promotedPayload);
    return;
  }
  const retryable = rpcErrorRetryable(details);
  effects.fail(rpcErr, {
    details,
    ...(retryable === undefined ? {} : { retryable }),
  });
}

/** Promotes an AMR retry-status `session/update` into a structured account-failure error, if the classifier matches. Returns `true` when it did (and thus failed the session). */
export function tryPromoteAmrRetryStatus({
  effects,
  update,
}: {
  effects: AcpSessionEffects;
  update: JsonObject;
}): boolean {
  const promotedPayload = promotedAmrRetryStatusPayload(update, effects.accountFailureClassifier);
  if (!promotedPayload) return false;
  effects.failWithPayload(promotedPayload);
  return true;
}

/** Translates an `agent_thought_chunk` update into `thinking_start` (once) / `thinking_delta` events. */
export function handleThoughtChunkUpdate({
  state,
  effects,
  update,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: JsonObject;
}): void {
  effects.emitAcpRawShapeDiagnostic(update);
  const text = extractAcpUpdateText(update);
  if (!text) return;
  if (!state.emittedThinkingStart) {
    state.emittedThinkingStart = true;
    effects.send('agent', { type: 'thinking_start' });
  }
  effects.send('agent', { type: 'thinking_delta', delta: text });
}

/** Strips tool-call XML from a raw message delta via the session's tool-call text suppressor, noting the suppression reason. */
export function stripToolCallText({ effects, delta }: { effects: AcpSessionEffects; delta: string }): string {
  const wasSuppressingToolCall = effects.toolCallTextSuppressor.isSuppressing();
  const toolCallStrippedDelta = effects.toolCallTextSuppressor.strip(delta);
  effects.noteToolCallTextSuppression(
    wasSuppressingToolCall || toolCallStrippedDelta !== delta ? 'tool_call_xml' : 'tool_call_candidate',
  );
  return toolCallStrippedDelta;
}

/**
 * Whether a non-cumulative message delta should be emitted as-is (prose)
 * rather than the DSML artifact suppressor's stripped output. True when this
 * delta isn't itself part of an artifact echo/candidate, AND either nothing
 * was actually stripped, or the suppressor was armed mid-stream (after
 * visible text) and prior deltas already established this is ordinary prose
 * rather than the start of another artifact echo.
 */
export function shouldPreserveIncrementalProse(args: {
  isCumulativeSnapshot: boolean;
  wasSuppressingArtifact: boolean;
  hadPendingArtifactCandidate: boolean;
  hasOpenArtifactCandidate: boolean;
  strippedDelta: string;
  toolCallStrippedDelta: string;
  dsmlArtifactSuppressorArmedAfterText: boolean;
  dsmlArtifactSuppressorSawIncrementalProse: boolean;
}): boolean {
  const {
    isCumulativeSnapshot,
    wasSuppressingArtifact,
    hadPendingArtifactCandidate,
    hasOpenArtifactCandidate,
    strippedDelta,
    toolCallStrippedDelta,
    dsmlArtifactSuppressorArmedAfterText,
    dsmlArtifactSuppressorSawIncrementalProse,
  } = args;
  if (isCumulativeSnapshot || wasSuppressingArtifact || hadPendingArtifactCandidate || hasOpenArtifactCandidate) {
    return false;
  }
  if (strippedDelta === toolCallStrippedDelta) return true;
  return (
    !dsmlArtifactSuppressorArmedAfterText &&
    dsmlArtifactSuppressorSawIncrementalProse &&
    !ACP_ARTIFACT_ECHO_START_RE.test(toolCallStrippedDelta)
  );
}

/** Whether a delta passed through the DSML suppressor completely unchanged and there is no artifact suppression in progress. */
export function isPlainIncrementalDelta(args: {
  strippedDelta: string;
  toolCallStrippedDelta: string;
  wasSuppressingArtifact: boolean;
  hadPendingArtifactCandidate: boolean;
  hasOpenArtifactCandidate: boolean;
}): boolean {
  const {
    strippedDelta,
    toolCallStrippedDelta,
    wasSuppressingArtifact,
    hadPendingArtifactCandidate,
    hasOpenArtifactCandidate,
  } = args;
  return (
    strippedDelta === toolCallStrippedDelta &&
    !wasSuppressingArtifact &&
    !hadPendingArtifactCandidate &&
    !hasOpenArtifactCandidate
  );
}

/** Runs a tool-call-stripped delta through the DSML artifact suppressor, emits whatever should stay visible, and arms/disarms the "saw incremental prose" and suppressor-cleared state. */
export function applyDsmlArtifactSuppression({
  state,
  effects,
  suppressor,
  toolCallStrippedDelta,
  delta,
  isCumulativeSnapshot,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  suppressor: ArtifactTextSuppressor;
  toolCallStrippedDelta: string;
  delta: string;
  isCumulativeSnapshot: boolean;
}): void {
  const wasSuppressingArtifact = suppressor.isSuppressing();
  const hadPendingArtifactCandidate = suppressor.hasPendingCandidate();
  const strippedDelta = suppressor.strip(toolCallStrippedDelta);
  effects.noteArtifactTextSuppression(
    wasSuppressingArtifact || strippedDelta !== toolCallStrippedDelta ? 'artifact_echo' : 'artifact_candidate',
  );
  const hasOpenArtifactCandidate = suppressor.isSuppressing() || suppressor.hasPendingCandidate();
  const consumedArtifactText = wasSuppressingArtifact || strippedDelta !== delta;
  const preserveIncrementalProse = shouldPreserveIncrementalProse({
    isCumulativeSnapshot,
    wasSuppressingArtifact,
    hadPendingArtifactCandidate,
    hasOpenArtifactCandidate,
    strippedDelta,
    toolCallStrippedDelta,
    dsmlArtifactSuppressorArmedAfterText: state.dsmlArtifactSuppressorArmedAfterText,
    dsmlArtifactSuppressorSawIncrementalProse: state.dsmlArtifactSuppressorSawIncrementalProse,
  });
  const outputDelta = preserveIncrementalProse ? toolCallStrippedDelta : strippedDelta;
  if (outputDelta) {
    effects.emitVisibleTextDelta(outputDelta);
  }
  if (
    isPlainIncrementalDelta({
      strippedDelta,
      toolCallStrippedDelta,
      wasSuppressingArtifact,
      hadPendingArtifactCandidate,
      hasOpenArtifactCandidate,
    })
  ) {
    state.dsmlArtifactSuppressorSawIncrementalProse = true;
  }
  if (consumedArtifactText && !hasOpenArtifactCandidate) {
    state.dsmlArtifactSuppressor = null;
    state.dsmlArtifactSuppressorToolCallId = null;
    state.dsmlArtifactSuppressorArmedAfterText = false;
    state.dsmlArtifactSuppressorSawIncrementalProse = false;
  }
}

/** Translates an `agent_message_chunk` update into `text_delta` events, applying tool-call and DSML-artifact text suppression. */
export function handleMessageChunkUpdate({
  state,
  effects,
  update,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: JsonObject;
}): void {
  effects.emitAcpRawShapeDiagnostic(update);
  const text = extractAcpUpdateText(update);
  if (!text) return;
  const isCumulativeSnapshot = text.startsWith(state.emittedTextBuffer);
  const delta = isCumulativeSnapshot ? text.slice(state.emittedTextBuffer.length) : text;
  if (delta.length === 0) return;
  state.emittedTextChunk = true;
  state.emittedTextBuffer += delta;
  const toolCallStrippedDelta = stripToolCallText({ effects, delta });
  if (!toolCallStrippedDelta) return;
  if (state.dsmlArtifactSuppressor) {
    applyDsmlArtifactSuppression({
      state,
      effects,
      suppressor: state.dsmlArtifactSuppressor,
      toolCallStrippedDelta,
      delta,
      isCumulativeSnapshot,
    });
  } else {
    effects.emitVisibleTextDelta(toolCallStrippedDelta);
  }
}

// Mirror artifact-write tool calls into the daemon's canonical
// tool_use/tool_result event shape so a run-artifacts scanner can see
// ACP file writes. Without this, an ACP agent that emits only
// text/status/thinking events (never a tool_use/tool_result pair)
// would report zero artifacts even when the run wrote artifacts.
//
// This path only feeds the NO-PROJECT fallback (project runs use the
// filesystem snapshot). Two correctness rules, both learned the hard
// way in review:
//   1. Defer emission to the TERMINAL frame and accumulate the best
//      concrete path across frames — ACP often sends `locations` only
//      on the completing update, and emitting on the first frame would
//      lock in a wrong/empty guess that a later path can't correct.
//   2. Never fabricate an artifact extension. `isArtifactPath` is what
//      decides whether a write counts; feeding it a real path lets it
//      correctly EXCLUDE non-artifact edits (`config.json`, `README.md`)
//      and INCLUDE real artifacts. A write that never carries a concrete
//      path stays keyed on its (extension-less) toolCallId, so it is
//      simply not counted rather than inflating the metric with a
//      synthetic `.html` — under-counting a truly opaque write is
//      acceptable; a false-positive artifact is not.
export function mirrorArtifactWriteToolEvent({
  state,
  effects,
  update,
  toolCallId,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: JsonObject;
  toolCallId: string | null;
}): void {
  if (!toolCallId) return;
  const isWriteCall = isAcpArtifactWriteLabel(update) || state.acpArtifactWriteToolCallIds.has(toolCallId);
  if (!isWriteCall) return;
  let st = state.acpArtifactRunEventState.get(toolCallId);
  if (!st) {
    st = { path: null, emitted: false };
    state.acpArtifactRunEventState.set(toolCallId, st);
  }
  if (!st.path) st.path = acpArtifactWritePath(update);
  const failed = isAcpTerminalFailureStatus(update);
  const shouldEmit = !st.emitted && (failed || isAcpCompletedStatus(update));
  if (!shouldEmit) return;
  st.emitted = true;
  effects.send('agent', {
    type: 'tool_use',
    id: toolCallId,
    name: 'Write',
    input: { file_path: st.path ?? toolCallId },
  });
  effects.send('agent', { type: 'tool_result', toolUseId: toolCallId, isError: failed });
  state.emittedConcreteToolEvent = true;
}

/** Arms the DSML artifact suppressor when a tool_call/tool_call_update completes an artifact write, or disarms it once its owning write call terminally fails. */
export function updateDsmlSuppressorForToolCall({
  state,
  update,
  toolCallId,
}: {
  state: AcpSessionState;
  update: JsonObject;
  toolCallId: string | null;
}): void {
  if (isAcpArtifactWriteUpdate(update, state.acpArtifactWriteToolCallIds)) {
    state.dsmlArtifactSuppressor = createDsmlArtifactTextSuppressor();
    state.dsmlArtifactSuppressorLastSuppressedChars = 0;
    state.dsmlArtifactSuppressorToolCallId = toolCallId;
    state.dsmlArtifactSuppressorArmedAfterText = state.emittedTextBuffer.length > 0;
    state.dsmlArtifactSuppressorSawIncrementalProse = false;
    if (toolCallId) state.acpArtifactWriteToolCallIds.delete(toolCallId);
    return;
  }
  if (!toolCallId || !isAcpTerminalFailureStatus(update)) return;
  const ownsPendingWriteSuppression = toolCallId === state.dsmlArtifactSuppressorToolCallId;
  const ownsPendingWriteCall = state.acpArtifactWriteToolCallIds.has(toolCallId);
  state.acpArtifactWriteToolCallIds.delete(toolCallId);
  if (!ownsPendingWriteSuppression && !ownsPendingWriteCall) return;
  state.dsmlArtifactSuppressor = null;
  state.dsmlArtifactSuppressorToolCallId = null;
  state.dsmlArtifactSuppressorArmedAfterText = false;
  state.dsmlArtifactSuppressorSawIncrementalProse = false;
}

/** Translates a `tool_call` / `tool_call_update` update: tracks it as real turn output, mirrors artifact writes, and manages DSML suppressor arming. */
export function handleToolCallUpdate({
  state,
  effects,
  update,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: JsonObject;
}): void {
  // The turn did real work (a tool call / file edit), which is valid output even
  // when the model emits no closing assistant text. Track it so the prompt-complete
  // handler does not misreport such a turn as "no output / model unavailable".
  state.emittedToolCall = true;
  const toolCallId = acpToolCallId(update);
  if (toolCallId && isAcpArtifactWriteLabel(update)) {
    state.acpArtifactWriteToolCallIds.add(toolCallId);
  }
  mirrorArtifactWriteToolEvent({ state, effects, update, toolCallId });
  updateDsmlSuppressorForToolCall({ state, update, toolCallId });
}

/** Top-level `session/update` dispatcher: emits a generic status for non-streaming update kinds, then routes to the matching per-kind handler. */
export function handleSessionUpdate({
  state,
  effects,
  update,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: JsonObject;
}): void {
  if (effects.modelUnavailableErrorCode && tryPromoteAmrRetryStatus({ effects, update })) return;
  if (update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'agent_thought_chunk') {
    effects.send('agent', {
      type: 'status',
      label: String(update.sessionUpdate || 'session_update'),
      elapsedMs: Date.now() - effects.runStartedAt,
    });
    effects.emitAcpRawShapeDiagnostic(update);
  }
  if (update.sessionUpdate === 'agent_thought_chunk') {
    handleThoughtChunkUpdate({ state, effects, update });
    return;
  }
  if (update.sessionUpdate === 'agent_message_chunk') {
    handleMessageChunkUpdate({ state, effects, update });
    return;
  }
  if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
    handleToolCallUpdate({ state, effects, update });
  }
}

/** Handles the `initialize` ack: sends `session/load` (resume) or `session/new` (fresh). */
export function handleInitializeAck({ state, effects }: { state: AcpSessionState; effects: AcpSessionEffects }): void {
  state.expectedId = state.nextId;
  if (effects.resumeSessionId) {
    // Resume the prior upstream session instead of creating a fresh one.
    effects.writeRpc(
      state.nextId,
      'session/load',
      { sessionId: effects.resumeSessionId, cwd: effects.effectiveCwd },
      'session/load',
    );
  } else {
    effects.writeRpc(
      state.nextId,
      'session/new',
      buildAcpSessionNewParams(
        effects.effectiveCwd,
        effects.mcpServers ? { mcpServers: effects.mcpServers, envFormat: effects.envFormat } : { envFormat: effects.envFormat },
      ),
      'session/new',
    );
  }
  state.nextId += 1;
}

/** Sends `session/set_model` (or `session/set_config_option`) when a non-default model was requested. Returns `true` when it did (caller should not send the prompt yet). */
export function triggerSetModelIfNeeded({
  state,
  effects,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
}): boolean {
  if (!state.sessionId || !effects.model || effects.model === 'default') return false;
  state.setModelRequestId = state.nextId;
  state.expectedId = state.nextId;
  const setModelMethod = state.modelConfigId ? 'session/set_config_option' : 'session/set_model';
  const setModelParams = state.modelConfigId
    ? { sessionId: state.sessionId, configId: state.modelConfigId, value: effects.model }
    : { sessionId: state.sessionId, modelId: effects.model };
  effects.writeRpc(state.nextId, setModelMethod, setModelParams, setModelMethod);
  state.nextId += 1;
  return true;
}

/** Handles the `session/new` (or `session/load`) ack: records the session id, model config, and either triggers a model switch or sends the prompt. */
export function handleSessionNewAck({
  state,
  effects,
  result,
  rawLine,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  result: JsonObject;
  rawLine: string;
}): void {
  state.sessionId = asOptionalString(result.sessionId);
  // The durable handle for resuming this session on the next turn.
  state.durableSessionId = asOptionalString(result.openCodeSessionId);
  // session/new acknowledged with a session id = handshake done.
  if (state.sessionId) notifySessionInit(effects);
  state.modelConfigId = resolveModelConfigId(findModelConfigOption(result.configOptions));
  state.activeModel = currentModelFromSessionResult(result);
  if (state.sessionId && state.activeModel) {
    effects.send('agent', { type: 'status', label: 'model', model: state.activeModel });
  }
  if (triggerSetModelIfNeeded({ state, effects })) return;
  if (!state.sessionId) {
    effects.fail(`invalid session/new response: ${rawLine}`);
    return;
  }
  effects.sendPrompt();
}

/** Handles the `session/prompt` ack: fails a turn that reported model activity but produced no visible output, otherwise flushes and finishes cleanly. */
export function handlePromptResult({
  state,
  effects,
  result,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  result: JsonObject;
}): void {
  const usage = formatUsage(result.usage);
  if (!state.emittedVisibleTextChunk && !state.emittedConcreteToolEvent && effects.modelUnavailableErrorCode) {
    const outputTokens = usage?.output_tokens;
    const hadCompletionTokens = typeof outputTokens === 'number' && outputTokens > 0;
    if (hadCompletionTokens || state.emittedToolCall || state.emittedTextChunk) {
      effects.fail(
        'ACP session completed after reporting model activity, but did not produce visible assistant text, concrete tool results, or artifacts.',
        {
          retryable: true,
          details: {
            kind: 'acp_no_visible_output',
            output_tokens: outputTokens,
            raw_tool_update_seen: state.emittedToolCall,
            text_chunk_seen: state.emittedTextChunk,
          },
        },
      );
    } else {
      effects.fail(
        'ACP session completed without producing any assistant text. Refresh the AMR model list, choose a supported model, and retry this run.',
        { forceModelUnavailable: true },
      );
    }
    return;
  }
  effects.finishCleanPrompt(result.usage);
}

/** Whether an incoming result frame is the ack for an in-flight `session/set_model` (or `set_config_option`) request. */
export function isModelSetAckExpected({
  state,
  effects,
  obj,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  obj: JsonObject;
}): boolean {
  return Boolean(state.sessionId && effects.model && effects.model !== 'default' && obj.id === state.expectedId);
}

/** Handles the `session/set_model` (or `set_config_option`) ack: records the confirmed model and sends the prompt. */
export function handleModelSetAck({
  state,
  effects,
  result,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  result: JsonObject;
}): void {
  // `isModelSetAckExpected` already confirmed `effects.model` is a truthy
  // string before this runs; the assertion is only to carry that narrowing
  // across the function boundary for the type checker (it doesn't survive
  // the call), not a behavior change.
  state.activeModel = currentModelFromSessionResult(result) ?? (effects.model as string);
  effects.send('agent', { type: 'status', label: 'model', model: state.activeModel });
  effects.sendPrompt();
}

/** Top-level JSON-RPC result dispatcher, keyed by which request `expectedId`/`promptRequestId` is currently outstanding. */
export function routeResultById({
  state,
  effects,
  obj,
  result,
  rawLine,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  obj: JsonObject;
  result: JsonObject | null;
  rawLine: string;
}): void {
  if (obj.id !== state.expectedId || !result) return;
  if (state.expectedId === 1) {
    handleInitializeAck({ state, effects });
    return;
  }
  if (state.expectedId === 2) {
    handleSessionNewAck({ state, effects, result, rawLine });
    return;
  }
  if (state.promptRequestId !== null && obj.id === state.promptRequestId) {
    handlePromptResult({ state, effects, result });
    return;
  }
  if (isModelSetAckExpected({ state, effects, obj })) {
    handleModelSetAck({ state, effects, result });
  }
}

/** `AttachAcpSessionOptions` fields resolved to their defaults. Extracted so `attachAcpSession`'s own signature carries no default-value branches. */
interface ResolvedAcpSessionOptions {
  imagePaths: string[];
  envFormat: 'array' | 'map';
  clientName: string;
  clientVersion: string;
  stageTimeoutMs: number;
  executionProfile: ExecutionProfile;
  accountFailureClassifier: AccountFailureClassifier;
}

function resolveAcpSessionOptionDefaults(options: AttachAcpSessionOptions): ResolvedAcpSessionOptions {
  return {
    imagePaths: options.imagePaths ?? [],
    envFormat: options.envFormat ?? 'array',
    clientName: options.clientName ?? 'agent-runtime',
    clientVersion: options.clientVersion ?? 'runtime-adapter',
    stageTimeoutMs: options.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS,
    executionProfile: options.executionProfile ?? 'filesystem',
    accountFailureClassifier: options.accountFailureClassifier ?? noopAccountFailureClassifier,
  };
}

/**
 * Attaches an ACP protocol session to an already-spawned child process and
 * drives the full JSON-RPC conversation from handshake to prompt completion.
 *
 * Sequence:
 * 1. Sends `initialize` to confirm the protocol version.
 * 2. Sends `session/new` (or `session/load` when `resumeSessionId` is set).
 * 3. Optionally sends `session/set_model` when a non-default model is requested.
 * 4. Sends `session/prompt` with the user's prompt and any image attachments.
 * 5. Streams `session/update` events to the `send` callback, translating:
 *    - `agent_thought_chunk` → `thinking_start` / `thinking_delta`
 *    - `agent_message_chunk` → `text_delta` (with DSML and tool-call text suppression)
 *    - `tool_call` / `tool_call_update` → deferred `tool_use` / `tool_result` pairs
 *    - status updates → `agent.status` events
 * 6. Handles `session/request_permission` calls through an injected policy,
 *    failing closed when no policy is supplied.
 * 7. On prompt completion, flushes suppression buffers, emits usage, and closes stdin.
 *
 * Returns a controller object that the caller may use to query session state
 * and to abort the in-progress turn.
 *
 * @param options - See `AttachAcpSessionOptions` for all fields.
 * @returns A controller with `hasFatalError`, `getDurableSessionId`,
 *   `completedSuccessfully`, and `abort` methods.
 */
export function attachAcpSession(options: AttachAcpSessionOptions): AcpSessionController {
  const {
    child,
    prompt,
    cwd,
    model,
    mcpServers,
    send,
    modelUnavailableErrorCode,
    resumeSessionId,
    onPermissionRequest,
    onCliReady,
    onSessionInit,
  } = options;
  const {
    imagePaths,
    envFormat,
    clientName,
    clientVersion,
    stageTimeoutMs,
    executionProfile,
    accountFailureClassifier,
  } = resolveAcpSessionOptionDefaults(options);
  const runStartedAt = Date.now();
  const effectiveCwd = path.resolve(cwd || process.cwd());
  if (!child.stdin || !child.stdout) {
    throw new Error('ACP child process must expose stdin and stdout streams');
  }
  const stdin = child.stdin;
  const stdout = child.stdout;
  const state = createAcpSessionState();
  let emittedFirstTokenStatus = false;
  let rawAcpShapeDiagnosticCount = 0;
  let artifactSuppressionDiagnosticCount = 0;
  let amrStderrRetryTail = '';
  let finished = false;
  let fatal = false;
  let aborted = false;
  let stageTimer: TimerHandle | null = null;
  const pendingPermissionRequestIds = new Set<JsonRpcId>();
  const toolCallTextSuppressor = createToolCallTextSuppressor();
  let toolCallTextSuppressorLastSuppressedChars = 0;
  const artifactTextSuppressionSummary = {
    suppressedChars: 0,
    suppressedChunks: 0,
    openedBlocks: 0,
    closedBlocks: 0,
  };
  const toolCallTextSuppressionSummary = {
    suppressedChars: 0,
    suppressedChunks: 0,
    openedBlocks: 0,
    closedBlocks: 0,
  };

  const stageWatchdogDisabled = stageTimeoutMs <= 0;
  const resetStageTimer = (label: string) => {
    if (stageTimer) clearTimeout(stageTimer);
    // `stageTimeoutMs <= 0` disables the watchdog. Mirrors a typical outer
    // run-level inactivity watchdog's escape hatch. Without this, a caller
    // passing a zero stage timeout would schedule a 0ms timeout that fires on
    // the next tick and kills the session immediately.
    if (stageWatchdogDisabled) return;
    stageTimer = setTimeout(() => {
      fail(`ACP ${label} timed out after ${stageTimeoutMs}ms`);
    }, stageTimeoutMs);
  };

  const clearStageTimer = () => {
    if (stageTimer) clearTimeout(stageTimer);
    stageTimer = null;
  };

  const amrModelUnavailablePayload = (message: string) => ({
    message,
    error: {
      code: 'AMR_MODEL_UNAVAILABLE',
      message,
      retryable: false,
      details: { kind: 'amr_model', action: 'choose_model' },
    },
  });

  const isModelUnavailableError = (message: string) => {
    const value = message.toLowerCase();
    return (
      value.includes('model not found') ||
      value.includes('providermodelnotfounderror') ||
      value.includes('unknown model') ||
      value.includes('invalid model')
    );
  };

  // Both call sites below (the session/update retry-status promotion and the
  // stderr promotion) are already nested inside a scope gated by `finished`
  // at their own entry point (the parser callback's own `if (aborted ||
  // finished) return;`, and the stderr handler's `if (!modelUnavailableErrorCode
  // || finished) return;`), and neither is re-entrant within a single
  // synchronous call — so `failWithPayload` can never actually be invoked a
  // second time once `finished` is true. The origin file carried its own
  // `if (finished) return;` re-entry guard here anyway; removed per this
  // package's coverage-driven dead-branch discipline (verified unreachable
  // by tracing every call site — see source-map.md), not suppressed.
  const failWithPayload = (payload: unknown) => {
    finished = true;
    fatal = true;
    clearStageTimer();
    send('error', payload);
    if (!child.killed) child.kill('SIGTERM');
  };

  const fail = (
    message: string,
    options: { forceModelUnavailable?: boolean; details?: unknown; retryable?: boolean } = {},
  ) => {
    if (finished) return;
    finished = true;
    fatal = true;
    clearStageTimer();
    const useModelUnavailable =
      modelUnavailableErrorCode &&
      (options.forceModelUnavailable || isModelUnavailableError(message));
    send(
      'error',
      useModelUnavailable
        ? amrModelUnavailablePayload(message)
        : options.details === undefined && options.retryable === undefined
          ? { message }
          : {
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
                // dead-branch discipline. See source-map.md.
                details: options.details,
              },
            },
    );
    if (!child.killed) child.kill('SIGTERM');
  };

  const writeRpc = (id: JsonRpcId, method: string, params: unknown, timeoutLabel: string) => {
    resetStageTimer(timeoutLabel);
    try {
      sendRpc(stdin, id, method, params);
    } catch (err) {
      fail(`stdin write failed: ${errorMessage(err)}`);
    }
  };

  const emitAcpRawShapeDiagnostic = (update: JsonObject) => {
    if (!modelUnavailableErrorCode) return;
    if (rawAcpShapeDiagnosticCount >= ACP_RAW_EVENT_SHAPE_DIAGNOSTIC_LIMIT) return;
    rawAcpShapeDiagnosticCount += 1;
    send('agent', {
      type: 'diagnostic',
      name: 'acp_raw_event_shape',
      source: 'acp-json-rpc',
      elapsedMs: Date.now() - runStartedAt,
      shape: acpRawEventShape(update),
    });
  };

  // All three call sites guard against an empty `delta` before calling this
  // (the finishCleanPrompt flush, the `if (outputDelta)` branch, and the
  // plain-else branch which is only reached after an earlier `if
  // (!toolCallStrippedDelta) return;` already ruled out emptiness) — so the
  // origin file's own `if (!delta) return;` guard here can never actually
  // fire. Removed per this package's coverage-driven dead-branch
  // discipline (verified unreachable by tracing every call site — see
  // source-map.md), not suppressed.
  const emitVisibleTextDelta = (delta: string) => {
    state.emittedVisibleTextChunk = true;
    if (!emittedFirstTokenStatus) {
      emittedFirstTokenStatus = true;
      send('agent', {
        type: 'status',
        label: 'streaming',
        ttftMs: Date.now() - runStartedAt,
      });
    }
    send('agent', { type: 'text_delta', delta });
  };

  const noteArtifactTextSuppression = (reason: string) => {
    if (!state.dsmlArtifactSuppressor) return;
    const stats = state.dsmlArtifactSuppressor.stats();
    const suppressedDelta = stats.suppressedChars - state.dsmlArtifactSuppressorLastSuppressedChars;
    if (suppressedDelta <= 0) return;
    state.dsmlArtifactSuppressorLastSuppressedChars = stats.suppressedChars;
    artifactTextSuppressionSummary.suppressedChars += suppressedDelta;
    artifactTextSuppressionSummary.suppressedChunks = stats.suppressedChunks;
    artifactTextSuppressionSummary.openedBlocks = stats.openedBlocks;
    artifactTextSuppressionSummary.closedBlocks = stats.closedBlocks;
    if (artifactSuppressionDiagnosticCount >= ACP_RAW_EVENT_SHAPE_DIAGNOSTIC_LIMIT) return;
    artifactSuppressionDiagnosticCount += 1;
    send('agent', {
      type: 'diagnostic',
      name: 'acp_artifact_text_suppression',
      source: 'acp-json-rpc',
      elapsedMs: Date.now() - runStartedAt,
      reason,
      suppressedChars: artifactTextSuppressionSummary.suppressedChars,
      suppressedChunks: artifactTextSuppressionSummary.suppressedChunks,
      openedBlocks: artifactTextSuppressionSummary.openedBlocks,
      closedBlocks: artifactTextSuppressionSummary.closedBlocks,
      pendingCandidateChars: stats.pendingCandidateChars,
      suppressing: stats.suppressing,
    });
  };

  const emitArtifactTextSuppressionSummary = () => {
    if (artifactTextSuppressionSummary.suppressedChars <= 0) return;
    if (executionProfile === 'filesystem') {
      send('agent', {
        type: 'diagnostic',
        name: 'unexpected_text_artifact_in_filesystem_run',
        source: 'acp-json-rpc',
        elapsedMs: Date.now() - runStartedAt,
        suppressedChars: artifactTextSuppressionSummary.suppressedChars,
        suppressedChunks: artifactTextSuppressionSummary.suppressedChunks,
        openedBlocks: artifactTextSuppressionSummary.openedBlocks,
        closedBlocks: artifactTextSuppressionSummary.closedBlocks,
      });
    }
    send('agent', {
      type: 'diagnostic',
      name: 'acp_artifact_text_suppression_summary',
      source: 'acp-json-rpc',
      elapsedMs: Date.now() - runStartedAt,
      ...artifactTextSuppressionSummary,
    });
  };

  const noteToolCallTextSuppression = (reason: string) => {
    const stats = toolCallTextSuppressor.stats();
    const suppressedDelta = stats.suppressedChars - toolCallTextSuppressorLastSuppressedChars;
    if (suppressedDelta <= 0) return;
    toolCallTextSuppressorLastSuppressedChars = stats.suppressedChars;
    toolCallTextSuppressionSummary.suppressedChars += suppressedDelta;
    toolCallTextSuppressionSummary.suppressedChunks = stats.suppressedChunks;
    toolCallTextSuppressionSummary.openedBlocks = stats.openedBlocks;
    toolCallTextSuppressionSummary.closedBlocks = stats.closedBlocks;
    if (artifactSuppressionDiagnosticCount >= ACP_RAW_EVENT_SHAPE_DIAGNOSTIC_LIMIT) return;
    artifactSuppressionDiagnosticCount += 1;
    send('agent', {
      type: 'diagnostic',
      name: 'acp_tool_call_text_suppression',
      source: 'acp-json-rpc',
      elapsedMs: Date.now() - runStartedAt,
      reason,
      suppressedChars: toolCallTextSuppressionSummary.suppressedChars,
      suppressedChunks: toolCallTextSuppressionSummary.suppressedChunks,
      openedBlocks: toolCallTextSuppressionSummary.openedBlocks,
      closedBlocks: toolCallTextSuppressionSummary.closedBlocks,
      pendingCandidateChars: stats.pendingCandidateChars,
      suppressing: stats.suppressing,
    });
  };

  const emitToolCallTextSuppressionSummary = () => {
    if (toolCallTextSuppressionSummary.suppressedChars <= 0) return;
    send('agent', {
      type: 'diagnostic',
      name: 'acp_tool_call_text_suppression_summary',
      source: 'acp-json-rpc',
      elapsedMs: Date.now() - runStartedAt,
      ...toolCallTextSuppressionSummary,
    });
  };

  const sendPrompt = () => {
    state.promptRequestId = state.nextId;
    state.expectedId = state.promptRequestId;
    writeRpc(
      state.promptRequestId,
      'session/prompt',
      {
        sessionId: state.sessionId,
        prompt: buildPromptBlocks(prompt, imagePaths),
      },
      'session/prompt',
    );
    send('agent', {
      type: 'status',
      label: 'waiting_for_first_output',
      elapsedMs: Date.now() - runStartedAt,
    });
    state.nextId += 1;
  };

  // `finishCleanPrompt` has exactly one call site (`handlePromptResult`,
  // called only from `routeResultById`'s promptRequestId-match branch),
  // which is itself only ever reached from the parser callback's own `if
  // (aborted || finished) return;` guard at entry — so this function can
  // never actually be invoked once `finished` is true. The origin file
  // carried its own re-entry guard here anyway; removed per this package's
  // coverage-driven dead-branch discipline. See source-map.md.
  const finishCleanPrompt = (usageSource?: unknown) => {
    const flushedToolText = toolCallTextSuppressor.flush();
    noteToolCallTextSuppression('tool_call_xml_flush');
    const flushedText = flushedToolText
      ? (state.dsmlArtifactSuppressor?.strip(flushedToolText) ?? flushedToolText)
      : '';
    if (flushedText) {
      emitVisibleTextDelta(flushedText);
    }
    noteArtifactTextSuppression('artifact_flush');
    emitToolCallTextSuppressionSummary();
    emitArtifactTextSuppressionSummary();
    const usage = formatUsage(usageSource);
    if (usage) {
      send('agent', {
        type: 'usage',
        usage,
        durationMs: Date.now() - runStartedAt,
      });
    }
    finished = true;
    clearStageTimer();
    stdin.end();
    // Some ACP agents keep the child process alive after stdin closes,
    // waiting for another prompt. Each run owns one process per turn, so
    // close it once this prompt is cleanly complete.
    const cleanExitTimer = setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM');
    }, 500);
    child.once('close', () => clearTimeout(cleanExitTimer));
  };

  const replyPermission = (raw: JsonObject) => {
    const params = asObject(raw.params);
    if (!params || !isJsonRpcId(raw.id)) {
      fail(`unhandled ACP permission request: ${JSON.stringify(raw)}`);
      return;
    }
    const requestId = raw.id;

    const optionRecords = Array.isArray(params.options)
      ? params.options.filter(
          (option): option is AcpPermissionOption =>
            Boolean(asObject(option)) && typeof asObject(option)?.optionId === 'string',
        )
      : [];
    const request: AcpPermissionRequest = {
      requestId,
      sessionId: typeof params.sessionId === 'string' ? params.sessionId : null,
      toolCall: asObject(params.toolCall) ?? null,
      options: optionRecords,
      rawParams: params,
    };

    const respond = (decision: AcpPermissionDecision) => {
      pendingPermissionRequestIds.delete(requestId);
      if (aborted || finished) return;
      if (
        decision.outcome === 'selected' &&
        !optionRecords.some((option) => option.optionId === decision.optionId)
      ) {
        fail(`ACP permission handler selected an unavailable option: ${decision.optionId}`);
        return;
      }
      resetStageTimer('session/request_permission');
      try {
        sendRpcResult(stdin, requestId, {
          outcome:
            decision.outcome === 'selected'
              ? { outcome: 'selected', optionId: decision.optionId }
              : { outcome: 'cancelled' },
        });
      } catch (err) {
        fail(`stdin write failed: ${errorMessage(err)}`);
      }
    };

    const rejectHandlerFailure = (err: unknown) => {
      pendingPermissionRequestIds.delete(requestId);
      fail(`ACP permission handler failed: ${errorMessage(err)}`);
    };

    pendingPermissionRequestIds.add(requestId);
    if (!onPermissionRequest) {
      pendingPermissionRequestIds.delete(requestId);
      fail('ACP permission request received without an injected permission handler');
      return;
    }
    try {
      Promise.resolve(onPermissionRequest(request)).then(respond, rejectHandlerFailure);
    } catch (err) {
      rejectHandlerFailure(err);
    }
  };

  const recoverFromModelSelectionError = () => {
    state.setModelRequestId = null;
    state.activeModel = state.activeModel || 'default';
    send('agent', { type: 'status', label: 'model', model: state.activeModel });
    sendPrompt();
  };

  const effects: AcpSessionEffects = {
    send,
    fail,
    failWithPayload,
    writeRpc,
    sendPrompt,
    recoverFromModelSelectionError,
    finishCleanPrompt,
    emitVisibleTextDelta,
    noteArtifactTextSuppression,
    noteToolCallTextSuppression,
    emitAcpRawShapeDiagnostic,
    toolCallTextSuppressor,
    runStartedAt,
    modelUnavailableErrorCode,
    accountFailureClassifier,
    model,
    onSessionInit,
    resumeSessionId,
    effectiveCwd,
    mcpServers,
    envFormat,
  };

  const parser = createJsonLineStream((raw, rawLine) => {
    if (aborted || finished) return;
    resetStageTimer('response');
    const obj = asObject(raw);
    if (!obj) return;
    // First well-formed ACP JSON-RPC message = CLI ready. Caller dedupes, so
    // re-notifying on later messages is harmless.
    onCliReady?.();
    const error = asObject(obj.error);
    const params = asObject(obj.params);
    const result = asObject(obj.result);
    const rpcErr = rpcErrorMessage(obj);
    if (rpcErr) {
      handleRpcError({ state, effects, obj, error, rpcErr });
      return;
    }
    if (obj.method === 'session/request_permission') {
      replyPermission(obj);
      return;
    }
    const update = asObject(params?.update);
    if (obj.method === 'session/update' && update) {
      handleSessionUpdate({ state, effects, update });
      return;
    }
    routeResultById({ state, effects, obj, result, rawLine });
  });

  stdout.on('data', (chunk: string) => parser.feed(chunk));
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    if (!modelUnavailableErrorCode || finished) return;
    amrStderrRetryTail = `${amrStderrRetryTail}${String(chunk)}`.slice(
      -AMR_STDERR_RETRY_TAIL_LIMIT,
    );
    const promotedPayload = promotedAmrStderrPayload(amrStderrRetryTail, accountFailureClassifier);
    if (promotedPayload) failWithPayload(promotedPayload);
  });
  child.on('close', (code, signal) => {
    clearStageTimer();
    parser.flush();
    if (!finished && !aborted && !fatal) {
      fail(`ACP session exited before completion (code=${code ?? 'null'}, signal=${signal ?? 'none'})`);
    }
  });
  child.on('error', (err: Error) => fail(err.message));
  stdin.on('error', (err: Error) => fail(`stdin error: ${err.message}`));

  writeRpc(1, 'initialize', {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { terminal: false },
    clientInfo: { name: clientName, version: clientVersion },
  }, 'initialize');

  // ACP requires pending permission requests to receive a terminal
  // `cancelled` response when the prompt turn is cancelled. Called before
  // closing stdin, which may otherwise make the response impossible to
  // deliver.
  const cancelPendingPermissionRequests = (): void => {
    for (const requestId of pendingPermissionRequestIds) {
      try {
        sendRpcResult(stdin, requestId, { outcome: { outcome: 'cancelled' } });
      } catch {
        // Closing stdin/process signalling below remains the fallback.
      }
    }
    pendingPermissionRequestIds.clear();
  };

  // Only cancel an established session; before session/new resolves there is
  // no sessionId to cancel, but the caller still closes stdin below.
  const sendSessionCancelIfEstablished = (activeStdin: NonNullable<AcpChildProcess['stdin']>): void => {
    if (!state.sessionId) return;
    try {
      sendRpc(activeStdin, state.nextId, 'session/cancel', { sessionId: state.sessionId });
      state.nextId += 1;
    } catch {
      // The caller owns process-signal fallback if the ACP transport is gone.
    }
  };

  return {
    /** Returns `true` when the session ended with a fatal protocol or transport error, allowing the caller to surface the failure. */
    hasFatalError() {
      return fatal;
    },
    // The durable upstream session handle to persist for resume, or null when
    // none was reported (older agents, or a handshake that never established a
    // session). Mirrors pi-rpc's getLastSessionPath().
    /** Returns the durable upstream session id (e.g. a vendor bridge's own session id) to persist for next-turn resume, or `null` when the agent did not report one. */
    getDurableSessionId() {
      return state.durableSessionId;
    },
    /** Returns `true` when the prompt request resolved cleanly without a fatal error and without an abort, even if the child process later exited via SIGTERM. */
    completedSuccessfully() {
      // Returns true when the prompt request resolved without a fatal error
      // and was not aborted. The chat consumer treats this as a successful
      // run even if the child process subsequently exited via SIGTERM
      // (which is expected for agents that don't shut down on stdin.end()).
      return finished && !fatal && !aborted;
    },
    /**
     * Aborts an in-progress ACP session. Sends `session/cancel` when a session
     * id has already been established, then always closes stdin so the agent
     * receives EOF and can tear down its own runtime (e.g. a vendor bridge's
     * private backing server). Idempotent — subsequent calls are no-ops.
     */
    abort() {
      if (aborted || finished) return;
      aborted = true;
      finished = true;
      clearStageTimer();
      cancelPendingPermissionRequests();
      if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded)
        return;
      sendSessionCancelIfEstablished(child.stdin);
      // Always close stdin so the agent receives EOF and shuts down its own
      // runtime — some ACP bridges tear down a private backing server on EOF —
      // instead of lingering (and leaking that server) until the caller's
      // SIGTERM fallback fires. This also covers aborts during ACP startup,
      // before session/new returns. Mirrors the clean-completion path above.
      try {
        child.stdin.end();
      } catch {
        // Best effort; the caller still owns the SIGTERM/SIGKILL fallback.
      }
    },
  };
}
