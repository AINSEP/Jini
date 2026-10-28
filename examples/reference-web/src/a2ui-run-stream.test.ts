import { expect, it, vi } from 'vitest';
import { streamA2uiRun } from './a2ui-run-stream.js';

it('delivers A2UI, status and error frames in order and normalizes the terminal status', async () => {
  const calls: unknown[] = [];
  const frames = [
    { kind: 'agent', payload: { type: 'a2ui', message: { version: 'v1.0' } } },
    { kind: 'agent', payload: { type: 'status', label: 'Building', detail: 'surface' } },
    { kind: 'error', payload: { message: 'warning' } },
    { kind: 'end', payload: { status: 'cancelled' } },
  ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('');
  const fetch = vi.fn(async () => new Response(frames));
  const signal = new AbortController().signal;
  await streamA2uiRun({ runId: 'run/1', fetch, callbacks: {
    onA2uiMessage: message => { calls.push(['message', message]); },
    onStatus: label => { calls.push(['status', label]); },
    onError: error => { calls.push(['error', error.message]); },
    onDone: status => { calls.push(['done', status]); },
  }, signal });
  expect(fetch.mock.calls).toEqual([['/api/runs/run%2F1/events', { signal }]]);
  expect(calls).toEqual([['message', { version: 'v1.0' }], ['status', 'Building — surface'], ['error', 'warning'], ['done', 'cancelled']]);
});

it('refuses a truncated stream but tolerates caller cancellation', async () => {
  const callbacks = { onA2uiMessage() {}, onStatus() {}, onError() {}, onDone() {} };
  const fetch = vi.fn(async () => new Response('data: {"kind":"end","payload":{}}'));
  await expect(streamA2uiRun({ runId: 'run', fetch, callbacks, signal: new AbortController().signal })).rejects.toThrow('the A2UI Lab event stream closed before the run ended');
  const controller = new AbortController();
  controller.abort();
  await expect(streamA2uiRun({ runId: 'run', fetch, callbacks, signal: controller.signal })).resolves.toBeUndefined();
});

it('ignores falsy JSON records and comment frames before the terminal record', async () => {
  const done = vi.fn();
  const fetch = vi.fn(async () => new Response(': keepalive\n\ndata: null\n\ndata: false\n\ndata: 0\n\ndata: ""\n\ndata: {"kind":"end","payload":{}}\n\n'));
  await streamA2uiRun({ runId: 'run', fetch, callbacks: { onA2uiMessage() {}, onStatus() {}, onError(error) { throw error; }, onDone: done }, signal: new AbortController().signal });
  expect(done.mock.calls).toEqual([['succeeded']]);
});
