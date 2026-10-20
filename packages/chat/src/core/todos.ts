/**
 * @module todos
 *
 * Pure TodoWrite-style plan-tool snapshot parsing/derivation. Reads the
 * structured plan a `TodoWrite`/`update_plan`-shaped tool call carries and
 * derives the "latest plan state" a pinned progress card renders — no I/O,
 * no framework.
 */
import type { AgentEvent } from './events.js';
import { isTerminalRunStatus, type ChatRunStatus } from './messages.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'stopped';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string | undefined;
}

const TODO_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'TodoWrite',
  'todowrite',
  'todo_write',
  'update_plan',
]);

/** `true` when `name` is one of the accepted plan/TodoWrite tool-name spellings. */
export function isTodoWriteToolName({ name }: { name: string }): boolean {
  return TODO_WRITE_TOOL_NAMES.has(name);
}

function normalizeTodoStatus(status: unknown): TodoStatus {
  if (status === 'completed' || status === 'in_progress' || status === 'stopped') {
    return status;
  }
  if (status === 'cancelled' || status === 'canceled' || status === 'failed') {
    return 'stopped';
  }
  return 'pending';
}

/**
 * Parse a plan-tool call's raw `input` into a normalized `TodoItem[]`,
 * tolerating the several shapes different agent runtimes emit (`todos` vs
 * `plan` array; `content`/`step`/`description`/`label`/`text` for the item
 * body; `activeForm`/`active_form`).
 *
 * @param input - The `tool_use` event's `input`, of unknown shape.
 * @returns Normalized items; entries with no recognizable body text are dropped.
 * @complexity O(n) in the number of raw plan entries.
 */
export function parseTodoWriteInput({ input }: { input: unknown }): TodoItem[] {
  const list = todoListOf({ input });
  return list ? list.items.map((todo) => parseTodoItem({ todo })).filter((todo): todo is TodoItem => todo !== null) : [];
}

/** The plan array a tool input carries (`todos` wins over `plan`), with the key it sits under. */
function todoListOf({ input }: { input: unknown }, _optional: {} = {}): { key: 'todos' | 'plan'; items: unknown[] } | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as { plan?: unknown; todos?: unknown };
  if (Array.isArray(obj.todos)) return { key: 'todos', items: obj.todos };
  if (Array.isArray(obj.plan)) return { key: 'plan', items: obj.plan };
  return null;
}

/** The first of `keys` whose value is a string (even an empty one), else undefined. */
function firstStringField({ record, keys }: { record: Record<string, unknown>; keys: readonly string[] }, _optional: {} = {}): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

const TODO_BODY_KEYS = ['content', 'step', 'description', 'label', 'text'] as const;
const TODO_ACTIVE_FORM_KEYS = ['activeForm', 'active_form'] as const;

function parseTodoItem({ todo }: { todo: unknown }, _optional: {} = {}): TodoItem | null {
  if (!todo || typeof todo !== 'object') return null;
  const record = todo as Record<string, unknown>;
  const content = firstStringField({ record, keys: TODO_BODY_KEYS });
  if (!content) return null;
  return {
    content,
    status: normalizeTodoStatus(record.status),
    activeForm: firstStringField({ record, keys: TODO_ACTIVE_FORM_KEYS }),
  };
}

/**
 * Find the most recent plan-tool `tool_use` in a single turn's events and
 * return its parsed items, or `[]` if this turn never wrote a plan.
 * @complexity O(n), scanning from the end.
 */
export function latestTodosFromEvents({ events }: { events: AgentEvent[] | undefined }): TodoItem[] {
  const event = latestTodoWriteEvent({ events });
  return event ? parseTodoWriteInput({ input: event.input }) : [];
}

type ToolUseEvent = Extract<AgentEvent, { kind: 'tool_use' }>;

/** The newest plan-tool `tool_use` in one turn's events, scanning from the end. */
function latestTodoWriteEvent({ events }: { events: readonly AgentEvent[] | undefined }, _optional: {} = {}): ToolUseEvent | undefined {
  return events?.findLast((event): event is ToolUseEvent => event.kind === 'tool_use' && isTodoWriteToolName({ name: event.name }));
}

/** The newest message holding a plan-tool call, with that call; messages are scanned newest first. */
function latestTodoWriteInMessages<T extends { events?: AgentEvent[] | undefined }>(
  { messages }: { messages: ReadonlyArray<T> | undefined },
  _optional: {} = {},
): { message: T; event: ToolUseEvent } | null {
  for (let mi = (messages?.length ?? 0) - 1; mi >= 0; mi -= 1) {
    const message = messages![mi]!;
    const event = latestTodoWriteEvent({ events: message.events });
    if (event) return { message, event };
  }
  return null;
}

/** The subset of {@link latestTodosFromEvents} not yet marked `completed`. */
export function unfinishedTodosFromEvents({ events }: { events: AgentEvent[] | undefined }): TodoItem[] {
  return latestTodosFromEvents({ events: events }).filter((todo) => todo.status !== 'completed');
}

/**
 * Walk a conversation in reverse to find the most recent plan-tool
 * `tool_use` across every message and return its raw (un-parsed) `input`, so
 * a caller can hand it straight to a plan/todo card without re-implementing
 * the discovery walk.
 *
 * @param messages - Conversation turns, oldest first (only `events` is read).
 * @returns The raw tool input, or `null` if no plan tool has run yet.
 * @complexity O(n*m) worst case (n messages, m events each), but returns on
 *   the first hit scanning backwards, so the common case (a recent plan
 *   update) is far cheaper.
 */
export function latestTodoWriteInputFromMessages({ messages }: { messages: ReadonlyArray<{ events?: AgentEvent[] | undefined }> | undefined }
): unknown | null {
  return latestTodoWriteInMessages({ messages })?.event.input ?? null;
}

/** Convenience alias for {@link latestTodoWriteInputFromMessages} matching the `latestTodoWriteInput()` name in the target API. */
export const latestTodoWriteInput = latestTodoWriteInputFromMessages;

function hasTerminalRunEnded(runStatus: ChatRunStatus | undefined, endedAt: number | undefined): boolean {
  return isTerminalRunStatus({ status: runStatus }) || (runStatus === undefined && endedAt !== undefined);
}

function stoppedTodoWriteInput(input: unknown): unknown {
  const list = todoListOf({ input });
  if (!list) return input;
  return {
    ...(input as Record<string, unknown>),
    [list.key]: list.items.map((todo) => {
      if (!todo || typeof todo !== 'object') return todo;
      const record = todo as Record<string, unknown>;
      if (record.status !== 'in_progress') return todo;
      return { ...record, status: 'stopped' };
    }),
  };
}

/**
 * Variant of {@link latestTodoWriteInputFromMessages} for a "pinned progress
 * card" that must stay honest once its owning run has ended: while the run
 * is still active the raw input is returned as-is, but once the run is
 * terminal any item still marked `in_progress` is flipped to `stopped` (the
 * agent process exited before marking it done or failed).
 *
 * @complexity Same as {@link latestTodoWriteInputFromMessages}, plus an O(m)
 *   remap of the winning turn's items when the run has ended.
 */
export function latestTodoWriteInputForPinnedCard<
  T extends {
    events?: AgentEvent[] | undefined;
    runStatus?: ChatRunStatus | undefined;
    endedAt?: number | undefined;
  },
>({ messages }: { messages: ReadonlyArray<T> | undefined }): unknown | null {
  const found = latestTodoWriteInMessages({ messages });
  if (!found) return null;
  const { message, event } = found;
  return hasTerminalRunEnded(message.runStatus, message.endedAt) ? stoppedTodoWriteInput(event.input) : event.input;
}
