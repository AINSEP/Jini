import { type ArtifactTextSuppressor } from './text-suppression.js';
import type { UnknownRecord } from './types.js';
import { ACP_ARTIFACT_ECHO_START_RE } from './constants.js';
import { extractAcpUpdateText } from './json.js';
import { type AcpSessionState, type AcpSessionEffects } from './session-types.js';
/** Translates an `agent_thought_chunk` update into `thinking_start` (once) / `thinking_delta` events. */
export function handleThoughtChunkUpdate({
  state,
  effects,
  update,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: UnknownRecord;
}, _optional: Record<string, never> = {}): void {
  effects.emitAcpRawShapeDiagnostic(update);
  const text = extractAcpUpdateText({ update });
  if (!text) return;
  if (!state.emittedThinkingStart) {
    state.emittedThinkingStart = true;
    effects.send({ event: 'agent', payload: { type: 'thinking_start' } });
  }
  effects.send({ event: 'agent', payload: { type: 'thinking_delta', delta: text } });
}

/** Strips tool-call XML from a raw message delta via the session's tool-call text suppressor, noting the suppression reason. */
export function stripToolCallText({ effects, delta }: { effects: AcpSessionEffects; delta: string }, _optional: Record<string, never> = {}): string {
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
}, _optional: Record<string, never> = {}): boolean {
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
}, _optional: Record<string, never> = {}): boolean {
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
  isCumulativeSnapshot,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  suppressor: ArtifactTextSuppressor;
  toolCallStrippedDelta: string;
  delta: string;
  isCumulativeSnapshot: boolean;
}, _optional: Record<string, never> = {}): void {
  const wasSuppressingArtifact = suppressor.isSuppressing();
  const hadPendingArtifactCandidate = suppressor.hasPendingCandidate();
  const strippedDelta = suppressor.strip(toolCallStrippedDelta);
  effects.noteArtifactTextSuppression(
    wasSuppressingArtifact || strippedDelta !== toolCallStrippedDelta ? 'artifact_echo' : 'artifact_candidate',
  );
  const hasOpenArtifactCandidate = suppressor.isSuppressing() || suppressor.hasPendingCandidate();
  const consumedArtifactText = wasSuppressingArtifact || strippedDelta !== toolCallStrippedDelta;
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
  clearConsumedArtifactSuppression({ state, consumedArtifactText, hasOpenArtifactCandidate });
}
function clearConsumedArtifactSuppression({ state, consumedArtifactText, hasOpenArtifactCandidate }: { state: AcpSessionState; consumedArtifactText: boolean; hasOpenArtifactCandidate: boolean }, _optional: Record<string, never> = {}): void { if (consumedArtifactText && !hasOpenArtifactCandidate) { state.dsmlArtifactSuppressor = null; state.dsmlArtifactSuppressorToolCallId = null; state.dsmlArtifactSuppressorArmedAfterText = false; state.dsmlArtifactSuppressorSawIncrementalProse = false; } }

/** Translates an `agent_message_chunk` update into `text_delta` events, applying tool-call and DSML-artifact text suppression. */
export function handleMessageChunkUpdate({
  state,
  effects,
  update,
}: {
  state: AcpSessionState;
  effects: AcpSessionEffects;
  update: UnknownRecord;
}, _optional: Record<string, never> = {}): void {
  effects.emitAcpRawShapeDiagnostic(update);
  const text = extractAcpUpdateText({ update });
  if (!text) return;
  const isCumulativeSnapshot = state.emittedTextBuffer.length > 0 &&
    text.length > state.emittedTextBuffer.length && text.startsWith(state.emittedTextBuffer);
  const delta = isCumulativeSnapshot ? text.slice(state.emittedTextBuffer.length) : text;
  // text is nonempty above; a cumulative snapshot is strictly longer than the prior buffer.
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
