/**
 * @module @jini/agui
 *
 * AG-UI (Agent-User Interaction Protocol) encoder for `@jini/protocol`'s run-event stream — see
 * `source-map.md` for provenance, the old→new field-mapping table, and the generalization
 * writeup. A composition root supplies `createAguiEncoder()` to `@jini/http`'s encoder-driven SSE
 * route; `examples/reference-web` demonstrates that wiring through the node host's HTTP-extension
 * seam.
 */
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
} from './types.js';

export type { AguiEncodeContext, AguiEncoder } from './encode.js';
export { createAguiEncoder } from './encode.js';
