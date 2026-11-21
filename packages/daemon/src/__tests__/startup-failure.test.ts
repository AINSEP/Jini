import { expect, it } from 'vitest';
import { failRunBeforeStart } from '../session-coordination.js';
import { agentRuntimeFixture } from '../agent-executor/__tests__/runtime-fixture.js';

it('emits a redacted startup cause before finishing the pre-spawn attempt', async () => {
  const calls: unknown[] = [];
  await failRunBeforeStart({ runId: 'attempt', message: 'Could not start.', startup: {
    stage: 'session binding', error: new Error('session store unavailable; password=private-value'),
  }, startupMessage: agentRuntimeFixture().failures.startupMessage, lifecycle: {
    async emit(input) { calls.push(input.input.data.message); },
    async finish(input) { calls.push(input.status); },
  } });
  expect(calls[0]).toContain('session binding');
  expect(calls[0]).toContain('session store unavailable');
  expect(calls[0]).not.toContain('private-value');
  expect(calls[1]).toBe('failed');
});

it('emits what the host formatter returns for a startup refusal, never the raw cause', async () => {
  const seen: unknown[] = [];
  const events: unknown[] = [];
  await failRunBeforeStart({ runId: 'attempt', message: 'Could not start.', startup: { stage: 'session binding', error: 'raw-cause' },
    startupMessage: (required) => { seen.push(required); return 'formatted by host'; },
    lifecycle: { async emit(input) { events.push(input.input.data.message); }, async finish() {} } });
  expect(seen).toEqual([{ stage: 'session binding', error: 'raw-cause' }]);
  expect(events).toEqual(['formatted by host']);
});

it('uses the plain message when there is no startup exception, and still finishes when the stream refuses the event', async () => {
  const calls: unknown[] = [];
  await failRunBeforeStart({ runId: 'attempt', message: 'Could not start.', lifecycle: {
    async emit() { throw new Error('stream closed'); },
    async finish(input) { calls.push(input.status); },
  } });
  expect(calls).toEqual(['failed']);
});
