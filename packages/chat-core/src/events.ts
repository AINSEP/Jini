/**
 * @module events
 *
 * The generic run-event vocabulary a chat surface renders. This is the
 * *display-layer* event shape — narrower than `@injini/protocol`'s
 * `RunAgentPayload` (the wire-level per-chunk protocol), and intentionally
 * decoupled from it: a host's transport adapter is responsible for reducing
 * wire deltas (`text_delta`, `thinking_delta`, `tool_input_delta`, ...) into
 * the persisted/renderable `AgentEvent` items below before handing them to
 * chat-core's pure helpers. See source-map.md for the provenance of this
 * split and why chat-core does not itself depend on `@injini/protocol`.
 */

/**
 * A single renderable unit of agent output. Covers every generic variant a
 * chat surface needs — status/text/thinking/tool lifecycle/usage/raw — plus
 * an `ext` escape hatch so a host can carry its own product-specific event
 * kinds (e.g. an OD `live_artifact` or `plugin_candidate` notification)
 * through the same envelope without this package knowing about them.
 */
export type AgentEvent =
  | { kind: 'status'; label: string; detail?: string; code?: string }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | {
      kind: 'usage';
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
      durationMs?: number;
      stopReason?: string;
    }
  | { kind: 'raw'; line: string }
  | { kind: 'ext'; name: string; data: unknown };

/** Narrows `AgentEvent` to its `tool_use` variant. */
export type ToolUseEvent = Extract<AgentEvent, { kind: 'tool_use' }>;

/** Narrows `AgentEvent` to its `tool_result` variant. */
export type ToolResultEvent = Extract<AgentEvent, { kind: 'tool_result' }>;
