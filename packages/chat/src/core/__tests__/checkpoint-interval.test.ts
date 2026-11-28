import { describe, expect, it } from 'vitest';
import { checkpointIntervalMs, checkpointProgress } from '../index.js';

describe('checkpointIntervalMs', () => {
  it.each([
    [0, 1_000],
    [999_999, 1_000],
    [1_000_000, 3_000],
    [1_000_001, 3_000],
    [4_999_999, 3_000],
    [5_000_000, 10_000],
    [5_000_001, 10_000],
    [8_000_000, 10_000],
  ])('uses %i bytes to select %i ms', (bytes, expected) => {
    expect(checkpointIntervalMs({ bytes })).toBe(expected);
  });
});

it('thinking and receipt events count as progress; status, usage and raw do not', () => {
  expect(checkpointProgress({ events: [
    { kind: 'text', text: 'a' }, { kind: 'thinking', text: 'think' },
    { kind: 'ext', name: 'user_message', data: { content: 'follow-up' } },
    { kind: 'status', label: 'waiting' }, { kind: 'usage', inputTokens: 1 }, { kind: 'raw', line: 'noise' },
  ] })).toEqual({ textCharacters: 6, extensionEvents: 1, tools: new Set() });
});

it('records each tool call and tool result once, keyed by its id', () => {
  expect(checkpointProgress({ events: [
    { kind: 'tool_use', id: 'call-1', name: 'search', input: {} },
    { kind: 'tool_result', toolUseId: 'call-1', content: 'ok', isError: false },
    { kind: 'tool_use', id: 'call-1', name: 'search', input: {} },
    { kind: 'tool_use', id: 'call-2', name: 'read', input: {} },
  ] })).toEqual({ textCharacters: 0, extensionEvents: 0, tools: new Set(['tool_use:call-1', 'tool_result:call-1', 'tool_use:call-2']) });
});
