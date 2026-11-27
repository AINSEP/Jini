import { describe, expect, it } from 'vitest';
import { isAgentEventAction, isLocalFunctionAction, parseDynamicValue, type Action } from '../common-types.js';

it.each([
  { value: false }, { value: 0 }, { value: 'literal' }, { value: ['nested', 0, false] },
  { value: { path: '/customer/name' } },
  { value: { call: 'format', args: { value: { path: '/total' }, digits: 2 } } },
])('preserves a supported A2UI value $value', ({ value }) => {
  expect(parseDynamicValue({ value })).toEqual({ ok: true, value });
});

it.each([
  { value: null }, { value: undefined }, { value: { path: 12 } }, { value: { call: 'format', args: ['wrong'] } },
])('returns a validation error for an unsupported A2UI value $value', ({ value }) => {
  expect(parseDynamicValue({ value })).toEqual({ ok: false, error: 'Invalid input' });
});

// `interpreter.ts`'s `buildAction` relies on TypeScript's own control-flow narrowing after
// `isLocalFunctionAction` rather than calling `isAgentEventAction` a second time (see that
// file's comment on why the second check is unreachable-by-construction there) — but both type
// guards are still real, exported public API a host renderer may use directly (e.g. to decide how
// to label an interactive component before dispatch), so they get their own direct test here
// rather than only being exercised indirectly.
describe('isAgentEventAction / isLocalFunctionAction', () => {
  const agentAction: Action = { event: { name: 'submit' } };
  const localAction: Action = { functionCall: { call: 'and', args: { values: [true, true] } } };

  it('correctly discriminates an agent-event action', () => {
    expect(isAgentEventAction({ action: agentAction })).toBe(true);
    expect(isAgentEventAction({ action: localAction })).toBe(false);
  });

  it('correctly discriminates a local functionCall action', () => {
    expect(isLocalFunctionAction({ action: localAction })).toBe(true);
    expect(isLocalFunctionAction({ action: agentAction })).toBe(false);
  });
});
