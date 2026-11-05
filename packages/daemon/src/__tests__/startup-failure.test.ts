import { expect, it } from 'vitest';
import { failRunBeforeStart } from '../session-coordination.js';

it('emits a redacted startup cause before finishing the pre-spawn attempt', async () => {
  const calls: unknown[] = [];
  await failRunBeforeStart({ runId: 'attempt', message: 'Could not start.', startup: {
    stage: 'session binding', error: new Error('session store unavailable; password=private-value'),
  }, lifecycle: {
    async emit(input) { calls.push(input.input.data.message); },
    async finish(input) { calls.push(input.status); },
  } });
  expect(calls[0]).toContain('session binding');
  expect(calls[0]).toContain('session store unavailable');
  expect(calls[0]).not.toContain('private-value');
  expect(calls[1]).toBe('failed');
});
