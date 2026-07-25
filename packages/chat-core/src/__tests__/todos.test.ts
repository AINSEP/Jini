import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import {
  isTodoWriteToolName,
  latestTodosFromEvents,
  latestTodoWriteInput,
  latestTodoWriteInputForPinnedCard,
  parseTodoWriteInput,
  unfinishedTodosFromEvents,
} from '../todos.js';

describe('todos: parseTodoWriteInput', () => {
  it('normalizes several input shapes (todos vs plan array; content/step/label aliases)', () => {
    expect(parseTodoWriteInput({ todos: [{ content: 'a', status: 'completed' }] })).toEqual([{ content: 'a', status: 'completed', activeForm: undefined }]);
    expect(parseTodoWriteInput({ plan: [{ step: 'b' }] })[0]?.content).toBe('b');
  });

  it('falls back through description/label/text aliases in priority order', () => {
    expect(parseTodoWriteInput({ todos: [{ description: 'd' }] })[0]?.content).toBe('d');
    expect(parseTodoWriteInput({ todos: [{ label: 'l' }] })[0]?.content).toBe('l');
    expect(parseTodoWriteInput({ todos: [{ text: 't' }] })[0]?.content).toBe('t');
  });

  it('maps an unrecognized/cancelled status to "stopped" and an unknown status to "pending"', () => {
    const [cancelled] = parseTodoWriteInput({ todos: [{ content: 'x', status: 'cancelled' }] });
    expect(cancelled?.status).toBe('stopped');
    const [unknown] = parseTodoWriteInput({ todos: [{ content: 'y', status: 'bogus' }] });
    expect(unknown?.status).toBe('pending');
  });

  it('reads activeForm from either the camelCase or snake_case key', () => {
    expect(parseTodoWriteInput({ todos: [{ content: 'a', activeForm: 'Doing A' }] })[0]?.activeForm).toBe('Doing A');
    expect(parseTodoWriteInput({ todos: [{ content: 'a', active_form: 'Doing A' }] })[0]?.activeForm).toBe('Doing A');
  });

  it('drops entries with no recognizable body text instead of throwing', () => {
    expect(parseTodoWriteInput({ todos: [{ status: 'pending' }, { content: 'kept' }] })).toEqual([{ content: 'kept', status: 'pending', activeForm: undefined }]);
  });

  it('drops a non-object entry within the array without throwing', () => {
    expect(parseTodoWriteInput({ todos: [42, { content: 'kept' }] })).toEqual([{ content: 'kept', status: 'pending', activeForm: undefined }]);
  });

  it('returns [] for non-object input', () => {
    expect(parseTodoWriteInput(null)).toEqual([]);
    expect(parseTodoWriteInput('nope')).toEqual([]);
  });

  it('returns [] when the input object has neither a todos nor a plan array', () => {
    expect(parseTodoWriteInput({ id: 'x' })).toEqual([]);
  });
});

describe('todos: isTodoWriteToolName', () => {
  it('accepts every documented spelling and rejects an unrelated tool name', () => {
    expect(isTodoWriteToolName('TodoWrite')).toBe(true);
    expect(isTodoWriteToolName('update_plan')).toBe(true);
    expect(isTodoWriteToolName('Read')).toBe(false);
  });
});

describe('todos: latest-plan derivation', () => {
  const planEvents: AgentEvent[] = [
    { kind: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [{ content: 'first', status: 'completed' }] } },
    { kind: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [{ content: 'first', status: 'completed' }, { content: 'second', status: 'in_progress' }] } },
  ];

  it('latestTodosFromEvents returns only the most recent TodoWrite snapshot, not the first', () => {
    expect(latestTodosFromEvents(planEvents)).toHaveLength(2);
  });

  it('unfinishedTodosFromEvents filters the latest snapshot down to non-completed items', () => {
    const unfinished = unfinishedTodosFromEvents(planEvents);
    expect(unfinished).toHaveLength(1);
    expect(unfinished[0]?.content).toBe('second');
  });

  it('latestTodoWriteInput (alias for latestTodoWriteInputFromMessages) scans messages newest-first across a conversation', () => {
    const messages = [{ events: planEvents.slice(0, 1) }, { events: planEvents.slice(1) }];
    const secondEvent = planEvents[1];
    const expectedInput = secondEvent?.kind === 'tool_use' ? secondEvent.input : undefined;
    expect(latestTodoWriteInput(messages)).toEqual(expectedInput);
  });

  it('latestTodoWriteInputForPinnedCard leaves an active run untouched but flips a stuck in_progress item to "stopped" once the run is terminal', () => {
    const messages = [{ events: planEvents.slice(1), runStatus: 'running' as const, endedAt: undefined }];
    const active = latestTodoWriteInputForPinnedCard(messages) as { todos: Array<{ status: string }> };
    expect(active.todos[1]?.status).toBe('in_progress');

    const terminalMessages = [{ events: planEvents.slice(1), runStatus: 'failed' as const, endedAt: 1000 }];
    const stopped = latestTodoWriteInputForPinnedCard(terminalMessages) as { todos: Array<{ status: string }> };
    expect(stopped.todos[1]?.status).toBe('stopped');
    expect(stopped.todos[0]?.status).toBe('completed'); // an already-completed item is left alone
  });

  it('returns null when no message carries a plan tool call', () => {
    expect(latestTodoWriteInputForPinnedCard([{ events: [{ kind: 'text', text: 'hi' }] }])).toBeNull();
  });

  it('returns null when a message has a tool_use event whose name is not a recognized plan-tool spelling', () => {
    const events: AgentEvent[] = [{ kind: 'tool_use', id: 't', name: 'Read', input: {} }];
    expect(latestTodoWriteInputForPinnedCard([{ events }])).toBeNull();
  });

  it('latestTodosFromEvents returns [] for undefined, an empty array, and when no event is a matching plan tool_use', () => {
    expect(latestTodosFromEvents(undefined)).toEqual([]);
    expect(latestTodosFromEvents([])).toEqual([]);
    expect(latestTodosFromEvents([{ kind: 'text', text: 'hi' }, { kind: 'tool_use', id: 't', name: 'Read', input: {} }])).toEqual([]);
  });

  it('latestTodoWriteInputFromMessages returns null for undefined/empty messages, messages with no events, and no matching tool_use', () => {
    expect(latestTodoWriteInput(undefined)).toBeNull();
    expect(latestTodoWriteInput([])).toBeNull();
    expect(latestTodoWriteInput([{ events: [] }, { events: undefined }])).toBeNull();
    expect(
      latestTodoWriteInput([{ events: [{ kind: 'text', text: 'hi' }, { kind: 'tool_use', id: 't', name: 'Read', input: {} }] }]),
    ).toBeNull();
  });

  it('latestTodoWriteInputForPinnedCard treats a message with no runStatus and no endedAt as still-active (not terminal)', () => {
    const messages = [{ events: planEvents.slice(1), runStatus: undefined, endedAt: undefined }];
    const result = latestTodoWriteInputForPinnedCard(messages) as { todos: Array<{ status: string }> };
    expect(result.todos[1]?.status).toBe('in_progress');
  });

  it('latestTodoWriteInputForPinnedCard treats a message with no runStatus but a defined endedAt as terminal', () => {
    const messages = [{ events: planEvents.slice(1), runStatus: undefined, endedAt: 1000 }];
    const result = latestTodoWriteInputForPinnedCard(messages) as { todos: Array<{ status: string }> };
    expect(result.todos[1]?.status).toBe('stopped');
  });

  it('latestTodoWriteInputForPinnedCard returns null for undefined/empty messages and skips messages with no events', () => {
    expect(latestTodoWriteInputForPinnedCard(undefined)).toBeNull();
    expect(latestTodoWriteInputForPinnedCard([])).toBeNull();
    expect(latestTodoWriteInputForPinnedCard([{ events: [] }, { events: undefined }])).toBeNull();
  });

  it('stoppedTodoWriteInput (via the pinned-card path) leaves a non-object or keyless input completely untouched', () => {
    const events1: AgentEvent[] = [{ kind: 'tool_use', id: 't', name: 'TodoWrite', input: null }];
    const messages1 = [{ events: events1, runStatus: 'succeeded' as const }];
    expect(latestTodoWriteInputForPinnedCard(messages1)).toBeNull();

    const events2: AgentEvent[] = [{ kind: 'tool_use', id: 't', name: 'TodoWrite', input: { id: 'no-list-keys' } }];
    const messages2 = [{ events: events2, runStatus: 'succeeded' as const }];
    expect(latestTodoWriteInputForPinnedCard(messages2)).toEqual({ id: 'no-list-keys' });
  });

  it('stoppedTodoWriteInput leaves a non-object item within the list untouched and remaps a "plan"-keyed list too', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 't', name: 'TodoWrite', input: { plan: [42, { content: 'a', status: 'in_progress' }] } },
    ];
    const messages = [{ events, runStatus: 'succeeded' as const }];
    const result = latestTodoWriteInputForPinnedCard(messages) as { plan: unknown[] };
    expect(result.plan[0]).toBe(42);
    expect(result.plan[1]).toMatchObject({ status: 'stopped' });
  });
});
