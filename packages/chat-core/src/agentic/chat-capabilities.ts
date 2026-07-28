/**
 * @module agentic/chat-capabilities
 *
 * What an outside caller may ask a chat pane to do. Each id names a product OUTCOME the pane
 * already supports — not a UI click — so a headless caller and an in-page one reach the same
 * result by the same name.
 *
 * Lives here rather than in a React package on purpose: a Node MCP server or HTTP route table
 * hosting this list must not drag a browser component graph into its process.
 *
 * This is a genuine chat product surface, not vocabulary — unlike its former siblings here
 * (capability.ts, page-capabilities.ts, …), which moved to `@jini-ai/agentic` on 2026-07-26 so a
 * non-chat consumer could depend on the vocabulary without depending on chat. This file stayed
 * behind on purpose: it's the proof the split is real (see `@jini-ai/agentic`'s source-map.md).
 */
import type { CapabilityDef } from '@jini-ai/agentic';

/** The bounded, explicit set of chat-pane capabilities every transport surface hosts. */
export const CHAT_CAPABILITIES: readonly CapabilityDef[] = [
  {
    id: 'chat.send_message',
    description:
      'Send a chat message to the currently selected agent, as if the user had typed it into the composer and pressed send.',
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string', description: 'The message text to send.' } },
      required: ['prompt'],
      additionalProperties: false,
    },
    risk: 'write',
    // The one genuinely headless outcome here: a run can be started with no tab open.
    surface: 'server',
  },
  {
    id: 'chat.set_draft',
    description: 'Set the composer draft text without sending it.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Draft text to place in the composer.' } },
      required: ['text'],
      additionalProperties: false,
    },
    risk: 'write',
    surface: 'session',
  },
  {
    id: 'chat.select_agent',
    description:
      'Switch which agent (and optionally model/reasoning level) the chat pane will use for the next message.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Id of an agent currently listed as available.' },
        model: { type: 'string', description: 'Optional model id, if the agent supports selecting one.' },
        reasoning: { type: 'string', description: 'Optional reasoning-effort level, if the agent supports one.' },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    risk: 'write',
    surface: 'session',
  },
  {
    id: 'chat.cancel_run',
    description: 'Cancel the in-flight run, if the chat pane is currently streaming a response.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'write',
    surface: 'session',
  },
  {
    id: 'chat.reset_conversation',
    description:
      'DESTRUCTIVE. Clear the conversation back to its initial messages and reset the composer, discarding the visible transcript and cancelling any in-flight run. Requires explicit confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true. Acknowledges that the current conversation will be discarded.',
        },
      },
      required: ['confirm'],
      additionalProperties: false,
    },
    risk: 'write',
    surface: 'session',
    requiresConfirmation: true,
  },
  {
    id: 'chat.set_working_directory',
    description:
      "Switch the working directory the next run will use. The path MUST be one the user has already approved — read recentDirectories from chat.get_state and pass one of those values verbatim. Arbitrary paths are rejected; only the user can approve a new directory, through the host's native picker. Note that recentDirectories is empty until the user has opened that picker at least once this session, so this capability refuses every path until then.",
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "One of the values in chat.get_state's recentDirectories, verbatim.",
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    risk: 'write',
    surface: 'session',
  },
  {
    id: 'chat.get_state',
    description:
      "Read the chat pane's current state: activity, agent/model/reasoning selection, working directory, approved recent directories, and a summary of the conversation so far.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    surface: 'session',
  },
];
