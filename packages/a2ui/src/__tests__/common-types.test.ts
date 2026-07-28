import { describe, expect, it } from 'vitest';
import { isAgentEventAction, isLocalFunctionAction, type Action } from '../common-types.js';

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
    expect(isAgentEventAction(agentAction)).toBe(true);
    expect(isAgentEventAction(localAction)).toBe(false);
  });

  it('correctly discriminates a local functionCall action', () => {
    expect(isLocalFunctionAction(localAction)).toBe(true);
    expect(isLocalFunctionAction(agentAction)).toBe(false);
  });
});
