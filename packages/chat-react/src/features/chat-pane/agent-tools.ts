/**
 * @module @jini/chat-react/features/chat-pane/agent-tools
 *
 * The chat pane's capability manifest now lives in `@jini/chat-core/agentic`, which is
 * framework-free and dependency-free — a Node MCP server or HTTP route table can host the same
 * list without pulling React and the component graph into its process, and a future Vue or
 * Svelte binding reads the identical definitions.
 *
 * This file remains as the React package's view of that list, keeping the older
 * `ChatPaneAgentTool*` names working for existing importers. New code should import from
 * `@jini/chat-core/agentic` directly.
 */
import {
  CHAT_CAPABILITIES,
  type CapabilityDef,
  type CapabilityInputSchema,
  type CapabilityRisk,
} from '@jini/chat-core';

/** @deprecated Use `CapabilityRisk` from `@jini/chat-core/agentic`. */
export type ChatPaneAgentToolRisk = CapabilityRisk;
/** @deprecated Use `CapabilityInputSchema` from `@jini/chat-core/agentic`. */
export type ChatPaneAgentToolInputSchema = CapabilityInputSchema;
/** @deprecated Use `CapabilityDef` from `@jini/chat-core/agentic`. */
export type ChatPaneAgentToolDef = CapabilityDef;

/**
 * The bounded, explicit set of chat-pane capabilities every transport surface hosts.
 *
 * @deprecated Use `CHAT_CAPABILITIES` from `@jini/chat-core/agentic`.
 */
export const CHAT_PANE_AGENT_TOOLS: readonly CapabilityDef[] = CHAT_CAPABILITIES;
