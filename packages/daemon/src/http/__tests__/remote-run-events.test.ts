import { describe, expect, it, vi } from 'vitest';
import type { ServerMiddleware } from '@jini-ai/core/contracts/server';
import { createInMemoryEventLog, createRemoteToolEventRecorder, createRunLifecycle, type RunLifecycle } from '../../index.js';
import {
  remoteRunEventRoutes,
  remoteToolBridgeTokenGate,
  remoteToolResultRoute,
  remoteToolUseRoute,
  type RemoteRunEventHttpDeps,
} from '../remote-run-events.js';
import type { DaemonRouteHost } from '../route-host.js';
import { describeRoutes } from '../route-table.js';
import { createRouteTestErrors, fakeDaemonRouteHost, injectedRecordingReporter, withInjectedReporter } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';

/** What a gate did with one request: its answer, and how often it let the request through. */
async function callGate({ gate, authorization }: { readonly gate: ServerMiddleware; readonly authorization?: string }): Promise<{ readonly status: number; readonly body: { error?: { code: string; message: string } } | null; readonly nextCalls: number }> {
  const next = vi.fn(async () => new Response(null, { status: 204 }));
  const request = new Request('http://local/api/runs/r1/tool-use', { method: 'POST', ...(authorization === undefined ? {} : { headers: { authorization } }) });
  const response = await gate({ request, params: { runId: 'r1' }, locals: {}, route: { method: 'POST', path: '/api/runs/:runId/tool-use' }, next });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text), nextCalls: next.mock.calls.length };
}

const TOKEN_ENV_VAR = 'JINI_REMOTE_TOOL_BRIDGE_TOKEN_TEST';

function makeLifecycle(): RunLifecycle {
  return createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
}

function makeDeps(overrides: Partial<RemoteRunEventHttpDeps> = {}): RemoteRunEventHttpDeps {
  const lifecycle = overrides.lifecycle ?? makeLifecycle();
  return {
    reportInternalError: createRouteTestErrors().reportInternalError,
    lifecycle,
    recorder: createRemoteToolEventRecorder({ lifecycle }),
    tokenConfig: { tokenEnvVar: TOKEN_ENV_VAR },
    env: { [TOKEN_ENV_VAR]: 'shared-secret' },
    ...overrides,
  };
}

describe('remoteToolUseRoute.parse', () => {
  it('rejects a missing runId', () => {
    const result = remoteToolUseRoute.parse({ body: { toolUseId: 'tu-1', toolId: 't1' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    const result = remoteToolUseRoute.parse({ body: 'nope', query: {}, params: { runId: 'r1' } });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('rejects a missing toolUseId', () => {
    const result = remoteToolUseRoute.parse({ body: { toolId: 't1' }, query: {}, params: { runId: 'r1' } });
    expect(result.ok).toBe(false);
  });

  it('accepts a well-formed body', () => {
    const result = remoteToolUseRoute.parse({ body: { toolUseId: 'tu-1', toolId: 'echo', input: { a: 1 } }, query: {}, params: { runId: 'r1' } });
    expect(result).toEqual({ ok: true, value: { runId: 'r1', toolUseId: 'tu-1', toolId: 'echo', input: { a: 1 } } });
  });
});

describe('remoteToolResultRoute.parse', () => {
  it('rejects a missing content', () => {
    const result = remoteToolResultRoute.parse({ body: { toolUseId: 'tu-1' }, query: {}, params: { runId: 'r1' } });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-boolean isError', () => {
    const result = remoteToolResultRoute.parse({ body: { toolUseId: 'tu-1', content: 'ok', isError: 'yes' }, query: {}, params: { runId: 'r1' } });
    expect(result.ok).toBe(false);
  });

  it('accepts a well-formed body without isError', () => {
    const result = remoteToolResultRoute.parse({ body: { toolUseId: 'tu-1', content: 'ok' }, query: {}, params: { runId: 'r1' } });
    expect(result).toEqual({ ok: true, value: { runId: 'r1', toolUseId: 'tu-1', content: 'ok' } });
  });

  // Local/remote parity regression (2026-07-29). `serializeDelegatedToolOutput` in
  // `@jini-ai/daemon`'s `delegated-tool-bridge.ts` maps a handler returning `undefined` to `''`,
  // and the local bridge emits that verbatim as a `tool_result`. This route previously rejected
  // `''` with a 400, so a tool that legitimately produces no output could be reported in-process
  // but not remotely. Empty content is a real value here; only a non-string is missing.
  it('accepts an EMPTY content string — a tool that produced no output, matching the local bridge', () => {
    const result = remoteToolResultRoute.parse({ body: { toolUseId: 'tu-1', content: '' }, query: {}, params: { runId: 'r1' } });
    expect(result).toEqual({ ok: true, value: { runId: 'r1', toolUseId: 'tu-1', content: '' } });
  });

  it('accepts a whitespace-only content string (also a real value, not a missing one)', () => {
    const result = remoteToolResultRoute.parse({ body: { toolUseId: 'tu-1', content: '   ' }, query: {}, params: { runId: 'r1' } });
    expect(result).toEqual({ ok: true, value: { runId: 'r1', toolUseId: 'tu-1', content: '   ' } });
  });

  it('still rejects a non-string content', () => {
    const result = remoteToolResultRoute.parse({ body: { toolUseId: 'tu-1', content: 42 }, query: {}, params: { runId: 'r1' } });
    expect(result.ok).toBe(false);
  });

  it('still rejects an EMPTY toolUseId — for identifiers, empty really is missing', () => {
    const result = remoteToolResultRoute.parse({ body: { toolUseId: '', content: 'ok' }, query: {}, params: { runId: 'r1' } });
    expect(result.ok).toBe(false);
  });
});

describe('remoteToolUseRoute.handle / remoteToolResultRoute.handle', () => {
  it('returns NOT_FOUND for an unknown run', async () => {
    const deps = makeDeps();
    const result = await remoteToolUseRoute.handle({ input: { runId: 'never-started', toolUseId: 'tu-1', toolId: 'echo' }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'run "never-started" was not found' } });
  });

  it('records a tool_use event visible to the run\'s own stream()', async () => {
    const lifecycle = makeLifecycle();
    const deps = makeDeps({ lifecycle, recorder: createRemoteToolEventRecorder({ lifecycle }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });

    const result = await remoteToolUseRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo', input: { x: 1 } }, deps });
    expect(result).toEqual({ ok: true, value: { recorded: true } });

    const events: unknown[] = [];
    await deps.lifecycle.stream({ runId: run.id, onEvent: (event) => events.push(event) });
    const agentEvents = (events as { kind: string; payload: { type: string } }[]).filter((e) => e.kind === 'agent');
    expect(agentEvents.map((e) => e.payload.type)).toEqual(['tool_use']);
  });

  it('records a tool_result event', async () => {
    const lifecycle = makeLifecycle();
    const deps = makeDeps({ lifecycle, recorder: createRemoteToolEventRecorder({ lifecycle }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await remoteToolResultRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', content: 'done' }, deps });
    expect(result).toEqual({ ok: true, value: { recorded: true } });
  });

  it('returns CONFLICT (not a 500) when the run is already terminal', async () => {
    const lifecycle = makeLifecycle();
    const deps = makeDeps({ lifecycle, recorder: createRemoteToolEventRecorder({ lifecycle }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await deps.lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const result = await remoteToolResultRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', content: 'too late' }, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toMatch(/terminal/);
    }
  });
});

const gateFor = (env: Record<string, string | undefined>, tokenConfig: RemoteRunEventHttpDeps['tokenConfig'] = { tokenEnvVar: TOKEN_ENV_VAR }): ServerMiddleware =>
  remoteToolBridgeTokenGate({ env, timingSafeEqual: fakeDaemonRouteHost().timingSafeEqual }, { tokenConfig });

describe('remoteToolBridgeTokenGate', () => {
  it('fails closed with 503 when the token env var is not configured', async () => {
    const answer = await callGate({ gate: gateFor({}), authorization: 'Bearer wrong-secret' });
    expect(answer).toEqual({
      status: 503,
      body: { error: { code: 'REMOTE_TOOL_BRIDGE_NOT_CONFIGURED', message: `${TOKEN_ENV_VAR} is not set — remote run-event ingestion is disabled` } },
      nextCalls: 0,
    });
  });

  it('rejects a missing/incorrect bearer token with 401', async () => {
    const answer = await callGate({ gate: gateFor({ [TOKEN_ENV_VAR]: 'right-secret' }), authorization: 'Bearer wrong-secret' });
    expect(answer).toEqual({
      status: 401,
      body: { error: { code: 'REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED', message: `Authorization: Bearer <${TOKEN_ENV_VAR}> required` } },
      nextCalls: 0,
    });
  });

  it('passes the request on for a correct bearer token', async () => {
    const answer = await callGate({ gate: gateFor({ [TOKEN_ENV_VAR]: 'right-secret' }), authorization: 'Bearer right-secret' });
    expect([answer.status, answer.nextCalls]).toEqual([204, 1]);
  });
});

describe('remoteToolBridgeTokenGate — deny table (F1: every non-matching header must 401, never next())', () => {
  const EXPECTED_401 = { error: { code: 'REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED', message: `Authorization: Bearer <${TOKEN_ENV_VAR}> required` } };
  it.each([
    ['no Authorization header', undefined],
    ['empty header', ''],
    ['scheme only', 'Bearer'],
    ['scheme with blank token', 'Bearer    '],
    ['wrong scheme', 'Basic right-secret'],
    ['raw token without scheme', 'right-secret'],
    ['wrong token, same length', 'Bearer wrong-secret!'],
    ['proper prefix of the token', 'Bearer right-secre'],
    ['token plus trailing junk', 'Bearer right-secretX'],
    ['token plus a second word', 'Bearer right-secret extra'],
    ['leading junk before the scheme', 'x Bearer right-secret'],
    ['wrong-case token', 'Bearer RIGHT-SECRET'],
  ])('%s → 401 REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED, next() never called', async (_label, authorization) => {
    const answer = await callGate({ gate: gateFor({ [TOKEN_ENV_VAR]: 'right-secret' }), ...(authorization === undefined ? {} : { authorization }) });
    expect(answer).toEqual({ status: 401, body: EXPECTED_401, nextCalls: 0 });
  });

  it('accepts the bearer scheme case-insensitively and tolerates trailing whitespace (the shared core header grammar)', async () => {
    for (const authorization of ['bearer right-secret', 'Bearer right-secret  ']) {
      const answer = await callGate({ gate: gateFor({ [TOKEN_ENV_VAR]: 'right-secret' }), authorization });
      expect([answer.status, answer.nextCalls]).toEqual([204, 1]);
    }
  });

  it('an empty-string token env var is "not configured" (503), never a match for an empty bearer', async () => {
    const answer = await callGate({ gate: gateFor({ [TOKEN_ENV_VAR]: '' }), authorization: 'Bearer ' });
    expect([answer.status, answer.nextCalls, answer.body?.error?.code]).toEqual([503, 0, 'REMOTE_TOOL_BRIDGE_NOT_CONFIGURED']);
  });

  it('a token configured under a DIFFERENT env var name does not open the gate', async () => {
    const answer = await callGate({ gate: gateFor({ JINI_REMOTE_TOOL_BRIDGE_TOKEN: 'right-secret' }), authorization: 'Bearer right-secret' });
    expect([answer.status, answer.nextCalls]).toEqual([503, 0]);
  });

  it('has no loopback exemption: a loopback peer with the wrong token is still refused', async () => {
    const gate = gateFor({ [TOKEN_ENV_VAR]: 'right-secret' });
    const next = vi.fn(async () => new Response(null, { status: 204 }));
    const request = new Request('http://local/x', { method: 'POST', headers: { authorization: 'Bearer wrong-secret!' } });
    const response = await gate({ request, params: {}, client: { address: '127.0.0.1' }, locals: {}, route: { method: 'POST', path: '/x' }, next });
    expect([response.status, next.mock.calls.length]).toEqual([401, 0]);
  });

  const exactGate = (timingSafeEqual: DaemonRouteHost['timingSafeEqual']): ServerMiddleware => remoteToolBridgeTokenGate({ env: { [TOKEN_ENV_VAR]: 'right-secret' }, timingSafeEqual }, { tokenConfig: { tokenEnvVar: TOKEN_ENV_VAR } });

  it('the verdict is the host port\'s: a port that says no refuses even the exact token', async () => {
    const refusing = Object.assign(() => false, { calls: fakeDaemonRouteHost().timingSafeEqual.calls });
    expect((await callGate({ gate: exactGate(refusing), authorization: 'Bearer right-secret' })).status).toBe(401);
  });

  it('a token of another length is refused without the host port being asked', async () => {
    const host = fakeDaemonRouteHost();
    expect((await callGate({ gate: exactGate(host.timingSafeEqual), authorization: 'Bearer right-secretx' })).status).toBe(401);
    expect(host.timingSafeEqual.calls).toHaveLength(0);
  });

  it('the exact token is admitted through the host port, asked exactly once', async () => {
    const host = fakeDaemonRouteHost();
    expect((await callGate({ gate: exactGate(host.timingSafeEqual), authorization: 'Bearer right-secret' })).status).toBe(204);
    expect(host.timingSafeEqual.calls).toHaveLength(1);
  });

  it('a same-length wrong token is compared through the host port, exactly once, on two equal-length arrays', async () => {
    const host = fakeDaemonRouteHost();
    const gate = remoteToolBridgeTokenGate({ env: { [TOKEN_ENV_VAR]: 'right-secret' }, timingSafeEqual: host.timingSafeEqual }, { tokenConfig: { tokenEnvVar: TOKEN_ENV_VAR } });
    expect((await callGate({ gate, authorization: 'Bearer wrong-secret' })).status).toBe(401);
    expect(host.timingSafeEqual.calls).toHaveLength(1);
    expect(host.timingSafeEqual.calls[0]!.left.length).toBe(host.timingSafeEqual.calls[0]!.right.length);
  });
});

/** The two routes on an in-memory server, with a lifecycle that has one live run. */
async function servedRoutes(overrides: Partial<RemoteRunEventHttpDeps> = {}) {
  const deps = makeDeps(overrides);
  const host = fakeDaemonRouteHost();
  const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
  return { deps, host, run, fetch: serveRoutes({ routes: remoteRunEventRoutes({ deps, host }) }) };
}

describe('remoteRunEventRoutes', () => {
  it('lists exactly the two remote-event routes, each behind the bridge-token gate', () => {
    const routes = remoteRunEventRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() });
    expect(describeRoutes({ routes })).toEqual([
      { method: 'POST', path: '/api/runs/:runId/tool-use', gates: ['remote-bridge-token'] },
      { method: 'POST', path: '/api/runs/:runId/tool-result', gates: ['remote-bridge-token'] },
    ]);
  });

  it('an unauthenticated request is rejected before the handler ever runs, and its body is never read', async () => {
    const { fetch, deps, run } = await servedRoutes();
    const recordToolUse = vi.spyOn(deps.recorder, 'recordToolUse');
    const malformed = new Request(`http://local/api/runs/${run.id}/tool-use`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    const response = await fetch(malformed);
    expect(response.status).toBe(401);
    expect(malformed.bodyUsed).toBe(false);
    expect(recordToolUse).not.toHaveBeenCalled();
  });

  it.each(['tool-use', 'tool-result'])('%s with no Authorization header answers 401 REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED', async (leaf) => {
    const { fetch, run } = await servedRoutes();
    const response = await fetch(jsonRequest({ path: `/api/runs/${run.id}/${leaf}`, method: 'POST' }, { body: { toolUseId: 'tu-1', toolId: 'echo', content: 'x' } }));
    expect([response.status, ((await response.json()) as { error: { code: string } }).error.code]).toEqual([401, 'REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED']);
  });

  it('with no token configured both routes fail closed with 503, and the recorder is never called', async () => {
    const { fetch, deps, run } = await servedRoutes({ env: {} });
    const recordToolUse = vi.spyOn(deps.recorder, 'recordToolUse');
    const request = jsonRequest({ path: `/api/runs/${run.id}/tool-use`, method: 'POST' }, { body: { toolUseId: 'tu-1', toolId: 'echo' } });
    request.headers.set('authorization', 'Bearer shared-secret');
    expect((await fetch(request)).status).toBe(503);
    expect(recordToolUse).not.toHaveBeenCalled();
  });

  it('a WRONG token on tool-result is rejected before the recorder runs', async () => {
    const { fetch, deps, run } = await servedRoutes();
    const recordToolResult = vi.spyOn(deps.recorder, 'recordToolResult');
    const request = jsonRequest({ path: `/api/runs/${run.id}/tool-result`, method: 'POST' }, { body: { toolUseId: 'tu-1', content: 'x' } });
    request.headers.set('authorization', 'Bearer shared-secreT');
    const response = await fetch(request);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED');
    expect(recordToolResult).not.toHaveBeenCalled();
  });

  it('an authenticated request records a real tool_use event through the full pipeline', async () => {
    const { fetch, deps, run } = await servedRoutes();
    const request = jsonRequest({ path: `/api/runs/${run.id}/tool-use`, method: 'POST' }, { body: { toolUseId: 'tu-1', toolId: 'echo', input: 1 } });
    request.headers.set('authorization', 'Bearer shared-secret');
    const response = await fetch(request);
    expect([response.status, await response.json()]).toEqual([200, { recorded: true }]);
    const events: unknown[] = [];
    await deps.lifecycle.stream({ runId: run.id, onEvent: (event) => events.push(event) });
    expect((events as { kind: string }[]).some((e) => e.kind === 'agent')).toBe(true);
  });

  it('answers an internal recorder failure through the host reporter: fixed sentence plus the request ID, the real error to the host', async () => {
    const lifecycle = makeLifecycle();
    const recorder = { recordToolUse: () => Promise.reject(new Error('sqlite failed at /srv/private/runs.db')), recordToolResult: () => Promise.resolve() } as unknown as RemoteRunEventHttpDeps['recorder'];
    const { fetch, host, run } = await servedRoutes({ lifecycle, recorder });
    const request = jsonRequest({ path: `/api/runs/${run.id}/tool-use`, method: 'POST' }, { body: { toolUseId: 'tu-1', toolId: 'echo' } });
    request.headers.set('authorization', 'Bearer shared-secret');
    const response = await fetch(request);
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain('/srv/private/runs.db');
    expect(JSON.parse(text).error).toMatchObject({ code: 'INTERNAL_ERROR', requestId: 'req-1' });
    expect(host.reports).toHaveLength(1);
    expect((host.reports[0]!.report.error as Error).message).toBe('sqlite failed at /srv/private/runs.db');
  });
});

/**
 * Coverage-completing cases for the paths the original increment left unexercised. Each is a real
 * behavior worth pinning, not a line-count exercise: the parser's remaining rejections, the
 * `isError: true` round trip, the already-terminal conflict on both routes, and the auth gate's own
 * zero-config defaults.
 */
describe('remote-run-events — remaining contract surface', () => {
  it('rejects a tool-use with no toolId', () => {
    const result = remoteToolUseRoute.parse({ body: { toolUseId: 'tu-1' }, query: {}, params: { runId: 'r1' } });
    expect(result.ok).toBe(false);
  });

  it('rejects a tool-result with no runId path parameter', () => {
    const result = remoteToolResultRoute.parse({ body: { toolUseId: 'tu-1', content: 'ok' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a tool-result whose body is not a JSON object', () => {
    const result = remoteToolResultRoute.parse({ body: 'nope', query: {}, params: { runId: 'r1' } });
    expect(result.ok).toBe(false);
  });

  it('carries isError through the parser and into the recorded event', async () => {
    const parsed = remoteToolResultRoute.parse({
      body: { toolUseId: 'tu-1', content: 'boom', isError: true },
      query: {},
      params: { runId: 'r1' },
    });
    expect(parsed).toEqual({ ok: true, value: { runId: 'r1', toolUseId: 'tu-1', content: 'boom', isError: true } });

    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-err' });
    const result = await remoteToolResultRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', content: 'boom', isError: true }, deps }
    );
    expect(result).toEqual({ ok: true, value: { recorded: true } });
  });

  it('reports a CONFLICT — not a redacted 500 — when a tool-use lands on an already-terminal run', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-terminal' });
    await deps.lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: false });

    const result = await remoteToolUseRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, deps });
    // A late report against a finished run is a legitimate business conflict, so the real message
    // survives rather than being SEC-005 redacted into an opaque internal error.
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT', details: { runId: run.id } } });
  });

  it('reports NOT_FOUND for a tool-result against an unknown run', async () => {
    const result = await remoteToolResultRoute.handle({ input: { runId: 'never-started', toolUseId: 'tu-1', content: 'x' }, deps: makeDeps() });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'run "never-started" was not found' } });
  });

  it('defaults its token env var name when a host configures none', async () => {
    // Unconfigured means 503, never an open door — the default name resolves to a real, absent
    // variable rather than to no gate at all.
    expect((await callGate({ gate: gateFor({}, {}) })).status).toBe(503);
    expect((await callGate({ gate: gateFor({ JINI_REMOTE_TOOL_BRIDGE_TOKEN: 'from-env' }, {}), authorization: 'Bearer from-env' })).status).toBe(204);
  });

  // Rewritten from an earlier assertion that this became `CONFLICT` with the raw rejection as its
  // message. That encoded the very defect this suite now guards against: a bare string rejection is
  // not a terminal-run conflict, and echoing whatever it happens to contain is the leak. It is
  // routed to the SEC-005 path instead — the value is not lost, it goes to the sink.
  it('routes a non-Error rejection to the internal-error sink rather than echoing it', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-nonerror' });
    const onInternalError = vi.fn();
    const result = await remoteToolUseRoute.handle({
      input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, deps: { 
        ...deps,
        reportInternalError: injectedRecordingReporter({ record: onInternalError }),
        recorder: {
          recordToolUse: () => Promise.reject('a bare string rejection'),
          recordToolResult: deps.recorder.recordToolResult.bind(deps.recorder),
        },
      }
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'The tool call could not be recorded for this run. Check the run status; copy the request ID and report this problem.' } });
    expect(onInternalError).toHaveBeenCalledOnce();
    expect(onInternalError.mock.calls[0]![0]).toMatchObject({ error: 'a bare string rejection' });
  });

  // A storage/driver fault is not a business conflict. Reporting it as 409 with the raw message
  // hands the caller whatever the exception happened to carry — here a filesystem path and a
  // credential — so this asserts on the response *not containing* those, not merely on the code.
  it('never echoes an unexpected recorder failure — it becomes a redacted INTERNAL_ERROR', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-storage-fault' });
    const secret = 'sqlite failed at /srv/private/runs.db; token=bridge-secret';
    const onInternalError = vi.fn();

    const result = await remoteToolUseRoute.handle({
      input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, deps: { 
        ...deps,
        reportInternalError: injectedRecordingReporter({ record: onInternalError }),
        recorder: {
          recordToolUse: () => Promise.reject(new Error(secret)),
          recordToolResult: deps.recorder.recordToolResult.bind(deps.recorder),
        },
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result.error)).not.toContain('/srv/private/runs.db');
    expect(JSON.stringify(result.error)).not.toContain('bridge-secret');
    // The operator still gets the real thing, correlated to what the caller was told.
    expect(onInternalError).toHaveBeenCalledOnce();
    const context = onInternalError.mock.calls[0]![0] as { correlationId: string; error: unknown };
    expect((context.error as Error).message).toBe(secret);
    expect(result.error.requestId).toBe(context.correlationId);
    expect(onInternalError.mock.calls[0]?.[0]).toMatchObject({ source: 'tool-use', runId: run.id, logSource: 'remote-run-events/tool-use' });
    expect(result.error.message).toBe('The tool call could not be recorded for this run. Check the run status; copy the request ID and report this problem.');
  });

  it('the fixture reporter records the failure once with the ERR id the caller received', async () => {
    const fixture = createRouteTestErrors();
    const deps = makeDeps({ reportInternalError: fixture.reportInternalError });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-default-sink' });
    const failure = new Error('disk full');
    const result = await remoteToolResultRoute.handle({
      input: { runId: run.id, toolUseId: 'tu-1', content: 'x' }, deps: {
        ...deps,
        recorder: { recordToolUse: deps.recorder.recordToolUse.bind(deps.recorder), recordToolResult: () => Promise.reject(failure) },
      },
    });
    if (result.ok) throw new Error('expected failure');
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(fixture.entries).toHaveLength(1);
    expect(fixture.reports).toHaveLength(1);
    expect(result.error.requestId).toBe('ERR-AAAA-BBBB-CCCC-0001');
    expect(fixture.entries[0]?.meta?.errorId).toBe(result.error.requestId);
    expect(fixture.reports[0]?.context.incidentId).toBe(result.error.requestId);
  });

  it('reports NOT_FOUND when the run disappears between the recorder failure and the status re-check', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-vanished' });
    let lookups = 0;
    const onInternalError = vi.fn();
    const lifecycle = Object.assign(Object.create(deps.lifecycle) as typeof deps.lifecycle, {
      get: (args: { runId: string }) => (++lookups === 1 ? deps.lifecycle.get(args) : Promise.reject(new Error('store closed'))),
    });
    const result = await remoteToolUseRoute.handle({
      input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, deps: { 
        ...deps, lifecycle, reportInternalError: injectedRecordingReporter({ record: onInternalError }),
        recorder: { recordToolUse: () => Promise.reject(new Error('write failed')), recordToolResult: deps.recorder.recordToolResult.bind(deps.recorder) },
      },
    });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: `run "${run.id}" was not found` } });
    expect(onInternalError).not.toHaveBeenCalled();
  });

  it('applies the same redaction to tool-result, not just tool-use', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-storage-fault-result' });
    const onInternalError = vi.fn();

    const result = await remoteToolResultRoute.handle({
      input: { runId: run.id, toolUseId: 'tu-1', content: 'x' }, deps: { 
        ...deps,
        reportInternalError: injectedRecordingReporter({ record: onInternalError }),
        recorder: {
          recordToolUse: deps.recorder.recordToolUse.bind(deps.recorder),
          recordToolResult: () => Promise.reject(new Error('disk on fire at /srv/private/runs.db')),
        },
      }
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('/srv/private/runs.db');
    expect(onInternalError).toHaveBeenCalledOnce();
  });

  // The other half of the contract: a genuine terminal-run conflict must still be a 409, and must
  // still say enough for the caller to understand it lost a legitimate race.
  it('still reports a real terminal-run conflict as CONFLICT', async () => {
    const deps = makeDeps();
    const onInternalError = vi.fn();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-still-conflict' });
    await deps.lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: false });

    const result = await remoteToolUseRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, deps: {  ...deps, reportInternalError: injectedRecordingReporter({ record: onInternalError }) } });

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT', details: { runId: run.id } } });
    // A legitimate business conflict is not an internal fault and must not page anyone.
    expect(onInternalError).not.toHaveBeenCalled();
  });
});

/**
 * F1 fix wave (Stryker L8 §2.1 / AP1 / AP3): the surviving mutants after the first F1 pass, each
 * killed by asserting WHICH refusal came back (full body), not just `ok: false`.
 */
describe('remote-run-events — F1 exact-refusal pins', () => {
  const badRequest = (message: string, path?: string, issue?: string) => ({
    ok: false,
    error: path === undefined
      ? { code: 'BAD_REQUEST', message }
      : { code: 'BAD_REQUEST', message, details: { kind: 'validation', issues: [{ path, message: issue }] } },
  });

  it('a missing Authorization header never matches a configured token that is literally "null"', async () => {
    // `presented === null` must short-circuit: TextEncoder would otherwise encode null as "null".
    const answer = await callGate({ gate: gateFor({ [TOKEN_ENV_VAR]: 'null' }) });
    expect([answer.status, answer.nextCalls]).toEqual([401, 0]);
  });

  for (const route of [remoteToolUseRoute, remoteToolResultRoute]) {
    const name = route === remoteToolUseRoute ? 'tool-use' : 'tool-result';
    it.each([[{}], [{ runId: '' }], [{ runId: 7 }]])(`${name}: runId path param %j → exact BAD_REQUEST`, (params) => {
      expect(route.parse({ body: { toolUseId: 'tu', toolId: 't', content: 'c' }, query: {}, params: params as any })).toEqual(badRequest('runId must be a non-empty path parameter'));
    });
    it.each([['array', ['toolUseId']], ['null', null], ['string', 'x'], ['number', 1]])(`${name}: %s body → "body must be a JSON object"`, (_l, body) => {
      expect(route.parse({ body, query: {}, params: { runId: 'r1' } })).toEqual(badRequest('body must be a JSON object'));
    });
    it.each([['absent', undefined], ['empty', ''], ['whitespace only', '   '], ['non-string', 5]])(`${name}: toolUseId %s → exact issue`, (_l, toolUseId) => {
      expect(route.parse({ body: { toolUseId, toolId: 't', content: 'c' }, query: {}, params: { runId: 'r1' } })).toEqual(badRequest('toolUseId must be a non-empty string', 'toolUseId', 'required non-empty string'));
    });
  }

  it.each([['absent', undefined], ['empty', ''], ['whitespace only', ' \t'], ['non-string', {}]])('tool-use: toolId %s → exact issue', (_l, toolId) => {
    expect(remoteToolUseRoute.parse({ body: { toolUseId: 'tu', toolId }, query: {}, params: { runId: 'r1' } })).toEqual(badRequest('toolId must be a non-empty string', 'toolId', 'required non-empty string'));
  });

  it('tool-use: an untrimmed but non-blank toolUseId is kept verbatim', () => {
    expect(remoteToolUseRoute.parse({ body: { toolUseId: ' tu ', toolId: 't' }, query: {}, params: { runId: 'r1' } })).toEqual({ ok: true, value: { runId: 'r1', toolUseId: ' tu ', toolId: 't', input: undefined } });
  });

  it.each([['absent', undefined], ['number', 42], ['null', null]])('tool-result: content %s → exact issue', (_l, content) => {
    expect(remoteToolResultRoute.parse({ body: { toolUseId: 'tu', content }, query: {}, params: { runId: 'r1' } })).toEqual(badRequest('content must be a string', 'content', 'required string'));
  });

  it.each([['string', 'yes'], ['number', 1], ['null', null]])('tool-result: isError %s → exact issue', (_l, isError) => {
    expect(remoteToolResultRoute.parse({ body: { toolUseId: 'tu', content: 'c', isError }, query: {}, params: { runId: 'r1' } })).toEqual(badRequest('isError must be a boolean when provided', 'isError', 'boolean when provided'));
  });

  it.each([[true], [false]])('tool-result: isError %s is carried through parse exactly', (isError) => {
    expect(remoteToolResultRoute.parse({ body: { toolUseId: 'tu', content: 'c', isError }, query: {}, params: { runId: 'r1' } })).toEqual({ ok: true, value: { runId: 'r1', toolUseId: 'tu', content: 'c', isError } });
  });

  it('an unknown run is NOT_FOUND on both routes and the recorder is never called', async () => {
    const deps = makeDeps();
    const recordToolUse = vi.spyOn(deps.recorder, 'recordToolUse');
    const recordToolResult = vi.spyOn(deps.recorder, 'recordToolResult');
    expect(await remoteToolUseRoute.handle({ input: { runId: 'ghost', toolUseId: 'tu', toolId: 't' }, deps })).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'run "ghost" was not found' } });
    expect(await remoteToolResultRoute.handle({ input: { runId: 'ghost', toolUseId: 'tu', content: 'c' }, deps })).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'run "ghost" was not found' } });
    expect(recordToolUse).not.toHaveBeenCalled();
    expect(recordToolResult).not.toHaveBeenCalled();
  });

  it('tool-result forwards isError only when provided: absent stays absent, false stays false', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const recordToolResult = vi.spyOn(deps.recorder, 'recordToolResult');
    await remoteToolResultRoute.handle({ input: { runId: run.id, toolUseId: 'tu-a', content: 'a' }, deps });
    await remoteToolResultRoute.handle({ input: { runId: run.id, toolUseId: 'tu-b', content: 'b', isError: false }, deps });
    expect(recordToolResult.mock.calls[0]![0]).toEqual({ runId: run.id, record: { toolUseId: 'tu-a', content: 'a' } });
    expect('isError' in recordToolResult.mock.calls[0]![0].record).toBe(false);
    expect(recordToolResult.mock.calls[1]![0]).toEqual({ runId: run.id, record: { toolUseId: 'tu-b', content: 'b', isError: false } });
  });

  it('tool-use forwards exactly toolUseId/toolId/input to the recorder', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const recordToolUse = vi.spyOn(deps.recorder, 'recordToolUse');
    await remoteToolUseRoute.handle({ input: { runId: run.id, toolUseId: 'tu', toolId: 'echo', input: { a: [1, 2] } }, deps });
    expect(recordToolUse).toHaveBeenCalledWith({ runId: run.id, record: { toolUseId: 'tu', toolId: 'echo', input: { a: [1, 2] } } });
  });
});


it.each(['GET', 'PUT'] as const)('lets %s on the remote-event path fall through without reading a body', async method => {
  const { fetch, deps, run } = await servedRoutes();
  const recordToolUse = vi.spyOn(deps.recorder, 'recordToolUse');
  const response = await fetch(new Request(`http://local/api/runs/${run.id}/tool-use`, { method }));
  // The server contract answers 405 when only the method differs (core/contracts/server conformance).
  expect(response.status).toBe(405);
  expect(recordToolUse).not.toHaveBeenCalled();
});
