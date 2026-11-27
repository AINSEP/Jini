import { expect, test, vi } from 'vitest';
import { createMcpUiToolCaller } from '../create-mcp-ui-tool-caller.js';
import { readSurfaceFrames, readSurfaceRecoveryStream } from '../surface-recovery-stream.js';

const info = { exchangeId: 'expired', toolId: 'external_mcp_save', runId: 'run' };
const emission = { channel: 'mcp-ui', payload: { resource: { type: 'resource', resource: { uri: 'ui://new-card', text: '<form></form>' } }, surfaceExchange: { ...info, exchangeId: 'new' } } };

test('returning to an expired card requests its original invocation without resending tool arguments', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(`${JSON.stringify({ type: 'surface', emission })}\n${JSON.stringify({ type: 'restored', ok: true })}\n`, { headers: { 'content-type': 'application/x-ndjson' } }));
  const onSurface = vi.fn();
  const caller = createMcpUiToolCaller({ baseUrl: '', fetch });
  await caller.restore({ ...info, onSurface, signal: new AbortController().signal });
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ toolName: info.toolId, params: {}, exchangeId: info.exchangeId, restore: true });
  expect(onSurface).toHaveBeenCalledWith(emission);
});

test('a late credential answer is sent once and a reissued card is streamed before the save finishes', async () => {
  let send!: (value: string) => void;
  let finish!: () => void;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    send = value => controller.enqueue(new TextEncoder().encode(value));
    finish = () => controller.close();
  } });
  const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }));
  const onSurface = vi.fn();
  const caller = createMcpUiToolCaller({ baseUrl: '', fetch });
  const answer = caller.answer({ call: { name: info.toolId, arguments: { __exchangeId: info.exchangeId, token: 'human-only' } }, onSurface, signal: new AbortController().signal });
  send(`${JSON.stringify({ type: 'surface', emission })}\n`);
  await vi.waitFor(() => expect(onSurface).toHaveBeenCalledWith(emission));
  send(`${JSON.stringify({ type: 'restored', ok: true })}\n`);
  finish();
  expect(await answer).toEqual({ delivered: true });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('reconstructs split UTF-8 and emits the final frame without a newline', async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode('  \n{"value":"café"}\n{"value":"last"}');
  const split = bytes.indexOf(0xc3) + 1;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(bytes.slice(0, split));
    controller.enqueue(bytes.slice(split));
    controller.close();
  } });
  const onFrame = vi.fn();
  await readSurfaceFrames({ response: new Response(stream), onFrame });
  expect(onFrame.mock.calls).toEqual([[{ value: 'café' }], [{ value: 'last' }]]);
  expect(stream.locked).toBe(false);
});

test('rejects a non-object frame, cancels the open response and emits nothing after it', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('[]\n{"value":"not delivered"}\n')); },
    cancel,
  });
  const onFrame = vi.fn();
  await expect(readSurfaceFrames({ response: new Response(stream), onFrame })).rejects.toThrow('The interactive response contains an invalid frame.');
  expect(onFrame).not.toHaveBeenCalled();
  expect(cancel.mock.calls).toEqual([[undefined]]);
  expect(stream.locked).toBe(false);
});

test('requires a stream body and a positive restoration confirmation', async () => {
  const onSurface = vi.fn();
  await expect(readSurfaceRecoveryStream({ response: new Response(null), onSurface })).rejects.toThrow('The interactive page response stream is unavailable.');
  await expect(readSurfaceRecoveryStream({ response: new Response('{"type":"surface"}\n{"type":"restored","ok":false}'), onSurface }))
    .rejects.toThrow('The card could not be restored.');
  expect(onSurface).not.toHaveBeenCalled();
});
