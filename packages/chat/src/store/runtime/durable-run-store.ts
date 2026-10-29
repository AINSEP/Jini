import type { RunIdPolicy } from "../../core/durable-runs/ports.js";
import { recoveredRunEvents, type AgentEvent, type ChatMessage } from "../../core/index.js";
import type { ChatKernel, ChatDatabase } from "./kernel.js";
import { chatKernelTables } from "../sql/boundary.js";
import { sql, type Selectable, type Insertable, type Updateable } from "kysely";
import { hasUnknownToolCall, CONTINUATION_DIVIDER } from "../../core/durable-runs/continuation.js";
import { RECOVERY_WINDOW_MS } from "../../core/durable-runs/policies.js";
import type { DurableRun, DurableRunHead, DurableRunStore } from "../../core/durable-runs/ports.js";
import type { RunRef } from "../../core/durable-runs/ledger-contracts.js";
import type { ChatStore } from "../ports.js";
import { createChatHistoryStore } from "./chat-history-store.js";
import { runLockKey } from "../../core/durable-runs/run-lock.js";
import { runContentFromEvents } from "../../core/run-events/entry.js";
import { toMessage } from "../sql/store.js";

export const RUN_SLOT_BUSY = "Another answer in this chat is still running. This turn is queued in your browser.";
export class RunSlotBusyError extends Error { constructor() { super(RUN_SLOT_BUSY); } }

type RunRow = Selectable<ChatDatabase["ai_chat_messages"]> & { owner_id: string; owner_kind: string; scope_id: string };
/** Where a run read finds its message row: by its id, or by the attempt id it currently holds. */
type RunMatch = { column: "ai_chat_messages.id" | "ai_chat_messages.run_id"; value: string };
/** `events`: parse the run's own saved events. `transcript`: also read every message of its conversation. */
type ReadOptions = { events?: boolean; transcript?: boolean };
/** A run read: its head, and the transcript only when that read loaded one. */
type RunRead = { head: DurableRunHead; transcript: readonly ChatMessage[] };
type Metadata = ChatDatabase["assistant_run_attempts"] | undefined;

function isAcceptedUserShape({ message }: { message: ChatMessage }, _optional = {}): boolean {
  if (!message || typeof message.id !== "string" || !message.id) return false;
  if (message.role !== "user" || typeof message.content !== "string") return false;
  return message.createdAt === undefined || Number.isFinite(message.createdAt);
}

function areAcceptedAttachments({ attachments }: { attachments: unknown }, _optional = {}): boolean {
  return Array.isArray(attachments) && attachments.every((attachment) => {
    if (!attachment || typeof attachment.path !== "string" || typeof attachment.name !== "string") return false;
    return attachment.kind === "file" || attachment.kind === "image";
  });
}

function acceptedUserMessage(
  { request, now }: { request: DurableRun["request"]; now: number }, _optional = {},
): ChatMessage | null {
  const context = JSON.parse(request.contextRef) as { userMessage?: ChatMessage };
  // Older clients supplied only a prompt; never invent a user identity from that transcript.
  const message = context.userMessage;
  if (message === undefined) return null;
  if (!isAcceptedUserShape({ message }, {})) throw new Error("Invalid accepted user message");
  if (message.attachments !== undefined && !areAcceptedAttachments({ attachments: message.attachments }, {})) throw new Error("Invalid accepted user attachments");
  // User input cannot claim an assistant run's status/events. Keep the same identity and payload
  // as its browser PUT, including the original clock and attachment order.
  return { id: message.id, role: "user", content: message.content, createdAt: message.createdAt ?? now,
    ...(message.attachments ? { attachments: message.attachments } : {}) };
}

function recoveryFields({ row, metadata }: { row: RunRow; metadata: Metadata }, _optional = {}) {
  const saved: Partial<NonNullable<Metadata>> = metadata ?? {};
  return { recoveryCount: saved.recovery_count ?? 0, recoveryDeadline: saved.recovery_deadline ?? null,
    attemptStartedAt: saved.attempt_started_at ?? 0, lastProgressAt: saved.last_progress_at ?? row.started_at ?? row.created_at,
    cancelReason: saved.cancel_reason ?? null };
}

function sessionFields({ metadata }: { metadata: Metadata }, _optional = {}) {
  return { sessionId: metadata?.session_id ?? null, sessionConfirmed: metadata?.session_confirmed === 1,
    child: metadata?.child_pid && metadata.child_started_at ? { pid: metadata.child_pid, startedAt: metadata.child_started_at } : null,
    attemptBase: savedRunEvents({ json: metadata?.attempt_base_json ?? null }, {}) };
}

function acceptedRequest({ row, metadata, transcript }: { row: RunRow; metadata: Metadata; transcript: readonly ChatMessage[] }, _optional = {}) {
  if (metadata) return JSON.parse(metadata.accepted_json);
  return { agentId: row.agent_id ?? "claude", contextRef: JSON.stringify({ conversationId: row.conversation_id,
    prompt: transcript.map((item) => `${item.role}: ${item.content}`).join("\n\n") }) };
}

function runHead(
  { row, runId, metadata, message, transcript }: { row: RunRow; runId: string; metadata: Metadata; message: ChatMessage; transcript: readonly ChatMessage[] },
  { isDaemonRunId }: { isDaemonRunId: RunIdPolicy },
): DurableRunHead {
  return {
    messageId: row.id, conversationId: row.conversation_id, runId,
    workspaceId: row.scope_id,
    principalId: row.owner_kind === "user" ? row.owner_id : null,
    engine: metadata?.engine ?? (isDaemonRunId({ runId }) ? "daemon" : "request"), message,
    request: acceptedRequest({ row, metadata, transcript }, {}),
    ...recoveryFields({ row, metadata }, {}), ...sessionFields({ metadata }, {}),
  };
}

function metadataForRun({ run }: { run: DurableRunHead }, _optional = {}) {
  return { message_id: run.messageId, engine: run.engine, accepted_json: JSON.stringify(run.request),
    recovery_count: run.recoveryCount, recovery_deadline: run.recoveryDeadline, recovery_elapsed_ms: 0,
    attempt_started_at: run.attemptStartedAt, last_progress_at: run.lastProgressAt,
    cancel_reason: run.cancelReason, session_id: run.sessionId, session_confirmed: run.sessionConfirmed ? 1 : 0,
    child_pid: null, child_started_at: null, attempt_base_json: JSON.stringify(run.attemptBase) };
}

export function attemptCanExecute({ run }: { run: DurableRunHead | null }, _optional = {}): boolean {
  return Boolean(run && !run.cancelReason && ["queued", "running"].includes(run.message.runStatus ?? ""));
}

export function savedRunEvents({ json }: { json: string | null }, _optional = {}): AgentEvent[] {
  try { const value: unknown = JSON.parse(json ?? "[]"); return Array.isArray(value) ? value as AgentEvent[] : []; }
  catch { return []; }
}

/** Index of the latest matching event, or -1. */
function lastIndexOf(
  { events, matches }: { events: readonly AgentEvent[]; matches: (event: AgentEvent) => boolean }, _optional = {},
): number {
  // Scan backward to keep the latest match without requiring ES2023 array methods.
  for (let index = events.length - 1; index >= 0; index--) if (matches(events[index]!)) return index;
  return -1;
}

/** Saved projection, with legacy content restored as text when no text event carries it. */
function savedProjection({ current }: { current: DurableRunHead }, _optional = {}): AgentEvent[] {
  const saved = [...(current.message.events ?? [])];
  if (!saved.some((event) => event.kind === "text") && current.message.content) saved.unshift({ kind: "text", text: current.message.content });
  return saved;
}

function continuationEvents(
  { current, incoming }: { current: DurableRunHead; incoming: readonly AgentEvent[] }, _optional = {},
): readonly AgentEvent[] {
  const separator = lastIndexOf({ events: incoming, matches: (event) => event.kind === "text" && event.text === CONTINUATION_DIVIDER });
  const saved = savedProjection({ current });
  // A trailing checkpoint/tool barrier may land after the recovery probe but before its CAS.
  // Build the continuation segment from the projection inside the transaction, never that probe.
  if (separator >= 0) return [...saved, ...incoming.slice(separator)];
  // Empty startup retries have a recovery marker but no divider. Rebase their saved work under
  // the same lock too: a checkpoint may have arrived since the recovery probe.
  const marker = lastIndexOf({ events: incoming, matches: (event) => event.kind === "status" && event.code === "run_recovering" });
  if (marker >= 0) {
    const event = incoming[marker]!;
    const notice = event.kind === 'status' && event.label === '' ? 'silent' : 'visible';
    return [...recoveredRunEvents({ saved }, { notice }), ...incoming.slice(marker + 1)];
  }
  return runContentFromEvents({ events: incoming }).length >= current.message.content.length ? incoming : saved;
}

/** `events_json` with one more event, built in SQL: no dialect parses or re-serializes the saved
 * array in JS. Writers store `JSON.stringify` output (no whitespace), so a non-empty array is
 * `[...]` and gains `,event`; `[]`, NULL and anything not array-shaped (a truncated legacy value,
 * which the old JS read also treated as no events) become `[event]`. Plain `substr`/`length`/`||`
 * run unchanged on SQLite and PostgreSQL. */
function appendedEventsJson({ event }: { event: AgentEvent }, _optional = {}) {
  const item = sql<string>`cast(${JSON.stringify(event)} as text)`;
  return sql<string>`case when events_json like '[_%]' then substr(events_json, 1, length(events_json) - 1) || ',' || ${item} || ']' else '[' || ${item} || ']' end`;
}

function sameOwner(
  { run, required }: { run: DurableRunHead; required: { principalId: string; conversationId: string } }, _optional = {},
): boolean {
  return run.principalId === required.principalId && run.conversationId === required.conversationId;
}

/** Same kernel and message lock as checkpoint/settle. Claim changes run_id before any spawn;
 * old attempts cannot write projections or dispatch tools after that transaction commits. */
export function createDurableRunStore<DB extends ChatDatabase>({ kernel: hostKernel, isDaemonRunId }: { kernel: ChatKernel<DB>; isDaemonRunId: RunIdPolicy }, _optional = {}): DurableRunStore {
  const kernel = chatKernelTables<DB, ChatDatabase>({ kernel: hostKernel }, {});
  /** The run's own message row, with its events only when asked: never another message's. */
  async function runRow({ match }: { match: RunMatch }, { events = false }: ReadOptions = {}): Promise<RunRow | undefined> {
    const eventsColumn = events ? sql<string | null>`${sql.ref("ai_chat_messages.events_json")}` : sql<string | null>`null`;
    return kernel.run((db) => db.selectFrom("ai_chat_messages")
      .innerJoin("ai_chats", "ai_chats.id", "ai_chat_messages.conversation_id")
      .select(["ai_chat_messages.id", "conversation_id", "role", "content", "agent_id", "agent_name", "attachments_json",
        "run_id", "run_status", "position", "ai_chat_messages.created_at", "started_at", "ended_at", "owner_kind", "owner_id", "scope_id"])
      .select(eventsColumn.as("events_json"))
      .where(match.column, "=", match.value).where("role", "=", "assistant").executeTakeFirst());
  }

  /** Every message of the run's conversation; only `load` and legacy rows without attempt metadata pay this. */
  async function conversationTranscript({ row }: { row: RunRow }, _options = {}): Promise<ChatMessage[]> {
    const history = createChatHistoryStore({ kernel, isDaemonRunId, scope: { scopeId: row.scope_id, ownerKind: row.owner_kind as "user" | "guest", ownerId: row.owner_id } }, {});
    return history.messages({ conversationId: row.conversation_id });
  }

  /** One run's head, plus its transcript when that was read (`[]` otherwise). */
  async function readRun({ match }: { match: RunMatch }, options: ReadOptions = {}): Promise<RunRead | null> {
    const row = await runRow({ match }, options);
    if (!row || !row.run_id) return null;
    const messageId = row.id;
    const metadata = await kernel.run((db) => db.selectFrom("assistant_run_attempts").selectAll().where("message_id", "=", messageId).executeTakeFirst());
    // A legacy row's accepted request is derived from its transcript, so only it reads one here.
    const transcript = options.transcript || !metadata ? await conversationTranscript({ row }) : [];
    const message = options.transcript ? transcript.find((item) => item.id === messageId) : toMessage(row);
    if (!message) return null; // Deletion may have cascaded between the two reads.
    return { head: runHead({ row, runId: row.run_id, metadata, message, transcript }, { isDaemonRunId }), transcript };
  }

  /** Locked read of one message; `transcript` decides whether it is a whole run or only its head. */
  async function lockedRead(
    { messageId, conversationId }: { messageId: string; conversationId: string }, options: ReadOptions = {},
  ): Promise<RunRead | null> {
    return kernel.transaction(async () => {
      // Message, attempt metadata and transcript must describe the same generation. A CAS in
      // the gap between independent reads must never pair a new projection with an old session.
      await kernel.lockKey(runLockKey({ messageId, conversationId, runId: "" }));
      return readRun({ match: { column: "ai_chat_messages.id", value: messageId } }, options);
    });
  }

  async function load({ messageId }: { messageId: string }, _options = {}): Promise<DurableRun | null> {
    const binding = await kernel.run((db) => db.selectFrom("ai_chat_messages").select("conversation_id")
      .where("id", "=", messageId).executeTakeFirst());
    if (!binding) return null;
    // The message comes from the transcript, so its row's events are not selected twice.
    const read = await lockedRead({ messageId, conversationId: binding.conversation_id }, { transcript: true });
    return read && { ...read.head, transcript: read.transcript };
  }

  /** Unlocked probe: the message and conversation an attempt id currently names. */
  async function probeRun({ runId }: { runId: string }, _options = {}) {
    return kernel.run((db) => db.selectFrom("ai_chat_messages").select(["id", "conversation_id"])
      .where("run_id", "=", runId).where("role", "=", "assistant").executeTakeFirst());
  }

  async function find({ runId, principalId }: { runId: string; principalId?: string }, _options = {}): Promise<DurableRunHead | null> {
    const row = await probeRun({ runId });
    if (!row) return null;
    const run = (await lockedRead({ messageId: row.id, conversationId: row.conversation_id }, { events: true }))?.head ?? null;
    return principalId !== undefined && run?.principalId !== principalId ? null : run;
  }

  /** Slot and run locks, then the owner-scoped conversation; null when the caller does not own it. */
  async function lockOwnedConversation(
    { required }: { required: RunRef & { principalId: string; workspaceId: string } }, _options = {},
  ): Promise<ChatStore | null> {
    await kernel.lockKey(`chat-slot:${required.conversationId}`);
    await kernel.lockKey(runLockKey(required));
    const history = createChatHistoryStore({ kernel, isDaemonRunId, scope: { scopeId: required.workspaceId, ownerKind: "user", ownerId: required.principalId } }, {});
    return await history.get({ id: required.conversationId }) ? history : null;
  }

  async function assertSlotFree({ conversationId }: { conversationId: string }, _options = {}): Promise<void> {
    const occupied = await kernel.run((db) => db.selectFrom("ai_chat_messages").select("id")
      .where("conversation_id", "=", conversationId).where("role", "=", "assistant")
      .where("run_status", "in", ["queued", "running"]).executeTakeFirst());
    if (occupied) throw new RunSlotBusyError();
  }

  async function appendAcceptedQuestion(
    { history, required, userMessage }: { history: ChatStore; required: Parameters<DurableRunStore["accept"]>[0]; userMessage: ChatMessage }, _options = {},
  ): Promise<void> {
    if (userMessage.id === required.messageId) throw new Error("User and assistant messages must have different IDs");
    // A pending/failed browser PUT must never let the assistant take the first position.
    // Nested appends join this transaction and retain the conversation lock through both
    // writes, so either arrival order of the idempotent PUT yields user then assistant.
    const saved = await history.appendMessage({ conversationId: required.conversationId, message: userMessage });
    if (!saved || saved.role !== "user") throw new Error("Accepted user message could not be persisted");
  }

  /** @returns false when the answer id collides and no question was written. */
  async function appendQueuedAnswer(
    { history, required, hasQuestion }: { history: ChatStore; required: Parameters<DurableRunStore["accept"]>[0]; hasQuestion: boolean }, _options = {},
  ): Promise<boolean> {
    const message: ChatMessage = { id: required.messageId, role: "assistant", content: "", events: [],
      runId: required.runId, runStatus: "queued", createdAt: required.now, startedAt: required.now,
      ...(required.request.agentId ? { agentId: required.request.agentId } : {}) };
    const savedMessage = await history.appendMessage({ conversationId: required.conversationId, message });
    if (savedMessage?.role === "assistant") return true;
    // Returning null here would commit the question alone after an ID collision.
    if (hasQuestion) throw new Error("Accepted assistant message could not be persisted");
    return false;
  }

  async function accept(required: Parameters<DurableRunStore["accept"]>[0], _options = {}): Promise<DurableRun | null> {
    return kernel.transaction(async () => {
      const history = await lockOwnedConversation({ required });
      if (!history) return null;
      const existing = await load({ messageId: required.messageId }, {});
      if (existing) return sameOwner({ run: existing, required }) ? existing : null;
      await assertSlotFree({ conversationId: required.conversationId });
      const userMessage = acceptedUserMessage({ request: required.request, now: required.now }, {});
      if (userMessage) await appendAcceptedQuestion({ history, required, userMessage });
      if (!await appendQueuedAnswer({ history, required, hasQuestion: userMessage !== null })) return null;
      await kernel.run((db) => db.insertInto("assistant_run_attempts").values({
        message_id: required.messageId, engine: "daemon", accepted_json: JSON.stringify(required.request),
        recovery_count: 0, recovery_deadline: null, last_progress_at: required.now, cancel_reason: null,
        recovery_elapsed_ms: 0, attempt_started_at: required.now,
        session_id: null, session_confirmed: 0, child_pid: null, child_started_at: null, attempt_base_json: "[]",
      }).execute());
      return load({ messageId: required.messageId }, {});
    });
  }

  async function writeAttemptMetadata({ values, updates }: {
    values: Insertable<ChatDatabase["assistant_run_attempts"]>;
    updates: Updateable<ChatDatabase["assistant_run_attempts"]>;
  }): Promise<void> {
    await kernel.run(db => db.insertInto("assistant_run_attempts").values(values)
      .onConflict(oc => oc.column("message_id").doUpdateSet(updates)).execute());
  }

  async function advance({ run, nextRunId, now, events }: Parameters<DurableRunStore["advance"]>[0], _options = {}): Promise<boolean> {
    return kernel.transaction(async () => {
      await kernel.lockKey(runLockKey(run));
      // The projection rebase needs this run's events, never the rest of its conversation.
      const current = (await lockedRead(run, { events: true }))?.head;
      if (!current || current.cancelReason || current.runId !== run.runId) return false;
      const projection = continuationEvents({ current, incoming: events }, {});
      const result = await kernel.run((db) => db.updateTable("ai_chat_messages")
        .set({ run_id: nextRunId, run_status: "queued", content: runContentFromEvents({ events: projection }), events_json: JSON.stringify(projection) })
        .where("id", "=", run.messageId).where("run_id", "=", run.runId)
        .where("run_status", "in", ["queued", "running"]).executeTakeFirst());
      if (Number(result.numUpdatedRows) === 0) return false;
      await writeAttemptMetadata({ values: {
        message_id: run.messageId, engine: run.engine, accepted_json: JSON.stringify(run.request),
        recovery_count: current.recoveryCount + 1, recovery_deadline: current.recoveryDeadline ?? now + RECOVERY_WINDOW_MS,
        recovery_elapsed_ms: 0, attempt_started_at: now,
        last_progress_at: current.lastProgressAt, cancel_reason: null, session_id: null,
        session_confirmed: 0, child_pid: null, child_started_at: null, attempt_base_json: JSON.stringify(projection),
      }, updates: {
        recovery_count: current.recoveryCount + 1, recovery_deadline: current.recoveryDeadline ?? now + RECOVERY_WINDOW_MS,
        attempt_started_at: now,
        session_id: null, session_confirmed: 0, child_pid: null, child_started_at: null, attempt_base_json: JSON.stringify(projection),
      } });
      return true;
    });
  }

  /** Probe without the run lock, take it, then read: a run deleted or advanced in the gap reads as gone.
   * One read under the lock serves the whole operation; the unlocked probe only names the lock.
   * @returns The run as of the lock, or null when the attempt id is unknown or no longer current. */
  async function lockedRun({ runId }: { runId: string }, options: ReadOptions = {}): Promise<DurableRunHead | null> {
    const probe = await probeRun({ runId });
    if (!probe) return null;
    await kernel.lockKey(runLockKey({ messageId: probe.id, conversationId: probe.conversation_id, runId }));
    return (await readRun({ match: { column: "ai_chat_messages.run_id", value: runId } }, options))?.head ?? null;
  }

  async function cancel({ runId, reason }: Parameters<DurableRunStore["cancel"]>[0], _options = {}): Promise<void> {
    await kernel.transaction(async () => {
      const run = await lockedRun({ runId });
      if (!run) return;
      await writeAttemptMetadata({ values: { ...metadataForRun({ run }, {}), cancel_reason: reason }, updates: { cancel_reason: reason } });
    });
  }

  async function cancelPending(required: Parameters<DurableRunStore["cancelPending"]>[0], _options = {}): Promise<DurableRun | null> {
    return kernel.transaction(async () => {
      const history = await lockOwnedConversation({ required });
      if (!history) return null;
      const existing = await load({ messageId: required.messageId }, {});
      if (existing) {
        if (!sameOwner({ run: existing, required })) return null;
        await cancel({ runId: existing.runId, reason: "user-stop" }, {}); return load({ messageId: existing.messageId }, {});
      }
      // Stop may beat acceptance or its response. A terminal tombstone for the same logical
      // identity makes any later duplicate acceptance a no-op, without reserving the chat slot.
      await history.appendMessage({ conversationId: required.conversationId, message: { id: required.messageId, role: "assistant", content: "",
        events: [{ kind: "status", label: "Stopped." }], runId: required.runId, runStatus: "canceled", createdAt: required.now, endedAt: required.now } });
      return load({ messageId: required.messageId }, {});
    });
  }

  async function saveAgentSession({ run, sessionId }: { run: DurableRunHead; sessionId: string }): Promise<void> {
    await kernel.run((db) => db.insertInto("assistant_agent_sessions").values({ conversation_id: run.conversationId,
      agent_id: run.request.agentId ?? "claude", session_id: sessionId, updated_at: Date.now() })
      .onConflict((oc) => oc.columns(["conversation_id", "agent_id"]).doUpdateSet({ session_id: sessionId, updated_at: Date.now() })).execute());
  }

  async function captureSession({ runId, sessionId, child, confirmed = true }: Parameters<DurableRunStore["captureSession"]>[0], _options = {}): Promise<boolean> {
    return kernel.transaction(async () => {
      const run = await lockedRun({ runId });
      if (!run || !attemptCanExecute({ run }, {})) return false;
      const fields = { session_id: sessionId, session_confirmed: confirmed ? 1 : 0, ...(child ? { child_pid: child.pid, child_started_at: child.startedAt } : {}) };
      await writeAttemptMetadata({ values: { ...metadataForRun({ run }, {}), ...fields }, updates: fields });
      // Session and generation share the same lock/transaction; an old callback cannot write
      // the conversation's locator in the gap between a successful guard and a later CAS.
      await saveAgentSession({ run, sessionId });
      return true;
    });
  }

  async function clearSession({ runId, sessionId }: Parameters<DurableRunStore["clearSession"]>[0], _options = {}): Promise<void> {
    await kernel.transaction(async () => {
      const run = await lockedRun({ runId });
      if (!run) return;
      await kernel.run((db) => db.deleteFrom("assistant_agent_sessions").where("conversation_id", "=", run.conversationId)
        .where("agent_id", "=", run.request.agentId ?? "claude").where("session_id", "=", sessionId).execute());
      await kernel.run((db) => db.updateTable("assistant_run_attempts").set({ session_id: null, session_confirmed: 0 })
        .where("message_id", "=", run.messageId).where("session_id", "=", sessionId).execute());
    });
  }

  async function guardTool(required: Parameters<DurableRunStore["guardTool"]>[0], _options = {}): Promise<"allowed" | "unknown" | "stale"> {
    return kernel.transaction(async () => {
      // The unknown-call check needs this run's saved events (one row), never other messages'.
      const run = await lockedRun({ runId: required.runId }, { events: true });
      if (!run || !attemptCanExecute({ run }, {})) return "stale";
      const events = run.message.events ?? [];
      const canonical = events.filter((event) => event.kind !== "tool_use" || event.name === required.toolId);
      if (hasUnknownToolCall({ ...required, events: run.attemptBase }, {}) || hasUnknownToolCall({ ...required, events: canonical }, {})) return "unknown";
      if (required.toolUseId) await writeToolEvent(run, { kind: "tool_use", id: required.toolUseId, name: required.toolId, input: required.input });
      return "allowed";
    });
  }

  async function writeToolEvent(run: DurableRunHead, event: AgentEvent): Promise<void> {
    await kernel.run((db) => db.updateTable("ai_chat_messages").set({ events_json: appendedEventsJson({ event }) })
      .where("id", "=", run.messageId).where("run_id", "=", run.runId).where("run_status", "in", ["queued", "running"]).execute());
    await kernel.run((db) => db.updateTable("assistant_run_attempts")
      .set({ recovery_count: 0, recovery_deadline: null, recovery_elapsed_ms: 0, last_progress_at: Date.now() })
      .where("message_id", "=", run.messageId).execute());
  }

  async function completeTool({ runId, toolUseId, content }: Parameters<DurableRunStore["completeTool"]>[0], _options = {}): Promise<void> {
    await kernel.transaction(async () => {
      const run = await lockedRun({ runId });
      if (run) await writeToolEvent(run, { kind: "tool_result", toolUseId, content, isError: false });
    });
  }

  async function recoveryClock({ runId, now, active }: Parameters<DurableRunStore["recoveryClock"]>[0], _options = {}): Promise<void> {
    await kernel.transaction(async () => {
      const run = await lockedRun({ runId });
      if (!run) return;
      const row = await kernel.run((db) => db.selectFrom("assistant_run_attempts").selectAll().where("message_id", "=", run.messageId).executeTakeFirst())
        ?? metadataForRun({ run }, {});
      let deadline = row.recovery_deadline;
      let elapsed = row.recovery_elapsed_ms;
      if (active && deadline === null) deadline = now + Math.max(0, RECOVERY_WINDOW_MS - elapsed);
      if (!active && deadline !== null) { elapsed = Math.max(0, RECOVERY_WINDOW_MS - (deadline - now)); deadline = null; }
      await writeAttemptMetadata({ values: { ...row, recovery_deadline: deadline, recovery_elapsed_ms: elapsed }, updates: { recovery_deadline: deadline, recovery_elapsed_ms: elapsed } });
    });
  }

  return { load, find, accept, advance, cancel, cancelPending, captureSession, clearSession, guardTool, completeTool, recoveryClock };
}
