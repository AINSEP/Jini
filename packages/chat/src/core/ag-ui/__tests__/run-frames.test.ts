import { expect, test } from 'vitest';
import { createAgUiTranslationState, drainRunFramesToAgUi, type AgUiEvent } from '../event-projection.js';
import { notices } from '../../run-events/__tests__/fixture.js';

const translation = {
  ids: { next: ({ prefix, ordinal }: { prefix: string; ordinal: number }) => `${prefix}_${ordinal}` },
  customEventNames: { usage: 'example.usage', status: 'example.status', extensionPrefix: 'example.ext.' },
};

test('text and a terminal reason produce ordered text events and a successful finish', async () => {
  const bytes = new TextEncoder().encode([
    `event: agent\ndata: ${JSON.stringify({ payload: { type: 'text_delta', delta: 'hello' } })}`,
    `event: end\ndata: ${JSON.stringify({ payload: { status: 'succeeded', reason: 'end_turn' } })}`,
  ].join('\n\n') + '\n\n');
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } });
  expect(outcome).toEqual({ status: 'succeeded' });
  expect(events).toEqual([
    { type: 'TEXT_MESSAGE_START', messageId: 'msg_1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg_1', delta: 'hello' },
    { type: 'TEXT_MESSAGE_END', messageId: 'msg_1' },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r', result: { reason: 'end_turn' } },
  ]);
});

test('a daemon-canceled end finishes with the cancelled reason and canceled status', async () => {
  const bytes = new TextEncoder().encode(`event: end\ndata: ${JSON.stringify({ payload: { status: 'canceled', code: 0 } })}\n\n`);
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } });
  expect(outcome).toEqual({ status: 'canceled' });
  expect(events).toEqual([
    { type: 'CUSTOM', name: 'example.status', value: { kind: 'status', label: 'Run canceled', detail: 'exit code 0, signal none, resumable no' } },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r', result: { reason: 'cancelled' } },
  ]);
});

test('an error frame writes its message as RUN_ERROR and fails the run', async () => {
  const bytes = new TextEncoder().encode(`event: error\ndata: ${JSON.stringify({ payload: { message: 'boom' } })}\n\n`);
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } });
  expect(outcome).toEqual({ status: 'failed' });
  expect(events).toEqual([
    { type: 'CUSTOM', name: 'example.status', value: { kind: 'status', label: 'boom' } },
    { type: 'RUN_ERROR', message: 'boom' },
  ]);
});

test('a stream closing without a terminal frame closes messages and finishes with stop', async () => {
  const bytes = new TextEncoder().encode(`event: agent\ndata: ${JSON.stringify({ payload: { type: 'text_delta', delta: 'hello' } })}\n\n`);
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } });
  expect(outcome).toEqual({ status: 'succeeded' });
  expect(events).toEqual([
    { type: 'TEXT_MESSAGE_START', messageId: 'msg_1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg_1', delta: 'hello' },
    { type: 'TEXT_MESSAGE_END', messageId: 'msg_1' },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r', result: { reason: 'stop' } },
  ]);
});

test('a reader rejection writes RUN_ERROR and returns the same error', async () => {
  const error = new Error('read failed');
  const reader = new ReadableStream<Uint8Array>({ pull(c) { c.error(error); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } });
  expect(outcome).toEqual({ status: 'failed', error });
  expect(outcome.error).toBe(error);
  expect(events).toEqual([{ type: 'RUN_ERROR', message: 'read failed' }]);
});

test('only an explicitly marked pending approval projects an interrupt', async () => {
  const resource = { type: 'resource', resource: { uri: 'ui://card', mimeType: 'text/html', text: '<p>Decision</p>' } };
  const pendingApproval = { id: 'approval', reason: 'confirmation', toolCallId: 'tool', message: 'Allow action?' };
  const bytes = new TextEncoder().encode([
    { type: 'mcp-ui', resource },
    { type: 'mcp-ui', resource, surfaceExchange: { exchangeId: 'result', toolId: 'tool', runId: 'r' } },
    { type: 'mcp-ui', resource, pendingApproval },
  ].map(payload => `event: agent\ndata: ${JSON.stringify({ payload })}\n\n`).join(''));
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r', state: createAgUiTranslationState(translation), notices,
    write: event => { events.push(event); } });
  expect(outcome).toEqual({ status: 'succeeded' });
  expect(events).toEqual([
    { type: 'CUSTOM', name: 'example.ext.mcp-ui', value: resource },
    { type: 'CUSTOM', name: 'example.ext.mcp-ui', value: { ...resource, resource: { ...resource.resource,
      _meta: { 'jini/surface-exchange': { exchangeId: 'result', toolId: 'tool', runId: 'r' } } } } },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'interrupt', interrupts: [pendingApproval] } },
  ]);
});
