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
import { createJsonLineStream } from '../core/index.js';
import type { UnknownRecord } from './types.js';
import { DEFAULT_STAGE_TIMEOUT_MS } from './constants.js';
import { asObject } from './json.js';
import { rpcErrorMessage, isJsonRpcId, sendRpcError } from './rpc.js';
import { promotedAmrRetryStatusPayload } from './updates.js';
import { currentModelFromSessionResult } from './models.js';
import { buildAcpEffects, buildAcpController, createAcpRun, failRun, resetStageTimer, sendInitialize, wireAcpProcessListeners, type AcpRun } from './session-run.js';
import { replyPermission } from './session-permission.js';
import { noopAccountFailureClassifier } from './account-failure.js';
import { type AcpSessionEffects, type AcpSessionState, type AttachAcpSessionOptions, type ResolvedAcpSessionOptions, type AcpSessionController } from './session-types.js';
import { handleThoughtChunkUpdate, handleMessageChunkUpdate } from './session-text-updates.js';
import { handleToolCallUpdate } from './session-tool-updates.js';
import { handleRpcError, routeResultById } from './session-results.js';
/** Promotes an AMR retry-status `session/update` into a structured account-failure error, if the classifier matches. Returns `true` when it did (and thus failed the session). */
export function tryPromoteAmrRetryStatus({
  effects,
  update,
}: {
  effects: AcpSessionEffects;
  update: UnknownRecord;
}, _optional: Record<string, never> = {}): boolean {
  const promotedPayload = promotedAmrRetryStatusPayload({ update }, { classifier: effects.accountFailureClassifier });
  if (!promotedPayload) return false;
  effects.failWithPayload(promotedPayload);
  return true;
}

/** Top-level `session/update` dispatcher: emits a generic status for non-streaming update kinds, then routes to the matching per-kind handler. */
export function handleSessionUpdate({
  state,
  effects,
  update,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: UnknownRecord;
}, _optional: Record<string, never> = {}): void {
  applyModelChangeUpdate({ state, effects, update });
  if (effects.modelUnavailableErrorCode && tryPromoteAmrRetryStatus({ effects, update })) return;
  if (update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'agent_thought_chunk') {
    effects.send({ event: 'agent', payload: {
      type: 'status',
      label: String(update.sessionUpdate || 'session_update'),
      elapsedMs: Date.now() - effects.runStartedAt,
    } });
    effects.emitAcpRawShapeDiagnostic(update);
  }
  routeSessionUpdateKind({ state, effects, update });
}

/** Tracks a model switch reported by a `session/update` and emits a `model` status when it changes. */
function applyModelChangeUpdate({
  state,
  effects,
  update,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: UnknownRecord;
}): void {
  // Model/config updates are authoritative protocol metadata, not assistant self-report.
  const changedModel = currentModelFromSessionResult({ result: update }) ?? currentModelUpdateId(update);
  if (changedModel && changedModel !== state.activeModel) {
    state.activeModel = changedModel;
    effects.send({ event: 'agent', payload: { type: 'status', label: 'model', model: changedModel } });
  }
}

/** The `currentModelId` of a `current_model_update` notification, else `null`. */
function currentModelUpdateId(update: UnknownRecord): string | null {
  return update.sessionUpdate === 'current_model_update' && typeof update.currentModelId === 'string'
    ? update.currentModelId
    : null;
}

/** Routes a `session/update` to its streaming-kind handler (thought, message, tool call). */
function routeSessionUpdateKind({
  state,
  effects,
  update,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: UnknownRecord;
}): void {
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

function resolveAcpSessionOptionDefaults(options: AttachAcpSessionOptions): ResolvedAcpSessionOptions {
  return {
    imagePaths: options.imagePaths ?? [],
    envFormat: options.envFormat ?? 'array',
    clientName: options.clientName ?? 'agent-runtime',
    clientVersion: options.clientVersion ?? 'runtime-adapter',
    stageTimeoutMs: options.cliParity && options.permissionMode === 'bypass' ? 0 : options.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS,
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
export function attachAcpSession(requiredArgs: Pick<AttachAcpSessionOptions, "child" | "prompt" | "send">, optionalArgs: Omit<AttachAcpSessionOptions, "child" | "prompt" | "send"> = {}): AcpSessionController {
  const options: AttachAcpSessionOptions = { ...optionalArgs, ...requiredArgs };
  const run = createAcpRun({ options, resolved: resolveAcpSessionOptionDefaults(options) });
  const effects = buildAcpEffects({ run });
  const parser = createJsonLineStream({
    onMessage: ({ message: raw, rawLine }) => handleAcpMessage({ run, effects, raw, rawLine }),
  }, { onError: error => failRun({ run, message: error.message }) });
  wireAcpProcessListeners({ run, parser });
  sendInitialize({ run });
  return buildAcpController({ run });
}

function handleAcpMessage({ run, effects, raw, rawLine }: {
  run: AcpRun;
  effects: AcpSessionEffects;
  raw: unknown;
  rawLine: string;
}): void {
  if (run.aborted || run.finished) return;
  resetStageTimer({ run, label: 'response' });
  const obj = asObject({ value: raw });
  if (!obj) return;
  // First well-formed ACP JSON-RPC message = CLI ready. Caller dedupes, so
  // re-notifying on later messages is harmless.
  run.options.onCliReady?.();
  routeAcpMessage({ run, effects, obj, rawLine });
}

function routeAcpMessage({ run, effects, obj, rawLine }: {
  run: AcpRun;
  effects: AcpSessionEffects;
  obj: UnknownRecord;
  rawLine: string;
}): void {
  const { state } = run;
  const params = asObject({ value: obj.params });
  const rpcErr = rpcErrorMessage({ raw: obj });
  if (rpcErr) {
    handleRpcError({ state, effects, obj, error: asObject({ value: obj.error }), rpcErr });
    return;
  }
  if (obj.method === 'session/request_permission') {
    replyPermission({ run, raw: obj });
    return;
  }
  const update = asObject({ value: params?.update });
  if (obj.method === 'session/update' && update) {
    handleSessionUpdate({ state, effects, update });
    return;
  }
  if (typeof obj.method === 'string') { replyMethodNotFound({ run, obj }); return; }
  routeResultById({ state, effects, obj, result: asObject({ value: obj.result }), rawLine });
}

function replyMethodNotFound({ run, obj }: { run: AcpRun; obj: UnknownRecord }): void {
  if (!isJsonRpcId(obj.id)) return;
  try {
    sendRpcError({ writable: run.stdin, id: obj.id, code: -32601, message: `Method not found: ${String(obj.method)}` });
  } catch { /* broken pipe: transport lifecycle owns process failure */ }
}
