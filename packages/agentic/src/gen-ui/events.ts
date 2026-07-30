/**
 * @module agui/events
 *
 * The AG-UI wire event shapes `./encoder.ts` produces. AG-UI (Agent-User Interaction
 * Protocol) is CopilotKit's open, external wire protocol for streaming an agent's run over SSE to
 * a UI client — see https://github.com/ag-ui-protocol/ag-ui. This module is a near-verbatim port
 * of a 312-line adapter that encoded a product's own run-event stream into this shape; the types
 * themselves are unchanged in kind, only de-branded (see `source-map.md` for the full
 * field-mapping table and provenance).
 *
 * Folded in 2026-07-26 from the standalone `@jini-ai/agui` package (plan §3a) into this `src/gen-ui/`
 * subdirectory — see `./encoder.ts` for why it is kept apart from the flat `ag-ui.ts`.
 */

export type GenUiEventKind =
  | 'agent.message'
  | 'tool_call'
  | 'state_update'
  | 'ui.surface_requested'
  | 'ui.surface_responded'
  | 'run.lifecycle';

export interface GenUiEventBase {
  kind: GenUiEventKind;
  runId: string;
  seq?: number;
  ts: number;
}

export interface GenUiAgentMessageEvent extends GenUiEventBase {
  kind: 'agent.message';
  text: string;
  done?: boolean;
}

export interface GenUiToolCallEvent extends GenUiEventBase {
  kind: 'tool_call';
  toolName: string;
  args: unknown;
  callId?: string;
  status?: 'started' | 'completed' | 'failed';
  result?: unknown;
}

export interface GenUiStateUpdateEvent extends GenUiEventBase {
  kind: 'state_update';
  path: string;
  value: unknown;
}

export interface GenUiSurfaceRequestedEvent extends GenUiEventBase {
  kind: 'ui.surface_requested';
  surfaceId: string;
  surfaceKind: 'form' | 'choice' | 'confirmation' | 'oauth-prompt';
  payload: unknown;
}

export interface GenUiSurfaceRespondedEvent extends GenUiEventBase {
  kind: 'ui.surface_responded';
  surfaceId: string;
  value: unknown;
  respondedBy: 'user' | 'agent' | 'auto' | 'cache';
}

export interface GenUiRunLifecycleEvent extends GenUiEventBase {
  kind: 'run.lifecycle';
  status: 'started' | 'pipeline_stage_started' | 'pipeline_stage_completed' | 'completed' | 'cancelled' | 'failed';
  stageId?: string;
  iteration?: number;
  message?: string;
}

export type GenUiEvent =
  | GenUiAgentMessageEvent
  | GenUiToolCallEvent
  | GenUiStateUpdateEvent
  | GenUiSurfaceRequestedEvent
  | GenUiSurfaceRespondedEvent
  | GenUiRunLifecycleEvent;
