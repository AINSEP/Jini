import type { RunIdPolicy } from "../../core/durable-runs/ports.js";
import type { ChatHistoryStore } from "../ports.js";
import type { ChatRunLedger } from "../../core/durable-runs/ledger-contracts.js";

/** Bind the server-owned run write fence to an already owner-scoped transcript. */
export function createRunGuardedChatStore({ store, ledger, isDaemonRunId }: { store: ChatHistoryStore; ledger: ChatRunLedger; isDaemonRunId: RunIdPolicy }, _optional = {}): ChatHistoryStore {
  return {
    ...store,
    /*
     * First terminal write wins, per run (`run-ledger.ts`'s file doc). The browser and the server
     * finalizer can both save the same finished turn; whichever lands second must not replace the
     * first — in particular, a browser that comes back after a restart and saves "run forgotten"
     * with no events must not erase the answer the finalizer already saved. The stored row is
     * returned instead, read through the scoped store, so a caller that does not own the
     * conversation still gets `null` exactly as before.
     *
     * The check and `store.appendMessage`'s write run in one ledger transaction under the run's
     * lock, so nothing can settle the row in between. The store and the ledger share the chat
     * kernel, so the store's own transaction joins the ledger's on every dialect.
     */
    async appendMessage({ conversationId, message }) {
      if (message.role !== "assistant" || !message.runId) return store.appendMessage({ conversationId, message });
      const runId = message.runId;
      const outcome = await ledger.unlessSettled(
        { run: { conversationId, messageId: message.id, runId },
        write: async () => {
          // Server acceptance and recovery own daemon rows. Browser snapshots can carry an old
          // attempt id or a transport-only failure; returning the stored row fences both without
          // matching presentation text. BYOK/AG-UI remain request-bound.
          if (isDaemonRunId({ runId })) {
            const saved = (await store.messages({ conversationId })).find((m) => m.id === message.id);
            if (saved) return saved;
            if (message.runStatus !== "queued" && message.runStatus !== "running") return null;
          }
          return store.appendMessage({ conversationId, message });
        } }, {}
      );
      if (outcome.written) return outcome.value;
      const saved = await store.messages({ conversationId });
      return saved.find((m) => m.id === message.id) ?? null;
    },
  };
}
