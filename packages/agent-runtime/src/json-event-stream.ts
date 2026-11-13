/** @module json-event-stream
 * Multi-CLI JSON event parsing with per-handler stream state. */
import { createBoundedLineStream } from './core/bounded-line-stream.js';
import { handleAntigravityEvent, type AntigravityStreamState } from './defs/antigravity/event-stream.js';
import { createCodexStreamState, handleCodexEvent, type CodexStreamState } from './defs/codex/event-stream.js';
import { createOpenCodeStreamState, emitOpenCodeModelReceipt, handleOpenCodeEvent, type OpenCodeStreamState } from './defs/opencode/event-stream.js';
import { createLegacyGoogleStreamState, flushPendingArtifactText, handleLegacyGoogleStreamEvent, type LegacyGoogleStreamState } from './defs/gemini/event-stream.js';
import { handleKimiEvent } from './defs/kimi/event-stream.js';
import { createCursorStreamState, handleCursorEvent, type CursorStreamState } from './defs/cursor-agent/event-stream.js';

export type JsonObject = Record<string, unknown>;
export type StreamEvent = Record<string, unknown>;
export type StreamEventHandler = (event: StreamEvent) => void;

export type ParserState = {
  antigravity: AntigravityStreamState;
  cursor: CursorStreamState;
  opencode: OpenCodeStreamState;
  codex: CodexStreamState;
  legacyGoogle: LegacyGoogleStreamState;
};

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  thought_tokens?: number;
  cached_read_tokens?: number;
  cached_write_tokens?: number;
};

/** One vendor frame translator: returns `true` when it handled the frame, `false` to fall back to `raw`. */
export type FrameHandler = (obj: JsonObject, onEvent: StreamEventHandler, state: ParserState) => boolean;

/** `[vendor field, Usage field]` pairs, in the emitted key order. */
export type UsageFields = ReadonlyArray<readonly [string, keyof Usage]>;

export function isRecord(value: unknown): value is JsonObject {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function trimmedNonBlank(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Copies the numeric vendor counters named in `fields` into a `Usage`, skipping absent ones. */
export function pickUsage(source: JsonObject, fields: UsageFields): Usage {
  const usage: Usage = {};
  for (const [from, to] of fields) {
    const value = source[from];
    if (typeof value === 'number') usage[to] = value;
  }
  return usage;
}

/** Routes a record frame to the handler registered for its `type`; unknown types are unhandled. */
export function dispatchFrame(
  handlers: ReadonlyMap<unknown, FrameHandler>,
  obj: JsonObject,
  onEvent: StreamEventHandler,
  state: ParserState,
): boolean {
  const handler = handlers.get(obj.type);
  return handler ? handler(obj, onEvent, state) : false;
}

export function safeParseJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    // Current callers pass JSON.parse results or their fields, which cannot contain cycles or
    // BigInts, so stringify cannot throw. Keep this fallback for future non-JSON callers without
    // forcing a coverage test around data the current parser cannot produce.
    return String(value);
  }
}

function isNonNullObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/** Unwrap string/record error envelopes, retaining string or numeric codes alongside messages. */
export function extractErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const parsed = safeParseJson(value);
    return isNonNullObject(parsed) ? extractErrorMessage(parsed, value) : value;
  }
  if (!isRecord(value)) return fallback;
  const message = extractRecordErrorMessage(value, '');
  const code = typeof value.code === 'number' ? String(value.code) : trimmedNonBlank(value.code);
  return (code ? [code, message].filter(Boolean).join(': ') : message) || fallback;
}

/** Field precedence for an error object: detail, message (itself maybe JSON), error, data, name. */
function extractRecordErrorMessage(value: JsonObject, fallback: string): string {
  const detail = nonEmptyString(value.detail);
  if (detail) return detail;
  const message = nonEmptyString(value.message);
  if (message) return extractErrorMessage(message, message);
  const error = nonEmptyString(value.error);
  if (error) return error;
  if (isNonNullObject(value.error)) return extractErrorMessage(value.error, fallback);
  const dataMessage = isNonNullObject(value.data) ? extractErrorMessage(value.data, '') : '';
  return dataMessage || nonEmptyString(value.name) || fallback;
}

export function initializingStatus(obj: JsonObject): StreamEvent {
  return { type: 'status', label: 'initializing', model: optionalString(obj.model) };
}

/** Ordered status buckets: the first rule whose exact alias or prefix matches wins; else `pending`. */
const TODO_STATUS_RULES: ReadonlyArray<{ status: string; exact: string[]; prefixes: string[] }> = [
  { status: 'completed', exact: ['complete', 'done'], prefixes: ['completed'] },
  { status: 'in_progress', exact: ['doing', 'active'], prefixes: ['in_progress'] },
  { status: 'stopped', exact: [], prefixes: ['stopped', 'failed', 'blocked', 'canceled', 'cancelled'] },
];

function normalizeTodoStatus(value: unknown): string {
  const status = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[-\s]+/g, '_')
    : '';
  const rule = TODO_STATUS_RULES.find(
    (candidate) => candidate.exact.includes(status) || candidate.prefixes.some((prefix) => status.startsWith(prefix)),
  );
  return rule ? rule.status : 'pending';
}

/** Text fields of a to-do item in precedence order; the first string-typed one wins, even when empty. */
const TODO_CONTENT_FIELDS = ['content', 'label', 'description', 'text'] as const;

function todoFromItem(raw: unknown): JsonObject | null {
  if (!isRecord(raw)) return null;
  const field = TODO_CONTENT_FIELDS.find((key) => typeof raw[key] === 'string');
  const content = field ? (raw[field] as string) : '';
  if (!content) return null;
  return {
    content,
    status: raw.completed === true
      ? 'completed'
      : normalizeTodoStatus(raw.status),
  };
}

// Takes `unknown[]`, not `unknown`: every real call site
// (`todoWriteInputFromParsedValue`'s three call sites and
// `codexTodoListInput`) already runs `Array.isArray(...)` before calling in,
// so a runtime `!Array.isArray` guard here was dead code for every real
// caller. Narrowed the parameter type to remove the branch instead of
// padding a test around unreachable data.
export function todoWriteInputFromItems(items: unknown[]): JsonObject | null {
  const todos = items
    .map(todoFromItem)
    .filter((todo): todo is JsonObject => todo !== null);
  return todos.length > 0 ? { todos } : null;
}

export function todoWriteInputFromParsedValue(value: unknown): JsonObject | null {
  if (Array.isArray(value)) return todoWriteInputFromItems(value);
  if (!isRecord(value)) return null;
  if (Array.isArray(value.todos)) return todoWriteInputFromItems(value.todos);
  if (Array.isArray(value.todo)) return todoWriteInputFromItems(value.todo);
  return null;
}

const MODEL_RECEIPT_FRAME_TYPES: ReadonlySet<string> = new Set(['session.created', 'thread.started', 'turn.started', 'model.changed']);
const MODEL_RECEIPT_EXTRACTORS = [emitOpenCodeModelReceipt];

// Preserve structured model receipts before vendor event translation. These fields describe
// session/turn/assistant-message metadata; generated text is never used for model identity.
function emitModelReceipts(obj: unknown, onEvent: StreamEventHandler): void {
  if (!isRecord(obj)) return;
  for (const extract of MODEL_RECEIPT_EXTRACTORS) extract(obj, onEvent);
  if (typeof obj.model === 'string' && MODEL_RECEIPT_FRAME_TYPES.has(String(obj.type))) {
    onEvent({ type: 'status', label: 'model', model: obj.model });
  }
}

const PARSERS_BY_KIND: ReadonlyMap<string, (obj: unknown, onEvent: StreamEventHandler, state: ParserState) => boolean> = new Map([
  ['antigravity', (frame, emit, state) => handleAntigravityEvent({ frame, emit, state: state.antigravity })],
  ['opencode', handleOpenCodeEvent],
  ['legacy-google-stream-json', handleLegacyGoogleStreamEvent],
  ['kimi', handleKimiEvent],
  ['cursor-agent', handleCursorEvent],
  ['codex', handleCodexEvent],
]);

export function createJsonEventStreamHandler({ kind, onEvent }: { kind: string; onEvent: StreamEventHandler }) {
  const lines = createBoundedLineStream({
    onLine: line => { const trimmed = line.trim(); if (trimmed) handleLine(trimmed); },
    onOverflow: error => onEvent({ type: 'error', message: error.message, raw: '' }),
  });
  const state: ParserState = {
    antigravity: { textEmitted: false, toolUses: new Set<string>(), toolResults: new Set<string>() },
    cursor: createCursorStreamState(),
    opencode: createOpenCodeStreamState(),
    codex: createCodexStreamState(),
    legacyGoogle: createLegacyGoogleStreamState(),
  };
  const parse = PARSERS_BY_KIND.get(kind);

  function handleLine(line: string): void {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      onEvent({ type: 'raw', line });
      return;
    }

    emitModelReceipts(obj, onEvent);
    if (parse?.(obj, onEvent, state)) return;

    onEvent({ type: 'raw', line });
  }

  function feed({ chunk }: { chunk: string }) {
    lines.feed({ chunk: chunk });
  }

  function flush(): void {
    lines.flush();
    flushPendingArtifactText(state, onEvent);
  }

  return { feed, flush };
}
