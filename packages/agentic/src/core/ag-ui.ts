/**
 * @module ag-ui
 *
 * Projection: {@link CapabilityDef} → an AG-UI frontend tool.
 *
 * AG-UI (the Agent-User Interaction Protocol) streams typed events between an agent backend and
 * a frontend. The relevant half here is its **frontend tool calls**: the frontend passes its
 * tools in `RunAgentInput.tools`, the agent emits a tool call, the frontend executes it, and the
 * frontend returns a `role: "tool"` message referencing the call id. That is the same handoff
 * Jini's capabilities describe, which is why this projection is a rename rather than a redesign.
 *
 * One shape difference this file exists to absorb: **AG-UI names the JSON Schema field
 * `parameters`**, where WebMCP and MCP both name it `inputSchema`. Anything reading a manifest
 * through the wrong name silently sends a tool with no arguments.
 *
 * Transport is not here — AG-UI runs over SSE or WebSocket, and this package opens no
 * connections. This is the vocabulary translation only.
 */
import type { CapabilityDef, CapabilityInputSchema } from './capability.js';

/** An AG-UI tool as passed in `RunAgentInput.tools`. */
export interface AgUiTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema. Note the field name: AG-UI says `parameters`, not `inputSchema`. */
  readonly parameters: CapabilityInputSchema;
}

/**
 * The tool-call event names AG-UI emits, agent → frontend.
 *
 * Arguments stream: `TOOL_CALL_ARGS` carries a `delta` fragment and may arrive many times for
 * one call, so a consumer must accumulate by `toolCallId` and only execute after
 * `TOOL_CALL_END`. Acting on a partial argument object is the obvious failure here.
 */
export const AG_UI_TOOL_CALL_EVENTS = {
  /** Fields: `toolCallId`, `toolCallName`, optional `parentMessageId`. */
  start: 'TOOL_CALL_START',
  /** Fields: `toolCallId`, `delta` — a JSON fragment, not a complete object. */
  args: 'TOOL_CALL_ARGS',
  /** Fields: `toolCallId`. Arguments are complete only once this arrives. */
  end: 'TOOL_CALL_END',
} as const;

/** The message a frontend returns after executing a tool call. */
export interface AgUiToolResultMessage {
  readonly id: string;
  readonly role: 'tool';
  readonly content: string;
  readonly toolCallId: string;
}

/**
 * Projects one capability into an AG-UI tool.
 *
 * @param capability - The capability to expose.
 * @returns The tool entry for `RunAgentInput.tools`.
 */
export function toAgUiTool(capability: CapabilityDef): AgUiTool {
  return {
    name: capability.id,
    description: capability.description,
    parameters: capability.inputSchema,
  };
}

/**
 * Projects a whole manifest.
 *
 * @param capabilities - Capabilities to expose, already filtered by whatever policy applies.
 * @returns One tool per capability, in manifest order.
 */
export function toAgUiTools(capabilities: readonly CapabilityDef[]): readonly AgUiTool[] {
  return capabilities.map(toAgUiTool);
}

/**
 * JSON, or a description of why there is none — always a string, which `JSON.stringify` alone is
 * not.
 *
 * `output` is `unknown`: whatever a host's capability actually returned. `JSON.stringify` is not
 * total over that domain, in two different ways, and `content` is declared `string`:
 *
 * - it **throws** for a BigInt or a circular structure — landing on the transport, where the
 *   agent never learns its tool call produced anything at all;
 * - it **returns `undefined`** (not a string) for a function or a symbol, so `content` was
 *   genuinely `undefined` despite its type, and whatever serialized the message downstream
 *   dropped the field or wrote `undefined` into the wire.
 *
 * Both become a result the agent can read, because that is this channel's whole premise: a
 * failure it can see and reason about beats one that disappears.
 */
function encodeToolContent(output: unknown): string {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(output ?? null);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `tool output could not be encoded as JSON: ${detail}` });
  }
  // `undefined` here means "not representable in JSON" (a function, a symbol), which is what
  // `null` means in every other JSON position — an array element, an object property.
  return encoded ?? 'null';
}

/**
 * Builds the result message for a completed frontend tool call.
 *
 * AG-UI carries the result as a string, so structured output is JSON-encoded. Errors are
 * returned through this same channel rather than thrown — the agent needs to see the refusal
 * (a fill guard saying no, an unavailable capability) as a result it can reason about.
 *
 * @param messageId - Id for the result message itself.
 * @param toolCallId - The `toolCallId` from `TOOL_CALL_START`.
 * @param outcome - What happened.
 * @returns The `role: "tool"` message to send back.
 */
export function createAgUiToolResult(
  messageId: string,
  toolCallId: string,
  outcome: { ok: true; output: unknown } | { ok: false; error: string },
): AgUiToolResultMessage {
  const content = outcome.ok
    ? typeof outcome.output === 'string' ? outcome.output : encodeToolContent(outcome.output)
    : JSON.stringify({ error: outcome.error });
  return { id: messageId, role: 'tool', content, toolCallId };
}
