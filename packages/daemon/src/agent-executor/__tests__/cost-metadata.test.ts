import { expect, it } from 'vitest';
import { translateAgentRuntimeEvent } from '../event-translation.js';

it('carries cumulative cost and session identity into the durable run wire payload', () => {
  expect(translateAgentRuntimeEvent({ rawEvent: { type: 'usage', costUsd: null,
    cumulativeCostUsd: 2.5, costSessionId: 'claude-session', durationMs: 100 } })).toEqual({
    kind: 'agent', payload: { type: 'usage', cumulativeCostUsd: 2.5,
      costSessionId: 'claude-session', durationMs: 100 },
  });
});

it('ignores malformed metadata and leaves existing per-run cost intact', () => {
  expect(translateAgentRuntimeEvent({ rawEvent: { type: 'usage', costUsd: 0.25,
    cumulativeCostUsd: '2.5', costSessionId: 42 } })).toEqual({
    kind: 'agent', payload: { type: 'usage', costUsd: 0.25 },
  });
});
