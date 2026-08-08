/**
 * @module gen-ui
 *
 * Jini's **own** run-stream surface protocol — six event kinds (`agent.message`, `tool_call`,
 * `state_update`, `ui.surface_requested`, `ui.surface_responded`, `run.lifecycle`) and the encoder
 * that produces them from a `RunProtocolEvent` stream.
 *
 * **This is not AG-UI**, despite what this directory was called until 2026-07-27. The real
 * Agent-User Interaction Protocol uses a 33-member `SCREAMING_SNAKE` event enum and shares zero
 * event names with these six; `../ag-ui.ts` is the genuine AG-UI projection and lives at `src/`
 * root, apart from this. See `source-map.md` for how the two came to be confused.
 *
 * Nothing here opens a connection or touches a browser global. Transport (SSE, WebSocket) belongs
 * to a host — `@jini-ai/http-kit`'s run-stream route is the shipped consumer.
 */

export {
  createGenUiEncoder,
  type GenUiEncodeContext,
  type GenUiEncoder,
} from './encoder.js';

export type {
  GenUiAgentMessageEvent,
  GenUiEvent,
  GenUiEventBase,
  GenUiEventKind,
  GenUiRunLifecycleEvent,
  GenUiStateUpdateEvent,
  GenUiSurfaceRequestedEvent,
  GenUiSurfaceRespondedEvent,
  GenUiToolCallEvent,
} from './events.js';
