/** Model-facing history tools over an authenticated owner-scoped store; no database handles. */
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, ToolInputError,
  type AgentToolDefinition, type AgentToolSideEffect, type ToolRegistration } from '@jini-ai/core';
import { redactUserText, type RedactUserText } from '../../core/user-text-redaction.js';
import type { ChatHistoryStore } from '../ports.js';
import type { AgentEvent } from '../../core/events.js';
import { assistantHistoryToolMetadata } from '../../core/history-tool-metadata.js';

export const HISTORY_MESSAGE_CHAR_CAP = 8_000;
export const HISTORY_TOTAL_CHAR_CAP = 40_000;
const TOOL_EVENT_CAP = 50;

export const assistantHistoryDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map([
  ['assistant_chats_list', 'none'], ['assistant_chat_read', 'none'],
]);
/** Exported so host contract tests can pin each registration to its catalog entry. */
export const assistantHistoryToolCatalog = indexCatalogById<AgentToolDefinition>({ catalog: [
  { name: 'assistant_chats_list', sideEffects: 'none', authorization: { permission: 'admin.assistant.use' },
    description: "Lists the CURRENT user's own conversations on this site, newest first, optionally searching titles and message content. Returns id, title, updatedAt, messageCount and firstUserLine, with redacted, capped text. When the user refers to an earlier or interrupted chat ('continue what we were doing'), list first, then assistant_chat_read to read its tail, summarise the state and continue. No other user's chats are accessible; unavailable history is an error. Pass siteName (a registered local site name) to list your own chats on another site instead, read-only; an unknown name returns the list of registered sites.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      siteName: { type: 'string', minLength: 1, maxLength: 100 },
      query: { type: 'string', maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    } } },
  { name: 'assistant_chat_read', sideEffects: 'none', authorization: { permission: 'admin.assistant.use' },
    description: "Reads one of the CURRENT user's own chats in stored message order. Omit fromPosition to read the latest tail (default 50 messages); use fromPosition and nextPosition for forward pagination. List chats first when resuming earlier work, read the tail, summarise the state, then continue. Returns redacted messages, positions, continuation and truncated flags; each serialized message is capped at 8,000 characters and the result at 40,000 characters. Tool events, when requested, contain only tool name and outcome, never payloads. Attachments are omitted. Missing and other-user chats receive the same refusal. Pass the same siteName used with assistant_chats_list to read a chat from another site.",
    inputSchema: { type: 'object', additionalProperties: false, required: ['chatId'], properties: {
      siteName: { type: 'string', minLength: 1, maxLength: 100 },
      chatId: { type: 'string', minLength: 1, maxLength: 128 },
      fromPosition: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      includeToolEvents: { type: 'boolean', default: false },
    } } },
] });

/** Auth is resolved by the host using execution identity, never from model input. */
export interface AssistantHistoryToolPorts {
  getStore(required: { principalId: string }, optional?: Record<string, never>): Promise<ChatHistoryStore>;
  /** Optional host port for other sites' history; the host resolves names through its own registry, read-only. */
  siteHistory?: {
    /** Site names the caller may pass as siteName (for discovery and error messages). */
    listSiteNames(required: { principalId: string }, optional?: Record<string, never>): Promise<string[]>;
    /** Owner-scoped read-only store for a registered site, or undefined for an unknown name. Host throws ToolInputError for refusals. */
    openStore(required: { principalId: string; siteName: string }, optional?: Record<string, never>): Promise<{ store: ChatHistoryStore; close(): void | Promise<void> } | undefined>;
  };
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

/** Only bounded names and status cross this boundary; malformed historical events are ignored.
 * @complexity O(e) time/space in persisted events; output is capped at 50 summaries.
 */
function summarizeTools({ events, redact }: { events: unknown; redact: RedactUserText }, _options = {}): { items: ToolSummary[]; truncated: boolean } {
  if (!Array.isArray(events)) return { items: [], truncated: false };
  const outcomes = new Map<string, ToolSummary['outcome']>();
  for (const raw of events) {
    const event = raw as Partial<Extract<AgentEvent, { kind: 'tool_result' }>> | null;
    if (event?.kind === 'tool_result' && typeof event.toolUseId === 'string') {
      outcomes.set(event.toolUseId, event.isError === true ? 'failed' : event.isError === false ? 'succeeded' : 'unknown');
    }
  }
  const items: ToolSummary[] = [];
  let truncated = false;
  for (const raw of events) {
    const event = raw as Partial<Extract<AgentEvent, { kind: 'tool_use' }>> | null;
    if (event?.kind !== 'tool_use' || typeof event.name !== 'string') continue;
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

/** Resolve one authenticated store, retaining host ownership of local lifetime and closing site reads.
 * @throws ToolInputError for invalid names, unsupported hosts or unknown registered names.
 * @complexity O(n) bounded name projection (at most 50); read cost belongs to persistence.
 */
async function withStore<T>({ ports, principalId, siteName, redact, read }: {
  ports: AssistantHistoryToolPorts; principalId: string; siteName: unknown; redact: RedactUserText;
  read: (store: ChatHistoryStore, site: { siteName?: string }) => Promise<T>;
}, _options = {}): Promise<T> {
  if (siteName === undefined) return read(await ports.getStore({ principalId }, {}), {});
  if (typeof siteName !== 'string' || !siteName.trim() || siteName.length > 100) {
    throw new ToolInputError({ message: 'siteName must be a registered site name of at most 100 characters.' });
  }
  if (!ports.siteHistory) throw new ToolInputError({ message: "Reading another site's chats is not supported on this host." });
  const opened = await ports.siteHistory.openStore({ principalId, siteName }, {});
  if (!opened) {
    const names = await ports.siteHistory.listSiteNames({ principalId }, {});
    const registered = names.slice(0, 50).map(name => redact({ text: name }).text.slice(0, 100)).join(', ');
    throw new ToolInputError({ message: `Unknown site "${redact({ text: siteName }).text.slice(0, 100)}". ${names.length ? `Registered sites: ${registered}.` : 'No other sites are registered.'}` });
  }
  try { return await read(opened.store, { siteName: redact({ text: siteName }).text.slice(0, 100) }); }
  finally { await opened.close(); }
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
      assistant_chats_list: async ctx => {
        const input = inputRecord({ input: ctx.input, keys: ['query', 'limit', 'siteName'] });
        if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200)) throw new ToolInputError({ message: 'query must be a string of at most 200 characters.' });
        const { query } = input;
        const limit = integerOption({ input, key: 'limit', fallback: 20, max: 50 });
        return withStore({ ports, principalId: ctx.principal.id, siteName: input.siteName, redact, read: async (store, site) => {
          if (!store.history) throw new ToolInputError({ message: 'Chat history is unavailable on this site.' });
          const rows = await store.history.list({}, { ...(query === undefined ? {} : { query }), limit });
          let truncated = false;
          const chats = rows.map(row => {
            // Redact BEFORE slicing: a cap must not turn a credential into an undetectable fragment.
            const title = redact({ text: row.title ?? '' }).text;
            const first = redact({ text: row.firstUserLine }).text.split(/\r?\n/, 1)[0]!;
            if (title.length > 300 || first.length > 500 || row.id.length > 128) truncated = true;
            return { id: redact({ text: row.id }).text.slice(0, 128), title: title.slice(0, 300), updatedAt: row.updatedAt,
              messageCount: row.messageCount, firstUserLine: first.slice(0, 500) };
          });
          // List is bounded too; serialized escaping can make text larger than its character count.
          while (JSON.stringify({ ...site, chats, truncated }).length > HISTORY_TOTAL_CHAR_CAP) { chats.pop(); truncated = true; }
          return { ...site, chats, truncated };
        } }, {});
      },
      assistant_chat_read: async ctx => {
        const input = inputRecord({ input: ctx.input, keys: ['chatId', 'fromPosition', 'limit', 'includeToolEvents', 'siteName'] });
        if (typeof input.chatId !== 'string' || !input.chatId.trim() || input.chatId.length > 128) throw new ToolInputError({ message: 'chatId must be an id returned by assistant_chats_list.' });
        const { chatId } = input;
        const limit = integerOption({ input, key: 'limit', fallback: 50, max: 100 });
        const fromPosition = input.fromPosition === undefined ? undefined : integerOption({ input, key: 'fromPosition', fallback: 0, max: Number.MAX_SAFE_INTEGER, min: 0 });
        if (input.includeToolEvents !== undefined && typeof input.includeToolEvents !== 'boolean') throw new ToolInputError({ message: 'includeToolEvents must be boolean.' });
        return withStore({ ports, principalId: ctx.principal.id, siteName: input.siteName, redact, read: async (store, site) => {
          if (!store.history) throw new ToolInputError({ message: 'Chat history is unavailable on this site.' });
          if (!await store.get({ id: chatId }, {})) throw new ToolInputError({ message: 'Chat is unavailable to this caller. Choose an id from assistant_chats_list.' });
          const page = await store.history.read({ chatId }, { ...(fromPosition === undefined ? {} : { fromPosition }), limit, includeToolEvents: input.includeToolEvents === true });
          const messages: HistoryMessageView[] = [];
          let truncated = page.hasMore;
          // Reserve result envelope/continuation space; measure serialized messages, including escapes.
          let remaining = HISTORY_TOTAL_CHAR_CAP - 512 - (site.siteName === undefined ? 0 : JSON.stringify(site).length);
          const candidates = fromPosition === undefined ? [...page.messages].reverse() : page.messages;
          for (const row of candidates) {
            const content = redact({ text: row.content }).text;
            const tools = input.includeToolEvents === true ? summarizeTools({ events: row.events, redact }) : undefined;
            const view = capMessage({ view: { id: redact({ text: row.id }).text.slice(0, 128), role: row.role === 'user' ? 'user' : 'assistant', position: row.position,
              content: content.slice(0, HISTORY_MESSAGE_CHAR_CAP), truncated: content.length > HISTORY_MESSAGE_CHAR_CAP || row.id.length > 128 || tools?.truncated === true,
              ...(tools ? { toolEvents: tools.items } : {}) } });
            if (JSON.stringify(view).length > remaining && messages.length > 0) { truncated = true; break; }
            // Advance only over returned positions; the next page must include the omitted row.
            messages.push(view); remaining -= JSON.stringify(view).length + 1;
            if (view.truncated) truncated = true;
          }
          if (fromPosition === undefined) messages.reverse();
          const last = messages.at(-1), first = messages.at(0);
          const omitted = messages.length < page.messages.length;
          const hasMore = fromPosition !== undefined && (omitted || page.hasMore);
          return { ...site, chatId: redact({ text: chatId }).text, messages, truncated, hasMore,
            ...(last ? { nextPosition: last.position + 1 } : {}),
            ...(first ? { firstPosition: first.position } : {}),
            hasMoreBefore: fromPosition === undefined && (omitted || page.hasMore) };
        } }, {});
      },
    },
  });
}
