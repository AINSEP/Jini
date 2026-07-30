import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrontendSessionRegistry, type FrontendSessionRegistry } from '@jini-ai/daemon';
import type { Request, Response } from 'express';

import {
  FRONTEND_SESSION_STREAM_ROUTE_PATH,
  handleFrontendSessionStream,
  parseCapabilityQuery,
  frontendSessionResponseRoute,
  registerFrontendSessionRoutes,
  type FrontendSessionsHttpDeps,
} from '../frontend-sessions.js';

/** A request/response pair standing in for Express's, which already ARE Node's raw pair. */
function makeReqRes(query: Record<string, unknown> = {}) {
  const req = Object.assign(new EventEmitter(), { query }) as unknown as Request;
  const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), write: vi.fn().mockReturnValue(true), end: vi.fn() });
  return { req, res: res as unknown as Response, raw: res, emitter: req as unknown as EventEmitter };
}

function sentEvents(raw: { write: ReturnType<typeof vi.fn> }): any[] {
  return raw.write.mock.calls
    .map((call: unknown[]) => call[0] as string)
    .filter((chunk: string) => chunk.startsWith('data: '))
    .map((chunk: string) => JSON.parse(chunk.slice('data: '.length, chunk.length - 2)));
}

function makeDeps(
  registry: FrontendSessionRegistry,
  overrides: Partial<FrontendSessionsHttpDeps> = {},
): FrontendSessionsHttpDeps {
  return { registry, newSessionId: () => 'session-1', ...overrides };
}

describe('registerFrontendSessionRoutes', () => {
  const servers: Server[] = [];
  const adapter = { resolvedPortRef: { current: 0 } };

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function listen(deps: FrontendSessionsHttpDeps): Promise<string> {
    const app = express();
    app.use(express.json());
    registerFrontendSessionRoutes(app as never, deps, adapter as never);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);
    adapter.resolvedPortRef.current = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${adapter.resolvedPortRef.current}`;
  }

  it('serves a real SSE stream and routes a capability call through it end to end', async () => {
    const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1', newBindToken: () => 'bind-1' });
    const base = await listen(makeDeps(registry));

    const controller = new AbortController();
    const response = await fetch(
      `${base}${FRONTEND_SESSION_STREAM_ROUTE_PATH}?capability=page.click`,
      { signal: controller.signal },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const readEvent = async (): Promise<Record<string, unknown>> => {
      for (;;) {
        const { value } = await reader.read();
        const text = decoder.decode(value);
        const line = text.split('\n').find((l) => l.startsWith('data: '));
        if (line) return JSON.parse(line.slice('data: '.length));
      }
    };

    expect(await readEvent()).toEqual({ type: 'attached', sessionId: 'session-1', bindToken: 'bind-1' });

    registry.bindRun('run-1', 'session-1');
    const pending = registry.invoke('run-1', 'page.click', { element: 'save-button' });
    expect(await readEvent()).toEqual({
      type: 'invocation',
      invocationId: 'inv-1',
      capabilityId: 'page.click',
      input: { element: 'save-button' },
    });

    // Answer over the real POST route, closing the loop the browser half will close.
    const answer = await fetch(`${base}/api/frontend-sessions/session-1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ invocationId: 'inv-1', ok: true, output: { clicked: 'save-button' } }),
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ settled: true });
    await expect(pending).resolves.toEqual({ clicked: 'save-button' });

    controller.abort();
  });

  it('reports a stream failure through the host sink without leaking it out of the handler', async () => {
    const registry = createFrontendSessionRegistry();
    vi.spyOn(registry, 'attach').mockImplementation(() => {
      throw new Error('registry exploded');
    });
    const onInternalError = vi.fn();
    const base = await listen(makeDeps(registry, { onInternalError }));

    const response = await fetch(`${base}${FRONTEND_SESSION_STREAM_ROUTE_PATH}?capability=page.click`);
    // SSE headers were already committed, so the response ends rather than becoming a 500.
    await response.text();

    expect(onInternalError).toHaveBeenCalledWith({ source: 'stream', error: expect.any(Error) });
  });

  it('answers 500 when the stream fails before SSE headers were committed', () => {
    const registry = createFrontendSessionRegistry();
    const onInternalError = vi.fn();
    // Capture the GET handler directly: this path is only reachable when writing the SSE headers
    // is itself what fails (a client that vanished mid-handshake), which a live server cannot be
    // made to produce reliably.
    let getHandler: ((req: Request, res: Response) => void) | undefined;
    const fakeApp = {
      get: (_path: string, handler: (req: Request, res: Response) => void) => { getHandler = handler; },
      post: () => undefined,
    };
    registerFrontendSessionRoutes(fakeApp as never, makeDeps(registry, { onInternalError }), adapter as never);

    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead: vi.fn(() => { throw new Error('client vanished mid-handshake'); }),
      write: vi.fn(),
      end: vi.fn(),
      status,
      json,
    };
    getHandler!(Object.assign(new EventEmitter(), { query: {} }) as never, res as never);

    expect(onInternalError).toHaveBeenCalledWith({ source: 'stream', error: expect.any(Error) });
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    });
  });

  it('ends the response without a status when the failure came after headers but before close', () => {
    const registry = createFrontendSessionRegistry();
    vi.spyOn(registry, 'attach').mockImplementation(() => { throw new Error('registry exploded'); });
    let getHandler: ((req: Request, res: Response) => void) | undefined;
    const fakeApp = {
      get: (_path: string, handler: (req: Request, res: Response) => void) => { getHandler = handler; },
      post: () => undefined,
    };
    registerFrontendSessionRoutes(fakeApp as never, makeDeps(registry, { onInternalError: vi.fn() }), adapter as never);

    const end = vi.fn();
    const res = Object.assign(new EventEmitter(), { headersSent: true, writableEnded: false, writeHead: vi.fn(), write: vi.fn().mockReturnValue(true), end, status: vi.fn(), json: vi.fn() });
    getHandler!(Object.assign(new EventEmitter(), { query: { capability: 'page.click' } }) as never, res as never);

    expect(end).toHaveBeenCalled();
  });

  it('falls back to console.error when no sink is supplied, and survives a throwing sink', async () => {
    const registry = createFrontendSessionRegistry();
    vi.spyOn(registry, 'attach').mockImplementation(() => {
      throw new Error('registry exploded');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const base = await listen({ registry, newSessionId: () => 'session-1' });
    await (await fetch(`${base}${FRONTEND_SESSION_STREAM_ROUTE_PATH}?capability=page.click`)).text();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('frontend-sessions:stream'),
      expect.any(Error),
    );

    // A sink that itself throws must not turn a contained failure into an unhandled rejection.
    consoleError.mockClear();
    const throwingSink = vi.fn(() => { throw new Error('sink exploded'); });
    const base2 = await listen(makeDeps(registry, { onInternalError: throwingSink }));
    await (await fetch(`${base2}${FRONTEND_SESSION_STREAM_ROUTE_PATH}?capability=page.click`)).text();
    expect(throwingSink).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('internal error sink failed'),
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});

describe('parseCapabilityQuery', () => {
  it('accepts a single value, repeated values, and none at all', () => {
    expect(parseCapabilityQuery('page.click')).toEqual(['page.click']);
    expect(parseCapabilityQuery(['page.click', 'page.fill'])).toEqual(['page.click', 'page.fill']);
    expect(parseCapabilityQuery(undefined)).toEqual([]);
  });

  it('rejects rather than coerces anything that is not a non-empty string', () => {
    // A bracketed query string (`?capability[x]=y`) parses to an object; silently coercing it
    // would attach a surface claiming a capability nobody asked for.
    expect(parseCapabilityQuery({ nested: 'value' })).toBeNull();
    expect(parseCapabilityQuery(['page.click', ''])).toBeNull();
    expect(parseCapabilityQuery(['page.click', '   '])).toBeNull();
    expect(parseCapabilityQuery([42])).toBeNull();
  });
});

describe('handleFrontendSessionStream', () => {
  it('attaches the surface and reports the minted session id as the first event', () => {
    const registry = createFrontendSessionRegistry({ newBindToken: () => 'bind-1' });
    const { req, res, raw } = makeReqRes({ capability: ['page.click', 'page.fill'] });

    handleFrontendSessionStream(req, res, makeDeps(registry));

    expect(sentEvents(raw)).toEqual([{ type: 'attached', sessionId: 'session-1', bindToken: 'bind-1' }]);
    registry.bindRun('run-1', 'session-1');
    expect(registry.capabilitiesFor('run-1')).toEqual(['page.click', 'page.fill']);
  });

  it('pushes each capability call to the surface as an invocation event', async () => {
    const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
    const { req, res, raw } = makeReqRes({ capability: 'page.click' });
    handleFrontendSessionStream(req, res, makeDeps(registry));
    registry.bindRun('run-1', 'session-1');

    const pending = registry.invoke('run-1', 'page.click', { element: 'save-button' });

    expect(sentEvents(raw)[1]).toEqual({
      type: 'invocation',
      invocationId: 'inv-1',
      capabilityId: 'page.click',
      input: { element: 'save-button' },
    });

    registry.settle('session-1', 'inv-1', { ok: true, output: { clicked: 'save-button' } });
    await expect(pending).resolves.toEqual({ clicked: 'save-button' });
  });

  it('mints a random session id when the host supplies no generator', () => {
    const registry = createFrontendSessionRegistry();
    const { req, res, raw } = makeReqRes({ capability: 'page.click' });

    handleFrontendSessionStream(req, res, { registry });

    const attached = sentEvents(raw)[0] as { type: string; sessionId: string };
    expect(attached.type).toBe('attached');
    // A real UUID, not an empty or predictable placeholder.
    expect(attached.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('never mints a session id the caller supplied', () => {
    const registry = createFrontendSessionRegistry({ newBindToken: () => 'bind-1' });
    // An id chosen by the caller could collide with, or impersonate, an attached session.
    const { req, res, raw } = makeReqRes({ capability: 'page.click', sessionId: 'attacker-chosen' });

    handleFrontendSessionStream(req, res, makeDeps(registry));

    expect(sentEvents(raw)[0]).toEqual({ type: 'attached', sessionId: 'session-1', bindToken: 'bind-1' });
  });

  it('reports a bad capability query as an SSE error event and closes, attaching nothing', () => {
    const registry = createFrontendSessionRegistry();
    const attachSpy = vi.spyOn(registry, 'attach');
    const { req, res, raw } = makeReqRes({ capability: { nested: 'value' } });

    handleFrontendSessionStream(req, res, makeDeps(registry));

    // SSE headers are already committed by then, so there is no status-code channel left.
    expect(sentEvents(raw)).toEqual([
      { type: 'error', message: 'each "capability" query parameter must be a non-empty string' },
    ]);
    expect(raw.end).toHaveBeenCalled();
    expect(attachSpy).not.toHaveBeenCalled();
  });

  it('detaches the surface when the connection closes, failing anything still awaiting it', async () => {
    const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
    const { req, res, emitter } = makeReqRes({ capability: 'page.click' });
    handleFrontendSessionStream(req, res, makeDeps(registry));
    registry.bindRun('run-1', 'session-1');

    const pending = registry.invoke('run-1', 'page.click', {});
    emitter.emit('close');

    await expect(pending).rejects.toThrow('detached before answering');
    // The binding goes with it, so a later call fails closed instead of hanging.
    expect(registry.sessionFor('run-1')).toBeUndefined();
  });

  it('attaches with no capabilities when none are requested, so nothing can be served', async () => {
    const registry = createFrontendSessionRegistry();
    const { req, res } = makeReqRes({});

    handleFrontendSessionStream(req, res, makeDeps(registry));
    registry.bindRun('run-1', 'session-1');

    expect(registry.capabilitiesFor('run-1')).toEqual([]);
    await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(/does not offer "page\.click"/);
  });
});

describe('frontendSessionResponseRoute', () => {
  const parse = frontendSessionResponseRoute.parse;

  function input(body: unknown, sessionId = 'session-1') {
    return { body, query: {}, params: { sessionId } };
  }

  it('settles a pending invocation with the surface\'s output', async () => {
    const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
    const { req, res } = makeReqRes({ capability: 'page.click' });
    handleFrontendSessionStream(req, res, makeDeps(registry));
    registry.bindRun('run-1', 'session-1');
    const pending = registry.invoke('run-1', 'page.click', {});

    const parsed = parse(input({ invocationId: 'inv-1', ok: true, output: { clicked: 'x' } }));
    expect(parsed.ok).toBe(true);
    const result = await frontendSessionResponseRoute.handle(
      (parsed as { ok: true; value: never }).value,
      makeDeps(registry),
    );

    expect(result).toEqual({ ok: true, value: { settled: true } });
    await expect(pending).resolves.toEqual({ clicked: 'x' });
  });

  it('turns a reported failure into a rejection carrying the surface\'s message', async () => {
    const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
    const { req, res } = makeReqRes({ capability: 'page.fill' });
    handleFrontendSessionStream(req, res, makeDeps(registry));
    registry.bindRun('run-1', 'session-1');
    const pending = registry.invoke('run-1', 'page.fill', {});

    const parsed = parse(input({ invocationId: 'inv-1', ok: false, message: 'refusing to fill "password"' }));
    await frontendSessionResponseRoute.handle((parsed as { ok: true; value: never }).value, makeDeps(registry));

    await expect(pending).rejects.toThrow('refusing to fill "password"');
  });

  it('reports settled:false for a duplicate or unknown answer instead of erroring', async () => {
    const registry = createFrontendSessionRegistry();
    const parsed = parse(input({ invocationId: 'never-issued', ok: true, output: 1 }));

    const result = await frontendSessionResponseRoute.handle(
      (parsed as { ok: true; value: never }).value,
      makeDeps(registry),
    );

    // A stream reconnect or retried POST is expected, not exceptional.
    expect(result).toEqual({ ok: true, value: { settled: false } });
  });

  it('requires a same-origin request', () => {
    expect(frontendSessionResponseRoute.requireSameOrigin).toBe(true);
  });

  describe('input validation', () => {
    it('rejects a missing or blank invocationId', () => {
      expect(parse(input({ ok: true })).ok).toBe(false);
      expect(parse(input({ invocationId: '   ', ok: true })).ok).toBe(false);
      expect(parse(input({ invocationId: 42, ok: true })).ok).toBe(false);
    });

    it('rejects a non-boolean ok', () => {
      expect(parse(input({ invocationId: 'inv-1' })).ok).toBe(false);
      expect(parse(input({ invocationId: 'inv-1', ok: 'yes' })).ok).toBe(false);
    });

    it('requires a message when ok is false', () => {
      // A failure with no reason gives the agent nothing to act on, so it retries forever.
      expect(parse(input({ invocationId: 'inv-1', ok: false })).ok).toBe(false);
      expect(parse(input({ invocationId: 'inv-1', ok: false, message: '  ' })).ok).toBe(false);
      expect(parse(input({ invocationId: 'inv-1', ok: false, message: 'why' })).ok).toBe(true);
    });

    it('rejects a non-object body and a missing sessionId', () => {
      expect(parse(input('not an object')).ok).toBe(false);
      expect(parse(input([1, 2, 3])).ok).toBe(false);
      expect(parse(input({ invocationId: 'inv-1', ok: true }, '')).ok).toBe(false);
    });

    it('accepts an absent output as a legitimate success value', () => {
      const parsed = parse(input({ invocationId: 'inv-1', ok: true }));
      expect(parsed.ok).toBe(true);
    });
  });
});
