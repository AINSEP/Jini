import { expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import type { ChatMessage } from '../messages.js';
import { conversationUsage } from '../turn-usage.js';
import { formatUsageCost } from '../usage-format.js';
import { mergeRunEvents } from '../durable-projection.js';
import { parseUsageEvent } from '../run-events/entry.js';
import { reduceAgentWirePayload } from '../ag-ui/entry.js';

const message = (id: string, events: AgentEvent[], agentId = 'claude'): ChatMessage => ({ id, role: 'assistant', content: '', agentId, events });
const snapshot = (session: string, cumulative: number): AgentEvent => ({ kind: 'usage', costSessionId: session, cumulativeCostUsd: cumulative });

it('subtracts resumed session snapshots and adds all turn charges across agent and session switches', () => {
  const messages = [message('a', [snapshot('s', 2.05)]),
    { id: 'user', role: 'user' as const, content: '', events: [{ kind: 'usage' as const, costUsd: 99 }] },
    message('b', [snapshot('s', 2.5)]), message('c', [{ kind: 'usage', costUsd: 0.25 }], 'pi'),
    message('d', [snapshot('new', 0.5)]), message('e', [snapshot('new', 0.75)])];
  const usage = conversationUsage({ messages });
  expect(usage.get('a')).toEqual({ kind: 'usage', costUsd: 2.05, totalCostUsd: 2.05 });
  expect(formatUsageCost({ costUsd: usage.get('b')!.costUsd!, totalCostUsd: usage.get('b')!.totalCostUsd! })).toBe('$0.45 (Total: $2.50)');
  expect(usage.get('c')).toEqual({ kind: 'usage', costUsd: 0.25, totalCostUsd: 2.75 });
  expect(usage.get('d')).toEqual({ kind: 'usage', costUsd: 0.5, totalCostUsd: 3.25 });
  expect(usage.get('e')).toEqual({ kind: 'usage', costUsd: 0.25, totalCostUsd: 3.5 });
  expect(conversationUsage({ messages: JSON.parse(JSON.stringify(messages)) })).toEqual(usage);
});

it('keeps separate baselines per agent even when their session IDs collide', () => {
  const usage = conversationUsage({ messages: [message('a', [snapshot('s', 1)]),
    message('b', [snapshot('s', 4)], 'second'), message('c', [snapshot('s', 1.25)])] });
  expect(usage.get('b')).toEqual({ kind: 'usage', costUsd: 4, totalCostUsd: 5 });
  expect(usage.get('c')).toEqual({ kind: 'usage', costUsd: 0.25, totalCostUsd: 5.25 });
});

it('does not double count interrupted charges, repeated snapshots, or replayed events', () => {
  const events = [snapshot('s', 1), { kind: 'usage' as const, costUsd: 0.25, costSessionId: 's' }, snapshot('s', 1.5)];
  const replayed = mergeRunEvents({ saved: events, incoming: events });
  const usage = conversationUsage({ messages: [message('a', replayed), message('b', [snapshot('s', 1.5)]),
    message('regressed', [snapshot('s', 0)]), message('c', [snapshot('s', 1.75)])] });
  expect(usage.get('a')).toEqual({ kind: 'usage', costUsd: 1.5, totalCostUsd: 1.5 });
  expect(usage.get('b')).toEqual({ kind: 'usage', costUsd: 0, totalCostUsd: 1.5 });
  expect(usage.get('regressed')).toEqual({ kind: 'usage', costUsd: 0, totalCostUsd: 1.5 });
  expect(usage.get('c')).toEqual({ kind: 'usage', costUsd: 1.75, totalCostUsd: 3.25 });
});

it('preserves missing costs and does not estimate money from tokens or invalid values', () => {
  const usage = conversationUsage({ messages: [message('missing', [{ kind: 'usage', outputTokens: 99 }]),
    message('bad', [{ kind: 'usage', costUsd: NaN, cumulativeCostUsd: Infinity, costSessionId: 's' }]),
    message('paid', [snapshot('s', 0.5)])] });
  expect(usage.get('missing')).toEqual({ kind: 'usage', outputTokens: 99 });
  expect(usage.get('bad')).toEqual({ kind: 'usage' });
  expect(usage.get('paid')).toEqual({ kind: 'usage', costUsd: 0.5, totalCostUsd: 0.5 });
});

it('preserves metadata in both native and AG-UI persisted event projections', () => {
  const payload = { type: 'usage', cumulativeCostUsd: 2.5, costSessionId: 's' };
  expect(parseUsageEvent({ payload })).toEqual(snapshot('s', 2.5));
  expect(reduceAgentWirePayload({ payload })).toEqual(snapshot('s', 2.5));
});

it.each([
  [0.445, 2.5, '$0.45 (Total: $2.50)'],
  [0.4028355, 1.0001, '$0.41 (Total: $1.01)'],
  [0.07, 0.14, '$0.07 (Total: $0.14)'],
  [25.60 - 25.15, Array.from({ length: 200 }, () => 0.07).reduce((a, b) => a + b, 0), '$0.45 (Total: $14.00)'],
  [0, 0, '$0.00 (Total: $0.00)'],
  [1e-16, 1e-16, '$0.01 (Total: $0.01)'],
  [0.004, 0.008, '$0.01 (Total: $0.01)'],
] as const)('rounds only the displayed amounts up to cents: %s, %s', (costUsd, totalCostUsd, expected) => {
  expect(formatUsageCost({ costUsd, totalCostUsd })).toBe(expected);
});

it('charges nonzero counter resets and resumes from the new baseline', () => {
  const usage = conversationUsage({ messages: [message('a', [snapshot('s', 2)]),
    message('reset', [snapshot('s', 0.5)]), message('next', [snapshot('s', 0.75)])] });
  expect(usage.get('reset')).toEqual({ kind: 'usage', costUsd: 0.5, totalCostUsd: 2.5 });
  expect(usage.get('next')).toEqual({ kind: 'usage', costUsd: 0.25, totalCostUsd: 2.75 });
});
it('revisits session A after B without charging A twice, even with ambiguous delimiter IDs', () => {
  const usage = conversationUsage({ messages: [message('a', [snapshot('a', 1)], 'agent:b'),
    message('b', [snapshot('b:a', 2)], 'agent'), message('c', [snapshot('a', 1.25)], 'agent:b')] });
  expect(usage.get('c')).toEqual({ kind: 'usage', costUsd: 0.25, totalCostUsd: 3.25 });
});
