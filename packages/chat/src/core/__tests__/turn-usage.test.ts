import { expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
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
