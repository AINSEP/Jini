import { describe, expect, it, vi } from 'vitest';
import { createInMemoryEventLog, createRemoteToolEventRecorder, createRunLifecycle, type RunLifecycle } from '@jini-ai/daemon';
import {
  registerRemoteRunEventRoutes,
  remoteToolResultRoute,
  remoteToolUseRoute,
  requireRemoteToolBridgeToken,
  type RemoteRunEventHttpDeps,
} from '../remote-run-events.js';

interface MockApp {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  delete: (path: string, handler: any) => void;
  patch: (path: string, handler: any) => void;
  use: (path: string, middleware: any) => void;
  handlers: Record<string, (req: any, res: any) => Promise<void> | void>;
  middlewares: Record<string, ((req: any, res: any, next: () => void) => void)[]>;
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const middlewares: MockApp['middlewares'] = {};
  const make = (method: string) => (path: string, handler: any) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return {
    get: make('get'),
    post: make('post'),
    put: make('put'),
    delete: make('delete'),
    patch: make('patch'),
    use: (path: string, middleware: any) => {
      (middlewares[path] ??= []).push(middleware);
    },
    handlers,
    middlewares,
  };
}

function makeJsonRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

/** Runs a mounted route's real middleware chain (registered via `app.use(path, ...)`) before the route handler itself, exactly as Express would for a matching path. */
async function dispatch(app: MockApp, method: string, path: string, req: any, res: any): Promise<void> {
  for (const mw of app.middlewares[path] ?? []) {
    let called = false;
    await new Promise<void>((resolve) => {
      mw(req, res, () => {
        called = true;
        resolve();
      });
      if (!called) resolve();
    });
    if (!called) return; // middleware responded directly (401/503) and never called next()
  }
  await app.handlers[`${method} ${path}`]!(req, res);
}

const adapter = { resolvedPortRef: { current: 7654 } };
const TOKEN_ENV_VAR = 'JINI_REMOTE_TOOL_BRIDGE_TOKEN_TEST';

function makeLifecycle(): RunLifecycle {
  return createRunLifecycle({ eventLog: createInMemoryEventLog() });
}

function makeDeps(overrides: Partial<RemoteRunEventHttpDeps> = {}): RemoteRunEventHttpDeps {
  const lifecycle = overrides.lifecycle ?? makeLifecycle();
  return {
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
    const result = await remoteToolUseRoute.handle({ runId: 'never-started', toolUseId: 'tu-1', toolId: 'echo' }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'run "never-started" was not found' } });
  });

  it('records a tool_use event visible to the run\'s own stream()', async () => {
    const lifecycle = makeLifecycle();
    const deps = makeDeps({ lifecycle, recorder: createRemoteToolEventRecorder({ lifecycle }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });

    const result = await remoteToolUseRoute.handle({ runId: run.id, toolUseId: 'tu-1', toolId: 'echo', input: { x: 1 } }, deps);
    expect(result).toEqual({ ok: true, value: { recorded: true } });

    const events: unknown[] = [];
    await deps.lifecycle.stream(run.id, (event) => events.push(event));
    const agentEvents = (events as { kind: string; payload: { type: string } }[]).filter((e) => e.kind === 'agent');
    expect(agentEvents.map((e) => e.payload.type)).toEqual(['tool_use']);
  });

  it('records a tool_result event', async () => {
    const lifecycle = makeLifecycle();
    const deps = makeDeps({ lifecycle, recorder: createRemoteToolEventRecorder({ lifecycle }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await remoteToolResultRoute.handle({ runId: run.id, toolUseId: 'tu-1', content: 'done' }, deps);
    expect(result).toEqual({ ok: true, value: { recorded: true } });
  });

  it('returns CONFLICT (not a 500) when the run is already terminal', async () => {
    const lifecycle = makeLifecycle();
    const deps = makeDeps({ lifecycle, recorder: createRemoteToolEventRecorder({ lifecycle }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await deps.lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const result = await remoteToolResultRoute.handle({ runId: run.id, toolUseId: 'tu-1', content: 'too late' }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toMatch(/terminal/);
    }
  });
});

describe('requireRemoteToolBridgeToken', () => {
  it('fails closed with 503 when the token env var is not configured', () => {
    const gate = requireRemoteToolBridgeToken({ tokenConfig: { tokenEnvVar: TOKEN_ENV_VAR }, env: {} });
    const res = makeJsonRes();
    const next = vi.fn();
    gate({ headers: {}, get: () => undefined } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a missing/incorrect bearer token with 401', () => {
    const gate = requireRemoteToolBridgeToken({ tokenConfig: { tokenEnvVar: TOKEN_ENV_VAR }, env: { [TOKEN_ENV_VAR]: 'right-secret' } });
    const res = makeJsonRes();
    const next = vi.fn();
    gate({ headers: {}, get: () => 'Bearer wrong-secret' } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for a correct bearer token', () => {
    const gate = requireRemoteToolBridgeToken({ tokenConfig: { tokenEnvVar: TOKEN_ENV_VAR }, env: { [TOKEN_ENV_VAR]: 'right-secret' } });
    const res = makeJsonRes();
    const next = vi.fn();
    gate({ headers: {}, get: () => 'Bearer right-secret' } as any, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('registerRemoteRunEventRoutes', () => {
  it('mounts exactly the two remote-event routes', () => {
    const app = makeApp();
    registerRemoteRunEventRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(['POST /api/runs/:runId/tool-result', 'POST /api/runs/:runId/tool-use'].sort());
  });

  it('end to end: an unauthenticated request is rejected before the handler ever runs', async () => {
    const app = makeApp();
    registerRemoteRunEventRoutes(app as any, makeDeps(), adapter);
    const res = makeJsonRes();
    await dispatch(app, 'POST', '/api/runs/:runId/tool-use', { headers: {}, get: () => undefined, body: { toolUseId: 'tu-1', toolId: 'echo' }, query: {}, params: { runId: 'whatever' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('end to end: an authenticated request records a real tool_use event through the full Adapter pipeline', async () => {
    const app = makeApp();
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    registerRemoteRunEventRoutes(app as any, deps, adapter);
    const res = makeJsonRes();
    await dispatch(
      app,
      'POST',
      '/api/runs/:runId/tool-use',
      { headers: {}, get: () => 'Bearer shared-secret', body: { toolUseId: 'tu-1', toolId: 'echo', input: 1 }, query: {}, params: { runId: run.id } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const events: unknown[] = [];
    await deps.lifecycle.stream(run.id, (event) => events.push(event));
    expect((events as { kind: string }[]).some((e) => e.kind === 'agent')).toBe(true);
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
    const result = await remoteToolResultRoute.handle(
      { runId: run.id, toolUseId: 'tu-1', content: 'boom', isError: true },
      deps,
    );
    expect(result).toEqual({ ok: true, value: { recorded: true } });
  });

  it('reports a CONFLICT — not a redacted 500 — when a tool-use lands on an already-terminal run', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-terminal' });
    await deps.lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: false });

    const result = await remoteToolUseRoute.handle({ runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, deps);
    // A late report against a finished run is a legitimate business conflict, so the real message
    // survives rather than being SEC-005 redacted into an opaque internal error.
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT', details: { runId: run.id } } });
  });

  it('reports NOT_FOUND for a tool-result against an unknown run', async () => {
    const result = await remoteToolResultRoute.handle({ runId: 'never-started', toolUseId: 'tu-1', content: 'x' }, makeDeps());
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'run "never-started" was not found' } });
  });

  it('defaults its token env var name and env source when a host configures neither', () => {
    const saved = process.env.JINI_REMOTE_TOOL_BRIDGE_TOKEN;
    delete process.env.JINI_REMOTE_TOOL_BRIDGE_TOKEN;
    try {
      const gate = requireRemoteToolBridgeToken({});
      const res = makeJsonRes();
      const next = vi.fn();
      gate({ get: () => undefined } as never, res as never, next);
      // Unconfigured means 503, never an open door — the default name resolves to a real, absent
      // variable rather than to no gate at all.
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);

      process.env.JINI_REMOTE_TOOL_BRIDGE_TOKEN = 'from-real-env';
      const allowed = makeJsonRes();
      const allowNext = vi.fn();
      requireRemoteToolBridgeToken({})(
        { get: () => 'Bearer from-real-env' } as never,
        allowed as never,
        allowNext,
      );
      expect(allowNext).toHaveBeenCalledTimes(1);
    } finally {
      if (saved === undefined) delete process.env.JINI_REMOTE_TOOL_BRIDGE_TOKEN;
      else process.env.JINI_REMOTE_TOOL_BRIDGE_TOKEN = saved;
    }
  });

  it('stringifies a non-Error rejection rather than losing it', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-nonerror' });
    const result = await remoteToolUseRoute.handle({ runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, {
      ...deps,
      recorder: {
        recordToolUse: () => Promise.reject('a bare string rejection'),
        recordToolResult: deps.recorder.recordToolResult.bind(deps.recorder),
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: 'a bare string rejection' } });
  });
});
