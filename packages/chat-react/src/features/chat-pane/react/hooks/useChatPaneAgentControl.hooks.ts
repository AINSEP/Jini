import { useEffect, useRef } from 'react';

import { CHAT_PANE_AGENT_TOOLS } from '../../agent-tools.js';
import type { ChatPaneAgentBridgeAccess } from '../../types.js';
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
 * Wires the chat pane's own actions (send/draft/selection/cancel/reset/working-directory/state) up
 * to every outside-caller surface the pane supports: in-page WebMCP tool registration
 * (`document.modelContext.registerTool`, feature-detected — a no-op when unavailable) and, when
 * `bridgeAccess` is supplied, a daemon-relayed action channel so an HTTP- or MCP-driven caller can
 * reach this SAME live pane instance. Both surfaces dispatch through one identical action map, so a
 * WebMCP-native agent and a daemon-relayed one can never diverge in behavior.
 *
 * `chat.send_message` deliberately bypasses the composer and calls `conversation.sendMessage`
 * directly with the supplied prompt — routing it through `composer.setDraft` first would race
 * React's async state update against an immediately-following `send()` reading stale draft state.
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

    const runAction = async (id: string, input: Record<string, unknown>): Promise<unknown> => {
      const current = paneRef.current;
      switch (id) {
        case 'chat.send_message': {
          // Routes through the pane's own guarded send (`rules.ts`'s blocker set + staged
          // attachments + composer reset + batch rotation + activity notification) rather than
          // calling `conversation.sendMessage` directly, so an agent-driven send cannot bypass what
          // the composer enforces. Throws a describable refusal when blocked.
          await current.sendPrompt(requireStringField(input, 'prompt'));
          return { sent: true };
        }
        case 'chat.set_draft': {
          current.composer.setDraft(requireStringField(input, 'text'));
          return { ok: true };
        }
        case 'chat.select_agent': {
          const agentId = requireStringField(input, 'agentId');
          const model = optionalStringField(input, 'model');
          const reasoning = optionalStringField(input, 'reasoning');
          current.setSelection({
            agentId,
            ...(model === undefined ? {} : { model }),
            ...(reasoning === undefined ? {} : { reasoning }),
          });
          return { ok: true };
        }
        case 'chat.cancel_run': {
          current.conversation.cancel();
          return { ok: true };
        }
        case 'chat.reset_conversation': {
          requireConfirmation(input, 'resetting the conversation');
          current.reset();
          return { ok: true };
        }
        case 'chat.set_working_directory': {
          // Only a directory the user already approved through the host's native picker. Passing a
          // model-supplied path straight to `selectRecentDirectory` would let the caller choose its
          // own project root, which is the desktop host's human-approval model
          // (`reference-desktop`'s `approvedDirectories`) inverted.
          const path = requireStringField(input, 'path');
          if (!current.recentDirectories.includes(path)) {
            throw new Error(
              'path must be one of the already-approved recentDirectories from chat.get_state; '
              + 'a new directory can only be approved by the user through the host picker',
            );
          }
          await current.selectRecentDirectory(path);
          return { ok: true };
        }
        case 'chat.get_state': {
          const lastMessage = current.conversation.messages.at(-1);
          return {
            activity: current.activity,
            selection: current.selection,
            workingDirectory: current.workingDirectory,
            recentDirectories: current.recentDirectories,
            canSend: current.canSend,
            sendBlocker: current.sendBlocker,
            messageCount: current.conversation.messages.length,
            ...(lastMessage === undefined ? {} : {
              lastMessage: { role: lastMessage.role, ...summarizeContent(lastMessage.content) },
            }),
            /**
             * Conversation content is user- and agent-authored text, not instructions from the
             * host. A caller reading it back must treat it as data.
             */
            untrustedFields: ['lastMessage.content'],
          };
        }
        default:
          throw new Error(`unknown chat capability: ${id}`);
      }
    };

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
            execute: (args) => runAction(tool.id, args ?? {}),
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
        void (async () => {
          // Delivery is reported separately from execution: a rejection inside `respondSuccess` is
          // a failure to ANSWER, not a failed action, and must not be re-reported as one. Every
          // delivery attempt is itself guarded so a dead channel cannot surface as an unhandled
          // rejection with the daemon-side invocation left hanging.
          const bridge = bridgeAccessRef.current ?? subscribedBridge;
          let output: unknown;
          try {
            output = await runAction(action.capabilityId, action.input);
          } catch (error) {
            await bridge
              .respondError(action.invocationId, errorMessage(error))
              .catch(() => undefined);
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
        })();
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
