import { expect, it, vi } from 'vitest';
import { createInMemoryEventLog, createRunLifecycle } from '@jini-ai/daemon';
import type { RendererToAgentMessage } from '@jini-ai/agentic/a2ui';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { driveA2uiDemoRun } from './a2ui-demo-run.js';

it('builds a real surface, acknowledges a click and finishes after the action source closes', async () => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'a2ui:lab' });
  const action: RendererToAgentMessage = { version: 'v1.0', action: {
    name: 'sayHello', surfaceId: `${run.id}-surface`, sourceComponentId: 'greetButton', timestamp: '2026-10-28T12:00:00.000Z', context: {},
  } };
  const waitForAction = vi.fn().mockResolvedValueOnce(action).mockResolvedValueOnce(null);
  const clearActionWaiters = vi.fn();
  const delay = vi.fn(async () => {});
  await driveA2uiDemoRun({ runId: run.id, lifecycle, ports: { waitForAction, clearActionWaiters, delay, now: () => 0 } });
  expect((await lifecycle.get({ runId: run.id }))?.state).toBe('succeeded');
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream({ runId: run.id, onEvent: event => { events.push(event); } });
  const messages = events.flatMap(event => event.kind === 'agent' && event.payload.type === 'a2ui' ? [event.payload.message] : []);
  expect(messages).toHaveLength(4);
  expect(messages[0]).toMatchObject({ createSurface: { surfaceId: `${run.id}-surface`, dataModel: { clicks: 0 } } });
  expect(messages[2]).toEqual({ version: 'v1.0', updateDataModel: { surfaceId: `${run.id}-surface`, path: '/message', value: 'Hello! This is click #1, acknowledged by the real daemon at 2026-10-28T12:00:00.000Z.' } });
  expect(messages[3]).toEqual({ version: 'v1.0', updateDataModel: { surfaceId: `${run.id}-surface`, path: '/clicks', value: 1 } });
  expect(delay.mock.calls).toEqual([[200], [150], [60]]);
  expect(clearActionWaiters.mock.calls).toEqual([[run.id]]);
});

it('honors cancellation during the initial delay before creating a surface', async () => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'a2ui:lab' });
  const waitForAction = vi.fn();
  await driveA2uiDemoRun({ runId: run.id, lifecycle, ports: {
    waitForAction, clearActionWaiters() {}, now: () => 0,
    delay: async () => { await lifecycle.cancel({ runId: run.id }); },
  } });
  expect((await lifecycle.get({ runId: run.id }))?.state).toBe('cancelled');
  expect(waitForAction).not.toHaveBeenCalled();
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream({ runId: run.id, onEvent: event => { events.push(event); } });
  expect(events.map(event => event.kind)).toEqual(['start', 'agent', 'end']);
});
