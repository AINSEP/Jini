/**
 * @module agui
 *
 * Everything this package knows about AG-UI (the Agent-User Interaction Protocol), in one place.
 *
 * The protocol has two halves that meet the engine at different seams, and both live here so that
 * "where does AG-UI live" has exactly one answer:
 *
 * - **`capability-tool.ts`** — projects a {@link CapabilityDef} into an AG-UI *frontend tool*
 *   declaration, the thing a frontend advertises in `RunAgentInput.tools`.
 * - **`events.ts` / `encoder.ts`** — encodes a run's `RunProtocolEvent` stream into AG-UI *wire*
 *   events, for streaming to that frontend.
 *
 * They were briefly split — `ag-ui.ts` at `src/` root beside an `agui/` directory — which left the
 * two halves of one protocol distinguishable only by a hyphen. That is a hazard rather than a
 * distinction, and it is the confusion folding the standalone `@jini/agui` package in (plan §3a)
 * was meant to remove in the first place.
 *
 * Neither half opens a connection or touches a browser global. Transport (SSE, WebSocket) belongs
 * to a host; this directory only describes shapes and translates between them.
 */

export {
  toAgUiTool,
  toAgUiTools,
  createAgUiToolResult,
  AG_UI_TOOL_CALL_EVENTS,
  type AgUiTool,
  type AgUiToolResultMessage,
} from './capability-tool.js';

export {
  createAguiEncoder,
  type AguiEncodeContext,
  type AguiEncoder,
} from './encoder.js';

export type {
  AGUIAgentMessageEvent,
  AGUIEvent,
  AGUIEventBase,
  AGUIEventKind,
  AGUIRunLifecycleEvent,
  AGUIStateUpdateEvent,
  AGUISurfaceRequestedEvent,
  AGUISurfaceRespondedEvent,
  AGUIToolCallEvent,
} from './events.js';
