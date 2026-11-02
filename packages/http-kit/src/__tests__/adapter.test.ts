import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createApiError } from '@jini-ai/protocol';
import { ClientFacingError, defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { err, ok } from '../types.js';
import { isLocalSameOrigin } from '@jini-ai/core';

vi.mock('@jini-ai/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@jini-ai/core')>(),
  isLocalSameOrigin: vi.fn(() => true),
}));

type RecordedHandler = (req: any, res: any) => Promise<void> | void;

/** A real `express()` app whose route methods record each handler instead of routing it. Typed as
 * `Express` through `Object.assign` (no cast), so an incompatible fake fails type-checking. */
function makeApp() {
  const handlers: Record<string, RecordedHandler> = {};
  const make = (method: string) => (path: string, handler: RecordedHandler) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return Object.assign(express(), {
    get: make('get'),
    post: make('post'),
    put: make('put'),
    delete: make('delete'),
    patch: make('patch'),
    handlers,
  });
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

/** A `res` double that, unlike `makeRes`'s plain `{status,json}` stub, behaves like a real
 * `ServerResponse` closely enough to exercise `mountJsonRoute`'s disconnect wiring: it tracks
 * `'close'` listeners and exposes `fireClose` for a test to simulate the connection dropping
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

const adapter = { allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS', webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST', env: {}, resolvedPortRef: { current: 7456 } };

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

describe('http adapter', () => {
  it('redacts inspected config headers and quoted credentials while retaining stack, code and correlation', async () => {
    const failure = Object.assign(new Error('UPSTREAM_FAILED'), {
      code: 'ECONNREFUSED',
      config: { headers: { 'x-api-key': 'synthetic-opaque-value' } },
      password: 'synthetic two words',
      detail: JSON.stringify({ apiKey: 'synthetic-json-value' }),
    });
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get', path: '/quoted-credentials', parse: () => ok({ value: undefined }),
      handle: () => { throw failure; },
    });
    const app = makeApp();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mountJsonRoute({ app, spec: route, deps: {}, adapter });
      const res = makeRes();
      await app.handlers['GET /quoted-credentials']!({ body: {}, query: {}, params: {} }, res);
      const body = res.json.mock.calls[0]![0] as { error: { requestId: string } };
      const output = log.mock.calls.flat().map(String).join(' ');
      for (const word of ['synthetic', 'two words']) expect(output).not.toContain(word);
      expect(output).toContain('ECONNREFUSED');
      expect(output).toContain('UPSTREAM_FAILED');
      expect(output).toContain('adapter.test.ts:');
      expect(output).toContain(body.error.requestId);
      expect(body.error.requestId).toEqual(expect.any(String));
      expect(res.status).toHaveBeenCalledWith(500);
    } finally { log.mockRestore(); }
  });

  it.each([false, true])('redacts exception logs and preserves request IDs and codes (non-Error=%s)', async (nonError) => {
    const secret = 'sk-live-0123456789abcdefghijklmnopqrstuv';
    const failure = Object.assign(new Error(`UPSTREAM_FAILED ${secret} Bearer abcdefghijklmnopqrst password=hunter2`), { code: 'ECONNREFUSED' });
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get', path: '/log-redaction', parse: () => ok({ value: undefined }),
      handle: () => { throw nonError ? failure.message : failure; },
    });
    const app = makeApp();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mountJsonRoute({ app, spec: route, deps: {}, adapter });
      const res = makeRes();
      await app.handlers['GET /log-redaction']!({ body: {}, query: {}, params: {} }, res);
      const body = res.json.mock.calls[0]![0] as { error: { requestId: string; code: string } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.requestId).toEqual(expect.any(String));
      const output = log.mock.calls.flat().map(String).join(' ');
      expect(output).toContain(body.error.requestId);
      expect(output).toContain('UPSTREAM_FAILED');
      expect(output).toContain('[REDACTED:');
      for (const value of [secret, 'abcdefghijklmnopqrst', 'hunter2']) expect(output).not.toContain(value);
      if (!nonError) expect(output).toContain('ECONNREFUSED');
    } finally { log.mockRestore(); }
  });

  it('parses input and returns the success payload', async () => {
    const route = defineJsonRoute<{ value: string }, { echoed: string }, unknown>({ method: 'post', path: '/echo', parse: (raw) => ok({ value: { value: String((raw.body as any).value) } }), handle: ({ input }) => ok({ value: { echoed: input.value } }) });
    const app = makeApp();
    mountJsonRoute({ app, spec: route, deps: {}, adapter });
    const res = makeRes();
    await app.handlers['POST /echo']!({ body: { value: 'hi' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ echoed: 'hi' });
  });

  it('returns 400 when parse fails', async () => {
    const route = defineJsonRoute<{ value: string }, unknown, unknown>({ method: 'post', path: '/missing', parse: () => err({ error: createApiError({ code: 'BAD_REQUEST', message: 'required' }) }), handle: () => ok({ value: {} }) });
    const app = makeApp();
    mountJsonRoute({ app, spec: route, deps: {}, adapter });
    const res = makeRes();
    await app.handlers['POST /missing']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'BAD_REQUEST', message: 'required' } });
  });

  it('maps a NOT_FOUND domain error to 404', async () => {
    const route = defineJsonRoute<void, unknown, unknown>({ method: 'get', path: '/missing', parse: () => ok({ value: undefined }), handle: () => err({ error: createApiError({ code: 'NOT_FOUND', message: 'gone' }) }) });
    const app = makeApp();
    mountJsonRoute({ app, spec: route, deps: {}, adapter });
    const res = makeRes();
    await app.handlers['GET /missing']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'gone' } });
  });

  it('allows a same-origin request through when requireSameOrigin is set', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(true);
    const route = defineJsonRoute<void, { secret: number }, unknown>({ method: 'get', path: '/secret', parse: () => ok({ value: undefined }), handle: () => ok({ value: { secret: 42 } }) }, { requireSameOrigin: true });
    const app = makeApp();
    mountJsonRoute({ app, spec: route, deps: {}, adapter });
    const res = makeRes();
    await app.handlers['GET /secret']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ secret: 42 });
  });

  it('blocks cross-origin requests when requireSameOrigin is set', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const route = defineJsonRoute<void, { secret: number }, unknown>({ method: 'get', path: '/secret', parse: () => ok({ value: undefined }), handle: () => ok({ value: { secret: 42 } }) }, { requireSameOrigin: true });
    const app = makeApp();
    mountJsonRoute({ app, spec: route, deps: {}, adapter });
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
      method: 'get', path: '/boom', parse: () => ok({ value: undefined }), handle: () => {
        throw new Error('sqlite failed at /srv/secret/data.db; token=hunter2');
      }
    });
    const app = makeApp();
    const onInternalError = vi.fn();
    mountJsonRoute({ app, spec: route, deps: {}, adapter: { ...adapter, onInternalError } });
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
      method: 'get', path: '/boom-string', parse: () => ok({ value: undefined }), handle: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'boom-string-with-/srv/secret/data.db';
      }
    });
    const app = makeApp();
    const onInternalError = vi.fn();
    mountJsonRoute({ app, spec: route, deps: {}, adapter: { ...adapter, onInternalError } });
    const res = makeRes();
    await app.handlers['GET /boom-string']!({ body: {}, query: {}, params: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0]![0])).not.toContain('/srv/secret/data.db');
    expect(onInternalError).toHaveBeenCalledOnce();
    expect(onInternalError.mock.calls[0]![0]).toMatchObject({ error: 'boom-string-with-/srv/secret/data.db' });
  });

  it('falls back to a console sink when the host supplies none, still without leaking', async () => {
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get', path: '/boom-nosink', parse: () => ok({ value: undefined }), handle: () => {
        throw new Error('secret-at-/srv/secret/data.db');
      }
    });
    const app = makeApp();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mountJsonRoute({ app, spec: route, deps: {}, adapter });
      const res = makeRes();
      await app.handlers['GET /boom-nosink']!({ body: {}, query: {}, params: {} }, res);
      expect(JSON.stringify(res.json.mock.calls[0]![0])).not.toContain('/srv/secret/data.db');
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  // Before this test's fix: nothing distinguishes a `ClientFacingError` thrown a level deeper than
  // `handle` itself (inside an awaited call `handle` never wrapped in its own `try`) from a genuine
  // unanticipated exception, so it fell into the SAME SEC-005 redaction as `/boom` above — the
  // caller (and the assistant reading the response) saw only "an internal error occurred", with no
  // way to tell "your input conflicted with something" from "the database fell over". This is the
  // general-purpose version of the carve-out `attachments.ts`'s `AttachmentRejectedError` and
  // `delegated-tools.ts`'s `errorKind: 'validation'` split each hand-roll per module: a route that
  // already knows its own failure is safe to disclose should not have to reinvent that split.
  it('surfaces a thrown ClientFacingError verbatim instead of redacting it', async () => {
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'post', path: '/conflict', parse: () => ok({ value: undefined }), handle: () => {
        throw new ClientFacingError({ apiError: createApiError({ code: 'CONFLICT', message: 'site "sample-site" already exists' }) });
      }
    });
    const app = makeApp();
    const onInternalError = vi.fn();
    mountJsonRoute({ app, spec: route, deps: {}, adapter: { ...adapter, onInternalError } });
    const res = makeRes();
    await app.handlers['POST /conflict']!({ body: {}, query: {}, params: {} }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'CONFLICT', message: 'site "sample-site" already exists' },
    });
    // Classified, not internal: nothing genuinely unanticipated happened, so nothing goes to the
    // operator sink and no `requestId` correlation id is minted for it.
    expect(onInternalError).not.toHaveBeenCalled();
  });

  it('passes deps through to the handler', async () => {
    interface Deps {
      tag: string;
    }
    const route = defineJsonRoute<void, { tag: string }, Deps>({ method: 'get', path: '/deps', parse: () => ok({ value: undefined }), handle: ({ input: _input, deps }) => ok({ value: { tag: deps.tag } }) });
    const app = makeApp();
    mountJsonRoute({ app, spec: route, deps: { tag: 'injected' }, adapter });
    const res = makeRes();
    await app.handlers['GET /deps']!({ body: {}, query: {}, params: {} }, res);
    expect(res.json).toHaveBeenCalledWith({ tag: 'injected' });
  });

  it('aborts the signal handed to `handle` when the request closes before a response is sent', async () => {
    let capturedSignal: AbortSignal | undefined;
    let releaseHandle: (() => void) | undefined;
    const route = defineJsonRoute<void, unknown, unknown>({
      method: 'get', path: '/slow', parse: () => ok({ value: undefined }), handle: async ({ input: _input, deps: _deps }, { signal } = {}) => {
        capturedSignal = signal;
        await new Promise<void>((resolve) => {
          releaseHandle = resolve;
        });
        return ok({ value: {} });
      }
    });
    const app = makeApp();
    mountJsonRoute({ app, spec: route, deps: {}, adapter });
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
    const route = defineJsonRoute<void, { ok: boolean }, unknown>({ method: 'get', path: '/fast', parse: () => ok({ value: undefined }), handle: () => ok({ value: { ok: true } }) });
    const app = makeApp();
    mountJsonRoute({ app, spec: route, deps: {}, adapter });
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
      method: 'get', path: '/boom-cleanup', parse: () => ok({ value: undefined }), handle: () => {
        throw new Error('boom');
      }
    });
    const app = makeApp();
    mountJsonRoute({ app, spec: route, deps: {}, adapter });
    const req = { body: {}, query: {}, params: {} };
    const res = makeClosableRes();
    await app.handlers['GET /boom-cleanup']!(req, res);

    expect(res.closeListenerCount).toBe(0);
  });
});
