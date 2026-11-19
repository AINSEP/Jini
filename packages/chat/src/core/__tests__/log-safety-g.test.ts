import { afterEach, expect, it, vi } from 'vitest';
import { EventType } from '@ag-ui/core';
import { createAgUiRunClient, type AgUiClient } from '../assistant-client/ag-ui-transport.js';
import { createVanillaChatController } from '../../embed-widget/vanilla/state.js';
import type { ChatTransport } from '../transport.js';

const sentinel = 'ochre owl private inlet';
const failure = () => Object.assign(new Error(sentinel), { stack: sentinel });
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('classifies an observable failure after started=%s and settles once', async started => {
  let observer!: Parameters<ReturnType<AgUiClient['run']>['subscribe']>[0];
  const agent: AgUiClient = { abortController: new AbortController(), abortRun: vi.fn(), run: () => ({ subscribe: value => { observer = value; } }) };
  const client = createAgUiRunClient({ ports: { endpoint: '/agent', runIdPrefix: 'test-', customEventNames: { usage: 'usage', status: 'status', extensionPrefix: 'ext:' }, mintId: () => 'id', createAgent: () => agent } });
  const order: string[] = [];
  const onError = vi.fn((error: Error) => { order.push('error'); expect(error.message).not.toContain(sentinel); });
  const onDone = vi.fn(() => { order.push('done'); });
  const pending = client.startAgUiRun({ input: { history: [], signal: new AbortController().signal }, handlers: { onEvent: vi.fn(), onError, onDone } });
  if (started) {
    observer.next({ type: EventType.RUN_STARTED, threadId: 'thread', runId: 'id' });
    await pending;
    observer.error(failure());
    observer.complete();
    expect(order).toEqual(['error', 'done']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  } else {
    const rejection = expect(pending).rejects.toThrow('The agent run stream stopped with an error (Error); send the message again.');
    observer.error(failure());
    await rejection;
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  }
});

it.each([failure(), sentinel])('vanilla failure settles a failed reply with fixed public copy', async error => {
  const save = vi.fn();
  const transport = { startRun: async () => { throw error; } } as unknown as ChatTransport;
  const controller = createVanillaChatController({ transport, session: { load: () => ({ open: true, messages: [] }), save, clear: vi.fn() }, agentId: 'agent', ids: () => 'id', createAbortController: () => new AbortController(), onChange: vi.fn() });
  expect(await controller.send({ text: 'hello' })).toBe(true);
  expect(controller.getState().error).toBe('The message could not be sent to the agent; send it again.');
  expect(controller.getState().busy).toBe(false);
  expect(controller.getState().messages.at(-1)?.runStatus).toBe('failed');
  expect(save).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(controller.getState())).not.toContain(sentinel);
  expect(JSON.stringify(save.mock.calls)).not.toContain(sentinel);
});
