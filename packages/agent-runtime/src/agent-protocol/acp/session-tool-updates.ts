import { createDsmlArtifactTextSuppressor } from './text-suppression.js';
import type { UnknownRecord } from './types.js';
import { isAcpCompletedStatus, isAcpTerminalFailureStatus, acpToolCallId, isAcpArtifactWriteLabel, isAcpArtifactWriteUpdate, acpArtifactWritePath } from './updates.js';
import { type AcpSessionState, type AcpSessionEffects } from './session-types.js';
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
  update: UnknownRecord;
  toolCallId: string | null;
}, _optional: Record<string, never> = {}): void {
  if (!toolCallId) return;
  const isWriteCall = isAcpArtifactWriteLabel({ update }) || state.acpArtifactWriteToolCallIds.has(toolCallId);
  if (!isWriteCall) return;
  let st = state.acpArtifactRunEventState.get(toolCallId);
  if (!st) {
    st = { path: null, emitted: false };
    state.acpArtifactRunEventState.set(toolCallId, st);
  }
  if (!st.path) st.path = acpArtifactWritePath({ update });
  const failed = isAcpTerminalFailureStatus({ update });
  const shouldEmit = !st.emitted && (failed || isAcpCompletedStatus({ update }));
  if (!shouldEmit) return;
  st.emitted = true;
  effects.send({ event: 'agent', payload: {
    type: 'tool_use',
    id: toolCallId,
    name: 'Write',
    input: { file_path: artifactWriteFilePath({ path: st.path, toolCallId }) },
  } });
  effects.send({ event: 'agent', payload: { type: 'tool_result', toolUseId: toolCallId, isError: failed } });
  state.emittedConcreteToolEvent = true;
}

function artifactWriteFilePath({ path, toolCallId }: { path: string | null; toolCallId: string }, _optional: Record<string, never> = {}): string { return path ?? toolCallId; }

/** Arms the DSML artifact suppressor when a tool_call/tool_call_update completes an artifact write, or disarms it once its owning write call terminally fails. */
export function updateDsmlSuppressorForToolCall({
  state,
  update,
  toolCallId,
}: {
  state: AcpSessionState;
  update: UnknownRecord;
  toolCallId: string | null;
}, _optional: Record<string, never> = {}): void {
  if (isAcpArtifactWriteUpdate({ update, writeToolCallIds: state.acpArtifactWriteToolCallIds })) {
    state.dsmlArtifactSuppressor = createDsmlArtifactTextSuppressor();
    state.dsmlArtifactSuppressorLastSuppressedChars = 0;
    state.dsmlArtifactSuppressorToolCallId = toolCallId;
    state.dsmlArtifactSuppressorArmedAfterText = state.emittedTextBuffer.length > 0;
    state.dsmlArtifactSuppressorSawIncrementalProse = false;
    if (toolCallId) state.acpArtifactWriteToolCallIds.delete(toolCallId);
    return;
  }
  if (!toolCallId || !isAcpTerminalFailureStatus({ update })) return;
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
  update: UnknownRecord;
}, _optional: Record<string, never> = {}): void {
  // The turn did real work (a tool call / file edit), which is valid output even
  // when the model emits no closing assistant text. Track it so the prompt-complete
  // handler does not misreport such a turn as "no output / model unavailable".
  state.emittedToolCall = true;
  const toolCallId = acpToolCallId({ update });
  if (toolCallId && isAcpArtifactWriteLabel({ update })) {
    state.acpArtifactWriteToolCallIds.add(toolCallId);
  }
  mirrorArtifactWriteToolEvent({ state, effects, update, toolCallId });
  updateDsmlSuppressorForToolCall({ state, update, toolCallId });
}
