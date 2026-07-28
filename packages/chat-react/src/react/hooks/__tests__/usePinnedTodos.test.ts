import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@injini/chat-core';
import { usePinnedTodos } from '../usePinnedTodos.js';

function withTodos(todos: { content: string; status: string }[], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    events: [{ kind: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos } }],
    ...overrides,
  };
}

describe('usePinnedTodos', () => {
  it('reports no visible card when there is no plan yet', () => {
    const { result } = renderHook(() => usePinnedTodos([]));
    expect(result.current.visible).toBe(false);
    expect(result.current.todos).toEqual([]);
  });

  it('surfaces the latest plan snapshot with progress counts', () => {
    const messages = [
      withTodos([
        { content: 'step one', status: 'completed' },
        { content: 'step two', status: 'in_progress' },
        { content: 'step three', status: 'pending' },
      ]),
    ];
    const { result } = renderHook(() => usePinnedTodos(messages));
    expect(result.current.total).toBe(3);
    expect(result.current.completed).toBe(1);
    expect(result.current.inProgress?.content).toBe('step two');
    expect(result.current.allComplete).toBe(false);
    expect(result.current.visible).toBe(true);
  });

  it('dismiss() hides an all-complete plan until it changes again', () => {
    const allDone = [withTodos([{ content: 'a', status: 'completed' }])];
    const { result, rerender } = renderHook(({ messages }) => usePinnedTodos(messages), { initialProps: { messages: allDone } });
    expect(result.current.allComplete).toBe(true);
    expect(result.current.visible).toBe(true);

    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(false);

    // A genuinely new plan (different content) must reappear despite the dismissal.
    const newPlan = [withTodos([{ content: 'b', status: 'in_progress' }], { id: 'm2' })];
    rerender({ messages: newPlan });
    expect(result.current.visible).toBe(true);
  });

  it('flips a stopped-mid-flight in_progress item to stopped once the run ends', () => {
    const messages = [withTodos([{ content: 'x', status: 'in_progress' }], { runStatus: 'canceled', endedAt: Date.now() })];
    const { result } = renderHook(() => usePinnedTodos(messages));
    expect(result.current.todos[0]?.status).toBe('stopped');
  });

  it('falls back to String(input) for the dismissal key when the raw plan input cannot be JSON.stringified (e.g. circular)', () => {
    const circular: Record<string, unknown> = { content: 'x', status: 'completed' };
    circular['self'] = circular;
    const message: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      events: [{ kind: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [circular] } }],
    };
    const { result } = renderHook(() => usePinnedTodos([message]));
    expect(result.current.allComplete).toBe(true);
    // Must not throw despite JSON.stringify failing internally, and dismiss() must
    // still work off the String(input) fallback key.
    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(false);
  });
});
