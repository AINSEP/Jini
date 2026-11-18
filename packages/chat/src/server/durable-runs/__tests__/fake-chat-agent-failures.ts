/** A `ChatAgentFailurePort` that follows the port's contract with no agent runtime behind it. The real
 * classifier's regexes and the real message's redaction are the host binding's to prove, not chat's. */
import type { ChatAgentFailurePort } from '../../../core/agents-port.js';

export interface FakeAgentFailures extends ChatAgentFailurePort {
  /** Every `startupFailureMessage` call, in order, exactly as chat made it. */
  readonly startupCalls: Parameters<ChatAgentFailurePort['startupFailureMessage']>[];
}

/** Authentication wording is the one service class recovery acts on, so the fake knows exactly that. */
export function fakeAgentFailures(_required = {}, optional: { authPattern?: RegExp } = {}): FakeAgentFailures {
  const authPattern = optional.authPattern ?? /not logged in|\/login/i;
  const startupCalls: FakeAgentFailures['startupCalls'] = [];
  return {
    startupCalls,
    classifyServiceFailure: ({ text }) => (authPattern.test(text) ? 'AGENT_AUTH_REQUIRED' : null),
    startupFailureMessage: (required, optional) => {
      startupCalls.push([required, optional]);
      return `${optional?.notice ?? 'The assistant could not start.'}\nStartup stage: ${required.stage}\nCause: ${required.error instanceof Error ? required.error.message : String(required.error)}`;
    },
  };
}
