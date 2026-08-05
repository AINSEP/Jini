import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiError } from '@jini-ai/protocol';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { err, ok } from '../types.js';
import { isLocalSameOrigin } from '../origin-validation.js';

vi.mock('../origin-validation.js', () => ({
  isLocalSameOrigin: vi.fn(() => true),
}));

interface MockApp {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  delete: (path: string, handler: any) => void;
  patch: (path: string, handler: any) => void;
  handlers: Record<string, (req: any, res: any) => Promise<void> | void>;
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const make = (method: string) => (path: string, handler: any) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return {
    get: make('get'),
    post: make('post'),
    put: make('put'),
    delete: make('delete'),
    patch: make('patch'),
    handlers,
  };
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

/** A `res` double that, unlike `makeRes`'s plain `{status,json}` stub, behaves like a real
 * `ServerResponse` closely enough to exercise `mountJsonRoute`'s disconnect wiring: it tracks
 * `'close'` listeners and exposes `fireClose()` for a test to simulate the connection dropping
 * mid-handle. Disconnect is observed on `res`, not `req` — see `adapter.ts`'s own comment for why
 * (a real POST's body finishing being read fires `req`'s `'close'` long before any response is
 * sent, with no disconnect having happened). */
function makeClosableRes() {
  const listeners = new Set<() => void>();
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    on(event: string, listener: () => void) {
      if (event === 'close') listeners.add(listener);
    },
    off(event: string, listener: () => void) {
      if (event === 'close') listeners.delete(listener);
    },
    fireClose() {
      for (const listener of listeners) listener();
    },
    get closeListenerCount() {
      return listeners.size;
    },
  };
}

const adapter = { resolvedPortRef: { current: 7456 } };

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

describe('http adapter', () => {
  it('parses input and returns the success payload', async () => {
    const route = defineJsonRoute<{ value: string }, { echoed: string }, unknown>({
      method: 'post',
      path: '/echo',
      parse: (raw) => ok({ value: String((raw.body as any).value) }),
      handle: (input) => ok({ echoed: input.value }),
    });
    const app = makeApp();
    mountJsonRoute(app as any, route, {}, adapter);
    const res = makeRes();
    await app.handlers['POST /echo']!({ body: { value: 'hi' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ echoed: 'hi' });
  });

  it('returns 400 when parse fails', async () => {
    const route = defineJsonRoute<{ value: string }, unknown, unknown>({
      method: 'post',
      path: '/missing',
      parse: () => err(createApiError('BAD_REQUEST', 'required')),
      handle: () => ok({}),
    });
    const app = makeApp();
    mountJsonRoute(app as any, route, {}, adapter);
    const res = makeRes();
    await app.handlers['POST /missing']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'BAD_REQUEST', message: 'required' } });
  });

  it('maps a NOT_FOUND domain error to 404', async () => {
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get',
      path: '/missing',
      parse: () => ok(undefined),
      handle: () => err(createApiError('NOT_FOUND', 'gone')),
    });
    const app = makeApp();
    mountJsonRoute(app as any, route, {}, adapter);
    const res = makeRes();
    await app.handlers['GET /missing']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'gone' } });
  });

  it('allows a same-origin request through when requireSameOrigin is set', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(true);
    const route = defineJsonRoute<void, { secret: number }, unknown>({
      method: 'get',
      path: '/secret',
      requireSameOrigin: true,
      parse: () => ok(undefined),
      handle: () => ok({ secret: 42 }),
    });
    const app = makeApp();
    mountJsonRoute(app as any, route, {}, adapter);
    const res = makeRes();
    await app.handlers['GET /secret']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ secret: 42 });
  });

  it('blocks cross-origin requests when requireSameOrigin is set', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const route = defineJsonRoute<void, { secret: number }, unknown>({
      method: 'get',
      path: '/secret',
      requireSameOrigin: true,
      parse: () => ok(undefined),
      handle: () => ok({ secret: 42 }),
    });
    const app = makeApp();
    mountJsonRoute(app as any, route, {}, adapter);
    const res = makeRes();
    await app.handlers['GET /secret']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'FORBIDDEN', message: 'cross-origin request rejected' },
    });
  });

  // Both of these previously asserted the thrown message was echoed verbatim into the 500 body.
  // That is the leak: this catch is the last-resort handler for *unanticipated* exceptions, which
  // are exactly the ones carrying filesystem paths, connection strings and credentials — and it
  // covers `health.ts`'s probes, which mount ahead of the security middleware and are therefore
  // reachable unauthenticated. The value is not discarded, it is routed to the host's sink and
  // tied to the caller's response by a correlation id.
  it('redacts a thrown handler error to a generic INTERNAL_ERROR (500) and reports it to the sink', async () => {
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get',
      path: '/boom',
      parse: () => ok(undefined),
      handle: () => {
        throw new Error('sqlite failed at /srv/secret/data.db; token=hunter2');
      },
    });
    const app = makeApp();
    const onInternalError = vi.fn();
    mountJsonRoute(app as any, route, {}, { ...adapter, onInternalError });
    const res = makeRes();
    await app.handlers['GET /boom']!({ body: {}, query: {}, params: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0]![0] as { error: { code: string; message: string; requestId?: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('an internal error occurred');
    expect(JSON.stringify(body)).not.toContain('/srv/secret/data.db');
    expect(JSON.stringify(body)).not.toContain('hunter2');

    expect(onInternalError).toHaveBeenCalledOnce();
    const context = onInternalError.mock.calls[0]![0] as { correlationId: string; error: unknown; method: string; path: string };
    expect((context.error as Error).message).toBe('sqlite failed at /srv/secret/data.db; token=hunter2');
    expect(context.path).toBe('/boom');
    expect(body.error.requestId).toBe(context.correlationId);
  });

  it('redacts a thrown non-Error value the same way', async () => {
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get',
      path: '/boom-string',
      parse: () => ok(undefined),
      handle: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'boom-string-with-/srv/secret/data.db';
      },
    });
    const app = makeApp();
    const onInternalError = vi.fn();
    mountJsonRoute(app as any, route, {}, { ...adapter, onInternalError });
    const res = makeRes();
    await app.handlers['GET /boom-string']!({ body: {}, query: {}, params: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0]![0])).not.toContain('/srv/secret/data.db');
    expect(onInternalError).toHaveBeenCalledOnce();
    expect(onInternalError.mock.calls[0]![0]).toMatchObject({ error: 'boom-string-with-/srv/secret/data.db' });
  });

  it('falls back to a console sink when the host supplies none, still without leaking', async () => {
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get',
      path: '/boom-nosink',
      parse: () => ok(undefined),
      handle: () => {
        throw new Error('secret-at-/srv/secret/data.db');
      },
    });
    const app = makeApp();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mountJsonRoute(app as any, route, {}, adapter);
      const res = makeRes();
      await app.handlers['GET /boom-nosink']!({ body: {}, query: {}, params: {} }, res);
      expect(JSON.stringify(res.json.mock.calls[0]![0])).not.toContain('/srv/secret/data.db');
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('passes deps through to the handler', async () => {
    interface Deps {
      tag: string;
    }
    const route = defineJsonRoute<void, { tag: string }, Deps>({
      method: 'get',
      path: '/deps',
      parse: () => ok(undefined),
      handle: (_input, deps) => ok({ tag: deps.tag }),
    });
    const app = makeApp();
    mountJsonRoute(app as any, route, { tag: 'injected' }, adapter);
    const res = makeRes();
    await app.handlers['GET /deps']!({ body: {}, query: {}, params: {} }, res);
    expect(res.json).toHaveBeenCalledWith({ tag: 'injected' });
  });

  it('aborts the signal handed to `handle` when the request closes before a response is sent', async () => {
    let capturedSignal: AbortSignal | undefined;
    let releaseHandle: (() => void) | undefined;
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get',
      path: '/slow',
      parse: () => ok(undefined),
      handle: async (_input, _deps, signal) => {
        capturedSignal = signal;
        await new Promise<void>((resolve) => {
          releaseHandle = resolve;
        });
        return ok({});
      },
    });
    const app = makeApp();
    mountJsonRoute(app as any, route, {}, adapter);
    const req = { body: {}, query: {}, params: {} };
    const res = makeClosableRes();
    const handled = app.handlers['GET /slow']!(req, res);

    await Promise.resolve();
    expect(capturedSignal?.aborted).toBe(false);
    res.fireClose();
    expect(capturedSignal?.aborted).toBe(true);

    releaseHandle!();
    await handled;
    // The client was gone before `handle` resolved — no response should have been written.
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('does not misfire on a close observed only after the response has already been sent', async () => {
    const route = defineJsonRoute<void, { ok: boolean }, unknown>({
      method: 'get',
      path: '/fast',
      parse: () => ok(undefined),
      handle: () => ok({ ok: true }),
    });
    const app = makeApp();
    mountJsonRoute(app as any, route, {}, adapter);
    const req = { body: {}, query: {}, params: {} };
    const res = makeClosableRes();
    await app.handlers['GET /fast']!(req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    // The listener is detached once `handle` settles, so a `close` firing afterward (the normal
    // end-of-request event, not a disconnect) has nothing left to call.
    expect(res.closeListenerCount).toBe(0);
    expect(() => res.fireClose()).not.toThrow();
  });

  it('leaves no dangling close listener after a route that throws', async () => {
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get',
      path: '/boom-cleanup',
      parse: () => ok(undefined),
      handle: () => {
        throw new Error('boom');
      },
    });
    const app = makeApp();
    mountJsonRoute(app as any, route, {}, adapter);
    const req = { body: {}, query: {}, params: {} };
    const res = makeClosableRes();
    await app.handlers['GET /boom-cleanup']!(req, res);

    expect(res.closeListenerCount).toBe(0);
  });
});
