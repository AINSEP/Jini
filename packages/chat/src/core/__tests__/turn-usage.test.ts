import { expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import type { ChatMessage } from '../messages.js';
import { conversationUsage, replySegments, turnUsage } from '../turn-usage.js';

it('sums every reported segment field independently without filling unknown fields with zero', () => {
  const total = turnUsage({ events: [
    { kind: 'usage', inputTokens: 100, outputTokens: 995, durationMs: 13_000 },
    { kind: 'text', text: 'Next segment' },
    { kind: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.0198, durationMs: 1_000 },
    { kind: 'usage', costUsd: 0.03 },
  ] }, {});
  expect(total).toMatchObject({ kind: 'usage', inputTokens: 110, outputTokens: 1000, durationMs: 14_000 });
  expect(total?.costUsd).toBeCloseTo(0.0498, 8);
  expect(turnUsage({ events: [{ kind: 'usage', outputTokens: 0 }, { kind: 'usage', outputTokens: NaN }] }, {})).toEqual({ kind: 'usage', outputTokens: 0 });
  expect(turnUsage({ events: [{ kind: 'usage', costUsd: 0.02 }] }, {})).toEqual({ kind: 'usage', costUsd: 0.02 });
  expect(turnUsage({ events: [] }, {})).toBeUndefined();
});

const boundary = (id: string): AgentEvent => ({ kind: 'ext', name: 'user_message', data: { id, text: id } });

it('keeps each reply stop reason and uses the final reason for a whole-turn summary', () => {
  const usage = conversationUsage({ messages: [{ id: 'a', role: 'assistant', content: 'First then second', events: [
    { kind: 'text', text: 'First' }, { kind: 'usage', costUsd: 0.1, stopReason: 'aborted_streaming' },
    boundary('next'), { kind: 'text', text: 'then second' },
    { kind: 'usage', costUsd: 0.2, stopReason: 'end_turn' }, { kind: 'usage', outputTokens: 4 },
  ] }] }).get('a');
  expect(usage?.stopReason).toBe('end_turn');
  expect(usage?.segments?.map(segment => segment?.stopReason)).toEqual(['aborted_streaming', 'end_turn']);
});

it('splits a run at each mid-run user message, keeping a late interrupted-reply result with the reply before', () => {
  const late = { kind: 'usage', costUsd: 0.03 } as const;
  const segments = replySegments({ events: [
    { kind: 'text', text: 'first' }, boundary('m1'), late, { kind: 'text', text: 'second' },
    { kind: 'usage', costUsd: 0.02 }, boundary('m2'), { kind: 'tool_use', id: 't', name: 'Bash', input: {} },
  ] });
  expect(segments).toEqual([
    [{ kind: 'text', text: 'first' }, late],
    [{ kind: 'text', text: 'second' }, { kind: 'usage', costUsd: 0.02 }],
    [{ kind: 'tool_use', id: 't', name: 'Bash', input: {} }],
  ]);
  expect(replySegments({ events: undefined })).toEqual([[]]);
});

it('gives a message with mid-run replies one usage entry per reply, each with its own prefix total', () => {
  const messages = [
    { id: 'a', role: 'assistant' as const, content: 'a', events: [{ kind: 'usage' as const, costUsd: 0.5 }] },
    { id: 'b', role: 'assistant' as const, content: 'b', events: [
      { kind: 'usage' as const, costUsd: 0.25, durationMs: 4_000 }, boundary('m1'), { kind: 'text' as const, text: 'b' },
      { kind: 'usage' as const, costUsd: 0.125, durationMs: 2_000 }, boundary('m2'), { kind: 'text' as const, text: 'running' },
    ] },
  ];
  const usage = conversationUsage({ messages });
  expect(usage.get('a')).toEqual({ kind: 'usage', costUsd: 0.5, totalCostUsd: 0.5 });
  expect(usage.get('b')).toEqual({
    kind: 'usage', costUsd: 0.375, durationMs: 6_000, totalCostUsd: 0.875,
    segments: [
      { kind: 'usage', costUsd: 0.25, durationMs: 4_000, totalCostUsd: 0.75 },
      { kind: 'usage', costUsd: 0.125, durationMs: 2_000, totalCostUsd: 0.875 },
      undefined,
    ],
  });
  // Reloaded history (events_json round trip) projects the same per-reply usage.
  expect(conversationUsage({ messages: JSON.parse(JSON.stringify(messages)) })).toEqual(usage);
});

it('derives a tokens-only turn duration from persisted timestamps without inferring cost', () => {
  const message: ChatMessage = {
    id: 'tokens-only', role: 'assistant', content: 'Finished', runStatus: 'succeeded',
    startedAt: 1_000, endedAt: 32_525,
    events: [{ kind: 'usage', inputTokens: 17_035, outputTokens: 93 }],
  };
  expect(conversationUsage({ messages: [message] }).get(message.id)).toEqual({
    kind: 'usage', inputTokens: 17_035, outputTokens: 93, durationMs: 31_525,
  });
  expect(message.events).toEqual([{ kind: 'usage', inputTokens: 17_035, outputTokens: 93 }]);
});

it.each([
  {}, { startedAt: 1_000 }, { endedAt: 32_525 },
  { startedAt: 32_525, endedAt: 1_000 },
  { startedAt: NaN, endedAt: 32_525 }, { startedAt: 0, endedAt: Infinity },
])('keeps duration unknown for missing or invalid timestamps: %j', timestamps => {
  const message: ChatMessage = { id: 'a', role: 'assistant', content: 'Finished', ...timestamps,
    events: [{ kind: 'usage', inputTokens: 17_035, outputTokens: 93 }] };
  expect(conversationUsage({ messages: [message] }).get('a')).toEqual({
    kind: 'usage', inputTokens: 17_035, outputTokens: 93,
  });
});

it('accepts a zero timestamp and a zero elapsed duration', () => {
  expect(conversationUsage({ messages: [{ id: 'a', role: 'assistant', content: 'Finished',
    startedAt: 0, endedAt: 0, events: [{ kind: 'usage', outputTokens: 93 }] }] }).get('a')).toEqual({
    kind: 'usage', outputTokens: 93, durationMs: 0,
  });
});

it.each([0, 7_000])('preserves a reported duration of %i ms over wall-clock time', durationMs => {
  expect(conversationUsage({ messages: [{ id: 'a', role: 'assistant', content: 'Finished',
    startedAt: 1_000, endedAt: 32_525, events: [{ kind: 'usage', durationMs }] }] }).get('a')).toEqual({
    kind: 'usage', durationMs,
  });
});

it('does not assign a whole-run duration to multiple replies', () => {
  const usage = conversationUsage({ messages: [{ id: 'a', role: 'assistant', content: 'Finished',
    startedAt: 1_000, endedAt: 32_525, events: [
      { kind: 'usage', outputTokens: 3 }, boundary('m1'), { kind: 'text', text: 'second' },
      { kind: 'usage', outputTokens: 5 },
    ] }] }).get('a');
  expect(usage).toEqual({ kind: 'usage', outputTokens: 8,
    segments: [{ kind: 'usage', outputTokens: 3 }, { kind: 'usage', outputTokens: 5 }] });
});

it('does not create usage from timestamps alone', () => {
  expect(conversationUsage({ messages: [{ id: 'a', role: 'assistant', content: 'Finished',
    startedAt: 1_000, endedAt: 32_525 }] }).get('a')).toBeUndefined();
});

it('reads missing events as no usage', () => {
  expect(turnUsage({ events: undefined })).toBeUndefined();
});

it('keeps a late usage with the reply before even after status and raw lines, but not after real output', () => {
  const late: AgentEvent = { kind: 'usage', outputTokens: 1 };
  const status: AgentEvent = { kind: 'status', label: 'thinking' };
  const raw: AgentEvent = { kind: 'raw', line: 'x' };
  const text: AgentEvent = { kind: 'text', text: 'second' };
  const after: AgentEvent = { kind: 'usage', outputTokens: 2 };
  expect(replySegments({ events: [boundary('m1'), status, raw, late, text, after] })).toEqual([[late], [status, raw, text, after]]);
});

it('starts a fresh reply after every boundary, so a usage right after the second boundary joins the second reply', () => {
  const text: AgentEvent = { kind: 'text', text: 'two' };
  const late: AgentEvent = { kind: 'usage', outputTokens: 4 };
  expect(replySegments({ events: [boundary('m1'), text, boundary('m2'), late] })).toEqual([[], [text, late], []]);
});

it('skips user messages and leaves a reply without usage as an undefined segment', () => {
  const user: ChatMessage = { id: 'u', role: 'user', content: 'hi', events: [{ kind: 'usage', outputTokens: 9 }] };
  const assistant: ChatMessage = { id: 'a', role: 'assistant', content: 'x', events: [
    { kind: 'text', text: 'no usage' }, boundary('m1'), { kind: 'text', text: 'second' }, { kind: 'usage', costUsd: 0.5 },
  ] };
  const usage = conversationUsage({ messages: [user, assistant] });
  expect([...usage.keys()]).toEqual(['a']);
  expect(usage.get('a')).toEqual({ kind: 'usage', costUsd: 0.5, totalCostUsd: 0.5, segments: [undefined, { kind: 'usage', costUsd: 0.5, totalCostUsd: 0.5 }] });
});


it('counts queued and consumed receipts as one reply boundary and one charge', () => {
  const queued: AgentEvent = { kind: 'ext', name: 'user_message', data: { id: 'u1', text: 'next', deliveryState: 'queued' } };
  const consumed: AgentEvent = { ...queued, data: { id: 'u1', text: 'next', deliveryState: 'consumed' } };
  const events: AgentEvent[] = [
    { kind: 'text', text: 'before' }, queued,
    { kind: 'usage', costUsd: 0.1 }, consumed,
    { kind: 'text', text: 'after' }, { kind: 'usage', costUsd: 0.2 },
  ];
  const usage = conversationUsage({ messages: [{ id: 'reply', role: 'assistant', content: 'beforeafter', events }] }).get('reply');
  expect(usage?.segments).toHaveLength(2);
  expect(usage?.segments?.map(segment => segment?.costUsd)).toEqual([0.1, 0.2]);
  expect(usage?.costUsd).toBeCloseTo(0.3);
});
