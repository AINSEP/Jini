/**
 * @module events
 *
 * Narrowings of the display-layer run-event vocabulary. `AgentEvent` and `ToolResultMediaBlock`
 * themselves are declared in `@jini-ai/core/contracts/site/chat-core`.
 */
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

/** Narrows `AgentEvent` to its `tool_use` variant. */
export type ToolUseEvent = Extract<AgentEvent, { kind: 'tool_use' }>;

/** Narrows `AgentEvent` to its `tool_result` variant. */
export type ToolResultEvent = Extract<AgentEvent, { kind: 'tool_result' }>;
