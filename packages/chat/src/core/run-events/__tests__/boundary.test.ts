import { expect, it } from 'vitest';
import { readSseFrames, translateRunFrame, readTerminalOutcome, isDaemonRunId, asString } from '../entry.js';
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
