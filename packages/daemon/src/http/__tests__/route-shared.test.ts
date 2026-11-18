import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, type ServerMiddleware, type ServerRoute } from '@jini-ai/core/contracts/server';
import { createInMemoryServer } from '@jini-ai/core/contracts/server/testing';
import { createLineStream } from '../line-stream.js';
import { describeRoutes, gated } from '../route-table.js';
import { createCommitLatch } from '../sse-commit.js';
import { createManualScheduler, fakeDaemonRouteHost } from './fakes/route-host.js';

const text = (status: number, body: string): Response => new Response(body, { status });
/** The signal of a request that nobody aborts, or the one a test passes. */
const request = (signal?: AbortSignal): { signal: AbortSignal } => ({ signal: signal ?? new AbortController().signal });

describe('gated', () => {
  const route: ServerRoute = { method: 'GET', path: '/api/thing', handler: () => text(200, 'handled') };
  const pass = (label: string, order: string[]): ServerMiddleware => async ({ next }) => { order.push(label); return next(); };
  const refuse: ServerMiddleware = () => text(401, 'refused');

  it('runs the gates in the order given, then the handler, and records their names in that order', async () => {
    const order: string[] = [];
    const built = gated({ route, gates: [{ name: 'remote-bridge-token', middleware: pass('token', order) }, { name: 'frontend-session-owner', middleware: pass('owner', order) }] });
    const server = createInMemoryServer();
    server.server.route(built);
    const response = await server.fetch(new Request('http://daemon.test/api/thing'));
    expect(await response.text()).toBe('handled');
    expect(order).toEqual(['token', 'owner']);
    expect(built.gates).toEqual(['remote-bridge-token', 'frontend-session-owner']);
    expect({ method: built.method, path: built.path }).toEqual({ method: 'GET', path: '/api/thing' });
  });

  it('a gate that refuses answers itself: later gates and the handler are not called', async () => {
    const order: string[] = [];
    const handler = vi.fn(() => text(200, 'handled'));
    const server = createInMemoryServer();
    server.server.route(gated({ route: { ...route, handler }, gates: [{ name: 'tool-exec-caller', middleware: refuse }, { name: 'frontend-session-owner', middleware: pass('owner', order) }] }));
    const response = await server.fetch(new Request('http://daemon.test/api/thing'));
    expect(response.status).toBe(401);
    expect(order).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a gate with no middleware is recorded by name and leaves the handler as it is', () => {
    const built = gated({ route, gates: [{ name: 'same-origin' }] });
    expect(built.gates).toEqual(['same-origin']);
    expect(built.handler).toBe(route.handler);
  });
});

describe('describeRoutes', () => {
  it('lists method, path and gate names in list order; a plain route has no gates', () => {
    const plain: ServerRoute = { method: 'POST', path: '/api/plain', handler: () => jsonResponse({ status: 200, body: {} }) };
    const guarded = gated({ route: { method: 'GET', path: '/api/guarded/:id', handler: plain.handler }, gates: [{ name: 'same-origin' }, { name: 'tool-exec-caller', middleware: ({ next }) => next() }] });
    expect(describeRoutes({ routes: [guarded, plain] })).toEqual([
      { method: 'GET', path: '/api/guarded/:id', gates: ['same-origin', 'tool-exec-caller'] },
      { method: 'POST', path: '/api/plain', gates: [] },
    ]);
  });
});

describe('createCommitLatch', () => {
  it('the first answer offered becomes the response; later offers are refused and change nothing', async () => {
    const latch = createCommitLatch();
    expect(latch.committed).toBe(false);
    const first = text(200, 'stream');
    expect(latch.commit({ response: first })).toBe(true);
    expect(latch.committed).toBe(true);
    expect(latch.commit({ response: text(500, 'too late') })).toBe(false);
    expect(await latch.response).toBe(first);
  });

  it('the response stays pending until something is offered', async () => {
    const latch = createCommitLatch();
    const settled = vi.fn();
    void latch.response.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    latch.commit({ response: text(404, 'unknown') });
    expect((await latch.response).status).toBe(404);
  });
});

describe('createLineStream', () => {
  const read = async (response: Response): Promise<string> => response.text();

  it('answers 200 as newline-delimited JSON that must not be cached, one line per write, and ends when told', async () => {
    const stream = createLineStream({ scheduler: createManualScheduler(), signal: request().signal });
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toBe('application/x-ndjson');
    expect(stream.response.headers.get('cache-control')).toBe('no-store');
    stream.write({ line: { type: 'surface', emission: { text: 'héllo' } } });
    stream.write({ line: { type: 'result', result: null } });
    stream.end();
    expect(await read(stream.response)).toBe('{"type":"surface","emission":{"text":"héllo"}}\n{"type":"result","result":null}\n');
    expect(stream.signal.aborted).toBe(false);
  });

  it('a write after the end is dropped, and ending twice is harmless', async () => {
    const stream = createLineStream({ scheduler: createManualScheduler(), signal: request().signal });
    stream.write({ line: 1 });
    stream.end();
    stream.write({ line: 2 });
    stream.end();
    expect(await read(stream.response)).toBe('1\n');
  });

  it('schedules no timer and writes nothing between lines unless a keepalive interval is given', async () => {
    const scheduler = createManualScheduler();
    const stream = createLineStream({ scheduler, signal: request().signal });
    expect(scheduler.pending).toBe(0);
    scheduler.advance(60_000);
    stream.end();
    expect(await read(stream.response)).toBe('');
  });

  it('writes a keepalive line at each interval while open, and cancels its timer at the end', async () => {
    const scheduler = createManualScheduler();
    const stream = createLineStream({ scheduler, signal: request().signal }, { keepAliveMs: 15_000 });
    expect(scheduler.pending).toBe(1);
    scheduler.advance(14_999);
    stream.write({ line: 'before' });
    scheduler.advance(1);
    scheduler.advance(15_000);
    stream.end();
    expect(scheduler.pending).toBe(0);
    scheduler.advance(15_000);
    expect(await read(stream.response)).toBe('"before"\n{"type":"keepalive"}\n{"type":"keepalive"}\n');
  });

  it('a caller whose request is aborted aborts the signal, stops the keepalive and drops later writes', async () => {
    const caller = new AbortController();
    const scheduler = createManualScheduler();
    const stream = createLineStream({ scheduler, signal: request(caller.signal).signal }, { keepAliveMs: 15_000 });
    stream.write({ line: 'kept' });
    caller.abort();
    expect(stream.signal.aborted).toBe(true);
    expect(scheduler.pending).toBe(0);
    stream.write({ line: 'dropped' });
    stream.end();
    expect(await read(stream.response)).toBe('"kept"\n');
  });

  it('a caller that stops reading aborts the signal and stops the keepalive', async () => {
    const scheduler = createManualScheduler();
    const stream = createLineStream({ scheduler, signal: request().signal }, { keepAliveMs: 15_000 });
    await stream.response.body!.cancel();
    expect(stream.signal.aborted).toBe(true);
    expect(scheduler.pending).toBe(0);
    expect(() => { stream.write({ line: 'dropped' }); stream.end(); }).not.toThrow();
  });

  it('a request that was already aborted gets an empty, ended answer, an aborted signal and no timer', async () => {
    const scheduler = createManualScheduler();
    const stream = createLineStream({ scheduler, signal: request(AbortSignal.abort()).signal }, { keepAliveMs: 15_000 });
    expect(stream.signal.aborted).toBe(true);
    expect(scheduler.pending).toBe(0);
    expect(await read(stream.response)).toBe('');
  });
});

describe('fakeDaemonRouteHost', () => {
  it('reports an internal error under a counted request ID, keeps the report, and tells the sink it was given', () => {
    const sink = vi.fn();
    const host = fakeDaemonRouteHost();
    const failure = new Error('boom');
    const answer = host.reportInternalError({ report: { error: failure, source: 'test' }, logSource: 'test-source', message: 'It failed.' }, { onInternalError: sink });
    expect(answer).toEqual({ code: 'INTERNAL_ERROR', message: 'It failed.', requestId: 'req-1' });
    expect(host.reports).toEqual([{ report: { error: failure, source: 'test' }, logSource: 'test-source', message: 'It failed.', requestId: 'req-1' }]);
    expect(sink).toHaveBeenCalledWith({ error: failure, source: 'test', correlationId: 'req-1', logSource: 'test-source' });
    expect(host.jsonBodyMaxBytes).toBe(1024 * 1024);
    expect(host.context.originPolicy.isSameOrigin({ host: 'a', origin: 'http://b' } as never)).toBe(true);
  });
});
