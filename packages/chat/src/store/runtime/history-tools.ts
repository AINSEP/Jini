/** Model-facing history tools over an authenticated owner-scoped store; no database handles. */
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, ToolInputError,
  type AgentToolDefinition, type AgentToolSideEffect, type ToolExecutionContext, type ToolRegistration } from '@jini-ai/core';
import { listPageForModel, parseListPageRequest } from '@jini-ai/core/list-page';
import { redactUserText, type RedactUserText } from '../../core/user-text-redaction.js';
import type { ChatHistoryReader, ChatHistoryStore } from '../ports.js';
import { assistantHistoryToolMetadata } from '../../core/history-tool-metadata.js';
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

export const HISTORY_MESSAGE_CHAR_CAP = 8_000;
export const HISTORY_TOTAL_CHAR_CAP = 40_000;
const TOOL_EVENT_CAP = 50;

export const assistantHistoryDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map([
  ['assistant_chats_list', 'none'], ['assistant_chat_read', 'none'],
]);
/** Exported so host contract tests can pin each registration to its catalog entry. */
export const assistantHistoryToolCatalog = indexCatalogById<AgentToolDefinition>({ catalog: [
  { name: 'assistant_chats_list', sideEffects: 'none', authorization: { permission: 'admin.assistant.use' },
    description: "Lists the CURRENT user's own conversations on this site, newest first, optionally searching titles and message content. Returns id, title, updatedAt, messageCount and firstUserLine, with redacted, capped text. When the user refers to an earlier or interrupted chat ('continue what we were doing'), list first, then assistant_chat_read to read its tail, summarise the state and continue. No other user's chats are accessible; unavailable history is an error.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string', description: 'nextCursor from the previous call. Omit for the first page.' },
    } } },
  { name: 'assistant_chat_read', sideEffects: 'none', authorization: { permission: 'admin.assistant.use' },
    description: "Reads one of the CURRENT user's own chats in stored message order. Omit fromPosition to read the latest tail (default 50 messages); use fromPosition and nextPosition for forward pagination. List chats first when resuming earlier work, read the tail, summarise the state, then continue. Returns redacted messages, positions, continuation and truncated flags; each serialized message is capped at 8,000 characters and the result at 40,000 characters. Tool events, when requested, contain only tool name and outcome, never payloads. Attachments are omitted. Missing and other-user chats receive the same refusal.",
    inputSchema: { type: 'object', additionalProperties: false, required: ['chatId'], properties: {
      chatId: { type: 'string', minLength: 1, maxLength: 128 },
      fromPosition: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      includeToolEvents: { type: 'boolean', default: false },
    } } },
] });

/** Auth is resolved by the host using execution identity, never from model input. */
export interface AssistantHistoryToolPorts {
  getStore(required: { principalId: string }, optional?: Record<string, never>): Promise<ChatHistoryStore>;
}
interface ToolSummary { name: string; outcome: 'succeeded' | 'failed' | 'unknown' }
interface HistoryMessageView {
  id: string; role: string; position: number; content: string; truncated: boolean;
  toolEvents?: ToolSummary[];
}

/** Cap a fresh projection including JSON escapes and tool summaries, before the total-page cap.
 * The projection is local to this call, so trimming it cannot mutate stored messages or events.
 * @complexity Bounded content/summary serialization; no I/O or unbounded output accumulation.
 */
function capMessage({ view }: { view: HistoryMessageView }, _options = {}): HistoryMessageView {
  while (JSON.stringify(view).length > HISTORY_MESSAGE_CHAR_CAP) {
    view.truncated = true;
    if (view.content.length > 0) view.content = view.content.slice(0, Math.floor(view.content.length / 2));
    else view.toolEvents?.pop();
  }
  return view;
}

function toolOutcome({ isError }: { isError: unknown }, _options = {}): ToolSummary['outcome'] {
  if (isError === true) return 'failed';
  return isError === false ? 'succeeded' : 'unknown';
}

/** Outcome per tool-use id; malformed historical events are ignored. */
function toolOutcomes({ events }: { events: readonly unknown[] }, _options = {}): Map<string, ToolSummary['outcome']> {
  const outcomes = new Map<string, ToolSummary['outcome']>();
  for (const raw of events) {
    const event = raw as Partial<Extract<AgentEvent, { kind: 'tool_result' }>> | null;
    if (event?.kind === 'tool_result' && typeof event.toolUseId === 'string') outcomes.set(event.toolUseId, toolOutcome({ isError: event.isError }));
  }
  return outcomes;
}

/** Well-formed tool-use events in stored order; malformed historical events are ignored. */
function toolUses({ events }: { events: readonly unknown[] }, _options = {}): { name: string; id?: string }[] {
  return events.filter((raw): raw is { name: string; id?: string } => {
    const event = raw as Partial<Extract<AgentEvent, { kind: 'tool_use' }>> | null;
    return event?.kind === 'tool_use' && typeof event.name === 'string';
  });
}

/** Only bounded names and status cross this boundary; malformed historical events are ignored.
 * @complexity O(e) time/space in persisted events; output is capped at 50 summaries.
 */
function summarizeTools({ events, redact }: { events: unknown; redact: RedactUserText }, _options = {}): { items: ToolSummary[]; truncated: boolean } {
  if (!Array.isArray(events)) return { items: [], truncated: false };
  const outcomes = toolOutcomes({ events });
  const items: ToolSummary[] = [];
  let truncated = false;
  for (const event of toolUses({ events })) {
    if (items.length === TOOL_EVENT_CAP) { truncated = true; break; }
    const name = redact({ text: event.name }).text;
    if (name.length > 120) truncated = true;
    items.push({ name: name.slice(0, 120), outcome: outcomes.get(event.id ?? '') ?? 'unknown' });
  }
  return { items, truncated };
}

/** Validate advertised integer bounds even when a transport bypasses JSON schema validation. */
function integerOption({ input, key, fallback, max, min = 1 }: { input: Record<string, unknown>; key: string; fallback: number; max: number; min?: number }, _options = {}): number {
  const value = input[key] === undefined ? fallback : input[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ToolInputError({ message: `${key} must be an integer from ${min} through ${max}.` });
  }
  return value;
}

/** Strict allowlist prevents model-supplied identity from ever reaching the host scope factory. */
function inputRecord({ input, keys }: { input: unknown; keys: readonly string[] }, _options = {}): Record<string, unknown> {
  const record = requireInputRecord({ input });
  if (Object.keys(record).some(key => !keys.includes(key))) throw new ToolInputError({ message: 'Unexpected chat history input field. Use the published schema.' });
  return record;
}

/** The scoped store's bounded reader; hosts without one fail closed for both tools. */
async function openHistory(
  { ports, principalId }: { ports: AssistantHistoryToolPorts; principalId: string }, _options = {},
): Promise<{ store: ChatHistoryStore; history: ChatHistoryReader }> {
  const store = await ports.getStore({ principalId }, {});
  if (!store.history) throw new ToolInputError({ message: 'Chat history is unavailable on this site.' });
  return { store, history: store.history };
}

/** Validate the model's search and page request before opening an owner-scoped store.
 * @throws {ToolInputError} If an input field, query, limit or cursor is malformed. @complexity O(1).
 */
function listInput({ input: raw }: { input: unknown }, _options = {}): { query?: string; limit: number; cursor?: string } {
  const input = inputRecord({ input: raw, keys: ['query', 'limit', 'cursor'] });
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200)) throw new ToolInputError({ message: 'query must be a string of at most 200 characters.' });
  const { limit, cursor } = parseListPageRequest({ value: input }, { defaultLimit: 20, maxLimit: 50 });
  return { ...(input.query === undefined ? {} : { query: input.query }), limit, ...(cursor === null ? {} : { cursor }) };
}

type ChatListRow = Awaited<ReturnType<ChatHistoryReader['list']>>['items'][number];
interface ChatListView { id: string; title: string; updatedAt: number; messageCount: number; firstUserLine: string }

function projectChatRow({ row, redact }: { row: ChatListRow; redact: RedactUserText }, _options = {}): { chat: ChatListView; truncated: boolean } {
  // Redact BEFORE slicing: a cap must not turn a credential into an undetectable fragment.
  const title = redact({ text: row.title ?? '' }).text;
  const first = redact({ text: row.firstUserLine }).text.split(/\r?\n/, 1)[0]!;
  const truncated = title.length > 300 || first.length > 500 || row.id.length > 128;
  return { truncated, chat: { id: redact({ text: row.id }).text.slice(0, 128), title: title.slice(0, 300), updatedAt: row.updatedAt,
    messageCount: row.messageCount, firstUserLine: first.slice(0, 500) } };
}

/** Return one redacted owner-scoped history page with a cursor for every omitted conversation.
 * Oversized escaped text can force a repeat read with a smaller page; the limit decreases on every
 * repeat, so at most 50 bounded reads occur. Store errors and invalid input propagate.
 * @complexity At most 50 reads of at most 51 rows, plus bounded response serialization per read.
 */
async function listChats(
  { ports, redact, ctx }: { ports: AssistantHistoryToolPorts; redact: RedactUserText; ctx: ToolExecutionContext }, _options = {},
): Promise<{ chats: ChatListView[]; truncated: boolean; nextCursor: string | null; more?: string }> {
  const options = listInput({ input: ctx.input });
  const { history } = await openHistory({ ports, principalId: ctx.principal.id });
  let limit = options.limit;
  let trimmed = false;
  for (;;) {
    const page = await history.list({}, { ...options, limit });
    const projected = page.items.map(row => projectChatRow({ row, redact }));
    const chats = projected.map(item => item.chat);
    let truncated = trimmed || projected.some(item => item.truncated);
    const { items: _items, ...continuation } = listPageForModel({ page, toolId: 'assistant_chats_list' });
    // Escaped text may exceed the output budget. Re-read with a smaller limit so the store issues
    // the owner-bound cursor for the last chat actually returned, rather than skipping popped rows.
    while (chats.length > 0 && JSON.stringify({ chats, truncated, ...continuation }).length > HISTORY_TOTAL_CHAR_CAP) {
      chats.pop(); truncated = true;
    }
    if (chats.length === projected.length) return { chats, truncated, ...continuation };
    if (chats.length === 0 || chats.length >= limit) throw new ToolInputError({ message: 'Chat list exceeds its response size limit.' });
    limit = chats.length;
    trimmed = true;
  }
}

interface ReadInput { chatId: string; limit: number; fromPosition?: number; includeToolEvents: boolean }

function readInput({ input: raw }: { input: unknown }, _options = {}): ReadInput {
  const input = inputRecord({ input: raw, keys: ['chatId', 'fromPosition', 'limit', 'includeToolEvents'] });
  if (typeof input.chatId !== 'string' || !input.chatId.trim() || input.chatId.length > 128) throw new ToolInputError({ message: 'chatId must be an id returned by assistant_chats_list.' });
  const limit = integerOption({ input, key: 'limit', fallback: 50, max: 100 });
  const fromPosition = input.fromPosition === undefined ? undefined : integerOption({ input, key: 'fromPosition', fallback: 0, max: Number.MAX_SAFE_INTEGER, min: 0 });
  if (input.includeToolEvents !== undefined && typeof input.includeToolEvents !== 'boolean') throw new ToolInputError({ message: 'includeToolEvents must be boolean.' });
  return { chatId: input.chatId, limit, ...(fromPosition === undefined ? {} : { fromPosition }), includeToolEvents: input.includeToolEvents === true };
}

type HistoryRow = Awaited<ReturnType<ChatHistoryReader['read']>>['messages'][number];

function projectMessage({ row, includeToolEvents, redact }: { row: HistoryRow; includeToolEvents: boolean; redact: RedactUserText }, _options = {}): HistoryMessageView {
  const content = redact({ text: row.content }).text;
  const tools = includeToolEvents ? summarizeTools({ events: row.events, redact }) : undefined;
  return capMessage({ view: { id: redact({ text: row.id }).text.slice(0, 128), role: row.role === 'user' ? 'user' : 'assistant', position: row.position,
    content: content.slice(0, HISTORY_MESSAGE_CHAR_CAP), truncated: content.length > HISTORY_MESSAGE_CHAR_CAP || row.id.length > 128 || tools?.truncated === true,
    ...(tools ? { toolEvents: tools.items } : {}) } });
}

/** Fill the serialized page budget in candidate order; the first row always fits. */
function fillPage(
  { candidates, project }: { candidates: readonly HistoryRow[]; project: (row: HistoryRow) => HistoryMessageView }, _options = {},
): { messages: HistoryMessageView[]; truncated: boolean } {
  const messages: HistoryMessageView[] = [];
  let truncated = false;
  // Reserve result envelope/continuation space; measure serialized messages, including escapes.
  let remaining = HISTORY_TOTAL_CHAR_CAP - 512;
  for (const row of candidates) {
    const view = project(row);
    if (JSON.stringify(view).length > remaining && messages.length > 0) { truncated = true; break; }
    // Advance only over returned positions; the next page must include the omitted row.
    messages.push(view); remaining -= JSON.stringify(view).length + 1;
    if (view.truncated) truncated = true;
  }
  return { messages, truncated };
}

async function readChat(
  { ports, redact, ctx }: { ports: AssistantHistoryToolPorts; redact: RedactUserText; ctx: ToolExecutionContext }, _options = {},
) {
  const { chatId, limit, fromPosition, includeToolEvents } = readInput({ input: ctx.input });
  const { store, history } = await openHistory({ ports, principalId: ctx.principal.id });
  if (!await store.get({ id: chatId }, {})) throw new ToolInputError({ message: 'Chat is unavailable to this caller. Choose an id from assistant_chats_list.' });
  const tail = fromPosition === undefined;
  const page = await history.read({ chatId }, { ...(tail ? {} : { fromPosition }), limit, includeToolEvents });
  const filled = fillPage({ candidates: tail ? [...page.messages].reverse() : page.messages, project: row => projectMessage({ row, includeToolEvents, redact }) });
  return pageResult({ chatId: redact({ text: chatId }).text, tail, page, filled });
}

/** Continuation envelope: positions come only from returned rows, so no row is ever skipped. */
function pageResult(
  { chatId, tail, page, filled }: { chatId: string; tail: boolean; page: { messages: readonly HistoryRow[]; hasMore: boolean }; filled: { messages: HistoryMessageView[]; truncated: boolean } },
  _options = {},
) {
  const messages = tail ? filled.messages.reverse() : filled.messages;
  const last = messages.at(-1), first = messages.at(0);
  const more = messages.length < page.messages.length || page.hasMore;
  return { chatId, messages, truncated: page.hasMore || filled.truncated, hasMore: !tail && more,
    ...(last ? { nextPosition: last.position + 1 } : {}),
    ...(first ? { firstPosition: first.position } : {}),
    hasMoreBefore: tail && more };
}

/** Build both history registrations, using the existing catalog/risk/metadata contract.
 * @param ports Authenticated scoped-store port; denied/missing history must fail closed.
 * @param options Optional stricter redaction policy (the secret-card policy is the default).
 * @returns Read-only tool registrations. @throws ToolInputError for malformed or refused reads.
 * @complexity Bounded projections; persistence owns search cost and message ordering.
 */
export function buildAssistantHistoryRegistrations(
  { ports }: { ports: AssistantHistoryToolPorts }, { redact = redactUserText }: { redact?: RedactUserText } = {},
): ToolRegistration[] {
  return buildDomainRegistrations({ domain: 'assistant-history', catalogModule: 'chat/store/runtime/history-tools', catalog: assistantHistoryToolCatalog,
    derivedRisk: assistantHistoryDerivedRisk, metadata: assistantHistoryToolMetadata,
    handlers: {
      assistant_chats_list: ctx => listChats({ ports, redact, ctx }),
      assistant_chat_read: ctx => readChat({ ports, redact, ctx }),
    },
  });
}
