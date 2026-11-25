import { sql, type Insertable, type Selectable, type Updateable } from "kysely";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";
import type { ChatMessage } from "../../core/index.js";
import type { RunIdPolicy, DurableRunHead } from "../../core/durable-runs/ports.js";
import { sqliteReadVersion } from "../sql/read-version.js";
import { toMessage, validatedEventsJson } from "../sql/store.js";
import { createChatHistoryStore } from "./chat-history-store.js";
import { appendedEventsJson } from "./events-json.js";
import type { ChatDatabase, ChatKernel } from "./kernel.js";

/**
 * @file The durable run store's SQL: every query and single-statement write it issues, each taking
 * the kernel explicitly. Nothing here opens a transaction or decides anything; the store owns both,
 * so each of its transactions still reads as one body.
 */

export type RunKernel = ChatKernel<ChatDatabase>;
export type RunRow = Selectable<ChatDatabase["ai_chat_messages"]> & { owner_id: string; owner_kind: string; scope_id: string };
/** Where a run read finds its message row: by its id, or by the attempt id it currently holds. */
export type RunMatch = { column: "ai_chat_messages.id" | "ai_chat_messages.run_id"; value: string };
/** `events`: parse the run's own saved events. `transcript`: also read every message of its conversation. */
export type ReadOptions = { events?: boolean; transcript?: boolean; includeTranscriptEvents?: boolean };
export type Metadata = ChatDatabase["assistant_run_attempts"] | undefined;
type AttemptTable = ChatDatabase["assistant_run_attempts"];

/** The run's own message row, with its events only when asked: never another message's. */
export async function selectRunRow({ kernel, match }: { kernel: RunKernel; match: RunMatch }, { events = false }: ReadOptions = {}): Promise<RunRow | undefined> {
  const eventsColumn = events ? sql<string | null>`${sql.ref("ai_chat_messages.events_json")}` : sql<string | null>`null`;
  return kernel.run((db) => db.selectFrom("ai_chat_messages")
    .innerJoin("ai_chats", "ai_chats.id", "ai_chat_messages.conversation_id")
    .select(["ai_chat_messages.id", "conversation_id", "role", "content", "agent_id", "agent_name", "attachments_json",
      "run_id", "run_status", "position", "ai_chat_messages.created_at", "started_at", "ended_at", "owner_kind", "owner_id", "scope_id"])
    .select(eventsColumn.as("events_json"))
    .where(match.column, "=", match.value).where("role", "=", "assistant").executeTakeFirst());
}

/** The attempt metadata of one message, when it has any. */
export async function selectAttempt({ kernel, messageId }: { kernel: RunKernel; messageId: string }): Promise<Metadata> {
  return kernel.run((db) => db.selectFrom("assistant_run_attempts").selectAll().where("message_id", "=", messageId).executeTakeFirst());
}

/** The conversation a message belongs to. */
export async function selectBinding({ kernel, messageId }: { kernel: RunKernel; messageId: string }) {
  return kernel.run((db) => db.selectFrom("ai_chat_messages").select("conversation_id")
    .where("id", "=", messageId).executeTakeFirst());
}

/** Unlocked probe: the message and conversation an attempt id currently names. */
export async function probeRun({ kernel, runId }: { kernel: RunKernel; runId: string }) {
  return kernel.run((db) => db.selectFrom("ai_chat_messages").select(["id", "conversation_id"])
    .where("run_id", "=", runId).where("role", "=", "assistant").executeTakeFirst());
}

/** Whether another answer in the conversation still holds its single run slot. */
export async function slotOccupied({ kernel, conversationId }: { kernel: RunKernel; conversationId: string }): Promise<boolean> {
  const occupied = await kernel.run((db) => db.selectFrom("ai_chat_messages").select("id")
    .where("conversation_id", "=", conversationId).where("role", "=", "assistant")
    .where("run_status", "in", ["queued", "running"]).executeTakeFirst());
  return occupied !== undefined;
}

/** Conversation projection: callers can omit assistant event payloads; legacy heads need only content. */
export async function conversationTranscript(
  { kernel, isDaemonRunId, row }: { kernel: RunKernel; isDaemonRunId: RunIdPolicy; row: RunRow },
  { includeEvents = true }: { includeEvents?: boolean | "user" } = {},
): Promise<ChatMessage[]> {
  const history = createChatHistoryStore({ kernel, isDaemonRunId, scope: { scopeId: row.scope_id, ownerKind: row.owner_kind as "user" | "guest", ownerId: row.owner_id } }, {});
  return history.messages({ conversationId: row.conversation_id }, { includeEvents });
}

/** Read only one owned projection, without a run lock or accepted-request reconstruction.
 * Native database versions follow checkpoint growth, replacements, attempts and settlement. SQL omits
 * content/events on a hit; only changed rows cross into JS as raw JSON, never parsed events.
 * @complexity One indexed row read; O(1) unchanged payload and JS space; changed payload is O(current message bytes).
 */
export async function pollProjection(
  { kernel, messageId, principalId, workspaceId }: { kernel: RunKernel; messageId: string; principalId: string; workspaceId: string },
  { cursor }: { cursor?: string } = {},
) {
  // SQLite has no per-row version: combine this connection's writes with the external-commit
  // generation. Unrelated writes may invalidate the cursor, but equal-length rewrites cannot
  // hide. PostgreSQL supplies the row's own MVCC version. Neither reads the event column.
  const version = kernel.dialect === 'sqlite'
    ? sqliteReadVersion({ kernel })
    : sql<string>`cast(ai_chat_messages.xmin as text)`;
  const changed = sql<boolean>`${version} <> ${cursor ?? ''}`;
  // Run writers persist compact JSON arrays on both engines. SQLite also tolerates malformed
  // legacy rows through its native validator; PG14 has no safe try-cast (do not parse in JS).
  const valid = kernel.dialect === 'sqlite' ? sql<number>`json_valid(events_json)` : sql<number>`1`;
  const row = await kernel.run(db => db.selectFrom('ai_chat_messages')
    .innerJoin('ai_chats', 'ai_chats.id', 'ai_chat_messages.conversation_id')
    .select(['ai_chat_messages.id', 'conversation_id', 'role'])
    .select([
      sql<string | null>`case when ${changed} then run_id else null end`.as('run_id'),
      sql<string | null>`case when ${changed} then run_status else null end`.as('run_status'),
      sql<string | null>`case when ${changed} then agent_id else null end`.as('agent_id'),
      sql<string | null>`case when ${changed} then agent_name else null end`.as('agent_name'),
      sql<string | null>`case when ${changed} then attachments_json else null end`.as('attachments_json'),
      sql<number>`case when ${changed} then ai_chat_messages.created_at else 0 end`.as('created_at'),
      sql<number | null>`case when ${changed} then started_at else null end`.as('started_at'),
      sql<number | null>`case when ${changed} then ended_at else null end`.as('ended_at')])
    .select([version.as('cursor'),
      sql<string>`case when ${changed} then content else '' end`.as('content'),
      sql<string | null>`case when ${changed} then events_json else null end`.as('events_json'),
      sql<number | null>`case when ${changed} then ${valid} else null end`.as('events_json_valid')])
    .where('ai_chat_messages.id', '=', messageId).where('role', '=', 'assistant')
    .where('owner_kind', '=', 'user').where('owner_id', '=', principalId).where('scope_id', '=', workspaceId)
    .executeTakeFirst());
  if (!row) return null;
  if (row.cursor === cursor) return { cursor: row.cursor };
  const metadata = JSON.stringify(toMessage({ ...row, events_json: null }));
  const events = validatedEventsJson({ row });
  const messageJson = events === undefined ? metadata : metadata.slice(0, -1) + ',"events":' + events + '}';
  return { cursor: row.cursor, conversationId: row.conversation_id, messageJson };
}

/** First acceptance of a run: its attempt row. */
export async function insertAttempt({ kernel, values }: { kernel: RunKernel; values: Insertable<AttemptTable> }): Promise<void> {
  await kernel.run((db) => db.insertInto("assistant_run_attempts").values(values).execute());
}

export async function writeAttemptMetadata({ kernel, values, updates }: {
  kernel: RunKernel;
  values: Insertable<AttemptTable>;
  updates: Updateable<AttemptTable>;
}): Promise<void> {
  await kernel.run(db => db.insertInto("assistant_run_attempts").values(values)
    .onConflict(oc => oc.column("message_id").doUpdateSet(updates)).execute());
}

/** CAS of the attempt id and projection; false when the row no longer holds the old attempt id as active. */
export async function casAdvanceProjection({ kernel, run, nextRunId, content, projection }: {
  kernel: RunKernel; run: DurableRunHead; nextRunId: string; content: string; projection: readonly AgentEvent[];
}): Promise<boolean> {
  const result = await kernel.run((db) => db.updateTable("ai_chat_messages")
    .set({ run_id: nextRunId, run_status: "queued", content, events_json: JSON.stringify(projection) })
    .where("id", "=", run.messageId).where("run_id", "=", run.runId)
    .where("run_status", "in", ["queued", "running"]).executeTakeFirst());
  return Number(result.numUpdatedRows) !== 0;
}

export async function saveAgentSession({ kernel, run, sessionId }: { kernel: RunKernel; run: DurableRunHead; sessionId: string }): Promise<void> {
  await kernel.run((db) => db.insertInto("assistant_agent_sessions").values({ conversation_id: run.conversationId,
    agent_id: run.request.agentId ?? "claude", session_id: sessionId, updated_at: Date.now() })
    .onConflict((oc) => oc.columns(["conversation_id", "agent_id"]).doUpdateSet({ session_id: sessionId, updated_at: Date.now() })).execute());
}

/** Drop the conversation's locator, then the attempt's own record of the same session. */
export async function deleteSession({ kernel, run, sessionId }: { kernel: RunKernel; run: DurableRunHead; sessionId: string }): Promise<void> {
  await kernel.run((db) => db.deleteFrom("assistant_agent_sessions").where("conversation_id", "=", run.conversationId)
    .where("agent_id", "=", run.request.agentId ?? "claude").where("session_id", "=", sessionId).execute());
  await kernel.run((db) => db.updateTable("assistant_run_attempts").set({ session_id: null, session_confirmed: 0 })
    .where("message_id", "=", run.messageId).where("session_id", "=", sessionId).execute());
}

export async function writeToolEvent({ kernel, run, event }: { kernel: RunKernel; run: DurableRunHead; event: AgentEvent }): Promise<void> {
  await kernel.run((db) => db.updateTable("ai_chat_messages").set({ events_json: appendedEventsJson({ event }) })
    .where("id", "=", run.messageId).where("run_id", "=", run.runId).where("run_status", "in", ["queued", "running"]).execute());
  await kernel.run((db) => db.updateTable("assistant_run_attempts")
    .set({ recovery_count: 0, recovery_deadline: null, recovery_elapsed_ms: 0, last_progress_at: Date.now() })
    .where("message_id", "=", run.messageId).execute());
}
