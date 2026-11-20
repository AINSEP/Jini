/** @module agent-protocol/acp/session-state
 * The initial value of an ACP session's mutable state. A leaf module: `session-run.ts` builds a run
 * from it, and `session.ts` imports `session-run.ts`, so the factory cannot live in `session.ts`
 * without a runtime import cycle. The `AcpSessionState` shape stays in `session.ts` (type-only import).
 */
import type { AcpSessionState } from './session-types.js';

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
