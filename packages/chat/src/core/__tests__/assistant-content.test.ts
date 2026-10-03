import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { assistantContentFromEvents } from '../assistant-content.js';

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
