import { expect, test, vi } from 'vitest';
import { EventType, type RunAgentInput } from '@ag-ui/core';
import { createAgUiFetchAgent } from '../ag-ui-fetch-agent.js';
import { createAgUiRunClient } from '../ag-ui-transport.js';
import type { AgUiEvent } from '../../ag-ui/event-projection.js';

const input: RunAgentInput = { threadId: 'thread', runId: 'run', state: null, messages: [], tools: [], context: [], forwardedProps: {} };
const names = { usage: 'usage', status: 'status', extensionPrefix: 'ext.' };

test('joins split SSE frames, ignores comments and delivers the first event before response completion', async () => {
  let push: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({ start(controller) { push = controller; } });
  const request = vi.fn(async () => new Response(body));
  const agent = createAgUiFetchAgent({ request });
  const observer = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
  agent.run(input).subscribe(observer);
  const bytes = new TextEncoder();
  push!.enqueue(bytes.encode(': heartbeat\n\ndata: {"type":"TEXT_MESSAGE_CON'));
  push!.enqueue(bytes.encode('TENT","messageId":"m","delta":"hello"}\n'));
  expect(observer.next).not.toHaveBeenCalled();
  push!.enqueue(bytes.encode('\n'));
  await vi.waitFor(() => expect(observer.next).toHaveBeenCalledWith({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm', delta: 'hello' }));
  expect(observer.complete).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith({ input, signal: agent.abortController.signal });
  push!.close();
  await vi.waitFor(() => expect(observer.complete).toHaveBeenCalledOnce());
  expect(observer.next).toHaveBeenCalledOnce();
  expect(observer.error).not.toHaveBeenCalled();
});

test('abort cancels the response reader and releases its lock', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const agent = createAgUiFetchAgent({ request: async () => new Response(body) });
  const observer = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
  agent.run(input).subscribe(observer);
  await vi.waitFor(() => expect(body.locked).toBe(true));
  agent.abortRun();
  await vi.waitFor(() => expect(observer.error).toHaveBeenCalledOnce());
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
  expect(observer.complete).not.toHaveBeenCalled();
});

test('reports a host refusal before the response once', async () => {
  const refusal = new Error('Request refused by host');
  const agent = createAgUiFetchAgent({ request: async () => { throw refusal; } });
  const observer = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
  agent.run(input).subscribe(observer);
  await vi.waitFor(() => expect(observer.error).toHaveBeenCalledOnce());
  expect(observer.error).toHaveBeenCalledWith(refusal);
  expect(observer.next).not.toHaveBeenCalled();
  expect(observer.complete).not.toHaveBeenCalled();
});

test('consumes a registered live directive before transcript reduction', async () => {
  const directive = { type: EventType.CUSTOM, name: 'ext.navigate', value: { path: '/guide' } };
  const visit = vi.fn();
  const onLiveEvent = vi.fn(({ event }: { event: AgUiEvent }) => { if (event.type !== EventType.CUSTOM || event.name !== 'ext.navigate') return false; visit(event.value); return true; });
  const client = createAgUiRunClient({ ports: { endpoint: '/agent', runIdPrefix: 'ag-', customEventNames: names,
    mintId: () => 'id', onLiveEvent, createAgent: () => createAgUiFetchAgent({ request: async () => new Response(`data: ${JSON.stringify(directive)}\n\n`) }) } });
  const handlers = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
  await client.startAgUiRun({ input: { history: [], conversationId: 'thread', signal: new AbortController().signal }, handlers });
  await vi.waitFor(() => expect(handlers.onDone).toHaveBeenCalledOnce());
  expect(handlers.onDone).toHaveBeenCalledWith([]);
  expect(visit).toHaveBeenCalledOnce();
  expect(visit).toHaveBeenCalledWith({ path: '/guide' });
  expect(handlers.onEvent).not.toHaveBeenCalled();
});

test('an event failing EventSchemas ends once without reaching the live consumer or transcript', async () => {
  const onLiveEvent = vi.fn(() => false);
  const client = createAgUiRunClient({ ports: { endpoint: '/agent', runIdPrefix: 'ag-', customEventNames: names,
    mintId: () => 'id', onLiveEvent, createAgent: () => createAgUiFetchAgent({ request: async () => new Response(
      'data: {"type":"RUN_STARTED","threadId":"thread","runId":"run"}\n\ndata: {"type":"CUSTOM","value":42}\n\ndata: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m","delta":"unread"}\n\n') }) } });
  const handlers = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
  await client.startAgUiRun({ input: { history: [], signal: new AbortController().signal }, handlers });
  await vi.waitFor(() => expect(handlers.onError).toHaveBeenCalledOnce());
  expect(onLiveEvent).toHaveBeenCalledTimes(1);
  expect(onLiveEvent).toHaveBeenCalledWith({ event: { type: EventType.RUN_STARTED, threadId: 'thread', runId: 'run' } });
  expect(handlers.onEvent).not.toHaveBeenCalled();
  expect(handlers.onDone).toHaveBeenCalledOnce();
  expect(handlers.onDone).toHaveBeenCalledWith([]);
});
