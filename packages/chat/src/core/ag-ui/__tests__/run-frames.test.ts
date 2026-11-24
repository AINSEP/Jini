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

test('an error frame fails the run with the host sentence and keeps the daemon text out of RUN_ERROR (C131)', async () => {
  const bytes = new TextEncoder().encode(`event: error\ndata: ${JSON.stringify({ payload: { message: 'boom: ECONNRESET at /srv/daemon' } })}\n\n`);
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } },
    { failureMessage: 'The assistant could not finish. Send your request again.' });
  expect(outcome).toEqual({ status: 'failed' });
  expect(events).toEqual([
    { type: 'CUSTOM', name: 'example.status', value: { kind: 'status', label: 'boom: ECONNRESET at /srv/daemon' } },
    { type: 'RUN_ERROR', message: 'The assistant could not finish. Send your request again.' },
  ]);
});

test('a daemon-failed end frame fails the run with the host sentence, not the daemon exit text (C131)', async () => {
  const bytes = new TextEncoder().encode(`event: end\ndata: ${JSON.stringify({ payload: { status: 'failed', code: 1, signal: null, resumable: false } })}\n\n`);
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } },
    { failureMessage: 'The assistant could not finish. Send your request again.' });
  expect(outcome).toEqual({ status: 'failed' });
  const last = events[events.length - 1];
  expect(last).toEqual({ type: 'RUN_ERROR', message: 'The assistant could not finish. Send your request again.' });
});

test('a stream closing without a terminal frame is reported as an interrupted failed run, never as finished (B143)', async () => {
  const bytes = new TextEncoder().encode(`event: agent\ndata: ${JSON.stringify({ payload: { type: 'text_delta', delta: 'hello' } })}\n\n`);
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } },
    { interruptionMessage: 'The response was cut off. Send your request again.' });
  expect(outcome).toEqual({ status: 'failed' });
  expect(events).toEqual([
    { type: 'TEXT_MESSAGE_START', messageId: 'msg_1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg_1', delta: 'hello' },
    { type: 'TEXT_MESSAGE_END', messageId: 'msg_1' },
    { type: 'RUN_ERROR', message: 'The response was cut off. Send your request again.' },
  ]);
});

test.each([new Error('private transport canary'), 'private transport canary'])('a reader rejection writes RUN_ERROR and returns the same error (%#)', async (error) => {
  const reader = new ReadableStream<Uint8Array>({ pull(c) { c.error(error); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } });
  expect(outcome, 'A reader rejection fails the run with the original rejection').toEqual({ status: 'failed', error });
  expect(outcome.error, 'The returned rejection is unchanged').toBe(error);
  expect(events, 'The wire uses the public interruption sentence without exposing the rejection').toEqual([
    { type: 'RUN_ERROR', message: 'The response was interrupted. Try again.' },
  ]);
});

test('a host can supply the interruption message without exposing the rejection', async () => {
  const error = new Error('private transport canary');
  const interruptionMessage = 'The host response was interrupted. Please retry.';
  const bytes = new TextEncoder().encode(`event: agent\ndata: ${JSON.stringify({ payload: { type: 'text_delta', delta: 'hello' } })}\n\n`);
  let delivered = false;
  const reader = new ReadableStream<Uint8Array>({
    pull(c) {
      if (delivered) c.error(error);
      else {
        delivered = true;
        c.enqueue(bytes);
      }
    },
  }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r',
    state: createAgUiTranslationState(translation), notices, write: event => { events.push(event); } }, { interruptionMessage });
  expect(outcome, 'The interrupted run returns the original failure').toEqual({ status: 'failed', error });
  expect(outcome.error, 'The returned error retains its identity').toBe(error);
  expect(events, 'Partial text closes before the single terminal error with the host sentence').toEqual([
    { type: 'TEXT_MESSAGE_START', messageId: 'msg_1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg_1', delta: 'hello' },
    { type: 'TEXT_MESSAGE_END', messageId: 'msg_1' },
    { type: 'RUN_ERROR', message: interruptionMessage },
  ]);
});

test('only an explicitly marked pending approval projects an interrupt', async () => {
  const resource = { type: 'resource', resource: { uri: 'ui://card', mimeType: 'text/html', text: '<p>Decision</p>' } };
  const pendingApproval = { id: 'approval', reason: 'confirmation', toolCallId: 'tool', message: 'Allow action?' };
  const bytes = new TextEncoder().encode([
    { type: 'mcp-ui', resource },
    { type: 'mcp-ui', resource, surfaceExchange: { exchangeId: 'result', toolId: 'tool', runId: 'r' } },
    { type: 'text_delta', delta: 'before approval' },
    { type: 'mcp-ui', resource, pendingApproval },
    { type: 'text_delta', delta: 'after approval' },
  ].map(payload => `event: agent\ndata: ${JSON.stringify({ payload })}\n\n`).join(''));
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }).getReader();
  const events: AgUiEvent[] = [];
  const outcome = await drainRunFramesToAgUi({ reader, threadId: 't', runId: 'r', state: createAgUiTranslationState(translation), notices,
    write: event => { events.push(event); } });
  expect(outcome).toEqual({ status: 'succeeded' });
  expect(events, 'The approval closes the open message before interrupting and excludes later text').toEqual([
    { type: 'CUSTOM', name: 'example.ext.mcp-ui', value: resource },
    { type: 'CUSTOM', name: 'example.ext.mcp-ui', value: { ...resource, resource: { ...resource.resource,
      _meta: { 'jini/surface-exchange': { exchangeId: 'result', toolId: 'tool', runId: 'r' } } } } },
    { type: 'TEXT_MESSAGE_START', messageId: 'msg_1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg_1', delta: 'before approval' },
    { type: 'TEXT_MESSAGE_END', messageId: 'msg_1' },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'interrupt', interrupts: [pendingApproval] } },
  ]);
});
