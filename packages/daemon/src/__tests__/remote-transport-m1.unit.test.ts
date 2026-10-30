import { EventEmitter } from 'node:events';
import type { request as httpRequest } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createRemoteToolExecutor } from '../remote-tool-executor.js';

const input = { principal: { id: 'person' }, run: { id: 'run' }, toolId: 'read', input: {} };

function transport({ reply }: { reply: (request: EventEmitter, response: EventEmitter) => void }) {
  const response = Object.assign(new EventEmitter(), { statusCode: 200 as number | undefined, setEncoding: vi.fn(), resume: vi.fn() });
  const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn(() => {
    request.emit('socket', { connecting: false });
    reply(request, response);
  }) });
  const adapter = vi.fn(() => request) as unknown as typeof httpRequest;
  const executor = createRemoteToolExecutor({ baseUrl: 'http://daemon.invalid', token: 'test-token' }, { request: adapter });
  return { executor, request, response, adapter };
}

it('classifies a reset on an already connected socket as an unknown outcome and never retries', async () => {
  const failure = new Error('reset after dispatch');
  const t = transport({ reply: request => { request.emit('error', failure); } });
  await expect(t.executor.execute(input)).rejects.toMatchObject({ name: 'ToolRpcError', code: 'TOOL_OUTCOME_UNKNOWN', cause: failure,
    message: 'remote tool call outcome is unknown: reset after dispatch' });
  expect(t.adapter).toHaveBeenCalledTimes(1);
  expect(t.request.destroy).toHaveBeenCalledTimes(1);
});

it('treats a response with no HTTP status as undispatched and drains it', async () => {
  const t = transport({ reply: (request, response) => { request.emit('response', response); } });
  t.response.statusCode = undefined;
  await expect(t.executor.execute(input)).rejects.toMatchObject({ name: 'ToolRpcError', code: 'TOOL_NOT_DISPATCHED',
    message: 'remote tool call was not dispatched: HTTP unknown' });
  expect(t.response.resume).toHaveBeenCalledTimes(1);
  expect(t.adapter).toHaveBeenCalledTimes(1);
});

it('rehydrates a nameless wire error as Error without changing its message', async () => {
  const t = transport({ reply: (request, response) => {
    request.emit('response', response);
    response.emit('data', '{"type":"throw","error":{"message":"denied"}}\n');
    response.emit('end');
  } });
  await expect(t.executor.execute(input)).rejects.toMatchObject({ name: 'Error', message: 'denied' });
  expect(t.request.destroy).not.toHaveBeenCalled();
});

it('retains a terminal line split across chunks, ignoring blank lines before it', async () => {
  const t = transport({ reply: (request, response) => {
    request.emit('response', response);
    response.emit('data', '\n{"type":"res');
    response.emit('data', 'ult","result":{"executionId":"remote","status":"completed","output":"saved"}}');
    response.emit('end');
  } });
  expect(await t.executor.execute(input)).toEqual({ executionId: 'remote', status: 'completed', output: 'saved' });
  expect(t.adapter).toHaveBeenCalledTimes(1);
});

it('accepts a result after a surface when the host supplies no surface emitter', async () => {
  const t = transport({ reply: (request, response) => {
    request.emit('response', response);
    response.emit('data', '{"type":"surface","emission":{"channel":"a2ui","payload":{"prompt":"Pick"}}}\n');
    response.emit('data', '{"type":"result","result":{"executionId":"remote","status":"completed","output":"saved"}}\n');
    response.emit('end');
  } });
  expect(await t.executor.execute(input)).toEqual({ executionId: 'remote', status: 'completed', output: 'saved' });
  expect(t.adapter).toHaveBeenCalledTimes(1);
});

it('a synchronous adapter refusal releases its abort listener even if the caller later cancels', async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const adapter = vi.fn(() => { throw 'adapter unavailable'; }) as unknown as typeof httpRequest;
  const executor = createRemoteToolExecutor({ baseUrl: 'http://daemon.invalid', token: 'test-token' }, { request: adapter });
  await expect(executor.execute(input, { signal: controller.signal })).rejects.toMatchObject({ code: 'TOOL_NOT_DISPATCHED', cause: 'adapter unavailable' });
  const cancel = remove.mock.calls[0]?.[1];
  expect(cancel).toBeTypeOf('function');
  expect(() => (cancel as () => void)()).not.toThrow();
  expect(adapter).toHaveBeenCalledTimes(1);
});
