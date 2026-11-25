import { acceptedInputEvent, acceptedInputUserEvent } from "../../core/accepted-input.js";
import { redactUserMessage, redactUserText } from "../../core/user-text-redaction.js";
import type { RunIdPolicy } from "../../core/durable-runs/ports.js";
import { recoveredRunEvents, type ChatMessage } from "../../core/index.js";
import type { ChatKernel, ChatDatabase } from "./kernel.js";
import {
  casAdvanceProjection, conversationTranscript, deleteSession, insertAttempt, pollProjection, probeRun, saveAgentSession,
  selectAttempt, selectBinding, selectRunRow, slotOccupied, writeAttemptMetadata, writeToolEvent,
  type Metadata, type ReadOptions, type RunKernel, type RunMatch, type RunRow,
} from "./durable-run-queries.js";
import { chatKernelTables } from "../sql/boundary.js";
import { hasUnknownToolCall, CONTINUATION_DIVIDER } from "../../core/durable-runs/continuation.js";
import { RECOVERY_WINDOW_MS } from "../../core/durable-runs/policies.js";
import type { DurableRun, DurableRunHead, DurableRunStore } from "../../core/durable-runs/ports.js";
import type { RunRef } from "../../core/durable-runs/ledger-contracts.js";
import type { ChatStore } from "../ports.js";
import { createChatHistoryStore } from "./chat-history-store.js";
import { runLockKey } from "../../core/durable-runs/run-lock.js";
import { runContentFromEvents } from "../../core/run-events/entry.js";
import { toMessage } from "../sql/store.js";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

export const RUN_SLOT_BUSY = "Another answer in this chat is still running. This turn is queued in your browser.";
export class RunSlotBusyError extends Error { constructor() { super(RUN_SLOT_BUSY); } }

function isAcceptedUserShape({ message }: { message: ChatMessage }, _optional = {}): boolean {
  if (!message || typeof message.id !== "string" || !message.id) return false;
  if (message.role !== "user" || typeof message.content !== "string") return false;
  return message.createdAt === undefined || Number.isFinite(message.createdAt);
}

/** Directory existence is host policy; the neutral store validates only its message contract. */
function validAcceptedFolders({ folders }: { folders: unknown }, _options = {}): boolean {
  return Array.isArray(folders) && folders.length <= 10 && folders.every(path => typeof path === 'string' && path.length > 0);
}

function areAcceptedAttachments({ attachments }: { attachments: unknown }, _optional = {}): boolean {
  return Array.isArray(attachments) && attachments.every((attachment) => {
    if (!attachment || typeof attachment.path !== "string" || typeof attachment.name !== "string") return false;
    return attachment.kind === "file" || attachment.kind === "image";
  });
}

/** Both top-level and queued user inputs obey the same reference contract. */
function validateAcceptedMetadata({ message }: { message: Pick<ChatMessage, 'folders' | 'attachments'> }, _options = {}): void {
  if (message.folders !== undefined && !validAcceptedFolders({ folders: message.folders })) throw new Error("Invalid accepted user folders");
  if (message.attachments !== undefined && !areAcceptedAttachments({ attachments: message.attachments }, {})) throw new Error("Invalid accepted user attachments");
}

/** Preserve only accepted user receipts; a browser cannot supply assistant lifecycle events.
 * Receipt text uses the same guard as ordinary user text; folder data remains byte-exact.
 */
function acceptedReceiptFields({ message }: { message: ChatMessage }, _options = {}): Pick<ChatMessage, 'events'> {
  if (!Array.isArray(message.events)) return {};
  const events = message.events.flatMap(event => {
    if (!event || typeof event !== 'object') return [];
    const input = acceptedInputEvent({ event })?.data;
    if (!input) return [];
    validateAcceptedMetadata({ message: input });
    const safe = redactUserMessage({ message: { role: 'user', content: input.text } }).message;
    return [acceptedInputUserEvent({ input: { ...input, text: safe.content } }, { receipt: 'accepted' })];
  });
  return events.length ? { events } : {};
}

function acceptedUserMessage(
  { request, now }: { request: DurableRun["request"]; now: number }, _optional = {},
): ChatMessage | null {
  const context = JSON.parse(request.contextRef) as { userMessage?: ChatMessage };
  // Older clients supplied only a prompt; never invent a user identity from that transcript.
  const message = context.userMessage;
  if (message === undefined) return null;
  if (!isAcceptedUserShape({ message }, {})) throw new Error("Invalid accepted user message");
  validateAcceptedMetadata({ message });
  // User input cannot claim assistant lifecycle events. Keep the same identity and payload
  // as its browser PUT, including the original clock and attachment order.
  return { id: message.id, role: "user", content: message.content, createdAt: message.createdAt ?? now,
    ...acceptedReceiptFields({ message }),
    ...(message.folders ? { folders: message.folders } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}) };
}

/** The request as it is stored for recovery and replay. The user row is masked when it is written; the request carries
 * the same text (the user message and the prompt built from it), so it is masked before it is serialized at all.
 * A request with nothing to mask is returned as it came. */
function maskedRequest({ request }: { request: DurableRun["request"] }, _optional = {}): DurableRun["request"] {
  const context = JSON.parse(request.contextRef) as { userMessage?: { content?: unknown }; prompt?: unknown };
  const mask = (text: unknown) => typeof text === "string" ? redactUserText({ text }) : null;
  const content = mask(context.userMessage?.content);
  const prompt = mask(context.prompt);
  if (!content?.secretRedacted && !prompt?.secretRedacted) return request;
  return { ...request, contextRef: JSON.stringify({ ...context,
    ...(content ? { userMessage: { ...context.userMessage, content: content.text } } : {}),
    ...(prompt ? { prompt: prompt.text } : {}) }) };
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

function sameOwner(
  { run, required }: { run: DurableRunHead; required: { principalId: string; conversationId: string } }, _optional = {},
): boolean {
  return run.principalId === required.principalId && run.conversationId === required.conversationId;
}

type Deps = { kernel: RunKernel; isDaemonRunId: RunIdPolicy };
/** A run read: its head, and the transcript only when that read loaded one. */
type RunRead = { head: DurableRunHead; transcript: readonly ChatMessage[] };
type Accept = Parameters<DurableRunStore["accept"]>[0];

/** The conversation locator and attempt fields one captured session writes. */
function capturedSessionFields(
  { sessionId, child, confirmed }: { sessionId: string; child: { pid: number; startedAt: string } | undefined; confirmed: boolean }, _optional = {},
) {
  return { session_id: sessionId, session_confirmed: confirmed ? 1 : 0, ...(child ? { child_pid: child.pid, child_started_at: child.startedAt } : {}) };
}

/** The attempt row a first acceptance stores; the request is masked before it is serialized. */
function acceptedAttemptRow({ required }: { required: Accept }, _optional = {}) {
  return {
    message_id: required.messageId, engine: "daemon", accepted_json: JSON.stringify(maskedRequest({ request: required.request }, {})),
    recovery_count: 0, recovery_deadline: null, last_progress_at: required.now, cancel_reason: null,
    recovery_elapsed_ms: 0, attempt_started_at: required.now,
    session_id: null, session_confirmed: 0, child_pid: null, child_started_at: null, attempt_base_json: "[]",
  };
}

/** Only a current, uncanceled attempt may move to its continuation. */
function mayAdvance({ current, run }: { current: DurableRunHead; run: DurableRunHead }, _optional = {}): boolean {
  return !current.cancelReason && current.runId === run.runId;
}

/** The attempt row a continuation stores: one more recovery, a window if none is open, and no session. */
function advancedAttempt(
  { run, current, now, projection }: { run: DurableRunHead; current: DurableRunHead; now: number; projection: readonly AgentEvent[] }, _optional = {},
) {
  const recoveryCount = current.recoveryCount + 1;
  const recoveryDeadline = current.recoveryDeadline ?? now + RECOVERY_WINDOW_MS;
  const reset = { session_id: null, session_confirmed: 0, child_pid: null, child_started_at: null, attempt_base_json: JSON.stringify(projection) };
  return {
    values: { message_id: run.messageId, engine: run.engine, accepted_json: JSON.stringify(run.request),
      recovery_count: recoveryCount, recovery_deadline: recoveryDeadline, recovery_elapsed_ms: 0, attempt_started_at: now,
      last_progress_at: current.lastProgressAt, cancel_reason: null, ...reset },
    updates: { recovery_count: recoveryCount, recovery_deadline: recoveryDeadline, attempt_started_at: now, ...reset },
  };
}

/** Whether a tool call may run now. The unknown-call check covers the attempt base and the canonical projection. */
function toolGuardVerdict(
  { run, required }: { run: DurableRunHead | null; required: Parameters<DurableRunStore["guardTool"]>[0] }, _optional = {},
): "allowed" | "unknown" | "stale" {
  if (!run || !attemptCanExecute({ run }, {})) return "stale";
  const events = run.message.events ?? [];
  const canonical = events.filter((event) => event.kind !== "tool_use" || event.name === required.toolId);
  if (hasUnknownToolCall({ ...required, events: run.attemptBase }, {}) || hasUnknownToolCall({ ...required, events: canonical }, {})) return "unknown";
  return "allowed";
}

/** The recovery window opened or paused by `active`, from the saved deadline and elapsed budget. */
function nextRecoveryClock(
  { row, now, active }: { row: { recovery_deadline: number | null; recovery_elapsed_ms: number }; now: number; active: boolean }, _optional = {},
) {
  let deadline = row.recovery_deadline;
  let elapsed = row.recovery_elapsed_ms;
  if (active && deadline === null) deadline = now + Math.max(0, RECOVERY_WINDOW_MS - elapsed);
  if (!active && deadline !== null) { elapsed = Math.max(0, RECOVERY_WINDOW_MS - (deadline - now)); deadline = null; }
  return { recovery_deadline: deadline, recovery_elapsed_ms: elapsed };
}

/** The terminal row a stop writes when it beats acceptance. */
function stopTombstone({ required }: { required: Parameters<DurableRunStore["cancelPending"]>[0] }, _optional = {}): ChatMessage {
  return { id: required.messageId, role: "assistant", content: "",
    events: [{ kind: "status", label: "Stopped." }], runId: required.runId, runStatus: "canceled", createdAt: required.now, endedAt: required.now };
}

/** Accepted user receipts split queued inputs and hold folder references. Keep that small
 * public metadata even when recovery omits prior assistant event payloads. */
function transcriptEventProjection(options: ReadOptions): boolean | "user" {
  if (options.includeTranscriptEvents === false && options.transcript) return 'user';
  return options.includeTranscriptEvents ?? options.transcript === true;
}

function currentMessage({ row, transcript }: { row: RunRow; transcript: readonly ChatMessage[] }, options: ReadOptions = {}): ChatMessage | undefined {
  return options.transcript && options.includeTranscriptEvents !== false
    ? transcript.find(item => item.id === row.id) : toMessage(row);
}

/** Legacy accepted requests and recovery reconstruction consume prior text only. */
async function readTranscript({ deps, row, metadata }: { deps: Deps; row: RunRow; metadata: Metadata }, options: ReadOptions = {}): Promise<ChatMessage[]> {
  if (!options.transcript && metadata) return [];
  const includeEvents = transcriptEventProjection(options);
  return conversationTranscript({ ...deps, row }, { includeEvents });
}

/** One run's head, plus its transcript when that was read (`[]` otherwise). */
async function readRun({ deps, match }: { deps: Deps; match: RunMatch }, options: ReadOptions = {}): Promise<RunRead | null> {
  const row = await selectRunRow({ kernel: deps.kernel, match }, options);
  if (!row || !row.run_id) return null;
  const messageId = row.id;
  const metadata = await selectAttempt({ kernel: deps.kernel, messageId });
  // A legacy row's accepted request is derived from its transcript, so only it reads one here.
  const transcript = await readTranscript({ deps, row, metadata }, options);
  const message = currentMessage({ row, transcript }, options);
  if (!message) return null; // Deletion may have cascaded between the two reads.
  return { head: runHead({ row, runId: row.run_id, metadata, message, transcript }, { isDaemonRunId: deps.isDaemonRunId }),
    transcript: transcript.map(item => item.id === messageId ? message : item) };
}

/** Locked read of one message; `transcript` decides whether it is a whole run or only its head. */
async function lockedRead(
  { deps, messageId, conversationId }: { deps: Deps; messageId: string; conversationId: string }, options: ReadOptions = {},
): Promise<RunRead | null> {
  return deps.kernel.transaction(async () => {
    // Message, attempt metadata and transcript must describe the same generation. A CAS in
    // the gap between independent reads must never pair a new projection with an old session.
    await deps.kernel.lockKey(runLockKey({ messageId, conversationId, runId: "" }));
    return readRun({ deps, match: { column: "ai_chat_messages.id", value: messageId } }, options);
  });
}

/** Probe without the run lock, take it, then read: a run deleted or advanced in the gap reads as gone.
 * One read under the lock serves the whole operation; the unlocked probe only names the lock.
 * @returns The run as of the lock, or null when the attempt id is unknown or no longer current. */
async function lockedRun({ deps, runId }: { deps: Deps; runId: string }, options: ReadOptions = {}): Promise<DurableRunHead | null> {
  const probe = await probeRun({ kernel: deps.kernel, runId });
  if (!probe) return null;
  await deps.kernel.lockKey(runLockKey({ messageId: probe.id, conversationId: probe.conversation_id, runId }));
  return (await readRun({ deps, match: { column: "ai_chat_messages.run_id", value: runId } }, options))?.head ?? null;
}

async function loadRun({ deps, messageId }: { deps: Deps; messageId: string }, { includeTranscriptEvents = true }: { includeTranscriptEvents?: boolean } = {}): Promise<DurableRun | null> {
  const binding = await selectBinding({ kernel: deps.kernel, messageId });
  if (!binding) return null;
  // Full reads take the message from the transcript. Lean reads select its own events once,
  // omitting prior assistant payloads while retaining accepted user receipts.
  const read = await lockedRead({ deps, messageId, conversationId: binding.conversation_id },
    { transcript: true, includeTranscriptEvents, events: !includeTranscriptEvents });
  return read && { ...read.head, transcript: read.transcript };
}

/** Single-message read; message identity survives continuation while run_id changes.
 * Legacy request reconstruction needs only transcript content, never its old event columns. */
async function headRun({ deps, messageId }: { deps: Deps; messageId: string }, { events = true }: { events?: boolean } = {}): Promise<DurableRunHead | null> {
  const binding = await selectBinding({ kernel: deps.kernel, messageId });
  if (!binding) return null;
  return (await lockedRead({ deps, messageId, conversationId: binding.conversation_id }, { events }))?.head ?? null;
}

async function findRun({ deps, runId, principalId }: { deps: Deps; runId: string; principalId?: string }): Promise<DurableRunHead | null> {
  const row = await probeRun({ kernel: deps.kernel, runId });
  if (!row) return null;
  const run = (await lockedRead({ deps, messageId: row.id, conversationId: row.conversation_id }, { events: true }))?.head ?? null;
  return principalId !== undefined && run?.principalId !== principalId ? null : run;
}

/** Slot and run locks, then the owner-scoped conversation; null when the caller does not own it. */
async function lockOwnedConversation(
  { deps, required }: { deps: Deps; required: RunRef & { principalId: string; workspaceId: string } }, _options = {},
): Promise<ChatStore | null> {
  const { kernel, isDaemonRunId } = deps;
  await kernel.lockKey(`chat-slot:${required.conversationId}`);
  await kernel.lockKey(runLockKey(required));
  const history = createChatHistoryStore({ kernel, isDaemonRunId, scope: { scopeId: required.workspaceId, ownerKind: "user", ownerId: required.principalId } }, {});
  return await history.get({ id: required.conversationId }) ? history : null;
}

async function appendAcceptedQuestion(
  { history, required, userMessage }: { history: ChatStore; required: Accept; userMessage: ChatMessage }, _options = {},
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
  { history, required, hasQuestion }: { history: ChatStore; required: Accept; hasQuestion: boolean }, _options = {},
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

async function acceptRun({ deps, required }: { deps: Deps; required: Accept }): Promise<DurableRun | null> {
  return deps.kernel.transaction(async () => {
    const history = await lockOwnedConversation({ deps, required });
    if (!history) return null;
    const existing = await loadRun({ deps, messageId: required.messageId }, { includeTranscriptEvents: false });
    if (existing) return sameOwner({ run: existing, required }) ? existing : null;
    if (await slotOccupied({ kernel: deps.kernel, conversationId: required.conversationId })) throw new RunSlotBusyError();
    const userMessage = acceptedUserMessage({ request: required.request, now: required.now }, {});
    if (userMessage) await appendAcceptedQuestion({ history, required, userMessage });
    if (!await appendQueuedAnswer({ history, required, hasQuestion: userMessage !== null })) return null;
    await insertAttempt({ kernel: deps.kernel, values: acceptedAttemptRow({ required }) });
    return loadRun({ deps, messageId: required.messageId }, { includeTranscriptEvents: false });
  });
}

async function advanceRun({ deps, args: { run, nextRunId, now, events } }: { deps: Deps; args: Parameters<DurableRunStore["advance"]>[0] }): Promise<boolean> {
  const { kernel } = deps;
  return kernel.transaction(async () => {
    await kernel.lockKey(runLockKey(run));
    // The projection rebase needs this run's events, never the rest of its conversation.
    const current = (await lockedRead({ deps, ...run }, { events: true }))?.head;
    if (!current || !mayAdvance({ current, run })) return false;
    const projection = continuationEvents({ current, incoming: events }, {});
    const content = runContentFromEvents({ events: projection });
    if (!await casAdvanceProjection({ kernel, run, nextRunId, content, projection })) return false;
    await writeAttemptMetadata({ kernel, ...advancedAttempt({ run, current, now, projection }) });
    return true;
  });
}

async function cancelRun({ deps, runId, reason }: { deps: Deps; runId: string; reason: string }): Promise<void> {
  await deps.kernel.transaction(async () => {
    const run = await lockedRun({ deps, runId });
    if (!run) return;
    await writeAttemptMetadata({ kernel: deps.kernel, values: { ...metadataForRun({ run }, {}), cancel_reason: reason }, updates: { cancel_reason: reason } });
  });
}

async function cancelPendingRun({ deps, required }: { deps: Deps; required: Parameters<DurableRunStore["cancelPending"]>[0] }): Promise<DurableRun | null> {
  return deps.kernel.transaction(async () => {
    const history = await lockOwnedConversation({ deps, required });
    if (!history) return null;
    const existing = await loadRun({ deps, messageId: required.messageId }, { includeTranscriptEvents: false });
    if (existing) {
      if (!sameOwner({ run: existing, required })) return null;
      await cancelRun({ deps, runId: existing.runId, reason: "user-stop" }); return loadRun({ deps, messageId: existing.messageId }, { includeTranscriptEvents: false });
    }
    // Stop may beat acceptance or its response. A terminal tombstone for the same logical
    // identity makes any later duplicate acceptance a no-op, without reserving the chat slot.
    await history.appendMessage({ conversationId: required.conversationId, message: stopTombstone({ required }) });
    return loadRun({ deps, messageId: required.messageId }, { includeTranscriptEvents: false });
  });
}

async function captureRunSession({ deps, args: { runId, sessionId, child, confirmed = true } }: { deps: Deps; args: Parameters<DurableRunStore["captureSession"]>[0] }): Promise<boolean> {
  const { kernel } = deps;
  return kernel.transaction(async () => {
    const run = await lockedRun({ deps, runId });
    if (!run || !attemptCanExecute({ run }, {})) return false;
    const fields = capturedSessionFields({ sessionId, child, confirmed });
    await writeAttemptMetadata({ kernel, values: { ...metadataForRun({ run }, {}), ...fields }, updates: fields });
    // Session and generation share the same lock/transaction; an old callback cannot write
    // the conversation's locator in the gap between a successful guard and a later CAS.
    await saveAgentSession({ kernel, run, sessionId });
    return true;
  });
}

async function clearRunSession({ deps, runId, sessionId }: { deps: Deps; runId: string; sessionId: string }): Promise<void> {
  await deps.kernel.transaction(async () => {
    const run = await lockedRun({ deps, runId });
    if (run) await deleteSession({ kernel: deps.kernel, run, sessionId });
  });
}

async function guardRunTool({ deps, required }: { deps: Deps; required: Parameters<DurableRunStore["guardTool"]>[0] }): Promise<"allowed" | "unknown" | "stale"> {
  return deps.kernel.transaction(async () => {
    // The unknown-call check needs this run's saved events (one row), never other messages'.
    const run = await lockedRun({ deps, runId: required.runId }, { events: true });
    const verdict = toolGuardVerdict({ run, required });
    if (verdict === "allowed" && run && required.toolUseId) {
      await writeToolEvent({ kernel: deps.kernel, run, event: { kind: "tool_use", id: required.toolUseId, name: required.toolId, input: required.input } });
    }
    return verdict;
  });
}

async function completeRunTool({ deps, args: { runId, toolUseId, content } }: { deps: Deps; args: Parameters<DurableRunStore["completeTool"]>[0] }): Promise<void> {
  await deps.kernel.transaction(async () => {
    const run = await lockedRun({ deps, runId });
    if (run) await writeToolEvent({ kernel: deps.kernel, run, event: { kind: "tool_result", toolUseId, content, isError: false } });
  });
}

async function runRecoveryClock({ deps, args: { runId, now, active } }: { deps: Deps; args: Parameters<DurableRunStore["recoveryClock"]>[0] }): Promise<void> {
  const { kernel } = deps;
  await kernel.transaction(async () => {
    const run = await lockedRun({ deps, runId });
    if (!run) return;
    const row = await selectAttempt({ kernel, messageId: run.messageId }) ?? metadataForRun({ run }, {});
    const clock = nextRecoveryClock({ row, now, active });
    await writeAttemptMetadata({ kernel, values: { ...row, ...clock }, updates: clock });
  });
}

/** Same kernel and message lock as checkpoint/settle. Claim changes run_id before any spawn;
 * old attempts cannot write projections or dispatch tools after that transaction commits. */
export function createDurableRunStore<DB extends ChatDatabase>({ kernel: hostKernel, isDaemonRunId }: { kernel: ChatKernel<DB>; isDaemonRunId: RunIdPolicy }, _optional = {}): DurableRunStore {
  const deps: Deps = { kernel: chatKernelTables<DB, ChatDatabase>({ kernel: hostKernel }, {}), isDaemonRunId };
  return {
    load: ({ messageId }, options) => loadRun({ deps, messageId }, options),
    head: ({ messageId }, options) => headRun({ deps, messageId }, options),
    poll: (required, options) => pollProjection({ kernel: deps.kernel, ...required }, options),
    find: (required) => findRun({ deps, ...required }),
    accept: (required) => acceptRun({ deps, required }),
    advance: (args) => advanceRun({ deps, args }),
    cancel: (required) => cancelRun({ deps, ...required }),
    cancelPending: (required) => cancelPendingRun({ deps, required }),
    captureSession: (args) => captureRunSession({ deps, args }),
    clearSession: (required) => clearRunSession({ deps, ...required }),
    guardTool: (required) => guardRunTool({ deps, required }),
    completeTool: (args) => completeRunTool({ deps, args }),
    recoveryClock: (args) => runRecoveryClock({ deps, args }),
  };
}
