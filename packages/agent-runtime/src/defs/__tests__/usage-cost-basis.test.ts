import { expect, it } from 'vitest';
import { claudeAgentDef } from '../claude.js';
import { createClaudeStreamHandler, type ClaudeStreamEvent } from '../../claude-stream.js';

it('the Claude adapter declares session costs, including when a host renames it', () => {
  const renamed = { ...claudeAgentDef, id: 'renamed-adapter' };
  const events: ClaudeStreamEvent[] = [];
  const handler = createClaudeStreamHandler({ onEvent: event => events.push(event) }, { costBasis: renamed.usageCostBasis });
  handler.feed({ chunk: JSON.stringify({ type: 'result', session_id: 'session', total_cost_usd: 2.5, duration_ms: 100 }) + '\n' });
  expect(renamed.usageCostBasis).toBe('session');
  expect(events).toEqual([{ type: 'usage', usage: null, costUsd: null, cumulativeCostUsd: 2.5, costSessionId: 'session', durationMs: 100, stopReason: null }]);
});
