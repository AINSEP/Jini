import type { AgentEvent, ChatMessage, ChatRunStatus } from "../../core/index.js";
import type { ExpressionBuilder } from "kysely";

import type { ChatDatabase, ChatKernel } from "./kernel.js";
import { chatKernelTables } from "../sql/boundary.js";
import { createDurableRunStore } from "./durable-run-store.js";
import type { RunIdPolicy } from "../../core/durable-runs/ports.js";

/**
 * @file The run-status half of chat history: the writes that decide how an assistant turn ENDS.
 *
 * Purpose:
 * The browser formerly competed with the finalizer to finish daemon rows. Daemon acceptance
 * and recovery now own those rows, while request-bound BYOK/AG-UI keep their browser writes.
 * For one attempt the first terminal write wins; subsequent checkpoints or settlements are
 * ignored. Continuation changes the attempt id by CAS while retaining the logical message;
 * an older attempt cannot write afterward. Terminal rows remain absorbing during recovery.
 *
 * How it stays race-free with async storage: every "is it settled?" check and the write it guards
 * run in ONE kernel transaction holding the run's lock ({@link runLockKey}), and {@link
 * ChatRunLedger.settle} takes the same lock. On SQLite that is `BEGIN IMMEDIATE` (the write lock);
 * on Postgres a transaction-scoped advisory lock, since a plain transaction does not serialize there.
 *
 * Architectural role:
 * ONE Kysely body over the chat kernel (`platform/db/chat-kernel.ts`), for every dialect. Nothing
 * here exposes history to request handlers; the cross-owner boot operation
 * ({@link ChatRunLedger.reconcileInterrupted}) supplies a recovery port with the persisted owner
 * and run stub. The recovery coordinator decides whether to reattach, continue or finalize;
 * rows it cannot adopt receive an atomic cancellation fallback rather than spinning forever.
 */

const TERMINAL_STATUSES = ["succeeded", "failed", "canceled"] as const;

export type * from "../../core/durable-runs/ledger-contracts.js";
import type { RunRef, ChatRunLedger } from "../../core/durable-runs/ledger-contracts.js";
import { runLockKey } from "../../core/durable-runs/run-lock.js";
export { runLockKey } from "../../core/durable-runs/run-lock.js";

function isTerminal(status: unknown): boolean {
  return typeof status === "string" && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

type MessagesBuilder = ExpressionBuilder<ChatDatabase, "ai_chat_messages">;

/** `run_status` is not terminal (NULL counts as not terminal). */
const notTerminal = (eb: MessagesBuilder) =>
  eb.or([eb("run_status", "is", null), eb("run_status", "not in", TERMINAL_STATUSES)]);

/** The assistant row of exactly this run. */
const isRunRow = (eb: MessagesBuilder, run: RunRef) =>
  eb.and([
    eb("id", "=", run.messageId),
    eb("conversation_id", "=", run.conversationId),
    eb("run_id", "=", run.runId),
    eb("role", "=", "assistant"),
  ]);

function readEvents(eventsJson: string | null): AgentEvent[] {
  let events: unknown = [];
  try {
    events = eventsJson ? JSON.parse(eventsJson) : [];
  } catch {
    events = [];
  }
  return Array.isArray(events) ? (events as AgentEvent[]) : [];
}

function hasNewToolProgress(current: readonly AgentEvent[], next: readonly AgentEvent[]): boolean {
  const key = (event: AgentEvent) => event.kind === "tool_use" ? `use:${event.id}` : event.kind === "tool_result" ? `result:${event.toolUseId}` : "";
  const saved = new Set(current.map(key));
  return next.some((event) => { const id = key(event); return id !== "" && !saved.has(id); });
}

function retainSavedEvents(saved: readonly AgentEvent[], incoming: readonly AgentEvent[]): AgentEvent[] {
  const keys = new Set(saved.map((event) => JSON.stringify(event)));
  const additions = incoming.filter((event) => event.kind !== "text" && !keys.has(JSON.stringify(event)));
  return [...saved, ...additions];
}

function keepToolCheckpoints(saved: readonly AgentEvent[], incoming: readonly AgentEvent[]): AgentEvent[] {
  const key = (event: AgentEvent) => event.kind === "tool_use" ? `use:${event.id}` : event.kind === "tool_result" ? `result:${event.toolUseId}` : "";
  const seen = new Set(incoming.map(key));
  return [...incoming, ...saved.filter((event) => { const id = key(event); return id !== "" && !seen.has(id); })];
}

/**
 * @param store the chat kernel, or the open `chat.db` handle `createChatStoreFactory` also wraps.
 * @complexity each method is one or two indexed statements, except `reconcileInterrupted`, which
 *   is O(stuck rows).
 */
export function createChatRunLedger<DB extends ChatDatabase>({ kernel: hostKernel, isDaemonRunId }: { kernel: ChatKernel<DB>; isDaemonRunId: RunIdPolicy }, _optional = {}): ChatRunLedger {
  const kernel = chatKernelTables<DB, ChatDatabase>({ kernel: hostKernel }, {});

  async function isSettled(run: RunRef): Promise<boolean> {
    const row = await kernel.run((db) =>
      db
        .selectFrom("ai_chat_messages")
        .select("run_status")
        .where("id", "=", run.messageId)
        .where("conversation_id", "=", run.conversationId)
        .where("run_id", "=", run.runId)
        .executeTakeFirst()
    );
    return isTerminal(row?.run_status);
  }

  return {
    durable: createDurableRunStore({ kernel, isDaemonRunId }, {}),
    unlessSettled({ run, write }, _optional = {}) {
      return kernel.transaction(async () => {
        await kernel.lockKey(runLockKey(run));
        if (await isSettled(run)) return { written: false } as const;
        return { written: true, value: await write() } as const;
      });
    },

    settle(settlement, _optional = {}) {
      return kernel.transaction(async () => {
        await kernel.lockKey(runLockKey(settlement));
        const saved = await kernel.run((db) => db.selectFrom("ai_chat_messages").select(["content", "events_json"])
          .where((eb) => eb.and([isRunRow(eb, settlement), notTerminal(eb)])).executeTakeFirst());
        if (!saved) return false;
        const content = settlement.content.length >= saved.content.length ? settlement.content : saved.content;
        let events = keepToolCheckpoints(readEvents(saved.events_json), settlement.events);
        if (content !== settlement.content) {
          events = retainSavedEvents(readEvents(saved.events_json), settlement.events);
          if (!events.some((event) => event.kind === "text")) events.unshift({ kind: "text", text: saved.content });
        }
        const result = await kernel.run((db) =>
          db
            .updateTable("ai_chat_messages")
            .set({
              content,
              events_json: JSON.stringify(events),
              run_status: settlement.status,
              ended_at: settlement.endedAt,
            })
            .where((eb) => eb.and([isRunRow(eb, settlement), notTerminal(eb)]))
            .executeTakeFirst()
        );
        if (Number(result.numUpdatedRows) === 0) return false;
        await kernel.run((db) =>
          db
            .updateTable("ai_chats")
            .set({ updated_at: settlement.endedAt })
            .where("id", "=", settlement.conversationId)
            .execute()
        );
        return true;
      });
    },

    async checkpoint(progress, _optional = {}) {
      return kernel.transaction(async () => {
      await kernel.lockKey(runLockKey(progress));
      const current = await kernel.run((db) => db.selectFrom("ai_chat_messages").select(["content", "events_json"])
        .where((eb) => eb.and([isRunRow(eb, progress), notTerminal(eb)])).executeTakeFirst());
      if (!current || progress.content.length < current.content.length) return false;
      const events = keepToolCheckpoints(readEvents(current.events_json), progress.events);
      const grown = progress.content.length > current.content.length || hasNewToolProgress(readEvents(current.events_json), events);
      const result = await kernel.run((db) =>
        db
          .updateTable("ai_chat_messages")
          .set({ content: progress.content, events_json: JSON.stringify(events) })
          .where((eb) => eb.and([isRunRow(eb, progress), notTerminal(eb)]))
          .executeTakeFirst()
      );
      if (Number(result.numUpdatedRows) > 0 && grown) {
        // Progress earns a fresh recovery budget. Replayed prefixes and the coordinator's
        // divider are not progress and cannot keep a repeatedly failing attempt alive forever.
        await kernel.run((db) => db.updateTable("assistant_run_attempts")
          .set({ recovery_count: 0, recovery_deadline: null, recovery_elapsed_ms: 0, last_progress_at: Date.now() })
          .where("message_id", "=", progress.messageId).execute());
      }
      return Number(result.numUpdatedRows) > 0;
      });
    },

    async reconcileInterrupted(required = {}, optional = {}) {
      const stuck = await kernel.run((db) =>
        db
          .selectFrom("ai_chat_messages")
          .innerJoin("ai_chats", "ai_chats.id", "ai_chat_messages.conversation_id")
          .select(["ai_chat_messages.id", "conversation_id", "run_id", "run_status", "content", "events_json", "owner_kind", "owner_id"])
          .where("ai_chat_messages.role", "=", "assistant")
          .where("ai_chat_messages.run_status", "in", ["queued", "running"])
          .orderBy("ai_chat_messages.id")
          .execute()
      );
      let count = 0;
      for (const row of stuck) {
        const dispatched = await optional.recover?.({
          principalId: row.owner_kind === "user" ? row.owner_id : null,
          conversationId: row.conversation_id,
          message: {
            id: row.id, role: "assistant", content: row.content, events: readEvents(row.events_json),
            ...(row.run_id ? { runId: row.run_id } : {}),
            runStatus: row.run_status as "queued" | "running",
          },
        });
        if (dispatched) { count += 1; continue; }
        // A legacy stub without an attempt id, or a host without durable recovery, cannot ever
        // be adopted. Preserve the latest checkpoint under the same lock as settle: discovery's
        // snapshot may be old, and acceptance/recovery may have replaced its run id meanwhile.
        const canceled = await kernel.transaction(async () => {
          await kernel.lockKey(runLockKey({ conversationId: row.conversation_id, messageId: row.id, runId: row.run_id ?? "" }));
          const matches = (eb: MessagesBuilder) => eb.and([
            eb("id", "=", row.id), eb("conversation_id", "=", row.conversation_id), eb("role", "=", "assistant"),
            row.run_id === null ? eb("run_id", "is", null) : eb("run_id", "=", row.run_id),
            notTerminal(eb),
          ]);
          const current = await kernel.run((db) => db.selectFrom("ai_chat_messages").select("events_json")
            .where(matches).executeTakeFirst());
          if (!current) return false;
          const endedAt = required.now ?? Date.now();
          const events = [...readEvents(current.events_json), { kind: "status", label: "Stopped. Saved work is above." }];
          const result = await kernel.run((db) => db.updateTable("ai_chat_messages")
            .set({ run_status: "canceled", ended_at: endedAt, events_json: JSON.stringify(events) })
            .where(matches).executeTakeFirst());
          if (Number(result.numUpdatedRows) === 0) return false;
          await kernel.run((db) => db.updateTable("ai_chats").set({ updated_at: endedAt })
            .where("id", "=", row.conversation_id).execute());
          return true;
        });
        if (canceled) count += 1;
      }
      return count;
    },
  };
}
