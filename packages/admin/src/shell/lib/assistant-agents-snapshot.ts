import type { ChatPaneAgent } from "../../react/kit.js";

/**
 * @file The assistant picker's instant placeholder: the last `/api/agents` inventory this browser
 * saw, kept in `localStorage` so the Local CLI picker has something real to show while a cold
 * daemon re-probes every installed CLI (~4s after a daemon restart).
 *
 * Why the last live answer rather than a static list shipped in the bundle: the only source of
 * agent defs is `@jini-ai/agent-runtime`, which is Node-only, and `agents.ts` on the website side
 * warns that a hardcoded client list offers agents whose run then fails. `ChatPane` swaps the
 * placeholder for the live list the moment `listAgents` resolves. Storage failures are absorbed by
 * the shared snapshot (`@jini-ai/chat/browser/agent-inventory`).
 *
 * The host composes this once: it supplies that shared snapshot factory (this package does not
 * depend on the chat package) and the storage key its browsers already hold, so stored inventories
 * survive.
 */

/** The shared fail-soft snapshot `createAgentInventorySnapshot` returns, narrowed to picker agents. */
export interface AgentInventoryStore {
  read(args: Record<string, never>): readonly ChatPaneAgent[] | undefined;
  write(args: { agents: readonly ChatPaneAgent[] }): void;
}

/** `@jini-ai/chat/browser/agent-inventory`'s `createAgentInventorySnapshot`, injected by the host. */
export type CreateAgentInventoryStore = (args: { storage: Pick<Storage, "getItem" | "setItem">; key: string }) => AgentInventoryStore;

export interface AssistantAgentsSnapshot {
  /** The last stored inventory, or `undefined` when there is none, it is empty, or it is unreadable. */
  readAgentsSnapshot(): readonly ChatPaneAgent[] | undefined;
  /** Stores a live inventory for the next cold load (empty lists are ignored; never throws). */
  writeAgentsSnapshot(required: { agents: readonly ChatPaneAgent[] }, _optional?: Record<string, never>): void;
}

/**
 * Builds the picker placeholder store.
 *
 * @param required.storageKey The host's key. Versioned so a future change to the stored shape can
 * ignore old entries instead of misreading them.
 * @param required.createInventorySnapshot The shared snapshot factory.
 */
export function createAssistantAgentsSnapshot(
  { storageKey, createInventorySnapshot }: { storageKey: string; createInventorySnapshot: CreateAgentInventoryStore },
  _optional: Record<string, never> = {},
): AssistantAgentsSnapshot {
  // Lazy property access: reading `localStorage` itself can throw in some privacy modes, and the shared
  // snapshot only absorbs errors raised inside its own calls.
  const snapshot = createInventorySnapshot({
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    },
    key: storageKey,
  });
  return {
    readAgentsSnapshot: () => snapshot.read({}),
    writeAgentsSnapshot: ({ agents }, _opts = {}) => {
      snapshot.write({ agents });
    },
  };
}
