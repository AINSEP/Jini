import { expect, it } from 'vitest';
import { turnUsage } from '../turn-usage.js';

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
