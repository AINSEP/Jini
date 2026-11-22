import { asObject } from './json.js';
import { ACP_AUTH_REQUIRED_ERROR_CODE, unsupportedAcpProtocolVersionMessage } from './constants.js';
import { accountFailureDetails } from './account-failure.js';
import type { UnknownRecord } from './types.js';
import { rpcErrorData, rpcErrorRetryable, promotedOpenCodeSessionErrorPayload, formatUsage } from './rpc.js';
import { findEffortConfigOption, findModelConfigOption, currentModelFromSessionResult, modelSelectionErrorIsRecoverable } from './models.js';
import { buildAcpSessionNewParams } from './session-params.js';
import { type AcpSessionState, type AcpSessionEffects } from './session-types.js';
/** `typeof value === 'string' ? value : null` as a named predicate — too trivial to export on its own. */
function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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
  obj: UnknownRecord;
  error: UnknownRecord | null;
  rpcErr: string;
}, _optional: Record<string, never> = {}): void {
  if (isRecoverableModelSelectionError({ state, effects, obj, error })) {
    effects.recoverFromModelSelectionError();
    return;
  }
  if (error?.code === -32603 && obj.id !== state.expectedId) {
    return;
  }
  if (error?.code === ACP_AUTH_REQUIRED_ERROR_CODE && /auth/i.test(rpcErr)) { failAuthRequired({ effects, rpcErr }); return; }
  if (awaitingModelSelectionReply({ state, obj }) && effects.model && effects.model !== 'default') {
    effects.fail(`This agent did not accept the model "${effects.model}". Pick a model from its list and retry. (${rpcErr})`, {
      details: { kind: 'model_unsupported', model: effects.model }, retryable: false,
    });
    return;
  }
  failWithRpcError({ effects, obj, rpcErr });
}

function failAuthRequired({ effects, rpcErr }: { effects: AcpSessionEffects; rpcErr: string }): void {
  const message = `This agent is not signed in. Sign in to its command-line tool on this computer, then retry. (${rpcErr})`;
  effects.failWithPayload({ message, error: { code: 'AUTH_REQUIRED', message, retryable: false,
    details: accountFailureDetails({ failure: { code: 'AUTH_REQUIRED', message, action: 'sign_in' } }) } });
}

function awaitingModelSelectionReply({ state, obj }: { state: AcpSessionState; obj: UnknownRecord }): boolean {
  return state.setModelRequestId !== null && obj.id === state.setModelRequestId && state.promptRequestId === null;
}

/** True when `obj` is a recoverable error answering our own `session/set_model`
 * request, sent before any prompt, for a run that asked for no specific model. */
function isRecoverableModelSelectionError({
  state,
  effects,
  obj,
  error,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  obj: UnknownRecord;
  error: UnknownRecord | null;
}): boolean {
  return awaitingModelSelectionReply({ state, obj }) && modelSelectionErrorIsRecoverable({ code: error?.code }) && (!effects.model || effects.model === 'default');
}

/** Fails the run for a real RPC error, promoting a known OpenCode session error
 * payload when present and carrying the RPC `data` details and retryability. */
function failWithRpcError({
  effects,
  obj,
  rpcErr,
}: {
  effects: AcpSessionEffects;
  obj: UnknownRecord;
  rpcErr: string;
}): void {
  const details = rpcErrorData({ raw: obj });
  const promotedPayload = promotedOpenCodeSessionErrorPayload({ data: details, fallbackMessage: rpcErr });
  if (promotedPayload) {
    effects.failWithPayload(promotedPayload);
    return;
  }
  const retryable = rpcErrorRetryable({ data: details });
  effects.fail(rpcErr, {
    details,
    ...(retryable === undefined ? {} : { retryable }),
  });
}

/** Handles the `initialize` ack: sends `session/load` (resume) or `session/new` (fresh). */
export function handleInitializeAck({ state, effects, result }: { state: AcpSessionState; effects: AcpSessionEffects; result: UnknownRecord }, _optional: Record<string, never> = {}): void {
  const message = unsupportedAcpProtocolVersionMessage({ protocolVersion: result.protocolVersion });
  if (message) {
    effects.fail(message);
    return;
  }
  if (effects.resumeSessionId && asObject({ value: result.agentCapabilities })?.loadSession !== true) {
    effects.fail('This agent cannot reopen a saved conversation (it does not offer session/load); a new conversation is needed.', { details: { reason: 'load_session_unsupported' } });
    return;
  }
  state.expectedId = state.nextId;
  if (effects.resumeSessionId) {
    // Resume the prior upstream session instead of creating a fresh one.
    effects.writeRpc(
      state.nextId,
      'session/load',
      {
        ...buildAcpSessionNewParams({ cwd: effects.effectiveCwd }, effects.mcpServers
          ? { mcpServers: effects.mcpServers, envFormat: effects.envFormat }
          : { envFormat: effects.envFormat }),
        sessionId: effects.resumeSessionId,
      },
      'session/load',
    );
  } else {
    effects.writeRpc(
      state.nextId,
      'session/new',
      buildAcpSessionNewParams({ cwd: effects.effectiveCwd }, effects.mcpServers ? { mcpServers: effects.mcpServers, envFormat: effects.envFormat } : { envFormat: effects.envFormat }
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
}, _optional: Record<string, never> = {}): boolean {
  if (!state.sessionId || !effects.model || effects.model === 'default') return false;
  // Hosts now pin the concrete starting model on every run. When session/new already reports that
  // model, a set_model round-trip is redundant, and a CLI without set_model support would turn it
  // into a fatal explicit-model rejection.
  if (state.activeModel === effects.model) return false;
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

/** Records handshake identity, retaining the requested handle on an ID-free load ack.
 * Mutates only the two session handles; performs no I/O.
 * @complexity O(1) time and space.
 */
function recordSessionIdentity({ state, result }: {
  state: AcpSessionState;
  result: UnknownRecord;
}, { resumeSessionId = null }: { resumeSessionId?: string | null | undefined } = {}): void {
  // ACP load responses need not repeat the handle supplied in the request.
  state.sessionId = asOptionalString(result.sessionId) ?? resumeSessionId;
  // The durable handle for resuming this session on the next turn.
  state.durableSessionId = asOptionalString(result.openCodeSessionId) ?? state.sessionId;
}

function sendEffortOrPrompt({ state, effects }: { state: AcpSessionState; effects: AcpSessionEffects }): void {
  const effort = effects.effort;
  if (!effort) { effects.sendPrompt(); return; }
  const option = findEffortConfigOption({ configOptions: state.configOptions });
  const offered = option?.values ?? [];
  if (!option || !offered.includes(effort)) {
    effects.fail(`This agent does not offer the reasoning effort "${effort}". It offers: ${offered.join(', ') || 'none'}. Pick one of those and retry.`, {
      details: { kind: 'effort_unsupported', effort, offered }, retryable: false,
    });
    return;
  }
  state.effortRequestId = state.nextId;
  state.expectedId = state.nextId;
  effects.writeRpc(state.nextId, 'session/set_config_option', {
    sessionId: state.sessionId, configId: option.configId, value: effort,
  }, 'session/set_config_option');
  state.nextId += 1;
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
  result: UnknownRecord;
  rawLine: string;
}, _optional: Record<string, never> = {}): void {
  recordSessionIdentity({ state, result }, { resumeSessionId: effects.resumeSessionId });
  // session/new acknowledged with a session id = handshake done.
  // Invoke the optional callback here instead of relocating its complexity score to a one-line wrapper.
  if (state.sessionId) effects.onSessionInit?.();
  // findModelConfigOption returns null or a parsed config with a required string id.
  const modelConfig = findModelConfigOption({ configOptions: result.configOptions });
  state.modelConfigId = modelConfigIdOrNull({ modelConfig });
  state.activeModel = currentModelFromSessionResult({ result });
  state.configOptions = result.configOptions;
  if (state.sessionId && state.activeModel && (!effects.model || effects.model === state.activeModel)) {
    effects.send({ event: 'agent', payload: { type: 'status', label: 'model', model: state.activeModel } });
  }
  if (triggerSetModelIfNeeded({ state, effects })) return;
  if (!state.sessionId) {
    effects.fail(`invalid session/new response: ${rawLine}`);
    return;
  }
  sendEffortOrPrompt({ state, effects });
}

function modelConfigIdOrNull({ modelConfig }: { modelConfig: ReturnType<typeof findModelConfigOption> }, _optional: Record<string, never> = {}): string | null { return modelConfig ? modelConfig.configId : null; }

/** Handles the `session/prompt` ack: fails a turn that reported model activity but produced no visible output, otherwise flushes and finishes cleanly. */
export function handlePromptResult({
  state,
  effects,
  result,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  result: UnknownRecord;
}, _optional: Record<string, never> = {}): void {
  const usage = formatUsage({ usage: result.usage });
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
  obj: UnknownRecord;
}, _optional: Record<string, never> = {}): boolean {
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
  result: UnknownRecord;
}, _optional: Record<string, never> = {}): void {
  // `isModelSetAckExpected` already confirmed `effects.model` is a truthy
  // string before this runs; the assertion is only to carry that narrowing
  // across the function boundary for the type checker (it doesn't survive
  // the call), not a behavior change.
  state.activeModel = currentModelFromSessionResult({ result }) ?? (effects.model as string);
  effects.send({ event: 'agent', payload: { type: 'status', label: 'model', model: state.activeModel } });
  if (result.configOptions !== undefined) state.configOptions = result.configOptions;
  sendEffortOrPrompt({ state, effects });
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
  obj: UnknownRecord;
  result: UnknownRecord | null;
  rawLine: string;
}, _optional: Record<string, never> = {}): void {
  if (obj.id !== state.expectedId || !result) return;
  if (state.expectedId === 1) {
    handleInitializeAck({ state, effects, result });
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
  if (obj.id === state.effortRequestId) { effects.sendPrompt(); return; }
  if (isModelSetAckExpected({ state, effects, obj })) {
    handleModelSetAck({ state, effects, result });
  }
}
