import { expect, it } from 'vitest';
import { createClaudeStreamHandler, type ClaudeStreamEvent } from '../claude-stream.js';

function usageFor(sessionId: string, costBasis: 'session' | 'run' = 'session', cumulativeCostUsd = 2.5) {
  const events: ClaudeStreamEvent[] = [];
  const handler = createClaudeStreamHandler({ onEvent: event => events.push(event) }, { costBasis });
  handler.feed({ chunk: `${JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId })}\n` });
  handler.feed({ chunk: `${JSON.stringify({ type: 'result', total_cost_usd: cumulativeCostUsd, duration_ms: 10 })}\n` });
  return events.find(event => event.type === 'usage');
}

it('keeps Claude session cost identifiable across independent resumed parsers, without labeling it per-run', () => {
  expect(usageFor('same')).toEqual({ type: 'usage', usage: null, costUsd: null, durationMs: 10,
    stopReason: null, costSessionId: 'same', cumulativeCostUsd: 2.5 });
  expect(usageFor('same', 'session', 3)).toMatchObject({ cumulativeCostUsd: 3, costSessionId: 'same', costUsd: null });
  expect(usageFor('new')).toMatchObject({ cumulativeCostUsd: 2.5, costSessionId: 'new' });
});

it('retains per-run reporting for other agents using the compatible parser', () => {
  expect(usageFor('amp-session', 'run')).toEqual({ type: 'usage', usage: null,
    costUsd: 2.5, durationMs: 10, stopReason: null });
});

it('captures a result-only session identity and preserves an interrupted model-cost fallback', () => {
  const events: ClaudeStreamEvent[] = [];
  const handler = createClaudeStreamHandler({ onEvent: event => events.push(event) }, { nowMs: () => 0 });
  handler.feed({ chunk: `${JSON.stringify({ type: 'result', session_id: 's', total_cost_usd: 0,
    terminal_reason: 'aborted_streaming', modelUsage: { model: { costUSD: 0.03 } } })}\n` });
  expect(events.find(event => event.type === 'usage')).toEqual({ type: 'usage', usage: null,
    costUsd: 0.03, costSessionId: 's', durationMs: 0, stopReason: 'aborted_streaming' });
});
