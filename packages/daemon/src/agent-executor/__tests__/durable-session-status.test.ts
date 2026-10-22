import { expect, it } from 'vitest';
import { translateAgentRuntimeEvent } from '../event-translation.js';

it.each(['codex-thread', 'opencode-session'])('surfaces %s in its first status before end', (sessionId) => {
  expect(translateAgentRuntimeEvent({ rawEvent: { type: 'status', label: 'initializing', sessionId } })).toEqual({
    kind: 'agent', payload: { type: 'status', label: 'initializing', sessionId }, sessionId,
  });
});
