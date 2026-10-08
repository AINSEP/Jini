/**
 * @module gen-ui
 *
 * Jini's **own** run-stream surface protocol — six event kinds (`agent.message`, `tool_call`,
 * `state_update`, `ui.surface_requested`, `ui.surface_responded`, `run.lifecycle`) and the encoder
 * that produces them from a `RunProtocolEvent` stream.
 *
 * GenUI and AG-UI are distinct contracts: AG-UI uses SCREAMING_SNAKE event names, while these six
 * belong to Jini's run-stream protocol. ../ag-ui.ts owns the AG-UI projection.
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
