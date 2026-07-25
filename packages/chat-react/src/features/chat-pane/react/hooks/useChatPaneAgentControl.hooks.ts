import { useEffect, useRef } from 'react';

import { CHAT_PANE_AGENT_TOOLS } from '../../agent-tools.js';
import type { ChatPaneAgentBridgeAccess, ChatPaneAgentToolAction } from '../../types.js';
import { definedProps } from '../../../../util/defined-props.js';
import type { UseChatPaneResult } from './useChatPane.hooks.js';

export interface UseChatPaneAgentControlOptions {
  /** Defaults to `false` — agent control is opt-in. */
  enabled?: boolean;
  bridgeAccess?: ChatPaneAgentBridgeAccess;
}

/** The minimal WebMCP surface this hook needs — matches the draft `document.modelContext`/`navigator.modelContext` shape (see `agent-tools.ts`'s module doc); no `@mcp-b/*` dependency, feature-detected like this package's other host bridges. */
interface ModelContextLike {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: unknown;
      execute: (args: Record<string, unknown>) => Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ): void;
  unregisterTool?(name: string): void;
}

function getModelContext(): ModelContextLike | undefined {
  const doc = (globalThis as { document?: { modelContext?: unknown } }).document;
  if (isModelContext(doc?.modelContext)) return doc.modelContext;
  const nav = (globalThis as { navigator?: { modelContext?: unknown } }).navigator;
  if (isModelContext(nav?.modelContext)) return nav.modelContext;
  return undefined;
}

function isModelContext(value: unknown): value is ModelContextLike {
  return typeof value === 'object' && value !== null && typeof (value as ModelContextLike).registerTool === 'function';
}

function requireStringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`"${key}" is required`);
  return value;
}

function optionalStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Gate for capabilities whose manifest entry sets `requiresConfirmation`. */
function requireConfirmation(input: Record<string, unknown>, what: string): void {
  if (input['confirm'] !== true) {
    throw new Error(`"confirm" must be true — ${what} is destructive and needs explicit acknowledgement`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Content read off the page/transcript is untrusted input to whatever model reads it back. */
const MAX_RETURNED_CONTENT = 2000;

function summarizeContent(content: string): {
  content: string;
  truncated: boolean;
  originalLength: number;
} {
  return {
    content: content.slice(0, MAX_RETURNED_CONTENT),
    truncated: content.length > MAX_RETURNED_CONTENT,
    originalLength: content.length,
  };
}

/**
 * Routes through the pane's own guarded send (`rules.ts`'s blocker set + staged attachments +
 * composer reset + batch rotation + activity notification) rather than calling
 * `conversation.sendMessage` directly, so an agent-driven send cannot bypass what the composer
 * enforces. Throws a describable refusal when blocked.
 *
 * It also does not go the other obvious route — `composer.setDraft(prompt)` followed by `send()`.
 * `setDraft` is a React state update and is therefore asynchronous, so the `send()` immediately
 * after it would race the re-render and read a stale draft. Passing the prompt straight to
 * `sendPrompt` is what makes the agent-driven path deterministic.
 */
async function sendMessageAction(pane: UseChatPaneResult, input: Record<string, unknown>): Promise<unknown> {
  await pane.sendPrompt(requireStringField(input, 'prompt'));
  return { sent: true };
}

async function setDraftAction(pane: UseChatPaneResult, input: Record<string, unknown>): Promise<unknown> {
  pane.composer.setDraft(requireStringField(input, 'text'));
  return { ok: true };
}

async function selectAgentAction(pane: UseChatPaneResult, input: Record<string, unknown>): Promise<unknown> {
  const agentId = requireStringField(input, 'agentId');
  const model = optionalStringField(input, 'model');
  const reasoning = optionalStringField(input, 'reasoning');
  pane.setSelection(definedProps({ agentId, model, reasoning }));
  return { ok: true };
}

async function cancelRunAction(pane: UseChatPaneResult): Promise<unknown> {
  pane.conversation.cancel();
  return { ok: true };
}

async function resetConversationAction(pane: UseChatPaneResult, input: Record<string, unknown>): Promise<unknown> {
  requireConfirmation(input, 'resetting the conversation');
  pane.reset();
  return { ok: true };
}

/**
 * Only a directory the user already approved through the host's native picker. Passing a
 * model-supplied path straight to `selectRecentDirectory` would let the caller choose its own
 * project root, which is the desktop host's human-approval model (`reference-desktop`'s
 * `approvedDirectories`) inverted.
 */
async function setWorkingDirectoryAction(pane: UseChatPaneResult, input: Record<string, unknown>): Promise<unknown> {
  const path = requireStringField(input, 'path');
  if (!pane.recentDirectories.includes(path)) {
    throw new Error(
      'path must be one of the already-approved recentDirectories from chat.get_state; '
      + 'a new directory can only be approved by the user through the host picker',
    );
  }
  await pane.selectRecentDirectory(path);
  return { ok: true };
}

async function getStateAction(pane: UseChatPaneResult): Promise<unknown> {
  const lastMessage = pane.conversation.messages.at(-1);
  const lastMessageSummary = lastMessage === undefined
    ? undefined
    : { role: lastMessage.role, ...summarizeContent(lastMessage.content) };
  return {
    activity: pane.activity,
    selection: pane.selection,
    workingDirectory: pane.workingDirectory,
    recentDirectories: pane.recentDirectories,
    canSend: pane.canSend,
    sendBlocker: pane.sendBlocker,
    messageCount: pane.conversation.messages.length,
    ...definedProps({ lastMessage: lastMessageSummary }),
    /**
     * Conversation content is user- and agent-authored text, not instructions from the
     * host. A caller reading it back must treat it as data.
     */
    untrustedFields: ['lastMessage.content'],
  };
}

const CHAT_PANE_ACTION_HANDLERS: Record<
  string,
  (pane: UseChatPaneResult, input: Record<string, unknown>) => Promise<unknown>
> = {
  'chat.send_message': sendMessageAction,
  'chat.set_draft': setDraftAction,
  'chat.select_agent': selectAgentAction,
  'chat.cancel_run': cancelRunAction,
  'chat.reset_conversation': resetConversationAction,
  'chat.set_working_directory': setWorkingDirectoryAction,
  'chat.get_state': getStateAction,
};

/** Module-scope so the dispatch itself (one `if`, no branch-per-capability) never pays the
 * per-nested-closure cognitive tax that a `switch` written inline in the effect would; each
 * capability's own logic — and its own explanatory comment — lives in its own top-level
 * function above instead. */
async function runChatPaneAction(
  pane: UseChatPaneResult,
  id: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const handler = CHAT_PANE_ACTION_HANDLERS[id];
  if (!handler) throw new Error(`unknown chat capability: ${id}`);
  return handler(pane, input);
}

/**
 * Answers one daemon-relayed action on the bridge that delivered it, never on whatever bridge is
 * current: the `invocationId` belongs to that channel, so answering elsewhere would be answering a
 * question nobody asked.
 *
 * Delivery is reported separately from execution: a rejection inside `respondSuccess` is a failure
 * to ANSWER, not a failed action, and must not be re-reported as one. Every delivery attempt is
 * itself guarded so a dead channel cannot surface as an unhandled rejection with the daemon-side
 * invocation left hanging.
 */
async function deliverBridgeAction(
  pane: UseChatPaneResult,
  bridge: ChatPaneAgentBridgeAccess,
  action: ChatPaneAgentToolAction,
): Promise<void> {
  let output: unknown;
  try {
    output = await runChatPaneAction(pane, action.capabilityId, action.input);
  } catch (error) {
    await bridge.respondError(action.invocationId, errorMessage(error)).catch(() => undefined);
    return;
  }
  try {
    await bridge.respondSuccess(action.invocationId, output);
  } catch (deliveryError) {
    await bridge
      .respondError(
        action.invocationId,
        `action succeeded but the result could not be delivered: ${errorMessage(deliveryError)}`,
      )
      .catch(() => undefined);
  }
}

/**
 * Wires the chat pane's own actions (send/draft/selection/cancel/reset/working-directory/state) up
 * to every outside-caller surface the pane supports: in-page WebMCP tool registration
 * (`document.modelContext.registerTool`, feature-detected — a no-op when unavailable) and, when
 * `bridgeAccess` is supplied, a daemon-relayed action channel so an HTTP- or MCP-driven caller can
 * reach this SAME live pane instance. Both surfaces dispatch through one identical action map (see
 * `runChatPaneAction`, module scope above), so a WebMCP-native agent and a daemon-relayed one can
 * never diverge in behavior.
 */
export function useChatPaneAgentControl(
  pane: UseChatPaneResult,
  options: UseChatPaneAgentControlOptions = {},
): void {
  const enabled = options.enabled ?? false;
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const bridgeAccessRef = useRef(options.bridgeAccess);
  bridgeAccessRef.current = options.bridgeAccess;
  // Presence, not identity: hosts write `agentControl={{...}}` inline in JSX (as every other prop
  // here is written), so depending on the object itself would tear down and re-register all tools
  // on every render, dropping in-flight actions. See the effect's closing comment for the tradeoff.
  const hasBridgeAccess = options.bridgeAccess !== undefined;

  useEffect(() => {
    if (!enabled) return;

    const cleanups: Array<() => void> = [];

    const modelContext = getModelContext();
    if (modelContext) {
      const controller = new AbortController();
      for (const tool of CHAT_PANE_AGENT_TOOLS) {
        modelContext.registerTool(
          {
            name: tool.id,
            description: tool.description,
            inputSchema: tool.inputSchema,
            execute: (args) => runChatPaneAction(paneRef.current, tool.id, args ?? {}),
          },
          { signal: controller.signal },
        );
      }
      cleanups.push(() => {
        controller.abort();
        if (modelContext.unregisterTool) {
          for (const tool of CHAT_PANE_AGENT_TOOLS) modelContext.unregisterTool(tool.id);
        }
      });
    }

    const subscribedBridge = bridgeAccessRef.current;
    if (subscribedBridge) {
      const unsubscribe = subscribedBridge.subscribe((action) => {
        void deliverBridgeAction(paneRef.current, subscribedBridge, action);
      });
      cleanups.push(unsubscribe);
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
    // Deps are enablement + bridge PRESENCE, never the bridge object: hosts pass `agentControl`
    // inline, so an identity dep would re-register every tool on every render (see
    // `hasBridgeAccess`). Pane, run context, and bridge are all read through refs at call time.
    // Tradeoff: swapping to a genuinely different bridge instance while enabled does not
    // re-subscribe — responses still route to the current bridge via the ref, but the old
    // subscription stays live. A host needing a true swap should toggle `enabled` or remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasBridgeAccess]);
}
