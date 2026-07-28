import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryEventLog, createRunLifecycle, type RunLifecycle } from '@injini/daemon';
import { RUN_PROTOCOL_VERSION, type RunProtocolEvent } from '@injini/protocol';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  handleRunEventStreamRequest,
  registerRunEventStream,
  registerRunRoutes,
  runCancelRoute,
  runListRoute,
  runStartRoute,
  runStatusRoute,
  type RunHttpDeps,
  type RunStartContext,
} from '../runs.js';

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
  return { get: make('get'), post: make('post'), put: make('put'), delete: make('delete'), patch: make('patch'), handlers };
}

function makeJsonRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

/** Minimal fake of the raw Express req/res surface `registerRunEventStream` uses directly (no Adapter in between). */
function makeSseReq(overrides: { runId?: string; headers?: Record<string, string>; query?: Record<string, unknown> } = {}) {
  const headers = overrides.headers ?? {};
  return {
    params: { runId: overrides.runId ?? 'run-1' },
    query: overrides.query ?? {},
    get: (name: string) => headers[name.toLowerCase()],
  };
}

/**
 * `status`/`json` stay mocked (Express-shaped) since `registerRunEventStream`'s own Express
 * wrapper still calls the real Express `sendApiError` for its own pre-`handleRunEventStreamRequest`
 * empty-runId check — but `statusCode` is a real, plain, settable property, since the core (a raw
 * `ServerResponse`-typed function, shared with the eventual Fastify mounting) sets
 * `res.statusCode = N` directly and writes JSON error bodies via `res.end(...)`, never through
 * `res.status()`/`res.json()`.
 */
function makeSseRes() {
  const closeListeners: Array<() => void> = [];
  const drainListeners: Array<() => void> = [];
  const res = {
    write: vi.fn((_chunk: string) => true),
    status: vi.fn().mockReturnThis(),
    statusCode: 0,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    end: vi.fn((_body?: string) => {
      res.writableEnded = true;
    }),
    json: vi.fn().mockReturnThis(),
    headersSent: false,
    writableEnded: false,
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'close') closeListeners.push(listener);
      if (event === 'drain') drainListeners.push(listener);
    }),
    emitClose: () => closeListeners.forEach((listener) => listener()),
    emitDrain: () => drainListeners.forEach((listener) => listener()),
  };
  return res;
}

/** Parses the JSON body `sendRawApiError` wrote via `res.end(...)` — the raw-`ServerResponse` equivalent of reading a mocked `res.json`'s call args. */
function jsonEndBody(res: ReturnType<typeof makeSseRes>): unknown {
  const [raw] = res.end.mock.calls[0]!;
  return JSON.parse(raw as string);
}

const adapter = { resolvedPortRef: { current: 7456 } };

function makeLifecycle(): RunLifecycle {
  return createRunLifecycle({ eventLog: createInMemoryEventLog() });
}

function makeDeps(overrides: Partial<RunHttpDeps> = {}): RunHttpDeps {
  return { lifecycle: makeLifecycle(), ...overrides };
}

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

describe('runStartRoute.parse (parseRunCreate)', () => {
  it('rejects a non-object body', () => {
    const result = runStartRoute.parse({ body: 'nope', query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('rejects a missing contextRef with a structured validation issue', () => {
    const result = runStartRoute.parse({ body: {}, query: {}, params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BAD_REQUEST');
      expect(result.error.details).toEqual({
        kind: 'validation',
        issues: [{ path: 'contextRef', message: 'required non-empty string' }],
      });
    }
  });

  it('rejects a whitespace-only contextRef the same as a missing one', () => {
    const result = runStartRoute.parse({ body: { contextRef: '   ' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string contextRef', () => {
    const result = runStartRoute.parse({ body: { contextRef: 42 }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('accepts a bare contextRef, omitting agentId/idempotencyKey entirely rather than as undefined', () => {
    const result = runStartRoute.parse({ body: { contextRef: 'ctx-1' }, query: {}, params: {} });
    expect(result).toEqual({ ok: true, value: { contextRef: 'ctx-1' } });
    if (result.ok) {
      expect('agentId' in result.value).toBe(false);
      expect('idempotencyKey' in result.value).toBe(false);
    }
  });

  it('accepts contextRef plus agentId and idempotencyKey when all are provided', () => {
    const result = runStartRoute.parse({
      body: { contextRef: 'ctx-1', agentId: 'agent-a', idempotencyKey: 'key-1' },
      query: {},
      params: {},
    });
    expect(result).toEqual({
      ok: true,
      value: { contextRef: 'ctx-1', agentId: 'agent-a', idempotencyKey: 'key-1' },
    });
  });

  it('rejects an empty-string agentId even though contextRef is valid', () => {
    const result = runStartRoute.parse({ body: { contextRef: 'ctx-1', agentId: '' }, query: {}, params: {} });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'optional string fields must be non-empty when provided' },
    });
  });

  it('rejects an empty-string idempotencyKey even though contextRef is valid', () => {
    const result = runStartRoute.parse({
      body: { contextRef: 'ctx-1', idempotencyKey: '  ' },
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
  });
});

describe('runStatusRoute.parse (parseRunId)', () => {
  it('accepts a non-empty runId path parameter', () => {
    expect(runStatusRoute.parse({ body: {}, query: {}, params: { runId: 'run-1' } })).toEqual({
      ok: true,
      value: 'run-1',
    });
  });

  it('rejects a missing runId path parameter', () => {
    const result = runStatusRoute.parse({ body: {}, query: {}, params: {} });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'runId must be a non-empty path parameter' },
    });
  });

  it('rejects an empty-string runId path parameter', () => {
    const result = runStatusRoute.parse({ body: {}, query: {}, params: { runId: '' } });
    expect(result.ok).toBe(false);
  });
});

describe('runListRoute.parse (parseRunList)', () => {
  it('accepts a request with no contextRef query parameter', () => {
    expect(runListRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: {} });
  });

  it('accepts a non-empty string contextRef query parameter', () => {
    expect(runListRoute.parse({ body: {}, query: { contextRef: 'ctx-1' }, params: {} })).toEqual({
      ok: true,
      value: { contextRef: 'ctx-1' },
    });
  });

  it('rejects an empty-string contextRef', () => {
    const result = runListRoute.parse({ body: {}, query: { contextRef: '' }, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string contextRef (e.g. Express repeated-query-param array)', () => {
    const result = runListRoute.parse({ body: {}, query: { contextRef: ['a', 'b'] }, params: {} });
    expect(result.ok).toBe(false);
  });
});

describe('runListRoute.handle', () => {
  it('lists every run when no contextRef is given', async () => {
    const deps = makeDeps();
    await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await deps.lifecycle.start({ contextRef: 'ctx-2' });
    const result = await runListRoute.handle({}, deps);
    expect(result.ok).toBe(true);
    expect((result as any).value.runs).toHaveLength(2);
  });

  it('scopes to the given contextRef', async () => {
    const deps = makeDeps();
    const { run: run1 } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await deps.lifecycle.start({ contextRef: 'ctx-2' });
    const result = await runListRoute.handle({ contextRef: 'ctx-1' }, deps);
    expect(result.ok).toBe(true);
    expect((result as any).value.runs.map((r: { id: string }) => r.id)).toEqual([run1.id]);
  });

  it('returns an empty list for a contextRef with no runs', async () => {
    const deps = makeDeps();
    const result = await runListRoute.handle({ contextRef: 'never-started' }, deps);
    expect(result).toEqual({ ok: true, value: { runs: [] } });
  });
});

describe('runCancelRoute.parse (parseRunCancel)', () => {
  it('rejects when runId itself is missing (delegates to parseRunId)', () => {
    const result = runCancelRoute.parse({ body: {}, query: {}, params: {} });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'runId must be a non-empty path parameter' },
    });
  });

  it('accepts a runId with no body at all (undefined)', () => {
    const result = runCancelRoute.parse({ body: undefined, query: {}, params: { runId: 'run-1' } });
    expect(result).toEqual({ ok: true, value: { runId: 'run-1' } });
  });

  it('accepts a runId with an explicit null body', () => {
    const result = runCancelRoute.parse({ body: null, query: {}, params: { runId: 'run-1' } });
    expect(result).toEqual({ ok: true, value: { runId: 'run-1' } });
  });

  it('rejects a non-object body once it is present (not undefined/null)', () => {
    const result = runCancelRoute.parse({ body: 'nope', query: {}, params: { runId: 'run-1' } });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'body must be a JSON object when provided' },
    });
  });

  it('accepts a runId with a present-but-empty body object, omitting reason entirely rather than as undefined', () => {
    const result = runCancelRoute.parse({ body: {}, query: {}, params: { runId: 'run-1' } });
    expect(result).toEqual({ ok: true, value: { runId: 'run-1' } });
    if (result.ok) expect('reason' in result.value).toBe(false);
  });

  it('rejects an empty-string reason', () => {
    const result = runCancelRoute.parse({ body: { reason: '' }, query: {}, params: { runId: 'run-1' } });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'reason must be a non-empty string when provided' },
    });
  });

  it('accepts a runId plus a non-empty reason', () => {
    const result = runCancelRoute.parse({
      body: { reason: 'user requested' },
      query: {},
      params: { runId: 'run-1' },
    });
    expect(result).toEqual({ ok: true, value: { runId: 'run-1', reason: 'user requested' } });
  });
});

describe('runStartRoute.handle', () => {
  it('starts a run and returns it with started: true when there is no onStarted driver', async () => {
    const deps = makeDeps();
    const result = await runStartRoute.handle({ contextRef: 'ctx-1' }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.started).toBe(true);
      expect(result.value.run.state).toBe('running');
    }
  });

  it('falls back to the just-started snapshot when lifecycle.get() unexpectedly returns nothing (defensive ?? fallback)', async () => {
    // Under the real, in-process `RunLifecycle`, `get()` right after `start()` always finds the
    // run — this exercises the `?? started.run` fallback for a `RunLifecycle` implementation
    // (an interface any host may implement, e.g. over an eventually-consistent store) where a
    // read-your-write immediately after `start()` can miss.
    const realLifecycle = makeLifecycle();
    const deps = makeDeps({ lifecycle: { ...realLifecycle, get: vi.fn(async () => undefined) } });
    const result = await runStartRoute.handle({ contextRef: 'ctx-1' }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.run.state).toBe('running');
      expect(result.value.started).toBe(true);
    }
  });

  it('invokes onStarted with the request, the freshly started run, and the lifecycle', async () => {
    const onStarted = vi.fn(async (_context: RunStartContext) => {});
    const deps = makeDeps({ onStarted });
    const request = { contextRef: 'ctx-1', agentId: 'agent-a' };
    await runStartRoute.handle(request, deps);
    expect(onStarted).toHaveBeenCalledTimes(1);
    const context = onStarted.mock.calls[0]![0];
    expect(context.request).toBe(request);
    expect(context.lifecycle).toBe(deps.lifecycle);
    expect(context.run.state).toBe('running');
  });

  it('does not invoke onStarted when the run was returned via idempotency-key replay (started: false)', async () => {
    const onStarted = vi.fn(async (_context: RunStartContext) => {});
    const deps = makeDeps({ onStarted });
    await deps.lifecycle.start({ contextRef: 'ctx-1', idempotencyKey: 'dedupe-1' });
    onStarted.mockClear();

    const result = await runStartRoute.handle({ contextRef: 'ctx-1', idempotencyKey: 'dedupe-1' }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.started).toBe(false);
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('returns the lifecycle current view rather than the pre-driver snapshot when onStarted finishes the run itself', async () => {
    const deps = makeDeps({
      onStarted: async (context) => {
        await context.lifecycle.finish({ runId: context.run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
      },
    });
    const result = await runStartRoute.handle({ contextRef: 'ctx-1' }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.run.state).toBe('succeeded');
    }
  });

  it('SEC-005: fails the run and returns a generic INTERNAL_ERROR (never the raw message) when onStarted throws synchronously, logging the real error server-side instead', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({
      onStarted: () => {
        throw new Error('driver spawn failed at /secret/executable/path');
      },
      onInternalError,
    });
    const result = await runStartRoute.handle({ contextRef: 'ctx-1' }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toBe('an internal error occurred');
      expect(result.error.message).not.toContain('/secret/executable/path');
      expect(JSON.stringify(result.error)).not.toContain('/secret/executable/path');
      expect(result.error.requestId).toEqual(expect.any(String));
      expect(result.error.requestId!.length).toBeGreaterThan(0);
    }
    const runs = await deps.lifecycle.list('ctx-1');
    expect(runs[0]?.state).toBe('failed');

    // The real exception is still observable server-side, just not in the public response.
    expect(onInternalError).toHaveBeenCalledTimes(1);
    const [context] = onInternalError.mock.calls[0]!;
    expect(context.source).toBe('run-start');
    expect(context.error).toBeInstanceOf(Error);
    expect((context.error as Error).message).toContain('/secret/executable/path');
    if (!result.ok) expect(context.correlationId).toBe(result.error.requestId);
  });

  it('SEC-005: fails the run and returns a generic INTERNAL_ERROR when onStarted returns a rejected promise', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({ onStarted: () => Promise.reject(new Error('async spawn failure: DB_URL=postgres://secret')), onInternalError });
    const result = await runStartRoute.handle({ contextRef: 'ctx-1' }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) });
    }
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  it('SEC-005: a non-Error throw from onStarted still produces a generic response and reaches the logger', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({
      onStarted: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'raw string failure with a secret token abc123';
      },
      onInternalError,
    });
    const result = await runStartRoute.handle({ contextRef: 'ctx-1' }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) });
    }
    expect(onInternalError.mock.calls[0]![0].error).toBe('raw string failure with a secret token abc123');
  });

  it('SEC-005: falls back to console.error when no onInternalError sink is supplied', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({
      onStarted: () => {
        throw new Error('driver spawn failed');
      },
    });
    const result = await runStartRoute.handle({ contextRef: 'ctx-1' }, deps);
    expect(result.ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });
});

describe('runStatusRoute.handle', () => {
  it('returns the run when it exists', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await runStatusRoute.handle(run.id, deps);
    expect(result).toEqual({ ok: true, value: { run } });
  });

  it('returns NOT_FOUND when the run does not exist', async () => {
    const deps = makeDeps();
    const result = await runStatusRoute.handle('never-started', deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'run "never-started" was not found' },
    });
  });
});

describe('runCancelRoute.handle', () => {
  it('returns NOT_FOUND when the run does not exist', async () => {
    const deps = makeDeps();
    const result = await runCancelRoute.handle({ runId: 'never-started' }, deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'run "never-started" was not found' },
    });
  });

  it('cancels an existing run and returns its updated status', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await runCancelRoute.handle({ runId: run.id, reason: 'user requested' }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.run.id).toBe(run.id);
    }
    // cancel() only records intent (state stays non-terminal until the driver observes it and finishes) —
    // assert the call actually reached the lifecycle by checking the cancellation was recorded.
    let observed = false;
    deps.lifecycle.onCancelRequested(run.id, () => {
      observed = true;
    });
    expect(observed).toBe(true);
  });
});

describe('registerRunEventStream', () => {
  function mount(deps: RunHttpDeps) {
    const app = makeApp();
    registerRunEventStream(app as any, deps);
    return app.handlers['GET /api/runs/:runId/events']!;
  }

  it('responds 400 without touching the lifecycle when runId is missing', async () => {
    const deps = makeDeps();
    const streamSpy = vi.spyOn(deps.lifecycle, 'stream');
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: '' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'BAD_REQUEST', message: 'runId must be a non-empty path parameter' },
    });
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('sends 404 NOT_FOUND when the lifecycle reports unknown-run, with a single clean write (no double-end/write-after-end)', async () => {
    // Regression: `channel.abandon()` (not `channel.end()`) must run here — calling `end()`
    // would end the response before `sendRawApiError`'s own `res.end(...)` writes this JSON
    // body, turning it into a write-after-end failure. `res.end` being called exactly once
    // (by `sendRawApiError` itself) is what proves that didn't happen.
    const deps = makeDeps();
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: 'never-started' }), res);
    expect(res.statusCode).toBe(404);
    expect(jsonEndBody(res)).toEqual({ error: { code: 'NOT_FOUND', message: 'run was not found' } });
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('sends 400 BAD_REQUEST when the lifecycle reports invalid-cursor', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id, headers: { 'last-event-id': 'not-a-number' } }), res);
    expect(res.statusCode).toBe(400);
    expect(jsonEndBody(res)).toEqual({
      error: { code: 'BAD_REQUEST', message: 'invalid replay cursor "not-a-number"' },
    });
  });

  it('sends 409 CONFLICT with the oldest-available cursor when the lifecycle reports replay-gap', async () => {
    const eventLog = createInMemoryEventLog({ maxEntriesPerRun: 2 });
    const deps = makeDeps({ lifecycle: createRunLifecycle({ eventLog }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    for (let i = 0; i < 5; i += 1) {
      await deps.lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: String(i) } });
    }
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id, headers: { 'last-event-id': '1' } }), res);
    expect(res.statusCode).toBe(409);
    const body = jsonEndBody(res) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details).toMatchObject({ oldestAvailableCursor: expect.any(String) });
  });

  it('prefers the Last-Event-ID header over the afterCursor query parameter', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const streamSpy = vi.spyOn(deps.lifecycle, 'stream');
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(
      makeSseReq({ runId: run.id, headers: { 'last-event-id': 'header-cursor' }, query: { afterCursor: 'query-cursor' } }),
      res,
    );
    expect(streamSpy).toHaveBeenCalledWith(run.id, expect.any(Function), { afterCursor: 'header-cursor' });
  });

  it('falls back to the afterCursor query parameter when there is no Last-Event-ID header', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const streamSpy = vi.spyOn(deps.lifecycle, 'stream');
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id, query: { afterCursor: 'query-cursor' } }), res);
    expect(streamSpy).toHaveBeenCalledWith(run.id, expect.any(Function), { afterCursor: 'query-cursor' });
  });

  it('uses null afterCursor when neither header nor query parameter is present', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const streamSpy = vi.spyOn(deps.lifecycle, 'stream');
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id }), res);
    expect(streamSpy).toHaveBeenCalledWith(run.id, expect.any(Function), { afterCursor: null });
  });

  it('ignores a non-string afterCursor query parameter (e.g. a repeated query key parsed as an array)', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const streamSpy = vi.spyOn(deps.lifecycle, 'stream');
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id, query: { afterCursor: ['a', 'b'] } }), res);
    expect(streamSpy).toHaveBeenCalledWith(run.id, expect.any(Function), { afterCursor: null });
  });

  it('writes SSE headers, flushes buffered replay history, and keeps the connection open on a fresh (non-terminal) run', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id }), res);

    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalledTimes(1);
    // The replayed 'start' event was written as a buffered SSE frame.
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: start'));
    expect(res.end).not.toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('ends the response immediately once the buffered replay contains the terminal end event', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await deps.lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id }), res);

    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: end'));
    expect(res.end).toHaveBeenCalledTimes(1);
    // 'close'/'drain' listeners are registered unconditionally, before the subscribe/replay
    // await, so a client disconnect racing that window is still observed (CR-R1) — but since
    // the subscription is already a no-op for a terminal run, firing 'close' now must not
    // attempt a second res.end() or throw.
    expect(res.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(() => res.emitClose()).not.toThrow();
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('delivers a live event as it is emitted and closes the stream on a live end event', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id }), res);
    res.write.mockClear();

    await deps.lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'working' } });
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: agent'));
    expect(res.end).not.toHaveBeenCalled();

    await deps.lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: end'));
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from the lifecycle when the client closes the connection', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id }), res);

    res.emitClose();
    res.write.mockClear();
    await deps.lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'after close' } });
    expect(res.write).not.toHaveBeenCalled();
  });

  it('SEC-005: sends a generic 500 INTERNAL_ERROR (never the raw message) when subscribing throws before headers are sent, and logs the real error', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({ onInternalError });
    deps.lifecycle.stream = vi.fn(async () => {
      throw new Error('subscribe blew up at /internal/secret/path');
    });
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: 'run-1' }), res);
    expect(res.statusCode).toBe(500);
    const body = jsonEndBody(res) as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('an internal error occurred');
    expect(JSON.stringify(body)).not.toContain('/internal/secret/path');
    expect(body.error.requestId).toEqual(expect.any(String));

    expect(onInternalError).toHaveBeenCalledTimes(1);
    const [context] = onInternalError.mock.calls[0]!;
    expect(context.source).toBe('run-stream');
    expect(context.runId).toBe('run-1');
    expect((context.error as Error).message).toContain('/internal/secret/path');
    // Regression: the catch block must abandon (not end) the channel when headers were never
    // sent, so `sendRawApiError`'s own single `res.end(...)` write is the only thing that
    // touches `res` (not a double-write via `channel.end()` first).
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('stringifies a non-Error throw from stream() when headers are not yet sent (still redacted per SEC-005)', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({ onInternalError });
    deps.lifecycle.stream = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'raw stream failure';
    });
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: 'run-1' }), res);
    const body = jsonEndBody(res) as { error: unknown };
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) });
    expect(onInternalError.mock.calls[0]![0].error).toBe('raw stream failure');
  });

  it('ends the response instead of sending a JSON error when a post-subscribe failure occurs after headers were already sent', async () => {
    // A `res.write` failure once the stream is already flowing (e.g. a socket error) must be
    // isolated inside the writer, not surfaced as a JSON error response.
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    res.flushHeaders = vi.fn(() => {
      res.headersSent = true;
    });
    res.write = vi.fn(() => {
      throw new Error('socket write failed');
    });
    await handler(makeSseReq({ runId: run.id }), res);
    expect(res.json).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('ends the response when a post-subscribe failure occurs after headers were sent but before the response was already ending', async () => {
    // Distinct from the "already fully ended" test below: there, `writableEnded` was
    // already true so `res.end()` must NOT be called a second time. Here headers were
    // sent but the response was never ended, so the `else if (!res.writableEnded)`
    // branch must actually run `res.end()` — e.g. a malformed event whose JSON.stringify
    // throws inside `pump()`, escaping the outer try after `flushHeaders()` already ran.
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    res.flushHeaders = vi.fn(() => {
      res.headersSent = true;
      throw new Error('boom after headers sent, before the response ended');
    });

    await handler(makeSseReq({ runId: run.id }), res);

    expect(res.json).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('CR-R1: unsubscribes immediately, without ever setting SSE headers, when the client disconnects while stream() is still resolving', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    const unsubscribe = vi.fn();
    deps.lifecycle.stream = vi.fn(async () => {
      // Simulates the client closing the connection during the (real) await on stream()'s
      // durable replay — 'close' fires and sets `closed = true` before this resolves.
      res.emitClose();
      return { kind: 'ok' as const, unsubscribe };
    });

    await handler(makeSseReq({ runId: run.id }), res);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });

  it('does not call res.end() a second time from the catch block when the response was already fully ended', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    res.flushHeaders = vi.fn(() => {
      res.headersSent = true;
      res.writableEnded = true; // some other path already fully ended this response
      throw new Error('boom after the response was already ended');
    });

    await handler(makeSseReq({ runId: run.id }), res);

    expect(res.json).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('CR-R1: unsubscribes on a replay-write failure instead of leaking the subscription, and does not corrupt later emit()/finish() for that run', async () => {
    // Before the fix: a write failure during the buffered-replay flush ended the response but
    // never called `unsubscribe`. The dead subscriber callback stayed registered on the run, so
    // a later `emit()`/`finish()` call invoked it again, its `res.write` threw a second time, and
    // that exception propagated synchronously out through `RunLifecycle`'s subscriber fan-out —
    // out of `emit()`/`finish()` themselves, and (for `finish()`) before `resolveTerminalWaiters`
    // ran, stranding any `waitForTerminal()` caller. This test fails a replay write, then drives
    // a live emit and a finish through the SAME run and asserts both still resolve cleanly, the
    // terminal waiter unblocks, and the dead connection never receives another write attempt.
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    res.flushHeaders = vi.fn(() => {
      res.headersSent = true;
    });
    res.write = vi.fn(() => {
      throw new Error('socket write failed');
    });

    const waitForTerminal = deps.lifecycle.waitForTerminal(run.id);

    await expect(handler(makeSseReq({ runId: run.id }), res)).resolves.toBeUndefined();
    expect(res.end).toHaveBeenCalledTimes(1);
    const writeCallsAfterStreamSetup = res.write.mock.calls.length;
    expect(writeCallsAfterStreamSetup).toBeGreaterThan(0);

    await expect(
      deps.lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'after leak-fix' } }),
    ).resolves.toBeDefined();
    // The leaked callback would otherwise still be registered and attempt another write.
    expect(res.write.mock.calls.length).toBe(writeCallsAfterStreamSetup);

    await expect(
      deps.lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false }),
    ).resolves.toMatchObject({ state: 'succeeded' });
    expect(res.write.mock.calls.length).toBe(writeCallsAfterStreamSetup);
    expect(res.end).toHaveBeenCalledTimes(1);

    await expect(waitForTerminal).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('SEC-006: queues events while res.write reports backpressure and resumes writing on drain, preserving order', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    const handlerPromise = handler(makeSseReq({ runId: run.id }), res);
    await handlerPromise;
    res.write.mockClear();

    res.write.mockReturnValueOnce(false); // simulate Node reporting a full socket buffer
    await deps.lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'first' } });
    await deps.lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'second' } });
    // The second event must be queued, not written, while backpressure is in effect.
    expect(res.write).toHaveBeenCalledTimes(1);

    res.emitDrain();
    expect(res.write).toHaveBeenCalledTimes(2);
    expect(res.write.mock.calls[0]![0]).toContain('"label":"first"');
    expect(res.write.mock.calls[1]![0]).toContain('"label":"second"');
  });

  it('SEC-006: disconnects a slow consumer once the bounded queue is exceeded instead of buffering without bound', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id }), res);
    res.write.mockClear();
    res.write.mockReturnValue(false); // never drains — a permanently stalled consumer

    for (let i = 0; i < 1002; i += 1) {
      await deps.lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: String(i) } });
    }

    expect(res.end).toHaveBeenCalledTimes(1);
    const writeCallsAtDisconnect = res.write.mock.calls.length;
    await deps.lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'after disconnect' } });
    expect(res.write.mock.calls.length).toBe(writeCallsAtDisconnect);
  });

  it('ignores an event delivered through a still-live enqueue callback after the connection already closed', async () => {
    // `cleanup()` unsubscribes from the lifecycle for real, so a *subsequent*
    // `lifecycle.emit()` never reaches `enqueue` again — the existing
    // "disconnects a slow consumer" test above only proves that path. This
    // proves the callback's own `if (closed) return;` guard: capture the raw
    // `enqueue` closure `registerRunEventStream` handed to `stream()` and
    // invoke it directly after close, simulating an event that was already
    // in flight through the subscriber fan-out when the client disconnected
    // (the exact race the doc comment above `closed` calls out).
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const streamSpy = vi.spyOn(deps.lifecycle, 'stream');
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id }), res);
    const enqueue = streamSpy.mock.calls[0]![1] as (event: RunProtocolEvent) => void;

    res.emitClose();
    res.write.mockClear();

    enqueue({
      runId: run.id,
      eventId: `${run.id}:late`,
      opaqueCursor: 'late',
      protocolVersion: RUN_PROTOCOL_VERSION,
      ts: Date.now(),
      kind: 'agent',
      payload: { type: 'status', label: 'late' },
      durability: 'durable',
    });

    expect(res.write).not.toHaveBeenCalled();
  });

  it('SEC-006: a terminal end event queued under backpressure is still written last and still ends the response', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const handler = mount(deps);
    const res = makeSseRes();
    await handler(makeSseReq({ runId: run.id }), res);
    res.write.mockClear();

    res.write.mockReturnValueOnce(false);
    await deps.lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'working' } });
    await deps.lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    // Both events are queued behind the backpressure; neither is written until 'drain'.
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.end).not.toHaveBeenCalled();

    res.emitDrain();
    expect(res.write).toHaveBeenCalledTimes(2);
    expect(res.write.mock.calls[1]![0]).toContain('event: end');
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe('handleRunEventStreamRequest — transport-independent core, called directly', () => {
  it('rejects an empty runId with a raw 400 before touching the lifecycle, independent of either transport wrapper', async () => {
    const deps = makeDeps();
    const streamSpy = vi.spyOn(deps.lifecycle, 'stream');
    const res = makeSseRes();
    await handleRunEventStreamRequest(res as any, '', null, deps);
    expect(res.statusCode).toBe(400);
    expect(jsonEndBody(res)).toEqual({
      error: { code: 'BAD_REQUEST', message: 'runId must be a non-empty path parameter' },
    });
    expect(streamSpy).not.toHaveBeenCalled();
  });
});

describe('registerRunRoutes', () => {
  it('mounts exactly the create/list/status/cancel JSON routes plus the SSE stream, nothing else', () => {
    const app = makeApp();
    registerRunRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(
      [
        'POST /api/runs',
        'GET /api/runs',
        'GET /api/runs/:runId',
        'POST /api/runs/:runId/cancel',
        'GET /api/runs/:runId/events',
      ].sort(),
    );
  });

  it('does not require same-origin for GET /api/runs: allows a cross-origin list read', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    const deps = makeDeps();
    await deps.lifecycle.start({ contextRef: 'ctx-1' });
    registerRunRoutes(app as any, deps, adapter);
    const res = makeJsonRes();
    await app.handlers['GET /api/runs']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const [body] = res.json.mock.calls[0]!;
    expect(body.runs).toHaveLength(1);
  });

  it('requires same-origin for POST /api/runs: blocks a cross-origin request with 403', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerRunRoutes(app as any, makeDeps(), adapter);
    const res = makeJsonRes();
    await app.handlers['POST /api/runs']!({ body: { contextRef: 'ctx-1' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('requires same-origin for POST /api/runs/:runId/cancel: blocks a cross-origin request with 403', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerRunRoutes(app as any, makeDeps(), adapter);
    const res = makeJsonRes();
    await app.handlers['POST /api/runs/:runId/cancel']!({ body: {}, query: {}, params: { runId: 'run-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does not require same-origin for GET /api/runs/:runId: allows a cross-origin status read', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    registerRunRoutes(app as any, deps, adapter);
    const res = makeJsonRes();
    await app.handlers['GET /api/runs/:runId']!({ body: {}, query: {}, params: { runId: run.id } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('mounted POST /api/runs creates a run end to end through the real Adapter pipeline', async () => {
    const app = makeApp();
    const deps = makeDeps();
    registerRunRoutes(app as any, deps, adapter);
    const res = makeJsonRes();
    await app.handlers['POST /api/runs']!({ body: { contextRef: 'ctx-1' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const [body] = res.json.mock.calls[0]!;
    expect(body.run.state).toBe('running');
    expect(body.started).toBe(true);
  });
});
