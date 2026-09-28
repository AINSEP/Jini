import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { mergeAdjacentTextEvents } from '../compact-events.js';
import { assistantContentFromEvents } from '../assistant-content.js';

describe('mergeAdjacentTextEvents', () => {
  it('joins streamed text deltas into one text event and thinking deltas into one thinking event', () => {
    const events: AgentEvent[] = [
      { kind: 'status', label: 'initializing' },
      { kind: 'thinking', text: 'Need ' },
      { kind: 'thinking', text: 'the posts.' },
      { kind: 'tool_use', id: 't1', name: 'search_tools', input: { q: 'posts' } },
      { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
      { kind: 'text', text: 'Here' },
      { kind: 'text', text: ' are your' },
      { kind: 'text', text: ' 6 posts.' },
      { kind: 'usage', outputTokens: 12 },
    ];
    expect(mergeAdjacentTextEvents(events)).toEqual([
      { kind: 'status', label: 'initializing' },
      { kind: 'thinking', text: 'Need the posts.' },
      { kind: 'tool_use', id: 't1', name: 'search_tools', input: { q: 'posts' } },
      { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
      { kind: 'text', text: 'Here are your 6 posts.' },
      { kind: 'usage', outputTokens: 12 },
    ]);
  });

  it('never merges across a tool call, card or any other event, so step boundaries survive', () => {
    const events: AgentEvent[] = [
      { kind: 'text', text: 'Checking.' },
      { kind: 'tool_use', id: 't1', name: 'x', input: {} },
      { kind: 'text', text: 'Done' },
      { kind: 'raw', line: '{"type":"system"}\n' },
      { kind: 'text', text: '.' },
      { kind: 'ext', name: 'card', data: {} },
      { kind: 'text', text: 'After.' },
      { kind: 'thinking', text: 'hm' },
      { kind: 'text', text: 'Tail' },
    ];
    const merged = mergeAdjacentTextEvents(events);
    expect(merged).toEqual(events);
    expect(assistantContentFromEvents(merged)).toBe(assistantContentFromEvents(events));
  });

  it('keeps the saved content identical and does not mutate its input', () => {
    const events: AgentEvent[] = [
      { kind: 'text', text: 'a' },
      { kind: 'text', text: 'b' },
      { kind: 'tool_use', id: 't', name: 'n', input: {} },
      { kind: 'text', text: 'c' },
      { kind: 'text', text: '' },
      { kind: 'text', text: 'd' },
    ];
    const before = JSON.stringify(events);
    const merged = mergeAdjacentTextEvents(events);
    expect(merged).toEqual([
      { kind: 'text', text: 'ab' },
      { kind: 'tool_use', id: 't', name: 'n', input: {} },
      { kind: 'text', text: 'cd' },
    ]);
    expect(JSON.stringify(events)).toBe(before);
    expect(assistantContentFromEvents(merged)).toBe(assistantContentFromEvents(events));
  });

  it('returns an empty list for no events', () => {
    expect(mergeAdjacentTextEvents(undefined)).toEqual([]);
    expect(mergeAdjacentTextEvents([])).toEqual([]);
  });
});
