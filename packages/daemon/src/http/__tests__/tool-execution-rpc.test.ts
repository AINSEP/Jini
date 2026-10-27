/**
 * Contract tests for the remote tool RPC: `registerToolExecutionRoutes` (server end) and
 * `createRemoteToolExecutor` (client end), in-process on an ephemeral 127.0.0.1 port.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import express, { type Request, type RequestHandler, type Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolRegistry, ToolInputError, type Principal, type SurfaceEmission, type ToolRegistration } from '@jini-ai/core';
import { createToolExecutor, type ToolExecutor } from '../../tool-executor.js';
import { createRemoteToolExecutor, ToolRpcError } from '../../remote-tool-executor.js';
import { registerToolExecutionRoutes, type ToolExecutionRoutesOptional, type ToolExecutionRoutesRequired } from '../tool-execution-routes.js';
import { createDelegatedToolBridge } from '../../delegated-tool-bridge.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { hasUnknownToolCall } from '@jini-ai/chat/server/durable-runs';
import { translateRunAgentPayload, type RunAgentPayload } from '@jini-ai/chat/core/run-events';
import { LOOPBACK_TLS_CERT, LOOPBACK_TLS_KEY } from './fixtures/loopback-tls.js';

const TOKEN = 'tool-exec-secret';
const env = { JINI_TOOL_EXEC_TOKEN: TOKEN };
const principal: Principal = { id: 'user-1', roles: ['admin'] };
const run = { id: 'run-1' };
const servers: http.Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => {
    server.closeAllConnections?.();
    server.close(() => done());
  })));
});

async function listen(handler: http.RequestListener | net.Server): Promise<string> {
  const server = handler instanceof net.Server ? handler : http.createServer(handler);
  servers.push(server as http.Server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const scheme = server instanceof tls.Server ? 'https' : 'http';
  return `${scheme}://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function executorWith(...registrations: ToolRegistration[]): ToolExecutor {
  const registry = createToolRegistry({});
  for (const registration of registrations) registry.register(registration);
  return createToolExecutor({ registry });
}

function tool(id: string, handler: ToolRegistration['handler']): ToolRegistration {
  return { descriptor: { id }, policy: { authorize: () => 'allow' }, handler };
}

interface Served {
  readonly baseUrl: string;
  readonly seen: Array<{ req: Request; res: Response; closeListeners: number }>;
}

/**
 * The route on a Router placed BEFORE an app-level 128 kb parser, the way a host with a small global
 * limit mounts it. `before` runs first on every request (peer overrides, request capture).
 */
async function serve(
  required: Partial<ToolExecutionRoutesRequired> & Pick<ToolExecutionRoutesRequired, 'executor'>,
  optional: ToolExecutionRoutesOptional & { before?: RequestHandler; tls?: boolean } = {},
): Promise<Served> {
  const seen: Served['seen'] = [];
  const app = express();
  app.use((req, res, next) => { seen.push({ req, res, closeListeners: res.listenerCount('close') }); next(); });
  if (optional.before) app.use(optional.before);
  const router = express.Router();
  const { before: _before, tls: _tls, ...routeOptions } = optional;
  registerToolExecutionRoutes({ app: router, listToolsFor: () => [], ...required }, { env, ...routeOptions });
  app.use(router);
  app.use(express.json({ limit: '128kb' }));
  return { baseUrl: await listen(optional.tls ? https.createServer({ cert: LOOPBACK_TLS_CERT, key: LOOPBACK_TLS_KEY }, app) : app), seen };
}

function client(baseUrl: string, optional: Parameters<typeof createRemoteToolExecutor>[1] = {}): ToolExecutor {
  return createRemoteToolExecutor({ baseUrl, token: TOKEN }, optional);
}

async function rpcCode(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ToolRpcError);
  expect((error as ToolRpcError).name).toBe('ToolRpcError');
  return (error as ToolRpcError).code;
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

describe('remote tool RPC — results', () => {
  it('returns the same result an in-process executor returns', async () => {
    const executor = executorWith(tool('echo', async ({ input }) => ({ echoed: input })));
    const { baseUrl } = await serve({ executor });
    const local = await executor.execute({ principal, run, toolId: 'echo', input: { a: 1 } });
    const remote = await client(baseUrl).execute({ principal, run, toolId: 'echo', input: { a: 1 } });
    const { executionId: _l, ...localRest } = local;
    const { executionId: _r, ...remoteRest } = remote;
    expect(remoteRest).toEqual(localRest);
    expect(remoteRest).toMatchObject({ status: 'completed', output: { echoed: { a: 1 } } });
  });

  it('passes the serialized principal through whole to the far executor', async () => {
    const seen: Principal[] = [];
    const executor = executorWith(tool('who', async (ctx) => { seen.push(ctx.principal); return 'ok'; }));
    const { baseUrl } = await serve({ executor });
    const restricted = { id: 'user-2', toolAccess: 'read-only' } as Principal;
    await client(baseUrl).execute({ principal: restricted, run, toolId: 'who', input: {} });
    expect(seen).toEqual([restricted]);
  });

  it('rehydrates a far ToolInputError with the same class, name and message', async () => {
    const executor = executorWith(tool('content_read.page', async () => 'unused'));
    const { baseUrl } = await serve({ executor });
    const rejection = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e as Error);
    const local = await rejection(executor.execute({ principal, run, toolId: 'content_read', input: {} }));
    const remote = await rejection(client(baseUrl).execute({ principal, run, toolId: 'content_read', input: {} }));
    expect(remote).toBeInstanceOf(ToolInputError);
    expect([remote.name, remote.message]).toEqual([local.name, local.message]);
  });

  it('keeps name and code of any other far throw', async () => {
    const throwing: ToolExecutor = { ...executorWith(), execute: async () => { throw Object.assign(new RangeError('boom'), { code: 'E_BOOM' }); } };
    const { baseUrl } = await serve({ executor: throwing });
    await expect(client(baseUrl).execute({ principal, run, toolId: 'x', input: {} })).rejects.toMatchObject({ name: 'RangeError', message: 'boom', code: 'E_BOOM' });
  });

  it('delivers every surface, in order, before the result settles', async () => {
    const executor = executorWith(tool('ask', async (_ctx, options) => {
      for (const n of [1, 2, 3]) await options?.emitSurface?.({ channel: 'a2ui', payload: { n } });
      return 'answered';
    }));
    const { baseUrl } = await serve({ executor });
    const order: string[] = [];
    const emitSurface = async (emission: SurfaceEmission) => { await tick(5); order.push(`surface:${String(emission.payload.n)}`); };
    const result = await client(baseUrl).execute({ principal, run, toolId: 'ask', input: {} }, { emitSurface });
    order.push(`result:${String(result.output)}`);
    expect(order).toEqual(['surface:1', 'surface:2', 'surface:3', 'result:answered']);
  });

  it('hands the wire context to runWithContext around the executor call', async () => {
    const contexts: unknown[] = [];
    const executor = executorWith(tool('echo', async () => 'ok'));
    const runWithContext = async <T>({ context, fn }: { context: unknown; fn: () => Promise<T> }) => { contexts.push(context); return fn(); };
    const { baseUrl } = await serve({ executor }, { runWithContext });
    const contextFor = vi.fn(() => ({ attachmentRefs: ['attachment:1'], localToolIds: ['page.read'] }));
    await client(baseUrl, { contextFor }).execute({ principal, run, toolId: 'echo', input: {} });
    expect(contextFor).toHaveBeenCalledWith({ principal, run, toolId: 'echo' });
    expect(contexts).toEqual([{ attachmentRefs: ['attachment:1'], localToolIds: ['page.read'] }]);
  });
});

describe('remote tool RPC — cancellation', () => {
  it('a normally completed request body does not abort the handler, and listeners are detached', async () => {
    let abortedDuringHandler: boolean | undefined;
    const executor = executorWith(tool('slow', async ({ signal }) => { await tick(50); abortedDuringHandler = signal.aborted; return 'done'; }));
    const { baseUrl, seen } = await serve({ executor });
    await expect(client(baseUrl).execute({ principal, run, toolId: 'slow', input: {} })).resolves.toMatchObject({ status: 'completed', output: 'done' });
    expect(abortedDuringHandler).toBe(false);
    expect(seen[0]!.res.listenerCount('close')).toBe(seen[0]!.closeListeners);
    expect(seen[0]!.req.listenerCount('error')).toBe(0);
  });

  it('a client abort mid-handler aborts the far signal and settles locally as cancelled', async () => {
    const started = deferred();
    const farAborted = deferred<boolean>();
    const executor = executorWith(tool('park', ({ signal }) => new Promise((done) => {
      started.resolve();
      signal.addEventListener('abort', () => { farAborted.resolve(signal.aborted); done('late'); }, { once: true });
    })));
    const { baseUrl, seen } = await serve({ executor });
    const controller = new AbortController();
    const pending = client(baseUrl).execute({ principal, run, toolId: 'park', input: {} }, { signal: controller.signal });
    await started.promise;
    controller.abort();
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    await expect(farAborted.promise).resolves.toBe(true);
    await tick();
    expect(seen[0]!.res.listenerCount('close')).toBe(seen[0]!.closeListeners);
  });

  it('cancel(executionId) with the wire id destroys the in-flight call', async () => {
    const started = deferred<string>();
    const executor = executorWith(tool('park', ({ signal }) => new Promise((done) => signal.addEventListener('abort', () => done('x'), { once: true }))));
    const { baseUrl } = await serve({ executor });
    const request = ((url: URL, options: http.RequestOptions) => {
      const req = http.request(url, options);
      const end = req.end.bind(req);
      req.end = ((body: string) => { started.resolve((JSON.parse(body) as { executionId: string }).executionId); return end(body); }) as typeof req.end;
      return req;
    }) as unknown as typeof http.request;
    const remote = client(baseUrl, { request });
    const pending = remote.execute({ principal, run, toolId: 'park', input: {} });
    remote.cancel({ executionId: await started.promise });
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('a client gone mid-body never calls the executor', async () => {
    const execute = vi.fn();
    const { baseUrl } = await serve({ executor: { ...executorWith(), execute } });
    const { port } = new URL(baseUrl);
    await new Promise<void>((done) => {
      const socket = net.connect(Number(port), '127.0.0.1', () => {
        socket.write(`POST /internal/tool-executions HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"executionId":"e1",`);
        setTimeout(() => { socket.destroy(); done(); }, 30);
      });
    });
    await tick(100);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('remote tool RPC — at-most-once', () => {
  it('a handler that commits and then loses its socket gives TOOL_OUTCOME_UNKNOWN after exactly one request', async () => {
    let commits = 0;
    let served: Served | undefined;
    const executor = executorWith(tool('commit', async () => {
      commits += 1;
      served!.seen.at(-1)!.req.socket.destroy();
      return 'committed';
    }));
    served = await serve({ executor });
    expect(await rpcCode(client(served.baseUrl).execute({ principal, run, toolId: 'commit', input: {} }))).toBe('TOOL_OUTCOME_UNKNOWN');
    expect(commits).toBe(1);
    expect(served.seen).toHaveLength(1);
  });

  it('a reset after the request was written, before any header, is still TOOL_OUTCOME_UNKNOWN', async () => {
    const baseUrl = await listen(net.createServer((socket) => socket.once('data', () => socket.destroy())));
    expect(await rpcCode(client(baseUrl).execute({ principal, run, toolId: 'x', input: {} }))).toBe('TOOL_OUTCOME_UNKNOWN');
  });

  it('a stream that ends without a terminal line, or carries a malformed line, is TOOL_OUTCOME_UNKNOWN', async () => {
    const truncated = await listen((_req, res) => { res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.end('{"type":"surface","emission":{"channel":"a","payload":{}}}\n'); });
    expect(await rpcCode(client(truncated).execute({ principal, run, toolId: 'x', input: {} }))).toBe('TOOL_OUTCOME_UNKNOWN');
    const malformed = await listen((_req, res) => { res.writeHead(200); res.end('not json\n'); });
    expect(await rpcCode(client(malformed).execute({ principal, run, toolId: 'x', input: {} }))).toBe('TOOL_OUTCOME_UNKNOWN');
  });

  it.each([
    ['an empty result', '{"type":"result","result":{}}'],
    ['a result without an executionId', '{"type":"result","result":{"status":"completed"}}'],
    ['a result with an unknown status', '{"type":"result","result":{"executionId":"e","status":"exploded"}}'],
    ['a throw without a message', '{"type":"throw","error":{"name":"Error"}}'],
  ])('a terminal line carrying %s is TOOL_OUTCOME_UNKNOWN, never a settled call', async (_label, line) => {
    const baseUrl = await listen((_req, res) => { res.writeHead(200); res.end(`${line}\n`); });
    expect(await rpcCode(client(baseUrl).execute({ principal, run, toolId: 'x', input: {} }))).toBe('TOOL_OUTCOME_UNKNOWN');
  });

  it('a malformed terminal result reaches the bridge as an unknown outcome, so the durable-run guard refuses a blind repeat', async () => {
    const baseUrl = await listen((_req, res) => { res.writeHead(200); res.end('{"type":"result","result":{}}\n'); });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: client(baseUrl) });
    const { run: started } = await lifecycle.start({ contextRef: 'delegated-tools' });
    const input = { path: '/a', body: 'x' };
    await expect(bridge.execute({ runId: started.id, toolUseId: 'call-1', toolId: 'write', principal, input })).rejects.toMatchObject({ code: 'TOOL_OUTCOME_UNKNOWN' });
    const events = await agentEvents(lifecycle, started.id);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool_result', toolUseId: 'call-1', outcome: 'unknown' }));
    expect(hasUnknownToolCall({ events, toolId: 'write', input })).toBe(true);
  });

  it('a socket that never connected gives TOOL_NOT_DISPATCHED', async () => {
    const closed = await listen(() => undefined);
    const server = servers.pop()!;
    await new Promise<void>((done) => server.close(() => done()));
    expect(await rpcCode(client(closed).execute({ principal, run, toolId: 'x', input: {} }))).toBe('TOOL_NOT_DISPATCHED');
  });

  it.each([
    ['401 wrong token', { token: 'wrong' }, {}],
    ['503 token unset', {}, { env: {} }],
    ['403 non-loopback socket peer', {}, { before: ((req, _res, next) => { Object.defineProperty(req.socket, 'remoteAddress', { value: '203.0.113.9', configurable: true }); next(); }) as RequestHandler }],
  ] as const)('%s gives TOOL_NOT_DISPATCHED and never calls the executor', async (_label, clientOverride, serverOptional) => {
    const execute = vi.fn();
    const { baseUrl } = await serve({ executor: { ...executorWith(), execute } }, serverOptional as ToolExecutionRoutesOptional);
    const remote = createRemoteToolExecutor({ baseUrl, token: TOKEN, ...clientOverride });
    expect(await rpcCode(remote.execute({ principal, run, toolId: 'x', input: {} }))).toBe('TOOL_NOT_DISPATCHED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('413 for a 17 MiB input gives TOOL_NOT_DISPATCHED and never calls the executor', async () => {
    const execute = vi.fn();
    const { baseUrl } = await serve({ executor: { ...executorWith(), execute } });
    const input = 'x'.repeat(17 * 1024 * 1024);
    expect(await rpcCode(client(baseUrl).execute({ principal, run, toolId: 'x', input }))).toBe('TOOL_NOT_DISPATCHED');
    expect(execute).not.toHaveBeenCalled();
  });
});

/** The run's agent payloads as the chat client reads them back. */
async function agentEvents(lifecycle: ReturnType<typeof createRunLifecycle>, runId: string) {
  const payloads: RunAgentPayload[] = [];
  await lifecycle.stream({ runId, onEvent: (event) => { if (event.kind === 'agent') payloads.push(event.payload as RunAgentPayload); } });
  return payloads.flatMap((payload) => translateRunAgentPayload({ payload }) ?? []);
}

/** A raw request so status codes and headers are observable directly. */
function rawRequest(baseUrl: string, { method, path, token, body, headers = {} }: { method: string; path: string; token?: string; body?: string; headers?: Record<string, string> }): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((done, fail) => {
    const req = http.request(new URL(path, baseUrl), {
      method,
      agent: false,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }), ...headers },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', fail);
    req.end(body);
  });
}

describe('remote tool RPC — body parser and gate order', () => {
  it('accepts an authenticated 1 MB body on a Router mounted before an app-level 128 kb parser', async () => {
    const executor = executorWith(tool('size', async ({ input }) => (input as { blob: string }).blob.length));
    const { baseUrl } = await serve({ executor });
    const blob = 'y'.repeat(1024 * 1024);
    await expect(client(baseUrl).execute({ principal, run, toolId: 'size', input: { blob } })).resolves.toMatchObject({ status: 'completed', output: blob.length });
  });

  it('answers 413 above maxBodyBytes', async () => {
    const { baseUrl } = await serve({ executor: executorWith() });
    const body = JSON.stringify({ executionId: 'e', principal, run, toolId: 'x', input: 'z'.repeat(17 * 1024 * 1024) });
    expect((await rawRequest(baseUrl, { method: 'POST', path: '/internal/tool-executions', token: TOKEN, body })).status).toBe(413);
  });

  it('refuses an unauthenticated 1 MB body with 401 before its parser runs', async () => {
    const realJson = express.json;
    const parserCalls = vi.fn();
    vi.spyOn(express, 'json').mockImplementation((options) => {
      const parser = realJson(options);
      return (req, res, next) => { parserCalls(); parser(req, res, next); };
    });
    const { baseUrl } = await serve({ executor: executorWith() });
    const body = JSON.stringify({ executionId: 'e', principal, run, toolId: 'x', input: 'z'.repeat(1024 * 1024) });
    const response = await rawRequest(baseUrl, { method: 'POST', path: '/internal/tool-executions', body });
    expect(response.status).toBe(401);
    expect(parserCalls).not.toHaveBeenCalled();
  });

  it('checks loopback on the socket peer and ignores X-Forwarded-For', async () => {
    const { baseUrl } = await serve({ executor: executorWith() }, {
      before: (req, _res, next) => { Object.defineProperty(req.socket, 'remoteAddress', { value: '198.51.100.7', configurable: true }); next(); },
    });
    const body = JSON.stringify({ executionId: 'e', principal, run, toolId: 'x', input: {} });
    const response = await rawRequest(baseUrl, { method: 'POST', path: '/internal/tool-executions', token: TOKEN, body, headers: { 'x-forwarded-for': '127.0.0.1' } });
    expect(response.status).toBe(403);
  });

  it('answers 400 for a malformed body without calling the executor', async () => {
    const execute = vi.fn();
    const { baseUrl } = await serve({ executor: { ...executorWith(), execute } });
    expect((await rawRequest(baseUrl, { method: 'POST', path: '/internal/tool-executions', token: TOKEN, body: JSON.stringify({ toolId: 'x' }) })).status).toBe(400);
    expect((await rawRequest(baseUrl, { method: 'POST', path: '/internal/tool-executions', token: TOKEN, body: '{not json' })).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('remote tool RPC — transport', () => {
  it('uses node:http and never touches fetch', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('fetch must not be used'); });
    vi.stubGlobal('fetch', fetchSpy);
    const { baseUrl } = await serve({ executor: executorWith(tool('echo', async () => 'ok')) });
    const request = vi.fn(http.request);
    await expect(client(baseUrl, { request: request as unknown as typeof http.request }).execute({ principal, run, toolId: 'echo', input: {} })).resolves.toMatchObject({ status: 'completed' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['http', false, http.request],
    ['https', true, ((url: URL, options: https.RequestOptions, callback?: (res: http.IncomingMessage) => void) => https.request(url, { ...options, ca: LOOPBACK_TLS_CERT }, callback)) as unknown as typeof http.request],
  ] as const)('a %s listener serves the call through its request adapter on a socket with no idle timeout', async (_scheme, useTls, adapter) => {
    const { baseUrl } = await serve({ executor: executorWith(tool('echo', async () => 'ok')) }, { tls: useTls });
    const sockets: net.Socket[] = [];
    const request = ((...args: Parameters<typeof http.request>) => adapter(...args).once('socket', (socket) => sockets.push(socket))) as typeof http.request;
    await expect(client(baseUrl, { request }).execute({ principal, run, toolId: 'echo', input: {} })).resolves.toMatchObject({ status: 'completed', output: 'ok' });
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.timeout).toBeUndefined();
  });

  it('defaults to node:https for an https baseUrl, and a refused certificate is TOOL_NOT_DISPATCHED', async () => {
    const execute = vi.fn();
    const { baseUrl } = await serve({ executor: { ...executorWith(), execute } }, { tls: true });
    const error = await client(baseUrl).execute({ principal, run, toolId: 'x', input: {} }).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'ToolRpcError', code: 'TOOL_NOT_DISPATCHED', cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('a request adapter that refuses the scheme synchronously is TOOL_NOT_DISPATCHED', async () => {
    const error = await client('https://127.0.0.1:1', { request: http.request }).execute({ principal, run, toolId: 'x', input: {} }).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'ToolRpcError', code: 'TOOL_NOT_DISPATCHED', cause: { code: 'ERR_INVALID_PROTOCOL' } });
  });

  it('getAuditRecord is null and resumeConfirmation throws: the far side owns both', () => {
    const remote = client('http://127.0.0.1:1');
    expect(remote.getAuditRecord({ executionId: 'e' })).toBeNull();
    expect(() => remote.resumeConfirmation({ executionId: 'e', decision: 'confirm' })).toThrow(/confirmed on the executing server/);
    expect(() => remote.cancel({ executionId: 'unknown' })).not.toThrow();
  });
});

describe('remote tool catalog', () => {
  it('calls listToolsFor on every request and sends no ETag', async () => {
    const listToolsFor = vi.fn(async ({ principalId }: { principalId: string }) => [{ id: `tool-for-${principalId}` }]);
    const { baseUrl } = await serve({ executor: executorWith(), listToolsFor });
    const first = await rawRequest(baseUrl, { method: 'GET', path: '/internal/tool-catalog?principalId=p1', token: TOKEN });
    const second = await rawRequest(baseUrl, { method: 'GET', path: '/internal/tool-catalog?principalId=p1', token: TOKEN, headers: { 'if-none-match': 'W/"anything"' } });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(JSON.parse(first.text)).toEqual({ tools: [{ id: 'tool-for-p1' }] });
    expect(listToolsFor).toHaveBeenCalledTimes(2);
    expect(listToolsFor).toHaveBeenCalledWith({ principalId: 'p1' });
    expect(first.headers.etag).toBeUndefined();
    expect(second.headers.etag).toBeUndefined();
  });

  it('is gated by the same token and needs a principalId', async () => {
    const listToolsFor = vi.fn(() => []);
    const { baseUrl } = await serve({ executor: executorWith(), listToolsFor });
    expect((await rawRequest(baseUrl, { method: 'GET', path: '/internal/tool-catalog?principalId=p1' })).status).toBe(401);
    expect((await rawRequest(baseUrl, { method: 'GET', path: '/internal/tool-catalog', token: TOKEN })).status).toBe(400);
    expect(listToolsFor).not.toHaveBeenCalled();
  });

  it('redacts a listToolsFor failure to a generic 500', async () => {
    const { baseUrl } = await serve({ executor: executorWith(), listToolsFor: () => { throw new Error('secret path /x'); } });
    const response = await rawRequest(baseUrl, { method: 'GET', path: '/internal/tool-catalog?principalId=p1', token: TOKEN });
    expect(response.status).toBe(500);
    expect(response.text).not.toContain('secret path');
  });
});
