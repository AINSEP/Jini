import type { AdminKitChat, ChatPaneAgent, ChatPaneAgentSelection } from "../../../react/kit.js";

/**
 * Whether a `ChatPane` `onSelectionChange` call is only `ChatPane` echoing back its own
 * normalization of the selection we passed in, not an operator pick.
 *
 * `ChatPane` resolves a controlled `selection` against its agent inventory and, when the resolved
 * value differs, reports it through `onSelectionChange` from an effect (`useChatPane.hooks.ts`):
 * a model-less `{ agentId: "claude" }` (the dock's starting value, and any hydrated agent with no
 * saved model) gains the agent's default model, an unavailable agent falls back to the first
 * available one. Every mount produced one such call, and persisting it wrote
 * `localCli.agentId`/`.model` on every admin page load (2026-09-23).
 *
 * With the inventory known, compare both values through `resolveChatPaneSelection`. A cached
 * inventory can still carry a legacy model alias that the picker no longer accepts; comparing
 * its raw model to the resolved current model misclassified an effort-only Default echo as a
 * pick, wrote Default, and blocked the next external effort refresh (2026-10-09). An
 * operator pick equal to it is also skipped, correctly: that value is what the picker already
 * shows. Without an inventory there is no echo to skip: `ChatPane` cannot normalize against an
 * empty list, and the dock records each live inventory (`recordAgents`) before `ChatPane` gets it.
 *
 * @param input.current - The selection the dock currently passes to `ChatPane`.
 * @param input.incoming - The value `ChatPane` reported.
 * @param input.agents - The inventory `ChatPane` resolves against, when known.
 * @param input.resolveChatPaneSelection - The chat library's own selection resolver (the admin kit's
 *   `chat.resolveChatPaneSelection`), injected so both values normalize exactly as `ChatPane` does.
 * @returns `true` when `incoming` should be shown but not saved.
 * @complexity O(a + m + r) time and O(m) space for the resolver's inventory/model/effort scans.
 * @example isSelectionNormalizationEcho({ current, incoming, agents, resolveChatPaneSelection });
 */
export function isSelectionNormalizationEcho(
  { current, incoming, agents, resolveChatPaneSelection }: {
    current: ChatPaneAgentSelection;
    incoming: ChatPaneAgentSelection;
    agents: readonly ChatPaneAgent[] | undefined;
    resolveChatPaneSelection: AdminKitChat["resolveChatPaneSelection"];
  },
  _options = {},
): boolean {
  if (!agents?.length) return false;
  const resolved = resolveChatPaneSelection({ agents, requested: current });
  const resolvedIncoming = resolveChatPaneSelection({ agents, requested: incoming });
  return resolved.agentId === resolvedIncoming.agentId
    && resolved.model === resolvedIncoming.model
    && resolved.reasoning === resolvedIncoming.reasoning;
}
