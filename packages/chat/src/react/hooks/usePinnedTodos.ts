/**
 * @module usePinnedTodos
 *
 * The latest `TodoWrite`-style plan snapshot across a conversation, a
 * dismissed-key so a user's dismissal sticks until the plan actually
 * changes again, and progress counts for a pinned progress-card UI. Pure
 * over `messages` — built on `@jini-ai/chat/core`'s
 * `latestTodoWriteInputForPinnedCard`/`parseTodoWriteInput`. Per
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §4 (origin: OD's
 * `runtime/todos.ts` pinned-card logic, `components/ToolCard.tsx`'s
 * `TodoCard`'s `onDismiss` convention).
 */
import { useCallback, useMemo, useState } from 'react';
import type { ChatMessage, TodoItem } from '../../core/index.js';
import { latestTodoWriteInputForPinnedCard, parseTodoWriteInput } from '../../core/index.js';

export interface UsePinnedTodosResult {
  todos: TodoItem[];
  total: number;
  completed: number;
  inProgress: TodoItem | undefined;
  /** `true` once every todo in the latest plan is `completed`. */
  allComplete: boolean;
  /** `false` when there's no plan yet, or the user dismissed the current (all-complete) plan. */
  visible: boolean;
  /** Dismisses the currently-pinned card. Only meaningful once `allComplete`; re-appears automatically once the plan changes again. */
  dismiss: () => void;
}

export function usePinnedTodos(messages: ReadonlyArray<ChatMessage> | undefined): UsePinnedTodosResult {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const rawInput = useMemo(() => latestTodoWriteInputForPinnedCard(messages), [messages]);
  const todos = useMemo(() => parseTodoWriteInput(rawInput), [rawInput]);
  const key = useMemo(() => (rawInput === null ? null : safeStableKey(rawInput)), [rawInput]);

  const total = todos.length;
  const completed = todos.filter((t) => t.status === 'completed').length;
  const allComplete = total > 0 && completed === total;
  const inProgress = todos.find((t) => t.status === 'in_progress');
  const visible = total > 0 && !(allComplete && key !== null && key === dismissedKey);

  const dismiss = useCallback(() => {
    if (key !== null) setDismissedKey(key);
  }, [key]);

  return { todos, total, completed, inProgress, allComplete, visible, dismiss };
}

// A plan-tool `input` is arbitrary JSON; stringify gives a cheap, stable
// identity for "has the plan actually changed since dismissal" without
// depending on object reference equality (a fresh event array on every
// stream tick would otherwise always look "new").
function safeStableKey(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}
