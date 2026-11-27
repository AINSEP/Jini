import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingOriginPolicy } from '@jini-ai/core/contracts/server/testing';
import { createInMemoryEventLog, createRunLifecycle, type RunLifecycle } from '../../index.js';
import { RUN_PROTOCOL_VERSION } from '@jini-ai/protocol';
import {
  runCancelRoute,
  runListRoute,
  runRoutes,
  runStartRoute,
  runStatusRoute,
  type RunHttpDeps,
  type RunStartContext,
} from '../runs.js';
import { describeRoutes } from '../route-table.js';
import { createRouteTestErrors, fakeDaemonRouteHost, injectedRecordingReporter, withInjectedReporter } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { readFrames } from './fakes/sse-reader.js';

const testOriginPolicy = createRecordingOriginPolicy();

function makeLifecycle(): RunLifecycle {
  return createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
}

function makeDeps(overrides: Partial<RunHttpDeps> = {}): RunHttpDeps {
  return { reportInternalError: createRouteTestErrors().reportInternalError, lifecycle: makeLifecycle(), ...overrides };
}

beforeEach(() => {
  testOriginPolicy.set({ allow: true });
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
    const result = await runListRoute.handle({ input: {}, deps });
    expect(result.ok).toBe(true);
    expect((result as any).value.runs).toHaveLength(2);
  });

  it('scopes to the given contextRef', async () => {
    const deps = makeDeps();
    const { run: run1 } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await deps.lifecycle.start({ contextRef: 'ctx-2' });
    const result = await runListRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
    expect(result.ok).toBe(true);
    expect((result as any).value.runs.map((r: { id: string }) => r.id)).toEqual([run1.id]);
  });

  it('returns an empty list for a contextRef with no runs', async () => {
    const deps = makeDeps();
    const result = await runListRoute.handle({ input: { contextRef: 'never-started' }, deps });
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
    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
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
    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.run.state).toBe('running');
      expect(result.value.started).toBe(true);
    }
  });

  it('invokes onStarted with the request, the freshly started run, and the lifecycle', async () => {
    const onStarted = vi.fn(async (_context: RunStartContext) => { });
    const deps = makeDeps({ onStarted });
    const request = { contextRef: 'ctx-1', agentId: 'agent-a' };
    await runStartRoute.handle({ input: request, deps });
    expect(onStarted).toHaveBeenCalledTimes(1);
    const context = onStarted.mock.calls[0]![0];
    expect(context.request).toBe(request);
    expect(context.lifecycle).toBe(deps.lifecycle);
    expect(context.run.state).toBe('running');
  });

  it('does not invoke onStarted when the run was returned via idempotency-key replay (started: false)', async () => {
    const onStarted = vi.fn(async (_context: RunStartContext) => { });
    const deps = makeDeps({ onStarted });
    await deps.lifecycle.start({ contextRef: 'ctx-1' }, { idempotencyKey: 'dedupe-1' });
    onStarted.mockClear();

    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1', idempotencyKey: 'dedupe-1' }, deps });
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
    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
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
      reportInternalError: injectedRecordingReporter({ record: onInternalError }),
    });
    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toBe('The agent could not be started. Check the run status before starting another task. Copy the request ID and report this problem.');
      expect(result.error.message).not.toContain('/secret/executable/path');
      expect(JSON.stringify(result.error)).not.toContain('/secret/executable/path');
      expect(result.error.requestId).toEqual(expect.any(String));
      expect(result.error.requestId!.length).toBeGreaterThan(0);
    }
    const runs = await deps.lifecycle.list({}, { contextRef: 'ctx-1' });
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
    const deps = makeDeps({ onStarted: () => Promise.reject(new Error('async spawn failure: DB_URL=postgres://secret')), reportInternalError: injectedRecordingReporter({ record: onInternalError }) });
    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'The agent could not be started. Check the run status before starting another task. Copy the request ID and report this problem.', requestId: expect.any(String) });
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
      reportInternalError: injectedRecordingReporter({ record: onInternalError }),
    });
    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'The agent could not be started. Check the run status before starting another task. Copy the request ID and report this problem.', requestId: expect.any(String) });
    }
    expect(onInternalError.mock.calls[0]![0].error).toBe('raw string failure with a secret token abc123');
  });

  it('SEC-005: records one fixture incident with the correlated ERR id', async () => {
    const fixture = createRouteTestErrors();
    const deps = makeDeps({
      reportInternalError: fixture.reportInternalError,
      onStarted: () => {
        throw new Error('driver spawn failed');
      },
    });
    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
    expect(result.ok).toBe(false);
    expect(fixture.entries).toHaveLength(1);
    expect(fixture.reports).toHaveLength(1);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.requestId).toBe('ERR-AAAA-BBBB-CCCC-0001');
    expect(fixture.entries[0]?.meta?.errorId).toBe(result.error.requestId);
    expect(fixture.reports[0]?.context.incidentId).toBe(result.error.requestId);
  });
});

describe('runStatusRoute.handle', () => {
  it('returns the run when it exists', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await runStatusRoute.handle({ input: run.id, deps });
    expect(result).toEqual({ ok: true, value: { run } });
  });

  it('returns NOT_FOUND when the run does not exist', async () => {
    const deps = makeDeps();
    const result = await runStatusRoute.handle({ input: 'never-started', deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'run "never-started" was not found' },
    });
  });
});

describe('runCancelRoute.handle', () => {
  it('returns NOT_FOUND when the run does not exist', async () => {
    const deps = makeDeps();
    const result = await runCancelRoute.handle({ input: { runId: 'never-started' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'run "never-started" was not found' },
    });
  });

  it('cancels an existing run and returns its updated status', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await runCancelRoute.handle({ input: { runId: run.id, reason: 'user requested' }, deps });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.run.id).toBe(run.id);
    }
    // cancel() only records intent (state stays non-terminal until the driver observes it and finishes) —
    // assert the call actually reached the lifecycle by checking the cancellation was recorded.
    let observed = false;
    deps.lifecycle.onCancelRequested({ runId: run.id, listener: () => {
      observed = true;
    } });
    expect(observed).toBe(true);
  });
});


/** The run routes on an in-memory server, behind the recording origin policy. */
function serve(deps: RunHttpDeps) {
  const host = withInjectedReporter({ host: fakeDaemonRouteHost({}, { originPolicy: testOriginPolicy }), deps });
  return { host, fetch: serveRoutes({ routes: runRoutes({ deps, host }) }) };
}

/** Opens the event stream of `runId`; `signal` is the client's way of leaving. */
function openEvents(
  { fetch, runId }: { readonly fetch: (request: Request) => Promise<Response>; readonly runId: string },
  { headers = {}, query = '', signal }: { readonly headers?: Record<string, string>; readonly query?: string; readonly signal?: AbortSignal } = {},
): Promise<Response> {
  return fetch(new Request(`http://local/api/runs/${runId}/events${query}`, { headers, ...(signal ? { signal } : {}) }));
}

const statusEvent = (deps: RunHttpDeps, runId: string, label: string) =>
  deps.lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'status', label } } });
const finishRun = (deps: RunHttpDeps, runId: string) =>
  deps.lifecycle.finish({ runId, status: 'succeeded', code: 0, signal: null, resumable: false });

const STREAM_FAILURE_SENTENCE = 'The connection to run updates could not be opened. Check the run status before starting another task. Copy the request ID and report this problem.';

describe('GET /api/runs/:runId/events — answers before the stream opens', () => {
  it('sends 404 NOT_FOUND as one JSON answer when the lifecycle reports unknown-run', async () => {
    const { fetch } = serve(makeDeps());
    const response = await openEvents({ fetch, runId: 'never-started' });
    expect([response.status, response.headers.get('content-type'), await response.json()]).toEqual([404, 'application/json; charset=utf-8', { error: { code: 'NOT_FOUND', message: 'run was not found' } }]);
  });

  it('sends 400 BAD_REQUEST when the lifecycle reports invalid-cursor', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const response = await openEvents({ fetch: serve(deps).fetch, runId: run.id }, { headers: { 'last-event-id': 'not-a-number' } });
    expect([response.status, await response.json()]).toEqual([400, { error: { code: 'BAD_REQUEST', message: 'invalid replay cursor "not-a-number"' } }]);
  });

  it('sends 409 CONFLICT with the oldest-available cursor when the lifecycle reports replay-gap', async () => {
    const deps = makeDeps({ lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}, { maxEntriesPerRun: 2 }) }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    for (let i = 0; i < 5; i += 1) await statusEvent(deps, run.id, String(i));
    const response = await openEvents({ fetch: serve(deps).fetch, runId: run.id }, { headers: { 'last-event-id': '1' } });
    const body = await response.json() as { error: { code: string; details: unknown } };
    expect([response.status, body.error.code]).toEqual([409, 'CONFLICT']);
    expect(body.error.details).toMatchObject({ oldestAvailableCursor: expect.any(String) });
  });

  it.each([
    ['prefers the Last-Event-ID header over the afterCursor query parameter', { 'last-event-id': 'header-cursor' }, '?afterCursor=query-cursor', 'header-cursor'],
    ['falls back to the afterCursor query parameter when there is no Last-Event-ID header', {}, '?afterCursor=query-cursor', 'query-cursor'],
    ['uses null when neither header nor query parameter is present', {}, '', null],
    ['reads no cursor from a repeated afterCursor (Express gave an array, which was ignored)', {}, '?afterCursor=a&afterCursor=b', null],
    ['reads no cursor from an empty afterCursor', {}, '?afterCursor=', null],
  ])('%s', async (_label, headers, query, expected) => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const streamSpy = vi.spyOn(deps.lifecycle, 'stream');
    const response = await openEvents({ fetch: serve(deps).fetch, runId: run.id }, { headers, query });
    await readFrames({ response }).cancel();
    expect(streamSpy).toHaveBeenCalledWith({ runId: run.id, onEvent: expect.any(Function) }, { afterCursor: expected });
  });

  it('SEC-005: sends a generic 500 INTERNAL_ERROR (never the raw message) when subscribing rejects before anything is committed, and gives the host the real error', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({ reportInternalError: injectedRecordingReporter({ record: onInternalError }) });
    deps.lifecycle.stream = vi.fn(async () => { throw new Error('subscribe blew up at /internal/secret/path'); });
    const { fetch, host } = serve(deps);
    const response = await openEvents({ fetch, runId: 'run-1' });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text).error).toEqual({ code: 'INTERNAL_ERROR', message: STREAM_FAILURE_SENTENCE, requestId: 'req-1' });
    expect(text).not.toContain('/internal/secret/path');
    expect(host.reports).toHaveLength(1);
    expect(onInternalError).toHaveBeenCalledTimes(1);
    const [context] = onInternalError.mock.calls[0]!;
    expect([context.source, context.runId, (context.error as Error).message, context.correlationId]).toEqual(['run-stream', 'run-1', 'subscribe blew up at /internal/secret/path', 'req-1']);
  });

  it('answers the same generic 500 when the source throws before it returns anything, and when it throws a non-Error', async () => {
    for (const failure of [() => { throw new Error('thrown at once'); }, () => { throw 'raw stream failure'; }]) {
      const onInternalError = vi.fn();
      const deps = makeDeps({ reportInternalError: injectedRecordingReporter({ record: onInternalError }) });
      deps.lifecycle.stream = vi.fn(failure) as never;
      const response = await openEvents({ fetch: serve(deps).fetch, runId: 'run-1' });
      expect([response.status, (await response.json() as { error: { message: string } }).error.message]).toEqual([500, STREAM_FAILURE_SENTENCE]);
      expect(onInternalError).toHaveBeenCalledOnce();
    }
  });
});

describe('GET /api/runs/:runId/events — the stream', () => {
  it('opens with the event-stream headers and sends the replayed start event as a frame, then stays open', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const response = await openEvents({ fetch: serve(deps).fetch, runId: run.id });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('connection')).toBe('keep-alive');
    const frames = readFrames({ response });
    expect((await frames.next())[0]).toContain('event: start');
    expect(await frames.stillSilent()).toBe(true);
    await frames.cancel();
  });

  it('has no heartbeat: no timer is scheduled and nothing is sent while the run is idle', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const { fetch, host } = serve(deps);
    const response = await openEvents({ fetch, runId: run.id });
    const frames = readFrames({ response });
    await frames.next();
    expect(host.scheduler.pending).toBe(0);
    host.scheduler.advance(60_000);
    expect(await frames.stillSilent()).toBe(true);
    await frames.cancel();
  });

  it('ends the stream once the buffered replay contains the terminal end event', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await finishRun(deps, run.id);
    const frames = await readFrames({ response: await openEvents({ fetch: serve(deps).fetch, runId: run.id }) }).rest();
    expect(frames.at(-1)).toContain('event: end');
  });

  it('delivers a live event as it is emitted and closes the stream on a live end event', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const frames = readFrames({ response: await openEvents({ fetch: serve(deps).fetch, runId: run.id }) });
    await frames.next();
    await statusEvent(deps, run.id, 'working');
    expect((await frames.next())[0]).toContain('event: agent');
    await finishRun(deps, run.id);
    expect((await frames.rest()).map((frame) => frame.split('\n')[1])).toEqual(['event: end']);
  });

  it('a terminal end event queued behind unread frames is still delivered last, and ends the stream', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const response = await openEvents({ fetch: serve(deps).fetch, runId: run.id });
    await statusEvent(deps, run.id, 'working');
    await finishRun(deps, run.id);
    const kinds = (await readFrames({ response }).rest()).map((frame) => frame.split('\n')[1]);
    expect(kinds).toEqual(['event: start', 'event: agent', 'event: end']);
  });

  it('answers a cross-origin caller too: this stream has never had a same-origin gate', async () => {
    testOriginPolicy.set({ allow: false });
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const response = await openEvents({ fetch: serve(deps).fetch, runId: run.id });
    expect(response.status).toBe(200);
    await readFrames({ response }).cancel();
  });
});

describe('GET /api/runs/:runId/events — replay and the frame cap (SEC-006)', () => {
  it('replay_over_1000_events_delivers_sse_and_advancing_cursors', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx' });
    for (let index = 0; index < 1166; index++) {
      await deps.lifecycle.emit({ runId: run.id, input: { event: 'agent', data: { type: 'text_delta', delta: String(index) } } });
    }
    const frames = readFrames({ response: await openEvents({ fetch: serve(deps).fetch, runId: run.id }) });
    const received = await frames.next(1167);
    const cursors = received.map((frame) => /^id: (.+)/m.exec(frame)![1]);
    expect(new Set(cursors).size).toBe(1167);
    expect(cursors.at(-1)).not.toBe(cursors[0]);
    expect(await frames.stillSilent()).toBe(true);
    await frames.cancel();
  });

  it('disconnects a client that stopped reading once 1000 live frames are queued, and unsubscribes', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const unsubscribe = vi.fn();
    const realStream = deps.lifecycle.stream.bind(deps.lifecycle);
    deps.lifecycle.stream = (async (...args: Parameters<typeof realStream>) => {
      const subscribed = await realStream(...args);
      return subscribed.kind === 'ok' ? { ...subscribed, unsubscribe: () => { unsubscribe(); subscribed.unsubscribe(); } } : subscribed;
    }) as never;
    const response = await openEvents({ fetch: serve(deps).fetch, runId: run.id });
    for (let i = 0; i < 1003; i += 1) await statusEvent(deps, run.id, String(i));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await readFrames({ response }).rest();
  });
});

describe('GET /api/runs/:runId/events — the client leaves, the source fails', () => {
  /** A lifecycle whose `stream` hands out an unsubscribe the test can see. */
  function watchedDeps(overrides: Partial<RunHttpDeps> = {}) {
    const deps = makeDeps(overrides);
    const unsubscribe = vi.fn();
    const realStream = deps.lifecycle.stream.bind(deps.lifecycle);
    deps.lifecycle.stream = (async (...args: Parameters<typeof realStream>) => {
      const subscribed = await realStream(...args);
      return subscribed.kind === 'ok' ? { ...subscribed, unsubscribe: () => { unsubscribe(); subscribed.unsubscribe(); } } : subscribed;
    }) as never;
    return { deps, unsubscribe };
  }

  it('unsubscribes from the lifecycle, once, when the client aborts', async () => {
    const { deps, unsubscribe } = watchedDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const controller = new AbortController();
    const frames = readFrames({ response: await openEvents({ fetch: serve(deps).fetch, runId: run.id }, { signal: controller.signal }) });
    await frames.next();
    controller.abort();
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    await statusEvent(deps, run.id, 'after leave');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes when the client cancels the body, and a later emit and finish still resolve cleanly (CR-R1)', async () => {
    const { deps, unsubscribe } = watchedDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const waitForTerminal = deps.lifecycle.waitForTerminal({ runId: run.id });
    const frames = readFrames({ response: await openEvents({ fetch: serve(deps).fetch, runId: run.id }) });
    await frames.next();
    await frames.cancel();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    // A leaked subscriber would still be called on later emits. A callback failure during finish could strand the terminal waiter.
    await expect(statusEvent(deps, run.id, 'after cancel')).resolves.toBeDefined();
    await expect(finishRun(deps, run.id)).resolves.toMatchObject({ state: 'succeeded' });
    await expect(waitForTerminal).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('CR-R1: unsubscribes immediately when the client left while stream() was still resolving', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const controller = new AbortController();
    const unsubscribe = vi.fn();
    deps.lifecycle.stream = vi.fn(async () => {
      controller.abort();
      return { kind: 'ok' as const, unsubscribe };
    });
    const response = await openEvents({ fetch: serve(deps).fetch, runId: run.id }, { signal: controller.signal });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(await readFrames({ response }).rest()).toEqual([]);
  });

  it('ignores an event delivered through a still-live onEvent callback after the connection closed', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const streamSpy = vi.spyOn(deps.lifecycle, 'stream');
    const controller = new AbortController();
    const frames = readFrames({ response: await openEvents({ fetch: serve(deps).fetch, runId: run.id }, { signal: controller.signal }) });
    await frames.next();
    // Unsubscribe keeps a later lifecycle.emit() from reaching this callback. Calling it directly models an event already in flight when the client disconnected.
    const onEvent = streamSpy.mock.calls[0]![0].onEvent;
    controller.abort();
    expect(() => onEvent({
      runId: run.id, eventId: `${run.id}:late`, opaqueCursor: 'late', protocolVersion: RUN_PROTOCOL_VERSION, ts: Date.now(),
      kind: 'agent', payload: { type: 'status', label: 'late' }, durability: 'durable',
    })).not.toThrow();
    expect(await frames.rest()).toEqual([]);
  });

  it('a failure after the stream was committed ends the stream (no second answer) and still reaches the host', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({ reportInternalError: injectedRecordingReporter({ record: onInternalError }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const realStream = deps.lifecycle.stream.bind(deps.lifecycle);
    deps.lifecycle.stream = (async (...args: Parameters<typeof realStream>) => {
      await realStream(...args);
      throw new Error('boom after the first frame');
    }) as never;
    const { fetch, host } = serve(deps);
    const response = await openEvents({ fetch, runId: run.id });
    expect(response.status).toBe(200);
    expect((await readFrames({ response }).rest())[0]).toContain('event: start');
    expect(host.reports).toHaveLength(1);
    expect((onInternalError.mock.calls[0]![0].error as Error).message).toBe('boom after the first frame');
  });
});

describe('runRoutes', () => {
  it('lists exactly the create/list/status/cancel/message JSON routes plus the SSE stream, nothing else, with the same-origin gate named where the spec asks for it', () => {
    expect(describeRoutes({ routes: runRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) })).toEqual([
      { method: 'POST', path: '/api/runs', gates: ['same-origin'] },
      { method: 'GET', path: '/api/runs', gates: [] },
      { method: 'GET', path: '/api/runs/:runId', gates: [] },
      { method: 'POST', path: '/api/runs/:runId/cancel', gates: ['same-origin'] },
      { method: 'POST', path: '/api/runs/:runId/messages', gates: ['same-origin'] },
      { method: 'GET', path: '/api/runs/:runId/events', gates: [] },
    ]);
  });

  it('does not require same-origin for GET /api/runs: allows a cross-origin list read', async () => {
    testOriginPolicy.set({ allow: false });
    const deps = makeDeps();
    await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const response = await serve(deps).fetch(jsonRequest({ path: '/api/runs' }));
    expect([response.status, ((await response.json()) as { runs: unknown[] }).runs]).toEqual([200, [expect.anything()]]);
  });

  it.each([
    ['POST /api/runs', 'POST', '/api/runs', { contextRef: 'ctx-1' }],
    ['POST /api/runs/:runId/cancel', 'POST', '/api/runs/run-1/cancel', {}],
    ['POST /api/runs/:runId/messages', 'POST', '/api/runs/run-1/messages', { text: 'x' }],
  ])('requires same-origin for %s: blocks a cross-origin request with 403', async (_label, method, path, body) => {
    testOriginPolicy.set({ allow: false });
    const response = await serve(makeDeps()).fetch(jsonRequest({ path, method }, { body }));
    expect([response.status, ((await response.json()) as { error: { code: string } }).error.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('does not require same-origin for GET /api/runs/:runId: allows a cross-origin status read', async () => {
    testOriginPolicy.set({ allow: false });
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    expect((await serve(deps).fetch(jsonRequest({ path: `/api/runs/${run.id}` }))).status).toBe(200);
  });

  it('POST /api/runs creates a run end to end through the real route pipeline', async () => {
    const response = await serve(makeDeps()).fetch(jsonRequest({ path: '/api/runs', method: 'POST' }, { body: { contextRef: 'ctx-1' } }));
    const body = await response.json() as { run: { state: string }; started: boolean };
    expect([response.status, body.run.state, body.started]).toEqual([201, 'running', true]);
  });

  it('an internal failure in the start hook goes through the host reporter, with the fixed sentence and the request ID', async () => {
    const deps = makeDeps({ onStarted: () => { throw new Error('boom api_key=SECRETSECRETSECRETSECRET'); } });
    const { fetch, host } = serve(deps);
    const response = await fetch(jsonRequest({ path: '/api/runs', method: 'POST' }, { body: { contextRef: 'ctx-1' } }));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text).error).toMatchObject({ code: 'INTERNAL_ERROR', requestId: 'req-1' });
    expect(text).not.toContain('SECRETSECRET');
    expect(host.reports).toHaveLength(1);
  });
});

describe('run routes: one incident owner (log safety)', () => {
  it('the host sink gets the original error, the run ID and the request ID the caller sees', async () => {
    const failure = new Error('boom api_key=SECRETSECRETSECRETSECRET');
    const onInternalError = vi.fn();
    const deps = makeDeps({ onStarted: () => { throw failure; }, reportInternalError: injectedRecordingReporter({ record: onInternalError }) });
    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
    if (result.ok) throw new Error('expected failure');
    const context = onInternalError.mock.calls[0]?.[0];
    expect(context).toEqual({ source: 'run-start', runId: expect.any(String), error: failure, correlationId: result.error.requestId, logSource: 'run-start' });
    expect(context.error).toBe(failure);
    expect(JSON.stringify(result.error)).not.toContain('SECRETSECRET');
  });

  it('the fixture reporter records one ERR id and keeps diagnostics out of the response', async () => {
    const fixture = createRouteTestErrors();
    const deps = makeDeps({ reportInternalError: fixture.reportInternalError, onStarted: () => { throw new Error('boom api_key=SECRETSECRETSECRETSECRET'); } });
    const result = await runStartRoute.handle({ input: { contextRef: 'ctx-1' }, deps });
    if (result.ok) throw new Error('expected failure');
    expect(fixture.entries).toHaveLength(1);
    expect(fixture.reports).toHaveLength(1);
    expect(result.error.requestId).toBe('ERR-AAAA-BBBB-CCCC-0001');
    expect(fixture.entries[0]?.meta?.errorId).toBe(result.error.requestId);
    expect(fixture.reports[0]?.context.incidentId).toBe(result.error.requestId);
    expect(fixture.entries[0]?.meta?.label).toBe('Error');
    const printed = JSON.stringify(result);
    for (const leaked of ['boom', 'SECRETSECRET', 'runs.test']) expect(printed).not.toContain(leaked);
  });
});

it('retains the injected reporter and envelope when run startup fails', async () => {
  const host = fakeDaemonRouteHost();
  const failure = new Error('private startup');
  const deps = makeDeps({ reportInternalError: host.reportInternalError, onStarted: () => { throw failure; } });
  const result = await runStartRoute.handle({ input: { contextRef: 'ctx-reporter' }, deps });
  expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', requestId: 'req-1' } });
  const runs = await deps.lifecycle.list({}, { contextRef: 'ctx-reporter' });
  expect(host.reports[0]).toMatchObject({ report: { source: 'run-start', runId: runs[0]?.id, error: failure } });
  expect(JSON.stringify(result)).not.toContain(failure.message);
});

it('returns the created run if its host lookup has no newer view', async () => {
  const lifecycle = makeLifecycle();
  const deps = makeDeps({ lifecycle });
  const get = vi.spyOn(lifecycle, 'get').mockResolvedValueOnce(undefined);
  const result = await runStartRoute.handle({ input: { contextRef: 'brief-1' }, deps });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const { run, started } = result.value;
  expect(started).toBe(true);
  expect(get.mock.calls).toEqual([[{ runId: run.id }]]);
  expect(await lifecycle.list({}, { contextRef: 'brief-1' })).toEqual([run]);
  expect(await lifecycle.get({ runId: run.id })).toEqual(run);
});
