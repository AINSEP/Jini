/**
 * Direct unit tests for the exported per-message-kind handlers in session.ts
 * (`handleSessionUpdate`, `routeResultById`, and everything they call). These
 * are pure/state-driven functions over `AcpSessionState` + `AcpSessionEffects`
 * — this file calls them directly, without spinning up a real `attachAcpSession`
 * session (which acp/__tests__/session.test.ts already covers end-to-end).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createAcpSessionState,
  handleRpcError,
  tryPromoteAmrRetryStatus,
  handleThoughtChunkUpdate,
  stripToolCallText,
  shouldPreserveIncrementalProse,
  isPlainIncrementalDelta,
  applyDsmlArtifactSuppression,
  handleMessageChunkUpdate,
  mirrorArtifactWriteToolEvent,
  updateDsmlSuppressorForToolCall,
  handleToolCallUpdate,
  handleSessionUpdate,
  handleInitializeAck,
  triggerSetModelIfNeeded,
  handleSessionNewAck,
  handlePromptResult,
  isModelSetAckExpected,
  handleModelSetAck,
  routeResultById,
  type AcpSessionState,
  type AcpSessionEffects,
} from '../session.js';
import { createDsmlArtifactTextSuppressor, createToolCallTextSuppressor } from '../text-suppression.js';
import { noopAccountFailureClassifier, type AccountFailureClassifier } from '../account-failure.js';
import type { JsonObject } from '../types.js';

function fakeEffects(overrides: Partial<AcpSessionEffects> = {}): AcpSessionEffects {
  return {
    send: vi.fn(),
    fail: vi.fn(),
    failWithPayload: vi.fn(),
    writeRpc: vi.fn(),
    sendPrompt: vi.fn(),
    recoverFromModelSelectionError: vi.fn(),
    finishCleanPrompt: vi.fn(),
    emitVisibleTextDelta: vi.fn(),
    noteArtifactTextSuppression: vi.fn(),
    noteToolCallTextSuppression: vi.fn(),
    emitAcpRawShapeDiagnostic: vi.fn(),
    toolCallTextSuppressor: createToolCallTextSuppressor(),
    runStartedAt: 1_000,
    modelUnavailableErrorCode: undefined,
    accountFailureClassifier: noopAccountFailureClassifier,
    model: undefined,
    onSessionInit: undefined,
    resumeSessionId: undefined,
    effectiveCwd: '/tmp/project',
    mcpServers: undefined,
    envFormat: 'array',
    ...overrides,
  };
}

const matchingClassifier: AccountFailureClassifier = {
  classify: () => ({ code: 'AUTH_REQUIRED', message: 'Please sign in again.', action: 'reauth' }),
};

describe('createAcpSessionState', () => {
  it('returns every field at its documented initial value', () => {
    const state = createAcpSessionState();
    expect(state.expectedId).toBe(1);
    expect(state.nextId).toBe(2);
    expect(state.promptRequestId).toBeNull();
    expect(state.setModelRequestId).toBeNull();
    expect(state.sessionId).toBeNull();
    expect(state.durableSessionId).toBeNull();
    expect(state.activeModel).toBeNull();
    expect(state.modelConfigId).toBeNull();
    expect(state.emittedThinkingStart).toBe(false);
    expect(state.emittedTextChunk).toBe(false);
    expect(state.emittedVisibleTextChunk).toBe(false);
    expect(state.emittedTextBuffer).toBe('');
    expect(state.emittedToolCall).toBe(false);
    expect(state.emittedConcreteToolEvent).toBe(false);
    expect(state.dsmlArtifactSuppressor).toBeNull();
    expect(state.acpArtifactWriteToolCallIds.size).toBe(0);
    expect(state.acpArtifactRunEventState.size).toBe(0);
  });
});

describe('handleRpcError', () => {
  it('recovers a model-selection error when the request id matches an in-flight set_model and no prompt has been sent yet', () => {
    const state = createAcpSessionState();
    state.setModelRequestId = 5;
    const effects = fakeEffects();
    handleRpcError({ state, effects, obj: { id: 5 }, error: { code: -32602 }, rpcErr: 'bad model' });
    expect(effects.recoverFromModelSelectionError).toHaveBeenCalledOnce();
    expect(effects.fail).not.toHaveBeenCalled();
  });

  it('does not treat a recoverable-coded error as a model-selection recovery once a prompt is already in flight', () => {
    const state = createAcpSessionState();
    state.setModelRequestId = 5;
    state.promptRequestId = 9;
    const effects = fakeEffects();
    handleRpcError({ state, effects, obj: { id: 5 }, error: { code: -32602 }, rpcErr: 'bad model' });
    expect(effects.recoverFromModelSelectionError).not.toHaveBeenCalled();
    expect(effects.fail).toHaveBeenCalled();
  });

  it('ignores an unexpected-id -32603 error as cleanup noise', () => {
    const state = createAcpSessionState();
    state.expectedId = 3;
    const effects = fakeEffects();
    handleRpcError({ state, effects, obj: { id: 99 }, error: { code: -32603 }, rpcErr: 'noise' });
    expect(effects.fail).not.toHaveBeenCalled();
    expect(effects.failWithPayload).not.toHaveBeenCalled();
    expect(effects.recoverFromModelSelectionError).not.toHaveBeenCalled();
  });

  it('promotes a matching opencode session error via failWithPayload', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    const obj: JsonObject = {
      id: 3,
      error: {
        code: -32000,
        data: { kind: 'opencode_session_error', source: 'opencode', code: 'ROLE_MARKER_HALLUCINATION' },
      },
    };
    handleRpcError({ state, effects, obj, error: obj.error as JsonObject, rpcErr: 'role marker' });
    expect(effects.failWithPayload).toHaveBeenCalledOnce();
    expect(effects.fail).not.toHaveBeenCalled();
  });

  it('fails with retryable omitted when error.data carries no retryable field', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleRpcError({ state, effects, obj: { id: 1, error: { code: -32001 } }, error: { code: -32001 }, rpcErr: 'protocol failure' });
    expect(effects.fail).toHaveBeenCalledWith('protocol failure', { details: undefined });
  });

  it('fails with retryable forwarded when error.data carries a retryable field', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    const obj: JsonObject = { id: 1, error: { code: -32001, data: { retryable: true } } };
    handleRpcError({ state, effects, obj, error: obj.error as JsonObject, rpcErr: 'protocol failure' });
    expect(effects.fail).toHaveBeenCalledWith('protocol failure', { details: { retryable: true }, retryable: true });
  });
});

describe('tryPromoteAmrRetryStatus', () => {
  it('returns false and does not fail when the update is not a retry status', () => {
    const effects = fakeEffects({ accountFailureClassifier: matchingClassifier });
    expect(tryPromoteAmrRetryStatus({ effects, update: { status: 'completed' } })).toBe(false);
    expect(effects.failWithPayload).not.toHaveBeenCalled();
  });

  it('returns false when the update is a retry status but the classifier finds nothing', () => {
    const effects = fakeEffects({ accountFailureClassifier: noopAccountFailureClassifier });
    expect(tryPromoteAmrRetryStatus({ effects, update: { status: 'retry' } })).toBe(false);
    expect(effects.failWithPayload).not.toHaveBeenCalled();
  });

  it('returns true and fails the session when a retry status matches the classifier', () => {
    const effects = fakeEffects({ accountFailureClassifier: matchingClassifier });
    expect(tryPromoteAmrRetryStatus({ effects, update: { status: 'retry' } })).toBe(true);
    expect(effects.failWithPayload).toHaveBeenCalledOnce();
  });
});

describe('handleThoughtChunkUpdate', () => {
  it('sends nothing when the update has no extractable text', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleThoughtChunkUpdate({ state, effects, update: {} });
    expect(effects.send).not.toHaveBeenCalled();
    expect(state.emittedThinkingStart).toBe(false);
  });

  it('emits thinking_start once, then thinking_delta for every subsequent chunk', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleThoughtChunkUpdate({ state, effects, update: { content: { text: 'first' } } });
    handleThoughtChunkUpdate({ state, effects, update: { content: { text: 'second' } } });
    expect(effects.send).toHaveBeenNthCalledWith(1, 'agent', { type: 'thinking_start' });
    expect(effects.send).toHaveBeenNthCalledWith(2, 'agent', { type: 'thinking_delta', delta: 'first' });
    expect(effects.send).toHaveBeenNthCalledWith(3, 'agent', { type: 'thinking_delta', delta: 'second' });
    expect(state.emittedThinkingStart).toBe(true);
  });
});

describe('stripToolCallText', () => {
  it('passes plain text through untouched and notes a candidate reason', () => {
    const effects = fakeEffects();
    const result = stripToolCallText({ effects, delta: 'plain text' });
    expect(result).toBe('plain text');
    expect(effects.noteToolCallTextSuppression).toHaveBeenCalledWith('tool_call_candidate');
  });

  it('strips a self-contained tool_call tag and notes the xml reason', () => {
    const effects = fakeEffects();
    const result = stripToolCallText({ effects, delta: '<tool_call>hidden</tool_call>' });
    expect(result).toBe('');
    expect(effects.noteToolCallTextSuppression).toHaveBeenCalledWith('tool_call_xml');
  });
});

describe('shouldPreserveIncrementalProse', () => {
  const base = {
    isCumulativeSnapshot: false,
    wasSuppressingArtifact: false,
    hadPendingArtifactCandidate: false,
    hasOpenArtifactCandidate: false,
    strippedDelta: 'x',
    toolCallStrippedDelta: 'x',
    dsmlArtifactSuppressorArmedAfterText: false,
    dsmlArtifactSuppressorSawIncrementalProse: false,
  };

  it('returns false when the snapshot is cumulative', () => {
    expect(shouldPreserveIncrementalProse({ ...base, isCumulativeSnapshot: true })).toBe(false);
  });

  it('returns false while already suppressing an artifact', () => {
    expect(shouldPreserveIncrementalProse({ ...base, wasSuppressingArtifact: true })).toBe(false);
  });

  it('returns false with a pending artifact candidate', () => {
    expect(shouldPreserveIncrementalProse({ ...base, hadPendingArtifactCandidate: true })).toBe(false);
  });

  it('returns false with an open artifact candidate', () => {
    expect(shouldPreserveIncrementalProse({ ...base, hasOpenArtifactCandidate: true })).toBe(false);
  });

  it('returns true when stripping changed nothing (no gates active)', () => {
    expect(shouldPreserveIncrementalProse(base)).toBe(true);
  });

  it('returns false when stripping changed the delta and the heuristic was never armed after text', () => {
    expect(
      shouldPreserveIncrementalProse({ ...base, strippedDelta: 'y', dsmlArtifactSuppressorArmedAfterText: true }),
    ).toBe(false);
  });

  it('returns false when stripping changed the delta and no prior incremental prose was seen', () => {
    expect(
      shouldPreserveIncrementalProse({
        ...base,
        strippedDelta: 'y',
        dsmlArtifactSuppressorArmedAfterText: false,
        dsmlArtifactSuppressorSawIncrementalProse: false,
      }),
    ).toBe(false);
  });

  it('returns true when stripping changed the delta but it does not look like an artifact-echo start and prose was already seen', () => {
    expect(
      shouldPreserveIncrementalProse({
        ...base,
        strippedDelta: 'y',
        toolCallStrippedDelta: 'plain unrelated text',
        dsmlArtifactSuppressorArmedAfterText: false,
        dsmlArtifactSuppressorSawIncrementalProse: true,
      }),
    ).toBe(true);
  });

  it('returns false when the delta looks like an artifact-echo start even with prose already seen', () => {
    expect(
      shouldPreserveIncrementalProse({
        ...base,
        strippedDelta: 'y',
        toolCallStrippedDelta: '<artifact>hidden</artifact>',
        dsmlArtifactSuppressorArmedAfterText: false,
        dsmlArtifactSuppressorSawIncrementalProse: true,
      }),
    ).toBe(false);
  });
});

describe('isPlainIncrementalDelta', () => {
  const base = {
    strippedDelta: 'x',
    toolCallStrippedDelta: 'x',
    wasSuppressingArtifact: false,
    hadPendingArtifactCandidate: false,
    hasOpenArtifactCandidate: false,
  };

  it('is true when nothing was stripped and no suppression flags are set', () => {
    expect(isPlainIncrementalDelta(base)).toBe(true);
  });

  it('is false when stripping changed the delta', () => {
    expect(isPlainIncrementalDelta({ ...base, strippedDelta: 'y' })).toBe(false);
  });

  it('is false while suppressing an artifact', () => {
    expect(isPlainIncrementalDelta({ ...base, wasSuppressingArtifact: true })).toBe(false);
  });

  it('is false with a pending artifact candidate', () => {
    expect(isPlainIncrementalDelta({ ...base, hadPendingArtifactCandidate: true })).toBe(false);
  });

  it('is false with an open artifact candidate', () => {
    expect(isPlainIncrementalDelta({ ...base, hasOpenArtifactCandidate: true })).toBe(false);
  });
});

describe('applyDsmlArtifactSuppression', () => {
  it('fully suppresses a self-contained artifact tag and clears the suppressor once consumed', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    const suppressor = createDsmlArtifactTextSuppressor();
    state.dsmlArtifactSuppressor = suppressor;
    applyDsmlArtifactSuppression({
      state,
      effects,
      suppressor,
      toolCallStrippedDelta: '<artifact>hidden</artifact>',
      delta: '<artifact>hidden</artifact>',
      isCumulativeSnapshot: false,
    });
    expect(effects.emitVisibleTextDelta).not.toHaveBeenCalled();
    expect(state.dsmlArtifactSuppressor).toBeNull();
  });

  it('emits plain text unchanged and marks incremental prose as seen', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    const suppressor = createDsmlArtifactTextSuppressor();
    state.dsmlArtifactSuppressor = suppressor;
    applyDsmlArtifactSuppression({
      state,
      effects,
      suppressor,
      toolCallStrippedDelta: 'plain prose',
      delta: 'plain prose',
      isCumulativeSnapshot: false,
    });
    expect(effects.emitVisibleTextDelta).toHaveBeenCalledWith('plain prose');
    expect(state.dsmlArtifactSuppressorSawIncrementalProse).toBe(true);
    // Nothing was consumed and there's no open candidate, so the suppressor stays armed.
    expect(state.dsmlArtifactSuppressor).toBe(suppressor);
  });
});

describe('handleMessageChunkUpdate', () => {
  it('sends nothing when the update has no extractable text', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleMessageChunkUpdate({ state, effects, update: {} });
    expect(effects.emitVisibleTextDelta).not.toHaveBeenCalled();
    expect(state.emittedTextChunk).toBe(false);
  });

  it('sends nothing when a cumulative snapshot repeats with no new characters', () => {
    const state = createAcpSessionState();
    state.emittedTextBuffer = 'Hello';
    const effects = fakeEffects();
    handleMessageChunkUpdate({ state, effects, update: { content: { text: 'Hello' } } });
    expect(effects.emitVisibleTextDelta).not.toHaveBeenCalled();
    expect(state.emittedTextChunk).toBe(false);
  });

  it('emits the delta directly when no DSML suppressor is armed', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleMessageChunkUpdate({ state, effects, update: { content: { text: 'hello world' } } });
    expect(effects.emitVisibleTextDelta).toHaveBeenCalledWith('hello world');
    expect(state.emittedTextChunk).toBe(true);
    expect(state.emittedTextBuffer).toBe('hello world');
  });

  it('routes through the DSML suppressor when one is armed and fully consumes a tag', () => {
    const state = createAcpSessionState();
    state.dsmlArtifactSuppressor = createDsmlArtifactTextSuppressor();
    const effects = fakeEffects();
    handleMessageChunkUpdate({ state, effects, update: { content: { text: '<artifact>hidden</artifact>' } } });
    expect(effects.emitVisibleTextDelta).not.toHaveBeenCalled();
  });

  it('sends nothing further when the delta is entirely consumed by tool-call XML', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleMessageChunkUpdate({ state, effects, update: { content: { text: '<tool_call>hidden</tool_call>' } } });
    expect(effects.emitVisibleTextDelta).not.toHaveBeenCalled();
  });
});

describe('mirrorArtifactWriteToolEvent', () => {
  it('does nothing when there is no toolCallId', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    mirrorArtifactWriteToolEvent({ state, effects, update: { title: 'write x.html', status: 'completed' }, toolCallId: null });
    expect(effects.send).not.toHaveBeenCalled();
  });

  it('does nothing for a non-write, non-tracked tool call', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    mirrorArtifactWriteToolEvent({ state, effects, update: { title: 'run tests', status: 'completed' }, toolCallId: 'tc-1' });
    expect(effects.send).not.toHaveBeenCalled();
  });

  it('emits tool_use/tool_result on a completed write, using the locations path', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    mirrorArtifactWriteToolEvent({
      state,
      effects,
      update: { title: 'Write file.html', status: 'completed', locations: [{ path: 'file.html' }] },
      toolCallId: 'tc-1',
    });
    expect(effects.send).toHaveBeenCalledWith('agent', { type: 'tool_use', id: 'tc-1', name: 'Write', input: { file_path: 'file.html' } });
    expect(effects.send).toHaveBeenCalledWith('agent', { type: 'tool_result', toolUseId: 'tc-1', isError: false });
    expect(state.emittedConcreteToolEvent).toBe(true);
  });

  it('emits isError: true for a failed write, falling back to the toolCallId as the path', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    mirrorArtifactWriteToolEvent({ state, effects, update: { title: 'edit', status: 'failed' }, toolCallId: 'tc-9' });
    expect(effects.send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'tool_result', isError: true }));
    expect(effects.send).toHaveBeenCalledWith('agent', expect.objectContaining({ input: { file_path: 'tc-9' } }));
  });

  it('does not double-emit for the same toolCallId once already emitted', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    const update = { title: 'Write file.html', status: 'completed' };
    mirrorArtifactWriteToolEvent({ state, effects, update, toolCallId: 'tc-1' });
    (effects.send as ReturnType<typeof vi.fn>).mockClear();
    mirrorArtifactWriteToolEvent({ state, effects, update, toolCallId: 'tc-1' });
    expect(effects.send).not.toHaveBeenCalled();
  });
});

describe('updateDsmlSuppressorForToolCall', () => {
  it('arms a fresh DSML suppressor on a completed artifact write and clears the pending-write marker', () => {
    const state = createAcpSessionState();
    state.acpArtifactWriteToolCallIds.add('tc-1');
    updateDsmlSuppressorForToolCall({ state, update: { title: 'write x.html', status: 'completed' }, toolCallId: 'tc-1' });
    expect(state.dsmlArtifactSuppressor).not.toBeNull();
    expect(state.dsmlArtifactSuppressorToolCallId).toBe('tc-1');
    expect(state.acpArtifactWriteToolCallIds.has('tc-1')).toBe(false);
  });

  it('marks armedAfterText true when text has already been streamed', () => {
    const state = createAcpSessionState();
    state.emittedTextBuffer = 'already said something';
    updateDsmlSuppressorForToolCall({ state, update: { title: 'write x.html', status: 'completed' }, toolCallId: 'tc-1' });
    expect(state.dsmlArtifactSuppressorArmedAfterText).toBe(true);
  });

  it('disarms the suppressor when its owning write call terminally fails', () => {
    const state = createAcpSessionState();
    state.dsmlArtifactSuppressor = createDsmlArtifactTextSuppressor();
    state.dsmlArtifactSuppressorToolCallId = 'tc-1';
    updateDsmlSuppressorForToolCall({ state, update: { status: 'failed' }, toolCallId: 'tc-1' });
    expect(state.dsmlArtifactSuppressor).toBeNull();
    expect(state.dsmlArtifactSuppressorToolCallId).toBeNull();
  });

  it('leaves the suppressor untouched when an unrelated, never-armed tool call fails', () => {
    const state = createAcpSessionState();
    const suppressor = createDsmlArtifactTextSuppressor();
    state.dsmlArtifactSuppressor = suppressor;
    state.dsmlArtifactSuppressorToolCallId = 'tc-1';
    updateDsmlSuppressorForToolCall({ state, update: { title: 'run tests', status: 'failed' }, toolCallId: 'tc-2' });
    expect(state.dsmlArtifactSuppressor).toBe(suppressor);
  });

  it('is a no-op for a non-write, non-terminal-failure update', () => {
    const state = createAcpSessionState();
    updateDsmlSuppressorForToolCall({ state, update: { title: 'run tests', status: 'in_progress' }, toolCallId: 'tc-1' });
    expect(state.dsmlArtifactSuppressor).toBeNull();
  });
});

describe('handleToolCallUpdate', () => {
  it('tracks the turn as having emitted a tool call and mirrors a completed write', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleToolCallUpdate({
      state,
      effects,
      update: { toolCallId: 'tc-1', title: 'Write out.txt', status: 'completed', locations: [{ path: 'out.txt' }] },
    });
    expect(state.emittedToolCall).toBe(true);
    expect(effects.send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'tool_use' }));
  });
});

describe('handleSessionUpdate', () => {
  it('short-circuits on a promoted AMR retry status without emitting the generic status event', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE', accountFailureClassifier: matchingClassifier });
    handleSessionUpdate({ state, effects, update: { sessionUpdate: 'agent_status', status: 'retry' } });
    expect(effects.failWithPayload).toHaveBeenCalledOnce();
    expect(effects.send).not.toHaveBeenCalled();
  });

  it('emits a generic status event for an update kind that is neither a thought nor message chunk', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleSessionUpdate({ state, effects, update: { sessionUpdate: 'plan' } });
    expect(effects.send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'status', label: 'plan' }));
  });

  it('falls back to "session_update" as the label when sessionUpdate is missing', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleSessionUpdate({ state, effects, update: {} });
    expect(effects.send).toHaveBeenCalledWith('agent', expect.objectContaining({ label: 'session_update' }));
  });

  it('routes agent_thought_chunk to the thought handler without a generic status event', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleSessionUpdate({ state, effects, update: { sessionUpdate: 'agent_thought_chunk', content: { text: 'thinking' } } });
    expect(effects.send).toHaveBeenCalledWith('agent', { type: 'thinking_start' });
    expect(effects.send).not.toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'status' }));
  });

  it('routes agent_message_chunk to the message handler without a generic status event', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleSessionUpdate({ state, effects, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hi' } } });
    expect(effects.emitVisibleTextDelta).toHaveBeenCalledWith('hi');
  });

  it('routes tool_call and tool_call_update to the tool-call handler', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleSessionUpdate({ state, effects, update: { sessionUpdate: 'tool_call', toolCallId: 'tc-1' } });
    expect(state.emittedToolCall).toBe(true);
  });
});

describe('handleInitializeAck', () => {
  it('sends session/load with the resume session id when resuming', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ resumeSessionId: 'sess-old', effectiveCwd: '/work' });
    handleInitializeAck({ state, effects });
    expect(effects.writeRpc).toHaveBeenCalledWith(2, 'session/load', { sessionId: 'sess-old', cwd: '/work' }, 'session/load');
    expect(state.expectedId).toBe(2);
    expect(state.nextId).toBe(3);
  });

  it('sends session/new with mcpServers forwarded when no resume id is set', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ mcpServers: [{ name: 'fs', command: 'x' }] as never });
    handleInitializeAck({ state, effects });
    expect(effects.writeRpc).toHaveBeenCalledWith(2, 'session/new', expect.anything(), 'session/new');
  });
});

describe('triggerSetModelIfNeeded', () => {
  it('returns false when there is no sessionId yet', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ model: 'gpt-5' });
    expect(triggerSetModelIfNeeded({ state, effects })).toBe(false);
  });

  it('returns false when no model was requested', () => {
    const state = createAcpSessionState();
    state.sessionId = 'sess-1';
    const effects = fakeEffects({ model: null });
    expect(triggerSetModelIfNeeded({ state, effects })).toBe(false);
  });

  it('returns false when the requested model is "default"', () => {
    const state = createAcpSessionState();
    state.sessionId = 'sess-1';
    const effects = fakeEffects({ model: 'default' });
    expect(triggerSetModelIfNeeded({ state, effects })).toBe(false);
  });

  it('sends session/set_model when there is no model config id', () => {
    const state = createAcpSessionState();
    state.sessionId = 'sess-1';
    const effects = fakeEffects({ model: 'gpt-5' });
    expect(triggerSetModelIfNeeded({ state, effects })).toBe(true);
    expect(effects.writeRpc).toHaveBeenCalledWith(2, 'session/set_model', { sessionId: 'sess-1', modelId: 'gpt-5' }, 'session/set_model');
    expect(state.setModelRequestId).toBe(2);
  });

  it('sends session/set_config_option when a model config id is present', () => {
    const state = createAcpSessionState();
    state.sessionId = 'sess-1';
    state.modelConfigId = 'cfg-1';
    const effects = fakeEffects({ model: 'gpt-5' });
    expect(triggerSetModelIfNeeded({ state, effects })).toBe(true);
    expect(effects.writeRpc).toHaveBeenCalledWith(
      2,
      'session/set_config_option',
      { sessionId: 'sess-1', configId: 'cfg-1', value: 'gpt-5' },
      'session/set_config_option',
    );
  });
});

describe('handleSessionNewAck', () => {
  it('records sessionId/durableSessionId, notifies onSessionInit, and sends the prompt when no model override is requested', () => {
    const state = createAcpSessionState();
    const onSessionInit = vi.fn();
    const effects = fakeEffects({ onSessionInit });
    handleSessionNewAck({ state, effects, result: { sessionId: 'sess-1', openCodeSessionId: 'oc-1' }, rawLine: '{}' });
    expect(state.sessionId).toBe('sess-1');
    expect(state.durableSessionId).toBe('oc-1');
    expect(onSessionInit).toHaveBeenCalledOnce();
    expect(effects.sendPrompt).toHaveBeenCalledOnce();
  });

  it('does not notify onSessionInit when the response carries no sessionId', () => {
    const state = createAcpSessionState();
    const onSessionInit = vi.fn();
    const effects = fakeEffects({ onSessionInit });
    handleSessionNewAck({ state, effects, result: {}, rawLine: 'raw' });
    expect(onSessionInit).not.toHaveBeenCalled();
  });

  it('fails with the raw response line when no sessionId is present', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handleSessionNewAck({ state, effects, result: {}, rawLine: '{"weird":true}' });
    expect(effects.fail).toHaveBeenCalledWith('invalid session/new response: {"weird":true}');
    expect(effects.sendPrompt).not.toHaveBeenCalled();
  });

  it('triggers a model switch instead of sending the prompt when a non-default model was requested', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ model: 'gpt-5' });
    handleSessionNewAck({ state, effects, result: { sessionId: 'sess-1' }, rawLine: '{}' });
    expect(effects.writeRpc).toHaveBeenCalledWith(2, 'session/set_model', expect.anything(), 'session/set_model');
    expect(effects.sendPrompt).not.toHaveBeenCalled();
  });
});

describe('handlePromptResult', () => {
  it('finishes cleanly when modelUnavailableErrorCode is not configured, regardless of output', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    handlePromptResult({ state, effects, result: { usage: {} } });
    expect(effects.finishCleanPrompt).toHaveBeenCalledWith({});
    expect(effects.fail).not.toHaveBeenCalled();
  });

  it('finishes cleanly when visible text was emitted', () => {
    const state = createAcpSessionState();
    state.emittedVisibleTextChunk = true;
    const effects = fakeEffects({ modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' });
    handlePromptResult({ state, effects, result: {} });
    expect(effects.finishCleanPrompt).toHaveBeenCalledOnce();
  });

  it('fails retryable when the model reported activity (completion tokens) but produced no visible output', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' });
    handlePromptResult({ state, effects, result: { usage: { outputTokens: 12 } } });
    expect(effects.fail).toHaveBeenCalledWith(
      expect.stringContaining('did not produce visible assistant text'),
      expect.objectContaining({ retryable: true }),
    );
    expect(effects.finishCleanPrompt).not.toHaveBeenCalled();
  });

  it('fails retryable when a raw tool update was seen even without completion tokens', () => {
    const state = createAcpSessionState();
    state.emittedToolCall = true;
    const effects = fakeEffects({ modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' });
    handlePromptResult({ state, effects, result: {} });
    expect(effects.fail).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ retryable: true }));
  });

  it('force-fails as model-unavailable when there was no model activity at all', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ modelUnavailableErrorCode: 'AMR_MODEL_UNAVAILABLE' });
    handlePromptResult({ state, effects, result: {} });
    expect(effects.fail).toHaveBeenCalledWith(expect.any(String), { forceModelUnavailable: true });
  });
});

describe('isModelSetAckExpected', () => {
  it('is false without a sessionId', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ model: 'gpt-5' });
    expect(isModelSetAckExpected({ state, effects, obj: { id: state.expectedId } })).toBe(false);
  });

  it('is false when the model is "default"', () => {
    const state = createAcpSessionState();
    state.sessionId = 'sess-1';
    const effects = fakeEffects({ model: 'default' });
    expect(isModelSetAckExpected({ state, effects, obj: { id: state.expectedId } })).toBe(false);
  });

  it('is false when the id does not match expectedId', () => {
    const state = createAcpSessionState();
    state.sessionId = 'sess-1';
    const effects = fakeEffects({ model: 'gpt-5' });
    expect(isModelSetAckExpected({ state, effects, obj: { id: 999 } })).toBe(false);
  });

  it('is true when a session, a non-default model, and a matching id all line up', () => {
    const state = createAcpSessionState();
    state.sessionId = 'sess-1';
    const effects = fakeEffects({ model: 'gpt-5' });
    expect(isModelSetAckExpected({ state, effects, obj: { id: state.expectedId } })).toBe(true);
  });
});

describe('handleModelSetAck', () => {
  it('records the confirmed model, emits status, and sends the prompt', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ model: 'gpt-5' });
    handleModelSetAck({ state, effects, result: {} });
    expect(state.activeModel).toBe('gpt-5');
    expect(effects.send).toHaveBeenCalledWith('agent', { type: 'status', label: 'model', model: 'gpt-5' });
    expect(effects.sendPrompt).toHaveBeenCalledOnce();
  });

  it('prefers the model reported by the session result over the requested one', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects({ model: 'gpt-5' });
    handleModelSetAck({ state, effects, result: { models: { currentModelId: 'gpt-5-confirmed' } } });
    expect(state.activeModel).toBe('gpt-5-confirmed');
  });
});

describe('routeResultById', () => {
  it('is a no-op when the id does not match expectedId', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    routeResultById({ state, effects, obj: { id: 999 }, result: {}, rawLine: '' });
    expect(effects.writeRpc).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no result payload', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    routeResultById({ state, effects, obj: { id: state.expectedId }, result: null, rawLine: '' });
    expect(effects.writeRpc).not.toHaveBeenCalled();
  });

  it('routes expectedId 1 to the initialize ack', () => {
    const state = createAcpSessionState();
    const effects = fakeEffects();
    routeResultById({ state, effects, obj: { id: 1 }, result: {}, rawLine: '' });
    expect(effects.writeRpc).toHaveBeenCalledWith(2, 'session/new', expect.anything(), 'session/new');
  });

  it('routes expectedId 2 to the session/new ack', () => {
    const state = createAcpSessionState();
    state.expectedId = 2;
    const effects = fakeEffects();
    routeResultById({ state, effects, obj: { id: 2 }, result: { sessionId: 'sess-1' }, rawLine: '' });
    expect(state.sessionId).toBe('sess-1');
  });

  it('routes a matching promptRequestId to the prompt result handler', () => {
    const state = createAcpSessionState();
    state.expectedId = 7;
    state.promptRequestId = 7;
    const effects = fakeEffects();
    routeResultById({ state, effects, obj: { id: 7 }, result: {}, rawLine: '' });
    expect(effects.finishCleanPrompt).toHaveBeenCalledOnce();
  });

  it('routes a matching model-set ack to the model-set handler', () => {
    const state = createAcpSessionState();
    state.sessionId = 'sess-1';
    state.expectedId = 4;
    const effects = fakeEffects({ model: 'gpt-5' });
    routeResultById({ state, effects, obj: { id: 4 }, result: {}, rawLine: '' });
    expect(effects.sendPrompt).toHaveBeenCalledOnce();
  });
});
