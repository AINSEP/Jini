import { describe, expect, it } from 'vitest';
import { resolveTimeoutMs } from '../close-status.js';

// F1 fix wave (Stryker L8 §4 close-status.ts:75-79): configured timeout parsing and the precedence chain.
describe('resolveTimeoutMs — F1 precedence table', () => {
  const base = { defaultMs: 1000, maxMs: 5000 };
  it.each<[string, string | undefined, number | undefined, number]>([
    ['valid configured timeout wins over agent default', '2500', 3000, 2500],
    ['configured "0" is not positive → agent default', '0', 3000, 3000],
    ['configured "-5" → agent default', '-5', 3000, 3000],
    ['configured "abc" (NaN) → agent default', 'abc', 3000, 3000],
    ['configured "Infinity" is not finite → agent default', 'Infinity', 3000, 3000],
    ['configured timeout absent → agent default', undefined, 3000, 3000],
    ['configured timeout absent, no agent default → kernel default', undefined, undefined, 1000],
    ['configured timeout invalid, no agent default → kernel default', 'nope', undefined, 1000],
    ['configured timeout above max is clamped', '999999', undefined, 5000],
    ['agent default above max is clamped', undefined, 9000, 5000],
    ['configured timeout exactly max', '5000', undefined, 5000],
    ['configured timeout fractional positive accepted', '0.5', undefined, 0.5],
  ])('%s', (_l, raw, agentDefaultMs, expected) => {
    expect(resolveTimeoutMs(base, { configuredTimeoutMs: raw, ...(agentDefaultMs === undefined ? {} : { agentDefaultMs }) })).toBe(expected);
  });
  it('an absent configured timeout uses the kernel default', () => {
    expect(resolveTimeoutMs(base, { configuredTimeoutMs: undefined })).toBe(1000);
  });
});
