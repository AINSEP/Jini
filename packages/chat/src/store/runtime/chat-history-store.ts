import type { RunIdPolicy } from "../../core/durable-runs/ports.js";
import type { ChatOwnerScope, ChatStore } from "../ports.js";
import { createSqliteChatStore } from "../sqlite/index.js";
// Owner isolation versus legacy project-only storage: packages/chat/src/store/sqlite/index.ts.
import { createPgliteChatStore } from "../pglite/index.js";
import { createPostgresChatStore } from "../postgres/index.js";

import type { ChatDatabase, ChatKernel } from "./kernel.js";
import { chatKernelTables } from "../sql/boundary.js";
import type { ChatMessage } from "../../core/index.js";

function isOrphanDaemonAnswer(
  { previous, answer, isDaemonRunId }: { previous: ChatMessage | undefined; answer: ChatMessage; isDaemonRunId: RunIdPolicy }, _optional = {},
): boolean {
  return previous?.role !== "user" && answer.role === "assistant" && Boolean(answer.runId && isDaemonRunId({ runId: answer.runId }));
}

function isEarlierOrEqualQuestion({ question, answer }: { question: ChatMessage; answer: ChatMessage }, _optional = {}): boolean {
  return question.role === "user" && question.createdAt !== undefined && answer.createdAt !== undefined
    && question.createdAt <= answer.createdAt;
}

function repairLegacyTurnOrder({ messages, isDaemonRunId }: { messages: ChatMessage[]; isDaemonRunId: RunIdPolicy }, _optional = {}): ChatMessage[] {
  const ordered: ChatMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const answer = messages[index]!;
    const question = messages[index + 1];
    // Legacy acceptance saved no question ID. Repair only an orphan daemon answer immediately
    // followed by an earlier/equal-clock user row; a preceding question already owns its answer.
    // A global timestamp sort would reorder valid follow-ups when browser/server clocks disagree.
    if (isOrphanDaemonAnswer({ previous: ordered.at(-1), answer, isDaemonRunId }) && question !== undefined
      && isEarlierOrEqualQuestion({ question, answer })) {
      ordered.push(question, answer);
      index++;
    } else ordered.push(answer);
  }
  return ordered;
}

// Transcript-isolation rationale: Jini packages/chat/src/store/sql/store.ts.
/**
 * Host compatibility factory over Jini's owner-scoped transcript adapters (PLAN C3).
 * Borrows the exact migrated kernel: the adapter's append joins the host's run-ledger transaction.
 * The host retains principal hashing, migrations and connection lifetime.
 * @param kernel The already-open chat kernel; never wrap or open a second connection here.
 * @param scope The authenticated owner tuple; guest ownerId is already hashed by tenant-scope.
 * @param now Injectable epoch-millisecond clock.
 * @returns Full ChatStore, also assignable to existing eight-method ChatHistoryStore consumers.
 */
export function createChatHistoryStore<DB extends ChatDatabase>(
  { kernel: hostKernel, scope, isDaemonRunId }: { kernel: ChatKernel<DB>; scope: ChatOwnerScope; isDaemonRunId: RunIdPolicy },
  { now = Date.now }: { now?: () => number } = {},
): ChatStore {
  const kernel = chatKernelTables<DB, ChatDatabase>({ kernel: hostKernel }, {});
  const required = { kernel, scope };
  const optional = { clock: { nowMs: now } };
  const createStore = storeFactory(kernel.transport);
  const store = createStore(required, optional);
  return { ...store,
    // Admin reload and recovery use this full-transcript compatibility read. Preserve stored
    // positions (and Jini's position-based page cursors); existing user databases need no migration.
    async messages(required, optional = {}) {
      return repairLegacyTurnOrder({ messages: await store.messages(required, optional), isDaemonRunId }, {});
    },
  };
}

function storeFactory(transport: ChatKernel<ChatDatabase>["transport"]) {
  if (transport === "better-sqlite3") return createSqliteChatStore;
  if (transport === "pglite" || transport === "pglite-socket") return createPgliteChatStore;
  return createPostgresChatStore;
}
