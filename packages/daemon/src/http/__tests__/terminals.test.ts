import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingOriginPolicy } from '@jini-ai/core/contracts/server/testing';
import { createToolRegistry, type Principal, type ToolPolicy, type ToolRegistry } from '@jini-ai/core';
import {
  createTerminalSessionManager,
  createTerminalToolRegistrations,
  createToolExecutor,
  TERMINAL_CREATE_TOOL_ID,
  type TerminalSessionManager,
  type ToolExecutionResult,
  type ToolExecutor,
} from '../../index.js';
import type { PtyProcess, PtySpawn } from '@jini-ai/core/contracts/runtime';
import { createTerminalService } from '@jini-ai/platform';
import {
  actionResultToApiResult,
  terminalCreateRoute,
  terminalDeleteRoute,
  terminalKillRoute,
  terminalListRoute,
  terminalResizeRoute,
  terminalRoutes,
  terminalStdinRoute,
  type TerminalsHttpDeps,
} from '../terminals.js';
import type { WorkspaceRootResolver } from '../workspace-root.js';
import { describeRoutes } from '../route-table.js';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { readFrames } from './fakes/sse-reader.js';

const testOriginPolicy = createRecordingOriginPolicy();

const alice: Principal = { id: 'alice' };
const bob: Principal = { id: 'bob' };

// A fake PtySpawn/PtyProcess pair — no real node-pty/subprocess anywhere in this test file. This
// exercises the real `@jini-ai/daemon` `TerminalSessionManager` (ownership + lock) and a real
// `ToolExecutor`/`ToolRegistry`, matching this codebase's "route tests should exercise the real
// gate, not a mock of it" convention (see `db-ops.test.ts`).
class FakePty implements PtyProcess {
  dataCb: ((chunk: string) => void) | null = null;
  exitCb: ((event: { exitCode: number; signal?: number }) => void) | null = null;
  writeCalls: string[] = [];
  onData(cb: (chunk: string) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (event: { exitCode: number; signal?: number }) => void): void {
    this.exitCb = cb;
  }
  write(input: string): void {
    this.writeCalls.push(input);
  }
  resize(): void { }
  kill(): void { }
  emitData(chunk: string): void {
    this.dataCb?.(chunk);
  }
}

function makeManager(): { manager: TerminalSessionManager; pty: FakePty } {
  const pty = new FakePty();
  const spawnPty: PtySpawn = () => pty;
  const manager = createTerminalSessionManager({ terminalService: createTerminalService({ loadSpawnPty: async () => spawnPty }) });
  return { manager, pty };
}

/** Real `ToolExecutor`/`ToolRegistry` with `terminal.create` registered under the given policy — mirrors `db-ops.test.ts`'s `makeExecutor`. */
function makeExecutor(manager: TerminalSessionManager, policy?: ToolPolicy): { executor: ToolExecutor; registry: ToolRegistry } {
  const registry = createToolRegistry({});
  const regs = createTerminalToolRegistrations({ manager }, policy === undefined ? {} : { policy });
  registry.register(regs.create);
  return { executor: createToolExecutor({ registry }), registry };
}

function makeDeps(overrides: Partial<TerminalsHttpDeps> & { policy?: ToolPolicy } = {}): {
  deps: TerminalsHttpDeps;
  manager: TerminalSessionManager;
  pty: FakePty;
} {
  const { manager, pty } = makeManager();
  const useProductionDefaultPolicy = Object.prototype.hasOwnProperty.call(overrides, 'policy') && overrides.policy === undefined;
  const { executor } = overrides.toolExecutor
    ? { executor: overrides.toolExecutor }
    : makeExecutor(manager, useProductionDefaultPolicy ? undefined : overrides.policy ?? { authorize: () => 'allow' });
  const resolveRoot: WorkspaceRootResolver = overrides.resolveRoot ?? (() => '/resolved/work');
  return {
    deps: { manager, toolExecutor: executor, principal: alice, resolveRoot, ...overrides },
    manager,
    pty,
  };
}

beforeEach(() => {
  testOriginPolicy.set({ allow: true });
});

describe('terminalCreateRoute.parse', () => {
  it('rejects a non-object body', () => {
    expect(terminalCreateRoute.parse({ body: 'nope', query: {}, params: {} })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' },
    });
  });

  it('requires a non-empty resourceRef', () => {
    const result = terminalCreateRoute.parse({ body: {}, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('accepts resourceRef alone', () => {
    expect(terminalCreateRoute.parse({ body: { resourceRef: 'proj-1' }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { resourceRef: 'proj-1' },
    });
  });

  it('accepts detail/cols/rows/shell when valid', () => {
    const result = terminalCreateRoute.parse({
      body: { resourceRef: 'proj-1', detail: 'sub', cols: 100, rows: 40, shell: '/bin/zsh' },
      query: {},
      params: {},
    });
    expect(result).toEqual({
      ok: true,
      value: { resourceRef: 'proj-1', detail: 'sub', cols: 100, rows: 40, shell: '/bin/zsh' },
    });
  });

  it.each([
    ['detail', ''],
    ['shell', ''],
  ])('rejects an empty %s string', (field, value) => {
    const result = terminalCreateRoute.parse({ body: { resourceRef: 'r1', [field]: value }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it.each([['cols'], ['rows']])('rejects a non-number %s', (field) => {
    const result = terminalCreateRoute.parse({ body: { resourceRef: 'r1', [field]: 'wide' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });
});

describe('terminalCreateRoute.handle', () => {
  it('success: resolves the workspace root and creates a session through the real ToolExecutor gate', async () => {
    const { deps, pty } = makeDeps();
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('running');
      expect(result.value.resourceRef).toBe('proj-1');
      expect(result.value.cwd).toBe('/resolved/work');
    }
    expect(pty).toBeInstanceOf(FakePty);
  });

  it('threads cols/rows/shell through into the tool input when supplied', async () => {
    const { manager } = makeManager();
    const seenInputs: unknown[] = [];
    const registry = createToolRegistry({});
    const real = createTerminalToolRegistrations({ manager });
    registry.register({
      descriptor: real.create.descriptor,
      policy: { authorize: () => 'allow' },
      handler: async (ctx) => {
        seenInputs.push(ctx.input);
        return real.create.handler(ctx);
      },
    });
    const executor = createToolExecutor({ registry });
    const deps: TerminalsHttpDeps = { manager, toolExecutor: executor, principal: alice, resolveRoot: () => '/work' };
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1', cols: 100, rows: 40, shell: '/bin/zsh' }, deps });
    expect(result.ok).toBe(true);
    expect(seenInputs[0]).toMatchObject({ cols: 100, rows: 40, shell: '/bin/zsh' });
  });

  it('forwards resourceRef/detail into the workspace-root resolver', async () => {
    const resolveRoot = vi.fn(() => '/work') as WorkspaceRootResolver;
    const { deps } = makeDeps({ resolveRoot });
    await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1', detail: 'src/index.ts' }, deps });
    expect(resolveRoot).toHaveBeenCalledWith({ request: { resourceRef: 'proj-1', detail: 'src/index.ts' } });
  });

  it('404s when the workspace-root resolver denies (the default, zero-config resolver denies everything)', async () => {
    const { manager } = makeManager();
    const { executor } = makeExecutor(manager, { authorize: () => 'allow' });
    // No `resolveRoot` at all — proves the real production default (`denyAllWorkspaceRoots`)
    // applies, not a test fixture's own convenience default.
    const deps: TerminalsHttpDeps = { manager, toolExecutor: executor, principal: alice };
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'unknown' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'resource "unknown" was not found' },
    });
  });

  it('propagates a non-WorkspaceRootDeniedError thrown by the resolver rather than mapping it to NOT_FOUND', async () => {
    const resolveRoot: WorkspaceRootResolver = () => {
      throw new Error('resolver exploded');
    };
    const { deps } = makeDeps({ resolveRoot });
    await expect(terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps })).rejects.toThrow('resolver exploded');
  });

  it('auth-denial: the real deny-by-default terminal.create policy blocks creation, and no session is spawned', async () => {
    const { manager } = makeManager();
    const { executor } = makeExecutor(manager); // no policy override — real denyAllTerminalCreatePolicy applies
    const deps: TerminalsHttpDeps = { manager, toolExecutor: executor, principal: alice, resolveRoot: () => '/work' };
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied by policy' },
    });
    expect(manager.list({ principal: alice })).toEqual([]);
  });

  it('a failed tool execution redacts the real error and reports a correlation id (SEC-005), while invoking onInternalError with the real error', async () => {
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: TERMINAL_CREATE_TOOL_ID },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        throw new Error('posix_spawnp failed for /secret/bin/bash');
      },
    });
    const executor = createToolExecutor({ registry });
    const onInternalError = vi.fn();
    const deps: TerminalsHttpDeps = {
      manager: makeManager().manager,
      toolExecutor: executor,
      principal: alice,
      resolveRoot: () => '/work',
      onInternalError,
    };
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(result.error)).not.toContain('/secret/bin/bash');
      expect(result.error.requestId).toEqual(expect.any(String));
    }
    expect(onInternalError).toHaveBeenCalledTimes(1);
    expect(onInternalError.mock.calls[0]![0].source).toBe('terminal-create');
  });

  it('logs to console.error by default when onInternalError is omitted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: TERMINAL_CREATE_TOOL_ID },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        throw new Error('boom');
      },
    });
    const executor = createToolExecutor({ registry });
    const deps: TerminalsHttpDeps = { manager: makeManager().manager, toolExecutor: executor, principal: alice, resolveRoot: () => '/work' };
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    if (result.ok) throw new Error('expected failure');
    expect(consoleError.mock.calls).toEqual([[`[@jini-ai/http-kit] internal error (terminal-create, correlationId=${result.error.requestId})`, 'string']]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('boom');
    consoleError.mockRestore();
  });

  it('reports a denied confirmation the same as a policy denial', async () => {
    const { manager } = makeManager();
    const registry = createToolRegistry({});
    const regs = createTerminalToolRegistrations({ manager }, { policy: { authorize: () => 'allow' }, requiresConfirmation: true });
    registry.register(regs.create);
    const executor = createToolExecutor({ registry }, { delegate: { onConfirm: () => 'deny' } });
    const deps: TerminalsHttpDeps = { manager, toolExecutor: executor, principal: alice, resolveRoot: () => '/work' };
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied during confirmation' },
    });
  });

  it('reports a timeout as a redacted INTERNAL_ERROR', async () => {
    const executor: ToolExecutor = {
      execute: vi.fn(async () => ({ executionId: 't1', status: 'timed-out' as const })),
      resumeConfirmation: vi.fn(),
      cancel: vi.fn(),
      getAuditRecord: vi.fn(() => null),
    };
    const deps: TerminalsHttpDeps = { manager: makeManager().manager, toolExecutor: executor, principal: alice, resolveRoot: () => '/work' };
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'The terminal could not be opened. Try again; if it keeps failing, copy the request ID and report this problem.', requestId: expect.any(String) },
    });
  });

  it('reports a cancellation as a redacted INTERNAL_ERROR', async () => {
    const executor: ToolExecutor = {
      execute: vi.fn(async () => ({ executionId: 't1', status: 'cancelled' as const })),
      resumeConfirmation: vi.fn(),
      cancel: vi.fn(),
      getAuditRecord: vi.fn(() => null),
    };
    const deps: TerminalsHttpDeps = { manager: makeManager().manager, toolExecutor: executor, principal: alice, resolveRoot: () => '/work' };
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'The terminal could not be opened. Try again; if it keeps failing, copy the request ID and report this problem.', requestId: expect.any(String) },
    });
  });
});

describe('terminalListRoute', () => {
  it('parse: defaults to no resourceRef filter', () => {
    expect(terminalListRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: {} });
  });

  it('parse: rejects a non-string resourceRef (e.g. a repeated query param becomes an array)', () => {
    const result = terminalListRoute.parse({ body: {}, query: { resourceRef: ['a', 'b'] }, params: {} });
    expect(result.ok).toBe(false);
  });

  it('parse: accepts a valid resourceRef query parameter', () => {
    expect(terminalListRoute.parse({ body: {}, query: { resourceRef: 'proj-1' }, params: {} })).toEqual({
      ok: true,
      value: { resourceRef: 'proj-1' },
    });
  });

  it('scopes to the calling principal and narrows by resourceRef', async () => {
    const { deps } = makeDeps();
    await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    await terminalCreateRoute.handle({ input: { resourceRef: 'proj-2' }, deps });
    const result = await terminalListRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.terminals).toHaveLength(1);
      expect(result.value.terminals[0]!.resourceRef).toBe('proj-1');
    }
  });

  it("never returns another principal's sessions", async () => {
    const { deps, manager } = makeDeps();
    await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    expect(manager.list({ principal: bob })).toEqual([]);
  });
});

describe('actionResultToApiResult', () => {
  it("omits `terminal` entirely when the action result's session is null (a real race: the session was killed between the ownership check and the critical section — see @jini-ai/daemon's currentSnapshot)", () => {
    const result = actionResultToApiResult({ result: { status: 'ok', ok: false, session: null }, notFoundMessage: 'terminal "t1" was not found' });
    expect(result).toEqual({ ok: true, value: { ok: false } });
  });

  it('includes `terminal` when the action result has a real session', () => {
    const session = { id: 't1', status: 'running', resourceRef: null } as any;
    const result = actionResultToApiResult({ result: { status: 'ok', ok: true, session }, notFoundMessage: 'unused' });
    expect(result).toEqual({ ok: true, value: { ok: true, terminal: session } });
  });

  it('maps not-found to a NOT_FOUND api error with the given message', () => {
    const result = actionResultToApiResult({ result: { status: 'not-found' }, notFoundMessage: 'terminal "t1" was not found' });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'terminal "t1" was not found' } });
  });
});

describe('terminalStdinRoute', () => {
  it('parse: requires id and a string data field', () => {
    expect(terminalStdinRoute.parse({ body: {}, query: {}, params: {} })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'id must be a non-empty path parameter' },
    });
    expect(terminalStdinRoute.parse({ body: {}, query: {}, params: { id: 't1' } }).ok).toBe(false);
    expect(terminalStdinRoute.parse({ body: { data: 'ls\n' }, query: {}, params: { id: 't1' } })).toEqual({
      ok: true,
      value: { id: 't1', data: 'ls\n' },
    });
  });

  it('parse: rejects a non-object body', () => {
    const result = terminalStdinRoute.parse({ body: 'not-an-object', query: {}, params: { id: 't1' } });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('success: forwards to the session and reports ok:true plus the current terminal snapshot', async () => {
    const { deps, manager, pty } = makeDeps();
    const created = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const result = await terminalStdinRoute.handle({ input: { id, data: 'ls\n' }, deps });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(true);
      expect(result.value.terminal?.id).toBe(id);
    }
    expect(pty.writeCalls).toEqual(['ls\n']);
    void manager;
  });

  it('404s for an unknown terminal id', async () => {
    const { deps } = makeDeps();
    const result = await terminalStdinRoute.handle({ input: { id: 'missing', data: 'x' }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'terminal "missing" was not found' } });
  });

  it("404s for another principal's terminal — never a distinguishable forbidden", async () => {
    const { deps } = makeDeps();
    const created = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const foreignDeps: TerminalsHttpDeps = { ...deps, principal: bob };
    const result = await terminalStdinRoute.handle({ input: { id, data: 'x' }, deps: foreignDeps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: `terminal "${id}" was not found` } });
  });
});

describe('terminalResizeRoute', () => {
  it('parse: rejects a missing id path parameter', () => {
    const result = terminalResizeRoute.parse({ body: { cols: 100, rows: 40 }, query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'id must be a non-empty path parameter' } });
  });

  it('parse: rejects a non-object body', () => {
    const result = terminalResizeRoute.parse({ body: 'not-an-object', query: {}, params: { id: 't1' } });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('parse: requires numeric cols and rows', () => {
    expect(terminalResizeRoute.parse({ body: { cols: 'x', rows: 10 }, query: {}, params: { id: 't1' } }).ok).toBe(false);
    expect(terminalResizeRoute.parse({ body: { cols: 100, rows: 40 }, query: {}, params: { id: 't1' } })).toEqual({
      ok: true,
      value: { id: 't1', cols: 100, rows: 40 },
    });
  });

  it('success: resizes and returns the updated terminal', async () => {
    const { deps } = makeDeps();
    const created = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const result = await terminalResizeRoute.handle({ input: { id, cols: 120, rows: 45 }, deps });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(true);
      expect(result.value.terminal?.cols).toBe(120);
      expect(result.value.terminal?.rows).toBe(45);
    }
  });

  it('404s for an unknown terminal id', async () => {
    const { deps } = makeDeps();
    const result = await terminalResizeRoute.handle({ input: { id: 'missing', cols: 10, rows: 10 }, deps });
    expect(result.ok).toBe(false);
  });
});

describe('terminalKillRoute / terminalDeleteRoute', () => {
  it('kill: sends SIGTERM and reports the updated terminal', async () => {
    const { deps } = makeDeps();
    const created = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const result = await terminalKillRoute.handle({ input: id, deps });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ok).toBe(true);
  });

  it('delete: behaves identically to kill', async () => {
    const { deps } = makeDeps();
    const created = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const result = await terminalDeleteRoute.handle({ input: id, deps });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ok).toBe(true);
  });

  it('404s for an unknown terminal id', async () => {
    const { deps } = makeDeps();
    const result = await terminalKillRoute.handle({ input: 'missing', deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'terminal "missing" was not found' } });
  });
});

/** The terminal routes on an in-memory server, behind the recording origin policy. */
function serve(deps: TerminalsHttpDeps) {
  const host = fakeDaemonRouteHost({}, { originPolicy: testOriginPolicy });
  return serveRoutes({ routes: terminalRoutes({ deps, host }) });
}

describe('terminalRoutes', () => {
  it('lists every documented route, with the same-origin gate named on each one that has it', () => {
    const { deps } = makeDeps();
    expect(describeRoutes({ routes: terminalRoutes({ deps, host: fakeDaemonRouteHost() }) })).toEqual([
      { method: 'GET', path: '/api/terminals', gates: [] },
      { method: 'POST', path: '/api/terminals', gates: ['same-origin'] },
      { method: 'POST', path: '/api/terminals/:id/stdin', gates: ['same-origin'] },
      { method: 'POST', path: '/api/terminals/:id/resize', gates: ['same-origin'] },
      { method: 'POST', path: '/api/terminals/:id/kill', gates: ['same-origin'] },
      { method: 'DELETE', path: '/api/terminals/:id', gates: ['same-origin'] },
      { method: 'GET', path: '/api/terminals/:id/stream', gates: ['same-origin'] },
    ]);
  });

  it('create: a same-origin request reaches parse, the executor, and returns 201', async () => {
    const { deps } = makeDeps();
    const response = await serve(deps)(jsonRequest({ path: '/api/terminals', method: 'POST' }, { body: { resourceRef: 'proj-1' } }));
    expect(response.status).toBe(201);
  });

  it('blocks a cross-origin create request before the tool executor ever runs', async () => {
    testOriginPolicy.set({ allow: false });
    const { deps, manager } = makeDeps();
    const response = await serve(deps)(jsonRequest({ path: '/api/terminals', method: 'POST' }, { body: { resourceRef: 'proj-1' } }));
    expect(response.status).toBe(403);
    expect(manager.list({ principal: alice })).toEqual([]);
  });

  it('the list route does not require same-origin (matches runListRoute precedent)', async () => {
    testOriginPolicy.set({ allow: false });
    const { deps } = makeDeps();
    expect((await serve(deps)(jsonRequest({ path: '/api/terminals' }))).status).toBe(200);
  });

  it('a failing tool execution answers the fixed sentence with a request ID and gives the host the real error', async () => {
    const onInternalError = vi.fn();
    const toolExecutor = { execute: async () => ({ status: 'failed', error: new Error('spawn failed at /opt/secret/pty') }) } as unknown as ToolExecutor;
    const { deps } = makeDeps({ toolExecutor, onInternalError });
    const response = await serve(deps)(jsonRequest({ path: '/api/terminals', method: 'POST' }, { body: { resourceRef: 'proj-1' } }));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain('The terminal could not be opened.');
    expect(text).not.toContain('/opt/secret/pty');
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ source: 'terminal-create', error: expect.objectContaining({ message: 'spawn failed at /opt/secret/pty' }) }));
  });
});

describe('GET /api/terminals/:id/stream', () => {
  const open = (deps: TerminalsHttpDeps, { id = 'term-1', headers = {}, query = '', signal }: { id?: string; headers?: Record<string, string>; query?: string; signal?: AbortSignal } = {}) =>
    serve(deps)(new Request(`http://local/api/terminals/${id}/stream${query}`, { headers, ...(signal ? { signal } : {}) }));
  const createSession = async (deps: TerminalsHttpDeps): Promise<string> => {
    const created = await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    if (!created.ok) throw new Error('create failed');
    return created.value.id;
  };

  it('rejects a cross-origin request before touching the manager or opening the stream', async () => {
    testOriginPolicy.set({ allow: false });
    const { deps, manager } = makeDeps();
    const attachSpy = vi.spyOn(manager, 'attach');
    const response = await open(deps, { headers: { origin: 'http://evil.example' } });
    expect([response.status, (await response.json() as { error: { code: string } }).error.code]).toEqual([403, 'FORBIDDEN']);
    expect(attachSpy).not.toHaveBeenCalled();
  });

  it('answers a JSON 404 NOT_FOUND, not a stream, when the terminal is unknown', async () => {
    const { deps } = makeDeps();
    const response = await open(deps, { id: 'missing' });
    expect([response.status, response.headers.get('content-type'), await response.json()]).toEqual([404, 'application/json; charset=utf-8', { error: { code: 'NOT_FOUND', message: 'terminal "missing" was not found' } }]);
  });

  it("404s for another principal's terminal", async () => {
    const { deps } = makeDeps();
    const id = await createSession(deps);
    expect((await open({ ...deps, principal: bob }, { id })).status).toBe(404);
  });

  it('keeps the connection open on a running terminal and delivers live output', async () => {
    const { deps, pty } = makeDeps();
    const id = await createSession(deps);
    const response = await open(deps, { id });
    expect([response.status, response.headers.get('content-type')]).toEqual([200, 'text/event-stream; charset=utf-8']);
    const frames = readFrames({ response });
    pty.emitData('hello');
    expect((await frames.next())[0]).toContain('event: data');
    await frames.cancel();
  });

  it('ends the stream right after the exit frame once a live terminal exits mid-stream', async () => {
    const { deps, pty } = makeDeps();
    const id = await createSession(deps);
    const frames = readFrames({ response: await open(deps, { id }) });
    expect(await frames.stillSilent()).toBe(true);
    pty.exitCb?.({ exitCode: 0 });
    const all = await frames.rest();
    expect(all.at(-1)).toContain('event: exit');
  });

  it('detaches once and stops delivering output when the client leaves', async () => {
    const { deps, manager, pty } = makeDeps();
    const id = await createSession(deps);
    const detachSpy = vi.spyOn(manager, 'detach');
    const controller = new AbortController();
    const response = await open(deps, { id, signal: controller.signal });
    const frames = readFrames({ response });
    controller.abort();
    await frames.cancel();
    await vi.waitFor(() => expect(detachSpy).toHaveBeenCalledTimes(1));
    expect(detachSpy).toHaveBeenCalledWith({ id, sink: expect.anything() });
    pty.emitData('should-not-be-delivered');
    expect(detachSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['prefers the Last-Event-ID header over the afterCursor query parameter', { 'last-event-id': '5' }, '?afterCursor=1', 5],
    ['falls back to the afterCursor query parameter', {}, '?afterCursor=3', 3],
    ['uses lastEventId 0 when neither header nor query parameter is present', {}, '', 0],
  ])('%s', async (_label, headers, query, expected) => {
    const { deps, manager } = makeDeps();
    const id = await createSession(deps);
    const attachSpy = vi.spyOn(manager, 'attach');
    const response = await open(deps, { id, headers, query });
    await readFrames({ response }).cancel();
    expect(attachSpy).toHaveBeenCalledWith({ principal: alice, id, lastEventId: expected, sink: expect.anything() });
  });

  it('replays the buffered scrollback, then the exit, then ends, for an already-exited terminal (the deferred-end gate it replaces existed for exactly this)', async () => {
    const { deps, pty } = makeDeps();
    const id = await createSession(deps);
    pty.emitData('line one');
    pty.emitData('line two');
    pty.exitCb?.({ exitCode: 0 });
    const frames = await readFrames({ response: await open(deps, { id }) }).rest();
    expect(frames.map((frame) => frame.split('\n')[1])).toEqual(['event: data', 'event: exit']);
    expect(frames.join('')).toContain('line two');
  });

  it('delivers a replay longer than the live-frame cap whole', async () => {
    const { deps, manager } = makeDeps();
    vi.spyOn(manager, 'attach').mockImplementation(({ sink: target }) => {
      for (let eventId = 1; eventId <= 1500; eventId += 1) target.send('output', { data: `line ${eventId}` }, eventId);
      target.send('exit', { code: 0, signal: null }, 1501);
      target.end();
      return 'ended';
    });
    const frames = await readFrames({ response: await open(deps) }).rest();
    expect(frames).toHaveLength(1501);
  });
});

/**
 * Characterization truth table for `parseTerminalCreate` (SEC: its output becomes the spawn
 * request's cwd lookup key, pty size and shell binary). Pinned on the pre-refactor code so the
 * complexity split is provably behaviour-identical: every refusal's exact error, the field
 * precedence (first failing field wins, in resourceRef → detail → cols → rows → shell order),
 * and which odd inputs are accepted.
 */
describe('terminalCreateRoute.parse — characterization', () => {
  const parse = (body: unknown) => terminalCreateRoute.parse({ body, query: {}, params: {} });
  const bad = (message: string) => ({ ok: false, error: { code: 'BAD_REQUEST', message } });
  const resourceRefError = {
    ok: false,
    error: {
      code: 'BAD_REQUEST',
      message: 'resourceRef is required',
      details: { kind: 'validation', issues: [{ path: 'resourceRef', message: 'required non-empty string' }] },
    },
  };

  it.each([[null], [[]], [['resourceRef']], [42], [undefined]])('rejects a non-object body %j', (body) => {
    expect(parse(body)).toEqual(bad('body must be a JSON object'));
  });

  it.each([[{}], [{ resourceRef: '' }], [{ resourceRef: 42 }], [{ resourceRef: null }], [{ resourceRef: ['r1'] }]])(
    'rejects an invalid resourceRef %j with a structured issue',
    (body) => {
      expect(parse(body)).toEqual(resourceRefError);
    },
  );

  it.each([[''], [7], [null], [false], [{}]])('rejects detail %j', (detail) => {
    expect(parse({ resourceRef: 'r1', detail })).toEqual(bad('detail must be a non-empty string when provided'));
  });

  it.each([['wide'], [null], [true], [[80]]])('rejects cols %j', (cols) => {
    expect(parse({ resourceRef: 'r1', cols })).toEqual(bad('cols must be a number when provided'));
  });

  it.each([['tall'], [null], [true], [[24]]])('rejects rows %j', (rows) => {
    expect(parse({ resourceRef: 'r1', rows })).toEqual(bad('rows must be a number when provided'));
  });

  it.each([[''], [3], [null], [['/bin/sh']]])('rejects shell %j', (shell) => {
    expect(parse({ resourceRef: 'r1', shell })).toEqual(bad('shell must be a non-empty string when provided'));
  });

  it('reports resourceRef before detail when both are invalid', () => {
    expect(parse({ resourceRef: '', detail: '' })).toEqual(resourceRefError);
  });

  it('reports detail before cols when both are invalid', () => {
    expect(parse({ resourceRef: 'r1', detail: '', cols: 'x' })).toEqual(bad('detail must be a non-empty string when provided'));
  });

  it('reports cols before rows when both are invalid', () => {
    expect(parse({ resourceRef: 'r1', cols: 'x', rows: 'y' })).toEqual(bad('cols must be a number when provided'));
  });

  it('reports rows before shell when both are invalid', () => {
    expect(parse({ resourceRef: 'r1', rows: 'y', shell: '' })).toEqual(bad('rows must be a number when provided'));
  });

  it('omits explicitly-undefined optional fields rather than carrying them as undefined', () => {
    const result = parse({ resourceRef: 'r1', detail: undefined, cols: undefined, rows: undefined, shell: undefined });
    expect(result).toEqual({ ok: true, value: { resourceRef: 'r1' } });
    expect(result.ok && Object.keys(result.value)).toEqual(['resourceRef']);
  });

  it('drops unknown body fields (e.g. a caller-supplied cwd or env never reaches the spawn request)', () => {
    const result = parse({ resourceRef: 'r1', cwd: '/etc', env: { PATH: '/evil' }, shell: '/bin/bash' });
    expect(result).toEqual({ ok: true, value: { resourceRef: 'r1', shell: '/bin/bash' } });
  });

  it('keeps cols/rows of 0 (falsy but defined)', () => {
    expect(parse({ resourceRef: 'r1', cols: 0, rows: 0 })).toEqual({ ok: true, value: { resourceRef: 'r1', cols: 0, rows: 0 } });
  });

  it('accepts non-finite, negative and fractional cols/rows unchecked (reported, not fixed)', () => {
    expect(parse({ resourceRef: 'r1', cols: Number.NaN, rows: Number.POSITIVE_INFINITY })).toEqual({
      ok: true,
      value: { resourceRef: 'r1', cols: Number.NaN, rows: Number.POSITIVE_INFINITY },
    });
    expect(parse({ resourceRef: 'r1', cols: -5, rows: 1.5 })).toEqual({ ok: true, value: { resourceRef: 'r1', cols: -5, rows: 1.5 } });
  });

  it('accepts any non-empty shell string, including a relative or argument-bearing one (reported, not fixed: only the terminal.create tool policy gates which binary runs)', () => {
    expect(parse({ resourceRef: 'r1', shell: 'bash -c id' })).toEqual({ ok: true, value: { resourceRef: 'r1', shell: 'bash -c id' } });
    expect(parse({ resourceRef: 'r1', shell: '../bin/sh' })).toEqual({ ok: true, value: { resourceRef: 'r1', shell: '../bin/sh' } });
  });
});

describe('terminalCreateRoute.handle — characterization', () => {
  /** A typed `ToolExecutor` fake whose `execute` records the call and returns `result`; the other methods are never reached by the create route. */
  function recordingExecutor(result: ToolExecutionResult): { executor: ToolExecutor; execute: ReturnType<typeof vi.fn<ToolExecutor['execute']>> } {
    const execute = vi.fn<ToolExecutor['execute']>(async () => result);
    return { executor: { execute, resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null }, execute };
  }

  it('passes no detail key to the resolver when detail is absent', async () => {
    const resolveRoot = vi.fn<WorkspaceRootResolver>(() => '/work');
    const { deps } = makeDeps({ resolveRoot });
    await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1' }, deps });
    expect(Object.keys(resolveRoot.mock.calls[0]![0].request)).toEqual(['resourceRef']);
  });

  it('never calls the tool executor when the resolver denies', async () => {
    const { executor, execute } = recordingExecutor({ executionId: 'e1', status: 'denied' });
    const { deps } = makeDeps({ resolveRoot: () => null, toolExecutor: executor });
    const result = await terminalCreateRoute.handle({ input: { resourceRef: 'gone' }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'resource "gone" was not found' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('sends exactly resourceRef + resolved cwd (+ supplied cols/rows/shell) as the terminal.create tool input', async () => {
    const { executor, execute } = recordingExecutor({ executionId: 'e1', status: 'denied' });
    const { deps } = makeDeps({ resolveRoot: () => '/resolved/work', toolExecutor: executor });
    await terminalCreateRoute.handle({ input: { resourceRef: 'proj-1', detail: 'sub', rows: 30 }, deps });
    const call = execute.mock.calls[0]![0];
    expect(call.toolId).toBe(TERMINAL_CREATE_TOOL_ID);
    expect(call.principal).toBe(alice);
    expect(call.input).toEqual({ resourceRef: 'proj-1', cwd: '/resolved/work', rows: 30 });
    expect(Object.keys(call.input as object)).toEqual(['resourceRef', 'cwd', 'rows']);
  });
});

describe('terminalResizeRoute.parse — characterization', () => {
  it('coerces non-number cols/rows through Number() and accepts the result (reported, not fixed)', () => {
    expect(terminalResizeRoute.parse({ body: { cols: '120', rows: null }, query: {}, params: { id: 't1' } })).toEqual({
      ok: true,
      value: { id: 't1', cols: 120, rows: 0 },
    });
  });

  it('rejects when rows alone is non-finite', () => {
    expect(terminalResizeRoute.parse({ body: { cols: 80 }, query: {}, params: { id: 't1' } })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'cols and rows (numbers) are required' },
    });
  });
});
