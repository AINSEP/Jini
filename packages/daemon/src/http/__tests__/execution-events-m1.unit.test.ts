import { EventEmitter } from 'node:events';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { expect, it, vi } from 'vitest';
import { registerToolExecutionRoutes, requireToolExecutionCaller } from '../tool-execution-routes.js';
import type { ToolExecutor } from '../../tool-executor.js';

function fixture({ execute }: { execute: ToolExecutor['execute'] }) {
  let handler!: RequestHandler;
  let parserFailure!: ErrorRequestHandler;
  const executor: ToolExecutor = { execute, cancel: () => {}, getAuditRecord: () => null,
    resumeConfirmation: () => { throw new Error('unexpected confirmation'); } };
  registerToolExecutionRoutes({ app: { post: (_path, ...handlers) => {
    handler = handlers[2] as RequestHandler; parserFailure = handlers[3] as ErrorRequestHandler;
  }, get: () => {} }, executor, listToolsFor: () => [] }, { env: { JINI_TOOL_EXEC_TOKEN: 'test-token' } });
  let ended!: () => void;
  const complete = new Promise<void>(resolve => { ended = resolve; });
  const req = Object.assign(new EventEmitter(), { complete: true, body: {
    executionId: 'execution', principal: { id: 'person' }, run: { id: 'run' }, toolId: 'read', input: {},
  } });
  const res = Object.assign(new EventEmitter(), { writableFinished: false, writableEnded: false,
    status: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn(),
    end: vi.fn(() => { res.writableFinished = true; res.writableEnded = true; ended(); }),
  });
  return { req, res, complete, parserFailure, start: () => handler(req as never, res as never, vi.fn()) };
}

it('aborts on a request error, detaches both listeners, and suppresses late surfaces', async () => {
  let finish!: () => void;
  let entered!: () => void;
  let signal!: AbortSignal;
  let emit!: NonNullable<NonNullable<Parameters<ToolExecutor['execute']>[1]>['emitSurface']>;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const f = fixture({ execute: async (_input, options) => {
    signal = options!.signal!; emit = options!.emitSurface!; entered();
    await new Promise<void>(resolve => { finish = resolve; });
    return { executionId: 'execution', status: 'cancelled' };
  } });
  f.start();
  await started;
  expect(signal.aborted).toBe(false);
  f.req.emit('error', new Error('body transport failed'));
  expect(signal.aborted).toBe(true);
  finish();
  await f.complete;
  expect(f.res.write.mock.calls).toEqual([['{"type":"result","result":{"executionId":"execution","status":"cancelled"}}\n']]);
  await emit({ channel: 'a2ui', payload: { late: true } });
  expect(f.res.write).toHaveBeenCalledTimes(1);
  expect(f.req.listenerCount('error')).toBe(0);
  expect(f.res.listenerCount('close')).toBe(0);
});

it('forwards a parser failure after headers have been sent to the host boundary', () => {
  const execute = vi.fn<ToolExecutor['execute']>();
  const f = fixture({ execute });
  const error = { status: 413 };
  const next = vi.fn();
  f.parserFailure(error, {} as never, { headersSent: true } as never, next);
  expect(next).toHaveBeenCalledWith(error);
  expect(execute).not.toHaveBeenCalled();
});

it('serializes a thrown non-Error value as a terminal wire failure', async () => {
  const f = fixture({ execute: async () => { throw 'execution refused'; } });
  f.start();
  await f.complete;
  expect(f.res.write.mock.calls).toEqual([['{"type":"throw","error":{"name":"Error","message":"execution refused"}}\n']]);
  expect(f.req.listenerCount('error')).toBe(0);
  expect(f.res.listenerCount('close')).toBe(0);
});

it('ends an incomplete request without dispatching a tool', async () => {
  const execute = vi.fn<ToolExecutor['execute']>();
  const f = fixture({ execute });
  f.req.complete = false;
  f.start();
  await f.complete;
  expect(execute).not.toHaveBeenCalled();
  expect(f.res.write).not.toHaveBeenCalled();
  expect(f.res.end).toHaveBeenCalledTimes(1);
});

it('uses the default token source when route options are omitted and refuses a wrong bearer', () => {
  vi.stubEnv('JINI_TOOL_EXEC_TOKEN', 'test-token');
  try {
    let gate!: RequestHandler;
    const execute = vi.fn<ToolExecutor['execute']>();
    const executor: ToolExecutor = { execute, cancel: () => {}, resumeConfirmation: () => {}, getAuditRecord: () => null };
    registerToolExecutionRoutes({ app: { post: (_path, ...handlers) => { gate = handlers[0] as RequestHandler; }, get: () => {} },
      executor, listToolsFor: () => [] });
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const req = { socket: { remoteAddress: '127.0.0.1' }, get: () => 'Bearer test-token' };
    gate(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    req.get = () => 'Bearer incorrect';
    gate(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'UNAUTHORIZED', message: 'Authorization: Bearer <JINI_TOOL_EXEC_TOKEN> required' } });
    expect(execute).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});

it('rejects a request without a socket peer before advancing to body parsing', () => {
  const gate = requireToolExecutionCaller({}, { env: { JINI_TOOL_EXEC_TOKEN: 'test-token' } });
  const next = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  gate({ get: () => 'Bearer test-token' } as never, res as never, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ error: { code: 'FORBIDDEN', message: 'remote tool execution accepts loopback callers only' } });
  expect(next).not.toHaveBeenCalled();
});
