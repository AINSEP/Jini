import type { RunIdPolicy } from "../../core/durable-runs/ports.js";
import { recoveredRunEvents, type AgentEvent, type ChatMessage } from "../../core/index.js";
import type { ChatKernel, ChatDatabase } from "./kernel.js";
import { chatKernelTables } from "../sql/boundary.js";
import type { Selectable } from "kysely";
import { hasUnknownToolCall, CONTINUATION_DIVIDER } from "../../core/durable-runs/continuation.js";
import { RECOVERY_WINDOW_MS } from "../../core/durable-runs/policies.js";
import type { DurableRun, DurableRunStore } from "../../core/durable-runs/ports.js";
import { createChatHistoryStore } from "./chat-history-store.js";
import { runLockKey } from "../../core/durable-runs/run-lock.js";
import { runContentFromEvents } from "../../core/run-events/entry.js";

export const RUN_SLOT_BUSY = "Another answer in this chat is still running. This turn is queued in your browser.";
export class RunSlotBusyError extends Error { constructor() { super(RUN_SLOT_BUSY); } }

type RunRow = Selectable<ChatDatabase["ai_chat_messages"]> & { owner_id: string; owner_kind: string; scope_id: string };
type Metadata = ChatDatabase["assistant_run_attempts"] | undefined;

function acceptedUserMessage(
  { request, now }: { request: DurableRun["request"]; now: number }, _optional = {},
): ChatMessage | null {
  const context = JSON.parse(request.contextRef) as { userMessage?: ChatMessage };
  // Older clients supplied only a prompt; never invent a user identity from that transcript.
  const message = context.userMessage;
  if (message === undefined) return null;
  if (!message || typeof message.id !== "string" || !message.id || message.role !== "user" || typeof message.content !== "string"
    || (message.createdAt !== undefined && !Number.isFinite(message.createdAt))) throw new Error("Invalid accepted user message");
  if (message.attachments !== undefined && (!Array.isArray(message.attachments) || !message.attachments.every((attachment) =>
    attachment && typeof attachment.path === "string" && typeof attachment.name === "string"
    && (attachment.kind === "file" || attachment.kind === "image")))) throw new Error("Invalid accepted user attachments");
  // User input cannot claim an assistant run's status/events. Keep the same identity and payload
  // as its browser PUT, including the original clock and attachment order.
  return { id: message.id, role: "user", content: message.content, createdAt: message.createdAt ?? now,
    ...(message.attachments ? { attachments: message.attachments } : {}) };
}

function recoveryFields({ row, metadata }: { row: RunRow; metadata: Metadata }, _optional = {}) {
  return { recoveryCount: metadata?.recovery_count ?? 0, recoveryDeadline: metadata?.recovery_deadline ?? null,
    attemptStartedAt: metadata?.attempt_started_at ?? 0, lastProgressAt: metadata?.last_progress_at ?? row.started_at ?? row.created_at,
    cancelReason: metadata?.cancel_reason ?? null };
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

function metadataForRun({ run }: { run: DurableRun }, _optional = {}) {
  return { message_id: run.messageId, engine: run.engine, accepted_json: JSON.stringify(run.request),
    recovery_count: run.recoveryCount, recovery_deadline: run.recoveryDeadline, recovery_elapsed_ms: 0,
    attempt_started_at: run.attemptStartedAt, last_progress_at: run.lastProgressAt,
    cancel_reason: run.cancelReason, session_id: run.sessionId, session_confirmed: run.sessionConfirmed ? 1 : 0,
    child_pid: null, child_started_at: null, attempt_base_json: JSON.stringify(run.attemptBase) };
}

export function attemptCanExecute({ run }: { run: DurableRun | null }, _optional = {}): boolean {
  return Boolean(run && !run.cancelReason && ["queued", "running"].includes(run.message.runStatus ?? ""));
}

export function savedRunEvents({ json }: { json: string | null }, _optional = {}): AgentEvent[] {
  try { const value: unknown = JSON.parse(json ?? "[]"); return Array.isArray(value) ? value as AgentEvent[] : []; }
  catch { return []; }
}

function continuationEvents(
  { current, incoming }: { current: DurableRun; incoming: readonly AgentEvent[] }, _optional = {},
): readonly AgentEvent[] {
  let separator = -1;
  // Scan backward to keep the latest separator without requiring ES2023 array methods.
  for (let index = incoming.length - 1; index >= 0; index--) {
    const event = incoming[index]!;
    if (event.kind === "text" && event.text === CONTINUATION_DIVIDER) { separator = index; break; }
  }
  const saved = [...(current.message.events ?? [])];
  if (!saved.some((event) => event.kind === "text") && current.message.content) saved.unshift({ kind: "text", text: current.message.content });
  // A trailing checkpoint/tool barrier may land after the recovery probe but before its CAS.
  // Build the continuation segment from the projection inside the transaction, never that probe.
  if (separator >= 0) return [...saved, ...incoming.slice(separator)];
  // Empty startup retries have a recovery marker but no divider. Rebase their saved work under
  // the same lock too: a checkpoint may have arrived since the recovery probe.
  let marker = -1;
  for (let index = incoming.length - 1; index >= 0; index--) {
    const event = incoming[index]!;
    if (event.kind === "status" && event.code === "run_recovering") { marker = index; break; }
  }
  if (marker >= 0) {
    const event = incoming[marker]!;
    const notice = event.kind === 'status' && event.label === '' ? 'silent' : 'visible';
    return [...recoveredRunEvents({ saved }, { notice }), ...incoming.slice(marker + 1)];
  }
  return runContentFromEvents({ events: incoming }).length >= current.message.content.length ? incoming : saved;
}

/** Same kernel and message lock as checkpoint/settle. Claim changes run_id before any spawn;
 * old attempts cannot write projections or dispatch tools after that transaction commits. */
export function createDurableRunStore<DB extends ChatDatabase>({ kernel: hostKernel, isDaemonRunId }: { kernel: ChatKernel<DB>; isDaemonRunId: RunIdPolicy }, _optional = {}): DurableRunStore {
  const kernel = chatKernelTables<DB, ChatDatabase>({ kernel: hostKernel }, {});
  async function loadSnapshot({ messageId }: { messageId: string }, _options = {}): Promise<DurableRun | null> {
    const row = await kernel.run((db) => db.selectFrom("ai_chat_messages")
      .innerJoin("ai_chats", "ai_chats.id", "ai_chat_messages.conversation_id")
      .selectAll("ai_chat_messages").select(["owner_kind", "owner_id", "scope_id"])
      .where("ai_chat_messages.id", "=", messageId).where("role", "=", "assistant").executeTakeFirst());
    if (!row || !row.run_id) return null;
    const metadata = await kernel.run((db) => db.selectFrom("assistant_run_attempts").selectAll().where("message_id", "=", messageId).executeTakeFirst());
    const history = createChatHistoryStore({ kernel, isDaemonRunId, scope: { scopeId: row.scope_id, ownerKind: row.owner_kind as "user" | "guest", ownerId: row.owner_id } }, {});
    const transcript = await history.messages({ conversationId: row.conversation_id });
    const message = transcript.find((item) => item.id === messageId);
    if (!message) return null; // Deletion may have cascaded between the two reads.
    const request = acceptedRequest({ row, metadata, transcript }, {});
    return {
      messageId, conversationId: row.conversation_id, runId: row.run_id,
      workspaceId: row.scope_id,
      principalId: row.owner_kind === "user" ? row.owner_id : null,
      engine: metadata?.engine ?? (isDaemonRunId({ runId: row.run_id }) ? "daemon" : "request"), message, transcript, request,
      ...recoveryFields({ row, metadata }, {}), ...sessionFields({ metadata }, {}),
    };
  }

  async function load({ messageId }: { messageId: string }, _options = {}): Promise<DurableRun | null> {
    const binding = await kernel.run((db) => db.selectFrom("ai_chat_messages").select("conversation_id")
      .where("id", "=", messageId).executeTakeFirst());
    if (!binding) return null;
    return kernel.transaction(async () => {
      // Message, attempt metadata and transcript must describe the same generation. A CAS in
      // the gap between independent reads must never pair a new projection with an old session.
      await kernel.lockKey(runLockKey({ messageId, conversationId: binding.conversation_id, runId: "" }));
      return loadSnapshot({ messageId }, {});
    });
  }

  async function find({ runId, principalId }: { runId: string; principalId?: string }, _options = {}): Promise<DurableRun | null> {
    const row = await kernel.run((db) => db.selectFrom("ai_chat_messages").select("id").where("run_id", "=", runId).where("role", "=", "assistant").executeTakeFirst());
    if (!row) return null;
    const run = await load({ messageId: row.id }, {});
    return principalId !== undefined && run?.principalId !== principalId ? null : run;
  }

  async function accept(required: Parameters<DurableRunStore["accept"]>[0], _options = {}): Promise<DurableRun | null> {
    return kernel.transaction(async () => {
      await kernel.lockKey(`chat-slot:${required.conversationId}`);
      await kernel.lockKey(runLockKey(required));
      const history = createChatHistoryStore({ kernel, isDaemonRunId, scope: { scopeId: required.workspaceId, ownerKind: "user", ownerId: required.principalId } }, {});
      if (!await history.get({ id: required.conversationId })) return null;
      const existing = await load({ messageId: required.messageId }, {});
      if (existing) return existing.principalId === required.principalId && existing.conversationId === required.conversationId ? existing : null;
      const occupied = await kernel.run((db) => db.selectFrom("ai_chat_messages").select("id")
        .where("conversation_id", "=", required.conversationId).where("role", "=", "assistant")
        .where("run_status", "in", ["queued", "running"]).executeTakeFirst());
      if (occupied) throw new RunSlotBusyError();
      const userMessage = acceptedUserMessage({ request: required.request, now: required.now }, {});
      if (userMessage) {
        if (userMessage.id === required.messageId) throw new Error("User and assistant messages must have different IDs");
        // A pending/failed browser PUT must never let the assistant take the first position.
        // Nested appends join this transaction and retain the conversation lock through both
        // writes, so either arrival order of the idempotent PUT yields user then assistant.
        const saved = await history.appendMessage({ conversationId: required.conversationId, message: userMessage });
        if (!saved || saved.role !== "user") throw new Error("Accepted user message could not be persisted");
      }
      const message: ChatMessage = { id: required.messageId, role: "assistant", content: "", events: [],
        runId: required.runId, runStatus: "queued", createdAt: required.now, startedAt: required.now,
        ...(required.request.agentId ? { agentId: required.request.agentId } : {}) };
      const savedMessage = await history.appendMessage({ conversationId: required.conversationId, message });
      if (!savedMessage || savedMessage.role !== "assistant") {
        // Returning null here would commit the question alone after an ID collision.
        if (userMessage) throw new Error("Accepted assistant message could not be persisted");
        return null;
      }
      await kernel.run((db) => db.insertInto("assistant_run_attempts").values({
        message_id: required.messageId, engine: "daemon", accepted_json: JSON.stringify(required.request),
        recovery_count: 0, recovery_deadline: null, last_progress_at: required.now, cancel_reason: null,
        recovery_elapsed_ms: 0, attempt_started_at: required.now,
        session_id: null, session_confirmed: 0, child_pid: null, child_started_at: null, attempt_base_json: "[]",
      }).execute());
      return load({ messageId: required.messageId }, {});
    });
  }

  async function advance({ run, nextRunId, now, events }: Parameters<DurableRunStore["advance"]>[0], _options = {}): Promise<boolean> {
    return kernel.transaction(async () => {
      await kernel.lockKey(runLockKey(run));
      const current = await load({ messageId: run.messageId }, {});
      if (!current || current.cancelReason || current.runId !== run.runId) return false;
      const projection = continuationEvents({ current, incoming: events }, {});
      const result = await kernel.run((db) => db.updateTable("ai_chat_messages")
        .set({ run_id: nextRunId, run_status: "queued", content: runContentFromEvents({ events: projection }), events_json: JSON.stringify(projection) })
        .where("id", "=", run.messageId).where("run_id", "=", run.runId)
        .where("run_status", "in", ["queued", "running"]).executeTakeFirst());
      if (Number(result.numUpdatedRows) === 0) return false;
      await kernel.run((db) => db.insertInto("assistant_run_attempts").values({
        message_id: run.messageId, engine: run.engine, accepted_json: JSON.stringify(run.request),
        recovery_count: current.recoveryCount + 1, recovery_deadline: current.recoveryDeadline ?? now + RECOVERY_WINDOW_MS,
        recovery_elapsed_ms: 0, attempt_started_at: now,
        last_progress_at: current.lastProgressAt, cancel_reason: null, session_id: null,
        session_confirmed: 0, child_pid: null, child_started_at: null, attempt_base_json: JSON.stringify(projection),
      }).onConflict((oc) => oc.column("message_id").doUpdateSet({
        recovery_count: current.recoveryCount + 1, recovery_deadline: current.recoveryDeadline ?? now + RECOVERY_WINDOW_MS,
        attempt_started_at: now,
        session_id: null, session_confirmed: 0, child_pid: null, child_started_at: null, attempt_base_json: JSON.stringify(projection),
      })).execute());
      return true;
    });
  }

  async function cancel({ runId, reason }: Parameters<DurableRunStore["cancel"]>[0], _options = {}): Promise<void> {
    await kernel.transaction(async () => {
      const run = await find({ runId }, {});
      if (!run) return;
      await kernel.lockKey(runLockKey(run));
      if (!await find({ runId }, {})) return;
      await kernel.run((db) => db.insertInto("assistant_run_attempts").values({ ...metadataForRun({ run }, {}), cancel_reason: reason })
        .onConflict((oc) => oc.column("message_id").doUpdateSet({ cancel_reason: reason })).execute());
    });
  }

  async function cancelPending(required: Parameters<DurableRunStore["cancelPending"]>[0], _options = {}): Promise<DurableRun | null> {
    return kernel.transaction(async () => {
      await kernel.lockKey(`chat-slot:${required.conversationId}`);
      await kernel.lockKey(runLockKey(required));
      const history = createChatHistoryStore({ kernel, isDaemonRunId, scope: { scopeId: required.workspaceId, ownerKind: "user", ownerId: required.principalId } }, {});
      if (!await history.get({ id: required.conversationId })) return null;
      const existing = await load({ messageId: required.messageId }, {});
      if (existing) {
        if (existing.principalId !== required.principalId || existing.conversationId !== required.conversationId) return null;
        await cancel({ runId: existing.runId, reason: "user-stop" }, {}); return load({ messageId: existing.messageId }, {});
      }
      // Stop may beat acceptance or its response. A terminal tombstone for the same logical
      // identity makes any later duplicate acceptance a no-op, without reserving the chat slot.
      await history.appendMessage({ conversationId: required.conversationId, message: { id: required.messageId, role: "assistant", content: "",
        events: [{ kind: "status", label: "Stopped." }], runId: required.runId, runStatus: "canceled", createdAt: required.now, endedAt: required.now } });
      return load({ messageId: required.messageId }, {});
    });
  }

  async function captureSession({ runId, sessionId, child, confirmed = true }: Parameters<DurableRunStore["captureSession"]>[0], _options = {}): Promise<boolean> {
    return kernel.transaction(async () => {
      const run = await find({ runId }, {});
      if (!run) return false;
      await kernel.lockKey(runLockKey(run));
      const current = await find({ runId }, {});
      if (!attemptCanExecute({ run: current }, {}) || !current) return false;
      const fields = { session_id: sessionId, session_confirmed: confirmed ? 1 : 0, ...(child ? { child_pid: child.pid, child_started_at: child.startedAt } : {}) };
      await kernel.run((db) => db.insertInto("assistant_run_attempts").values({ ...metadataForRun({ run: current }, {}), ...fields })
        .onConflict((oc) => oc.column("message_id").doUpdateSet(fields)).execute());
      // Session and generation share the same lock/transaction; an old callback cannot write
      // the conversation's locator in the gap between a successful guard and a later CAS.
      await kernel.run((db) => db.insertInto("assistant_agent_sessions").values({ conversation_id: run.conversationId,
        agent_id: run.request.agentId ?? "claude", session_id: sessionId, updated_at: Date.now() })
        .onConflict((oc) => oc.columns(["conversation_id", "agent_id"]).doUpdateSet({ session_id: sessionId, updated_at: Date.now() })).execute());
      return true;
    });
  }

  async function clearSession({ runId, sessionId }: Parameters<DurableRunStore["clearSession"]>[0], _options = {}): Promise<void> {
    await kernel.transaction(async () => {
      const before = await find({ runId }, {});
      if (!before) return;
      await kernel.lockKey(runLockKey(before));
      const run = await find({ runId }, {});
      if (!run) return;
      await kernel.run((db) => db.deleteFrom("assistant_agent_sessions").where("conversation_id", "=", run.conversationId)
        .where("agent_id", "=", run.request.agentId ?? "claude").where("session_id", "=", sessionId).execute());
      await kernel.run((db) => db.updateTable("assistant_run_attempts").set({ session_id: null, session_confirmed: 0 })
        .where("message_id", "=", run.messageId).where("session_id", "=", sessionId).execute());
    });
  }

  async function guardTool(required: Parameters<DurableRunStore["guardTool"]>[0], _options = {}): Promise<"allowed" | "unknown" | "stale"> {
    return kernel.transaction(async () => {
      const before = await find({ runId: required.runId }, {});
      if (!before) return "stale";
      await kernel.lockKey(runLockKey(before));
      const run = await find({ runId: required.runId }, {});
      if (!attemptCanExecute({ run }, {})) return "stale";
      if (!run) return "stale";
      const events = run.message.events ?? [];
      const canonical = events.filter((event) => event.kind !== "tool_use" || event.name === required.toolId);
      if (hasUnknownToolCall({ ...required, events: run.attemptBase }, {}) || hasUnknownToolCall({ ...required, events: canonical }, {})) return "unknown";
      if (required.toolUseId) await writeToolEvent(run, { kind: "tool_use", id: required.toolUseId, name: required.toolId, input: required.input });
      return "allowed";
    });
  }

  async function writeToolEvent(run: DurableRun, event: AgentEvent): Promise<void> {
    await kernel.run((db) => db.updateTable("ai_chat_messages").set({ events_json: JSON.stringify([...(run.message.events ?? []), event]) })
      .where("id", "=", run.messageId).where("run_id", "=", run.runId).where("run_status", "in", ["queued", "running"]).execute());
    await kernel.run((db) => db.updateTable("assistant_run_attempts")
      .set({ recovery_count: 0, recovery_deadline: null, recovery_elapsed_ms: 0, last_progress_at: Date.now() })
      .where("message_id", "=", run.messageId).execute());
  }

  async function completeTool({ runId, toolUseId, content }: Parameters<DurableRunStore["completeTool"]>[0], _options = {}): Promise<void> {
    await kernel.transaction(async () => {
      const before = await find({ runId }, {});
      if (!before) return;
      await kernel.lockKey(runLockKey(before));
      const run = await find({ runId }, {});
      if (run) await writeToolEvent(run, { kind: "tool_result", toolUseId, content, isError: false });
    });
  }

  async function recoveryClock({ runId, now, active }: Parameters<DurableRunStore["recoveryClock"]>[0], _options = {}): Promise<void> {
    await kernel.transaction(async () => {
      const run = await find({ runId }, {});
      if (!run) return;
      await kernel.lockKey(runLockKey(run));
      if (!await find({ runId }, {})) return;
      const row = await kernel.run((db) => db.selectFrom("assistant_run_attempts").selectAll().where("message_id", "=", run.messageId).executeTakeFirst())
        ?? metadataForRun({ run }, {});
      let deadline = row.recovery_deadline;
      let elapsed = row.recovery_elapsed_ms;
      if (active && deadline === null) deadline = now + Math.max(0, RECOVERY_WINDOW_MS - elapsed);
      if (!active && deadline !== null) { elapsed = Math.max(0, RECOVERY_WINDOW_MS - (deadline - now)); deadline = null; }
      await kernel.run((db) => db.insertInto("assistant_run_attempts").values({ ...row, recovery_deadline: deadline, recovery_elapsed_ms: elapsed })
        .onConflict((oc) => oc.column("message_id").doUpdateSet({ recovery_deadline: deadline, recovery_elapsed_ms: elapsed })).execute());
    });
  }

  return { load, find, accept, advance, cancel, cancelPending, captureSession, clearSession, guardTool, completeTool, recoveryClock };
}
