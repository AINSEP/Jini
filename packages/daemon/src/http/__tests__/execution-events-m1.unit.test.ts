import { expect, it, vi } from 'vitest';
import { toolExecutionRoutes } from '../tool-execution-routes.js';
import type { ToolExecutor } from '../../tool-executor.js';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { serveRoutes } from './fakes/serve-routes.js';

const URL_ = 'http://local/internal/tool-executions';
const BODY = { executionId: 'execution', principal: { id: 'person' }, run: { id: 'run' }, toolId: 'read', input: {} };

function fixture({ execute }: { execute: ToolExecutor['execute'] }) {
  const executor: ToolExecutor = { execute, cancel: () => {}, getAuditRecord: () => null,
    resumeConfirmation: () => { throw new Error('unexpected confirmation'); } };
  const host = fakeDaemonRouteHost();
  const fetch = serveRoutes({ routes: toolExecutionRoutes({ executor, listToolsFor: () => [], env: { JINI_TOOL_EXEC_TOKEN: 'test-token' }, host }) });
  // The in-memory server has no socket peer unless the request carries one; the gate wants a loopback peer.
  const post = ({ body = JSON.stringify(BODY), signal, token = 'test-token' }: { body?: string | null; signal?: AbortSignal; token?: string } = {}) =>
    fetch(new Request(URL_, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body, ...(signal ? { signal } : {}) }), { client: { address: '127.0.0.1' } });
  return { post, fetch, host };
}

it('aborts the tool when the caller goes away, writes the result line, and suppresses late surfaces', async () => {
  let finish!: () => void;
  let entered!: () => void;
  let signal!: AbortSignal;
  let emit!: NonNullable<NonNullable<Parameters<ToolExecutor['execute']>[1]>['emitSurface']>;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const f = fixture({ execute: async (_input, options) => {
    signal = options!.signal!; emit = options!.emitSurface!; entered();
    await new Promise<void>((resolve) => { finish = resolve; });
    return { executionId: 'execution', status: 'cancelled' };
  } });
  const caller = new AbortController();
  const answer = await f.post({ signal: caller.signal });
  await started;
  expect(signal.aborted).toBe(false);
  caller.abort();
  expect(signal.aborted).toBe(true);
  finish();
  await emit({ channel: 'a2ui', payload: { late: true } });
  // The caller left, so nothing is read from the body; reading it must not hang or throw.
  await answer.body?.cancel().catch(() => undefined);
});

it('writes a surface before the result, and drops a surface that arrives after the result', async () => {
  let emit!: NonNullable<NonNullable<Parameters<ToolExecutor['execute']>[1]>['emitSurface']>;
  const f = fixture({ execute: async (_input, options) => {
    emit = options!.emitSurface!;
    await emit({ channel: 'a2ui', payload: { n: 1 } });
    return { executionId: 'execution', status: 'completed', output: 'ok' };
  } });
  const answer = await f.post();
  const text = await answer.text();
  await emit({ channel: 'a2ui', payload: { late: true } });
  expect(text.trimEnd().split('\n')).toEqual([
    '{"type":"surface","emission":{"channel":"a2ui","payload":{"n":1}}}',
    '{"type":"result","result":{"executionId":"execution","status":"completed","output":"ok"}}',
  ]);
});

it('answers a body over the limit 413 and a body that is not JSON 400, without dispatching a tool', async () => {
  const execute = vi.fn<ToolExecutor['execute']>();
  const f = fixture({ execute });
  const executor = { execute, cancel: () => {}, getAuditRecord: () => null, resumeConfirmation: () => undefined } as unknown as ToolExecutor;
  const small = serveRoutes({ routes: toolExecutionRoutes({ executor, listToolsFor: () => [], env: { JINI_TOOL_EXEC_TOKEN: 'test-token' }, host: f.host }, { maxBodyBytes: 64 }) });
  const send = (body: string) => small(new Request(URL_, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body }), { client: { address: '127.0.0.1' } });
  expect((await send(JSON.stringify({ ...BODY, input: 'x'.repeat(100) }))).status).toBe(413);
  const bad = await f.post({ body: '{not json' });
  expect([bad.status, await bad.json()]).toEqual([400, { error: { code: 'BAD_REQUEST', message: 'request body must be valid JSON' } }]);
  expect(execute).not.toHaveBeenCalled();
});

it('serializes a thrown non-Error value as a terminal wire failure', async () => {
  const f = fixture({ execute: async () => { throw 'execution refused'; } });
  expect(await (await f.post()).text()).toBe('{"type":"throw","error":{"name":"Error","message":"execution refused"}}\n');
});

it('a request whose body fails mid-read never dispatches a tool', async () => {
  const execute = vi.fn<ToolExecutor['execute']>();
  const f = fixture({ execute });
  const failing = new ReadableStream<Uint8Array>({ start: (controller) => { controller.enqueue(new TextEncoder().encode('{"executionId":"e",')); controller.error(new Error('body transport failed')); } });
  const request = new Request(URL_, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: failing, duplex: 'half' } as RequestInit);
  await f.fetch(request, { client: { address: '127.0.0.1' } }).then(() => undefined, () => undefined);
  expect(execute).not.toHaveBeenCalled();
});

it('refuses a wrong bearer with the exact body and never dispatches', async () => {
  const execute = vi.fn<ToolExecutor['execute']>();
  const f = fixture({ execute });
  const answer = await f.post({ token: 'incorrect' });
  expect([answer.status, await answer.json()]).toEqual([401, { error: { code: 'UNAUTHORIZED', message: 'Authorization: Bearer <JINI_TOOL_EXEC_TOKEN> required' } }]);
  expect(execute).not.toHaveBeenCalled();
});

it('rejects a request without a socket peer before reading the body', async () => {
  const f = fixture({ execute: vi.fn<ToolExecutor['execute']>() });
  const request = new Request(URL_, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify(BODY) });
  const answer = await f.fetch(request);
  expect([answer.status, await answer.json()]).toEqual([403, { error: { code: 'FORBIDDEN', message: 'remote tool execution accepts loopback callers only' } }]);
  expect(request.bodyUsed).toBe(false);
});
