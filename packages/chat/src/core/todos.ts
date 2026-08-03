/**
 * @module todos
 *
 * Pure TodoWrite-style plan-tool snapshot parsing/derivation. Reads the
 * structured plan a `TodoWrite`/`update_plan`-shaped tool call carries and
 * derives the "latest plan state" a pinned progress card renders — no I/O,
 * no framework.
 */
import type { AgentEvent } from './events.js';
import type { ChatRunStatus } from './messages.js';

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
export function isTodoWriteToolName(name: string): boolean {
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
export function parseTodoWriteInput(input: unknown): TodoItem[] {
  if (!input || typeof input !== 'object') return [];
  const obj = input as { plan?: unknown; todos?: unknown };
  const rawItems = Array.isArray(obj.todos) ? obj.todos : Array.isArray(obj.plan) ? obj.plan : [];
  return rawItems
    .map((todo): TodoItem | null => {
      if (!todo || typeof todo !== 'object') return null;
      const record = todo as Record<string, unknown>;
      const content =
        typeof record.content === 'string'
          ? record.content
          : typeof record.step === 'string'
            ? record.step
            : typeof record.description === 'string'
              ? record.description
              : typeof record.label === 'string'
                ? record.label
                : typeof record.text === 'string'
                  ? record.text
                  : '';
      if (!content) return null;
      return {
        content,
        status: normalizeTodoStatus(record.status),
        activeForm:
          typeof record.activeForm === 'string'
            ? record.activeForm
            : typeof record.active_form === 'string'
              ? record.active_form
              : undefined,
      };
    })
    .filter((todo): todo is TodoItem => todo !== null);
}

/**
 * Find the most recent plan-tool `tool_use` in a single turn's events and
 * return its parsed items, or `[]` if this turn never wrote a plan.
 * @complexity O(n), scanning from the end.
 */
export function latestTodosFromEvents(events: AgentEvent[] | undefined): TodoItem[] {
  if (!events) return [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.kind !== 'tool_use' || !isTodoWriteToolName(event.name)) continue;
    return parseTodoWriteInput(event.input);
  }
  return [];
}

/** The subset of {@link latestTodosFromEvents} not yet marked `completed`. */
export function unfinishedTodosFromEvents(events: AgentEvent[] | undefined): TodoItem[] {
  return latestTodosFromEvents(events).filter((todo) => todo.status !== 'completed');
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
export function latestTodoWriteInputFromMessages(
  messages: ReadonlyArray<{ events?: AgentEvent[] | undefined }> | undefined,
): unknown | null {
  if (!messages || messages.length === 0) return null;
  for (let mi = messages.length - 1; mi >= 0; mi -= 1) {
    const events = messages[mi]?.events;
    if (!events || events.length === 0) continue;
    for (let ei = events.length - 1; ei >= 0; ei -= 1) {
      const event = events[ei];
      if (event?.kind !== 'tool_use') continue;
      if (!isTodoWriteToolName(event.name)) continue;
      return event.input;
    }
  }
  return null;
}

/** Convenience alias for {@link latestTodoWriteInputFromMessages} matching the `latestTodoWriteInput()` name in the target API. */
export const latestTodoWriteInput = latestTodoWriteInputFromMessages;

function hasTerminalRunEnded(runStatus: ChatRunStatus | undefined, endedAt: number | undefined): boolean {
  return (
    runStatus === 'succeeded' ||
    runStatus === 'failed' ||
    runStatus === 'canceled' ||
    (runStatus === undefined && endedAt !== undefined)
  );
}

function stoppedTodoWriteInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const obj = input as { todos?: unknown; plan?: unknown };
  const key = Array.isArray(obj.todos) ? 'todos' : Array.isArray(obj.plan) ? 'plan' : null;
  if (!key) return input;
  const items = obj[key] as unknown[];
  return {
    ...(input as Record<string, unknown>),
    [key]: items.map((todo) => {
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
>(messages: ReadonlyArray<T> | undefined): unknown | null {
  if (!messages || messages.length === 0) return null;
  for (let mi = messages.length - 1; mi >= 0; mi -= 1) {
    const message = messages[mi];
    const events = message?.events;
    if (!events || events.length === 0) continue;
    for (let ei = events.length - 1; ei >= 0; ei -= 1) {
      const event = events[ei];
      if (event?.kind !== 'tool_use') continue;
      if (!isTodoWriteToolName(event.name)) continue;
      if (!hasTerminalRunEnded(message.runStatus, message.endedAt)) {
        return event.input;
      }
      return stoppedTodoWriteInput(event.input);
    }
  }
  return null;
}
