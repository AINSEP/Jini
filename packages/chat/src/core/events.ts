/**
 * @module events
 *
 * The generic run-event vocabulary a chat surface renders. This is the
 * *display-layer* event shape — narrower than `@jini-ai/protocol`'s
 * `RunAgentPayload` (the wire-level per-chunk protocol), and intentionally
 * decoupled from it: a host's transport adapter is responsible for reducing
 * wire deltas (`text_delta`, `thinking_delta`, `tool_input_delta`, ...) into
 * the persisted/renderable `AgentEvent` items (declared type-only in
 * `@jini-ai/core/contracts/site/chat-core`, re-exported here) before handing them to
 * chat-core's pure helpers. See archived provenance ledger for the provenance of this
 * split and why chat-core does not itself depend on `@jini-ai/protocol`.
 */

import type { AgentEvent } from '@jini-ai/core/contracts/site/chat-core';
export type { AgentEvent, ToolResultMediaBlock } from '@jini-ai/core/contracts/site/chat-core';

/** Narrows `AgentEvent` to its `tool_use` variant. */
export type ToolUseEvent = Extract<AgentEvent, { kind: 'tool_use' }>;

/** Narrows `AgentEvent` to its `tool_result` variant. */
export type ToolResultEvent = Extract<AgentEvent, { kind: 'tool_result' }>;
