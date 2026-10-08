import { expect, it } from 'vitest';
import { parseFrame, readSseFrames, translateRunFrame, readTerminalOutcome, isDaemonRunId, asString } from '../entry.js';
import { notices } from './fixture.js';

it('rejects malformed wire payloads without throwing, including terminal nulls', () => {
  for (const raw of ['no-json', 'null', '[]', '1', '{}', '{"payload":null}', '{"payload":1}']) {
    expect(() => translateRunFrame({ kind: 'agent', raw, notices })).not.toThrow();
    expect(translateRunFrame({ kind: 'agent', raw, notices }).events).toEqual([]);
    expect(readTerminalOutcome({ raw })).toBeNull();
  }
});
it('classifies excluded run IDs only by host-provided prefixes', () => {
  expect(isDaemonRunId({ runId: 'external:a', excludedPrefixes: ['external:'] })).toBe(false);
  expect(isDaemonRunId({ runId: 'external:a', excludedPrefixes: [] })).toBe(true);
  expect(isDaemonRunId({ runId: '', excludedPrefixes: [] })).toBe(false);
});
it('releases/cancels the reader when consumption stops at a terminal boundary', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('event: end\ndata: {}\n\n')); }, cancel() { canceled = true; } });
  for await (const frame of readSseFrames({ body })) { expect(frame.event).toBe('end'); break; }
  expect(canceled).toBe(true); expect(body.locked).toBe(false);
});
it('parses chunks across UTF-8 and frame boundaries without retaining keepalives', async () => {
  const bytes = new TextEncoder().encode('event: ping\n\nevent: agent\ndata: café\n\n');
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const frames = []; for await (const frame of readSseFrames({ body })) frames.push(frame);
  expect(frames).toEqual([{ event: 'agent', data: 'café' }]); expect(body.locked).toBe(false);
});

it('preserves the host string helper through the object API', () => {
  expect(asString({ value: undefined })).toBe(''); expect(asString({ value: null })).toBe('');
  expect(asString({ value: { code: 1 } })).toBe('{"code":1}'); expect(asString({ value: 'ready' })).toBe('ready');
});

it('emits the budget notice before the terminal classification and durable failure', () => {
  const raw = JSON.stringify({ payload: { reason: 'max_tool_turns', status: 'failed', code: 7, signal: 'SIGTERM', resumable: true } });
  const outcome = translateRunFrame({ kind: 'end', raw, notices });
  expect(outcome.events).toEqual([notices.toolStepLimit, { kind: 'status', label: 'Run failed', detail: 'exit code 7, signal SIGTERM, resumable yes' }]);
  expect(outcome.terminal).toBe('failed');
  expect(outcome.error?.message).toBe('The agent process exited without answering (exit code 7, signal SIGTERM, resumable yes).');
  expect(translateRunFrame({ kind: 'end', raw: JSON.stringify({ payload: { status: 'canceled' } }), notices }).error).toBeUndefined();
});

it('keeps chat field trimming and default message names through the shared raw parser', () => {
  expect(parseFrame({ rawFrame: 'data:  first \r\ndata:second  ' })).toEqual({ event: 'message', data: 'first\nsecond' });
  expect(parseFrame({ rawFrame: 'event: end \r\ndata: {}\r' })).toEqual({ event: 'end', data: '{}' });
  expect(parseFrame({ rawFrame: 'id: cursor\nevent: ping' })).toBeNull();
  expect(parseFrame({ rawFrame: 'event:\ndata:' })).toEqual({ event: '', data: '' });
});

it('reads CRLF records with every byte split and ignores an incomplete terminal tail', async () => {
  const bytes = new TextEncoder().encode('id: c1\r\nevent: agent\r\ndata: café\r\n\r\nevent: end\r\ndata: {}\r\n');
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); },
    cancel() { canceled = true; },
  });
  const frames = []; for await (const frame of readSseFrames({ body })) frames.push(frame);
  expect(frames).toEqual([{ event: 'agent', data: 'café' }]);
  expect(body.locked).toBe(false); expect(canceled).toBe(false);
});

it('releases the chat reader even when cancellation rejects', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode('data: first\n\ndata: late\n\n')); },
    cancel() { throw new Error('already disconnected'); },
  });
  const frames = [];
  for await (const frame of readSseFrames({ body })) { frames.push(frame); break; }
  expect(frames).toEqual([{ event: 'message', data: 'first' }]);
  expect(body.locked).toBe(false);
});

it('propagates a read failure while releasing the chat reader', async () => {
  const failure = new Error('connection lost');
  const body = new ReadableStream<Uint8Array>({ start(c) { c.error(failure); } });
  const consume = async () => { for await (const _ of readSseFrames({ body })) { /* no records */ } };
  await expect(consume()).rejects.toBe(failure);
  expect(body.locked).toBe(false);
});
