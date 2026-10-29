import { expect, test } from 'vitest';
import { conversationUsage, replySegments, turnUsage } from '../turn-usage.js';
import type { AgentEvent } from '../events.js';

test('legacy boundary data without an id splits every reply, while a repeated receipt id splits once', () => {
  const text: AgentEvent = { kind: 'text', text: 'reply' };
  const legacy: AgentEvent = { kind: 'ext', name: 'user_message', data: null };
  const malformed: AgentEvent = { kind: 'ext', name: 'user_message', data: { id: 3 } };
  const receipt: AgentEvent = { kind: 'ext', name: 'user_message', data: { id: 'input' } };
  expect(replySegments({ events: [text, legacy, text, malformed, text, receipt, text, receipt, text] })).toEqual([
    [text], [text], [text], [text, text],
  ]);
});

test('unknown session snapshots do not erase the baseline, and invalid charges do not manufacture zero cost', () => {
  const sessions = new Map<string, { sessionId: string; chargedUsd: number }>();
  const usage = (event: Extract<AgentEvent, { kind: 'usage' }>) => turnUsage({ events: [event] }, { sessions, agentId: 'agent' });
  expect(usage({ kind: 'usage', costSessionId: 'session', cumulativeCostUsd: 2 })).toEqual({ kind: 'usage', costUsd: 2 });
  expect(usage({ kind: 'usage', costSessionId: 'session', cumulativeCostUsd: NaN, costUsd: -1 })).toEqual({ kind: 'usage' });
  expect(usage({ kind: 'usage', costSessionId: 'session', cumulativeCostUsd: 3 })).toEqual({ kind: 'usage', costUsd: 1 });
  expect(conversationUsage({ messages: [{ id: 'a', role: 'assistant', content: '',
    events: [{ kind: 'usage', inputTokens: 4 }, { kind: 'ext', name: 'user_message', data: null }, { kind: 'text', text: 'second' }] }] }).get('a')).toEqual({
    kind: 'usage', inputTokens: 4, segments: [{ kind: 'usage', inputTokens: 4 }, undefined],
  });
});
