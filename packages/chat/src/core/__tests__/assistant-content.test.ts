import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { assistantContentFromEvents, legacyAssistantContentFromEvents } from '../assistant-content.js';

describe('assistantContentFromEvents — a working note is never glued onto the answer', () => {
  it('puts a paragraph break where a tool call sat between two text runs (the saved-row bug)', () => {
    const events: AgentEvent[] = [
      { kind: 'text', text: 'Need project id. Find list_projects.' },
      { kind: 'tool_use', id: 't1', name: 'mcp__supabase__list_projects', input: {} },
      { kind: 'tool_result', toolUseId: 't1', content: '[]', isError: false },
      { kind: 'text', text: '`test_table` now exists' },
      { kind: 'text', text: ' in your project.' },
    ];
    expect(assistantContentFromEvents({ events })).toBe('Need project id. Find list_projects.\n\n`test_table` now exists in your project.');
  });

  it('keeps streamed deltas of one run joined exactly, and adds no break before the first run', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 't1', name: 'Read', input: {} },
      { kind: 'text', text: 'Hel' },
      { kind: 'text', text: 'lo' },
    ];
    expect(assistantContentFromEvents({ events })).toBe('Hello');
  });

  it('does not create another text step when a Claude tool ID is replayed between deltas', () => {
    const call = { kind: 'tool_use', id: 't1', name: 'Read', input: {} } as const;
    expect(assistantContentFromEvents({ events: [
      call,
      { kind: 'text', text: 'Hel' },
      { ...call, input: { replay: true } },
      { kind: 'text', text: 'lo' },
      { ...call, id: 't2' },
      { kind: 'text', text: 'Done.' },
    ] })).toBe('Hello\n\nDone.');
  });

  it('breaks at a card too, and never doubles an existing line break', () => {
    expect(
      assistantContentFromEvents({ events: [
        { kind: 'text', text: 'Pick one:\n' },
        { kind: 'ext', name: 'mcp-ui', data: {} },
        { kind: 'text', text: 'Thanks.' },
      ] }),
    ).toBe('Pick one:\n\nThanks.');
    expect(
      assistantContentFromEvents({ events: [
        { kind: 'text', text: 'A' },
        { kind: 'tool_use', id: 't', name: 'x', input: {} },
        { kind: 'text', text: '\nB' },
      ] }),
    ).toBe('A\nB');
  });
});

describe('assistantContentFromEvents — edges', () => {
  it('returns an empty string for no events', () => {
    expect(assistantContentFromEvents({ events: undefined })).toBe('');
  });

  it('skips an empty text delta without consuming the pending step break', () => {
    expect(assistantContentFromEvents({ events: [
      { kind: 'text', text: 'A' },
      { kind: 'tool_use', id: 't', name: 'x', input: {} },
      { kind: 'text', text: '' },
      { kind: 'text', text: 'B' },
    ] })).toBe('A\n\nB');
  });

  it('adds no second break when the earlier run already ends with a paragraph break', () => {
    expect(assistantContentFromEvents({ events: [
      { kind: 'text', text: 'A\n\n' },
      { kind: 'tool_use', id: 't', name: 'x', input: {} },
      { kind: 'text', text: 'B' },
    ] })).toBe('A\n\nB');
  });

  it('does not treat a tool_result alone as a step boundary', () => {
    expect(assistantContentFromEvents({ events: [
      { kind: 'text', text: 'A' },
      { kind: 'tool_result', toolUseId: 't', content: 'ok', isError: false },
      { kind: 'text', text: 'B' },
    ] })).toBe('AB');
  });

  it('does not mutate the caller\'s readonly event list', () => {
    const events: readonly AgentEvent[] = Object.freeze([
      { kind: 'tool_use', id: 't', name: 'x', input: {} },
      { kind: 'tool_use', id: 't', name: 'x', input: {} },
      { kind: 'text', text: 'A' },
    ]);
    expect(assistantContentFromEvents({ events })).toBe('A');
    expect(events).toHaveLength(3);
  });
});

describe('legacyAssistantContentFromEvents', () => {
  it('glues every text event together, ignoring tool calls between them', () => {
    expect(legacyAssistantContentFromEvents({ events: [
      { kind: 'text', text: 'Need id.' },
      { kind: 'tool_use', id: 't', name: 'x', input: {} },
      { kind: 'text', text: 'Done.' },
    ] })).toBe('Need id.Done.');
  });

  it('returns an empty string for no events', () => {
    expect(legacyAssistantContentFromEvents({ events: undefined })).toBe('');
  });
});
