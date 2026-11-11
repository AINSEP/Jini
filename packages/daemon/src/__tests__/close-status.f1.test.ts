import { describe, expect, it } from 'vitest';
import { resolveTimeoutMs } from '../close-status.js';

// F1 fix wave (Stryker L8 §4 close-status.ts:75-79): env override parsing and the precedence chain.
describe('resolveTimeoutMs — F1 precedence table', () => {
  const base = { defaultMs: 1000, maxMs: 5000 };
  it.each<[string, string | undefined, number | undefined, number]>([
    ['valid env wins over agent default', '2500', 3000, 2500],
    ['env "0" is not positive → agent default', '0', 3000, 3000],
    ['env "-5" → agent default', '-5', 3000, 3000],
    ['env "abc" (NaN) → agent default', 'abc', 3000, 3000],
    ['env "Infinity" is not finite → agent default', 'Infinity', 3000, 3000],
    ['env absent → agent default', undefined, 3000, 3000],
    ['env absent, no agent default → kernel default', undefined, undefined, 1000],
    ['env invalid, no agent default → kernel default', 'nope', undefined, 1000],
    ['env above max is clamped', '999999', undefined, 5000],
    ['agent default above max is clamped', undefined, 9000, 5000],
    ['env exactly max', '5000', undefined, 5000],
    ['env fractional positive accepted', '0.5', undefined, 0.5],
  ])('%s', (_l, raw, agentDefaultMs, expected) => {
    const env = raw === undefined ? {} : { T: raw };
    expect(resolveTimeoutMs(base, { envVar: 'T', env, ...(agentDefaultMs === undefined ? {} : { agentDefaultMs }) })).toBe(expected);
  });
  it('without an envVar name the env is never consulted', () => {
    expect(resolveTimeoutMs(base, { env: { T: '2500', undefined: '2500' } as never })).toBe(1000);
  });
});
