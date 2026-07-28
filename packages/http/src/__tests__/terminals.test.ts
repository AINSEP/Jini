import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolRegistry, type Principal, type ToolPolicy, type ToolRegistry } from '@injini/core';
import {
  createTerminalSessionManager,
  createTerminalToolRegistrations,
  createToolExecutor,
  TERMINAL_CREATE_TOOL_ID,
  type TerminalSessionManager,
  type ToolExecutor,
} from '@injini/daemon';
import type { PtyProcess, PtySpawn } from '@injini/platform';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  actionResultToApiResult,
  createDeferredEndGate,
  registerTerminalEventStream,
  registerTerminalRoutes,
  terminalCreateRoute,
  terminalDeleteRoute,
  terminalKillRoute,
  terminalListRoute,
  terminalResizeRoute,
  terminalStdinRoute,
  type TerminalsHttpDeps,
} from '../terminals.js';
import type { WorkspaceRootResolver } from '../workspace-root.js';

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

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

/** Minimal fake of the raw Express req/res surface `registerTerminalEventStream` uses directly (no Adapter in between) — mirrors `runs.test.ts`'s `makeSseReq`/`makeSseRes`. */
function makeSseReq(overrides: { id?: string; headers?: Record<string, string>; query?: Record<string, unknown> } = {}) {
  const headers = overrides.headers ?? {};
  return {
    params: { id: overrides.id ?? 'term-1' },
    query: overrides.query ?? {},
    get: (name: string) => headers[name.toLowerCase()],
  };
}

function makeSseRes() {
  const closeListeners: Array<() => void> = [];
  const drainListeners: Array<() => void> = [];
  const res = {
    write: vi.fn((_chunk: string) => true),
    status: vi.fn().mockReturnThis(),
    statusCode: 0,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    end: vi.fn(() => {
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

const adapter = { resolvedPortRef: { current: 7456 } };
const alice: Principal = { id: 'alice' };
const bob: Principal = { id: 'bob' };

// A fake PtySpawn/PtyProcess pair — no real node-pty/subprocess anywhere in this test file. This
// exercises the real `@injini/daemon` `TerminalSessionManager` (ownership + lock) and a real
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
  resize(): void {}
  kill(): void {}
  emitData(chunk: string): void {
    this.dataCb?.(chunk);
  }
}

function makeManager(): { manager: TerminalSessionManager; pty: FakePty } {
  const pty = new FakePty();
  const spawnPty: PtySpawn = () => pty;
  const manager = createTerminalSessionManager({ loadSpawnPty: async () => spawnPty });
  return { manager, pty };
}

/** Real `ToolExecutor`/`ToolRegistry` with `terminal.create` registered under the given policy — mirrors `db-ops.test.ts`'s `makeExecutor`. */
function makeExecutor(manager: TerminalSessionManager, policy?: ToolPolicy): { executor: ToolExecutor; registry: ToolRegistry } {
  const registry = createToolRegistry();
  const regs = createTerminalToolRegistrations(policy === undefined ? { manager } : { manager, policy });
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
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
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
    const result = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
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
    const registry = createToolRegistry();
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
    const result = await terminalCreateRoute.handle({ resourceRef: 'proj-1', cols: 100, rows: 40, shell: '/bin/zsh' }, deps);
    expect(result.ok).toBe(true);
    expect(seenInputs[0]).toMatchObject({ cols: 100, rows: 40, shell: '/bin/zsh' });
  });

  it('forwards resourceRef/detail into the workspace-root resolver', async () => {
    const resolveRoot = vi.fn(() => '/work') as WorkspaceRootResolver;
    const { deps } = makeDeps({ resolveRoot });
    await terminalCreateRoute.handle({ resourceRef: 'proj-1', detail: 'src/index.ts' }, deps);
    expect(resolveRoot).toHaveBeenCalledWith({ resourceRef: 'proj-1', detail: 'src/index.ts' });
  });

  it('404s when the workspace-root resolver denies (the default, zero-config resolver denies everything)', async () => {
    const { manager } = makeManager();
    const { executor } = makeExecutor(manager, { authorize: () => 'allow' });
    // No `resolveRoot` at all — proves the real production default (`denyAllWorkspaceRoots`)
    // applies, not a test fixture's own convenience default.
    const deps: TerminalsHttpDeps = { manager, toolExecutor: executor, principal: alice };
    const result = await terminalCreateRoute.handle({ resourceRef: 'unknown' }, deps);
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
    await expect(terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps)).rejects.toThrow('resolver exploded');
  });

  it('auth-denial: the real deny-by-default terminal.create policy blocks creation, and no session is spawned', async () => {
    const { manager } = makeManager();
    const { executor } = makeExecutor(manager); // no policy override — real denyAllTerminalCreatePolicy applies
    const deps: TerminalsHttpDeps = { manager, toolExecutor: executor, principal: alice, resolveRoot: () => '/work' };
    const result = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied by policy' },
    });
    expect(manager.list(alice)).toEqual([]);
  });

  it('a failed tool execution redacts the real error and reports a correlation id (SEC-005), while invoking onInternalError with the real error', async () => {
    const registry = createToolRegistry();
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
    const result = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
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
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = createToolRegistry();
    registry.register({
      descriptor: { id: TERMINAL_CREATE_TOOL_ID },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        throw new Error('boom');
      },
    });
    const executor = createToolExecutor({ registry });
    const deps: TerminalsHttpDeps = { manager: makeManager().manager, toolExecutor: executor, principal: alice, resolveRoot: () => '/work' };
    await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('reports a denied confirmation the same as a policy denial', async () => {
    const { manager } = makeManager();
    const registry = createToolRegistry();
    const regs = createTerminalToolRegistrations({ manager, policy: { authorize: () => 'allow' }, requiresConfirmation: true });
    registry.register(regs.create);
    const executor = createToolExecutor({ registry, delegate: { onConfirm: () => 'deny' } });
    const deps: TerminalsHttpDeps = { manager, toolExecutor: executor, principal: alice, resolveRoot: () => '/work' };
    const result = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
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
    const result = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) },
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
    const result = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) },
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
    await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    await terminalCreateRoute.handle({ resourceRef: 'proj-2' }, deps);
    const result = await terminalListRoute.handle({ resourceRef: 'proj-1' }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.terminals).toHaveLength(1);
      expect(result.value.terminals[0]!.resourceRef).toBe('proj-1');
    }
  });

  it("never returns another principal's sessions", async () => {
    const { deps, manager } = makeDeps();
    await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    expect(manager.list(bob)).toEqual([]);
  });
});

describe('actionResultToApiResult', () => {
  it("omits `terminal` entirely when the action result's session is null (a real race: the session was killed between the ownership check and the critical section — see @injini/daemon's currentSnapshot)", () => {
    const result = actionResultToApiResult({ status: 'ok', ok: false, session: null }, 'terminal "t1" was not found');
    expect(result).toEqual({ ok: true, value: { ok: false } });
  });

  it('includes `terminal` when the action result has a real session', () => {
    const session = { id: 't1', status: 'running', resourceRef: null } as any;
    const result = actionResultToApiResult({ status: 'ok', ok: true, session }, 'unused');
    expect(result).toEqual({ ok: true, value: { ok: true, terminal: session } });
  });

  it('maps not-found to a NOT_FOUND api error with the given message', () => {
    const result = actionResultToApiResult({ status: 'not-found' }, 'terminal "t1" was not found');
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
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const result = await terminalStdinRoute.handle({ id, data: 'ls\n' }, deps);
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
    const result = await terminalStdinRoute.handle({ id: 'missing', data: 'x' }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'terminal "missing" was not found' } });
  });

  it("404s for another principal's terminal — never a distinguishable forbidden", async () => {
    const { deps } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const foreignDeps: TerminalsHttpDeps = { ...deps, principal: bob };
    const result = await terminalStdinRoute.handle({ id, data: 'x' }, foreignDeps);
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
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const result = await terminalResizeRoute.handle({ id, cols: 120, rows: 45 }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(true);
      expect(result.value.terminal?.cols).toBe(120);
      expect(result.value.terminal?.rows).toBe(45);
    }
  });

  it('404s for an unknown terminal id', async () => {
    const { deps } = makeDeps();
    const result = await terminalResizeRoute.handle({ id: 'missing', cols: 10, rows: 10 }, deps);
    expect(result.ok).toBe(false);
  });
});

describe('terminalKillRoute / terminalDeleteRoute', () => {
  it('kill: sends SIGTERM and reports the updated terminal', async () => {
    const { deps } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const result = await terminalKillRoute.handle(id, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ok).toBe(true);
  });

  it('delete: behaves identically to kill', async () => {
    const { deps } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const result = await terminalDeleteRoute.handle(id, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ok).toBe(true);
  });

  it('404s for an unknown terminal id', async () => {
    const { deps } = makeDeps();
    const result = await terminalKillRoute.handle('missing', deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'terminal "missing" was not found' } });
  });
});

describe('registerTerminalRoutes', () => {
  it('mounts every documented route', () => {
    const app = makeApp();
    const { deps } = makeDeps();
    registerTerminalRoutes(app as any, deps, adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(
      [
        'GET /api/terminals',
        'POST /api/terminals',
        'POST /api/terminals/:id/stdin',
        'POST /api/terminals/:id/resize',
        'POST /api/terminals/:id/kill',
        'DELETE /api/terminals/:id',
        'GET /api/terminals/:id/stream',
      ].sort(),
    );
  });

  it('mounted create route: a same-origin request reaches parse, the executor, and returns 201', async () => {
    const app = makeApp();
    const { deps } = makeDeps();
    registerTerminalRoutes(app as any, deps, adapter);
    const res = makeRes();
    await app.handlers['POST /api/terminals']!({ body: { resourceRef: 'proj-1' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('blocks a cross-origin create request before the tool executor ever runs', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    const { deps, manager } = makeDeps();
    registerTerminalRoutes(app as any, deps, adapter);
    const res = makeRes();
    await app.handlers['POST /api/terminals']!({ body: { resourceRef: 'proj-1' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(manager.list(alice)).toEqual([]);
  });

  it('the list route does not require same-origin (matches runListRoute precedent)', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    const { deps } = makeDeps();
    registerTerminalRoutes(app as any, deps, adapter);
    const res = makeRes();
    await app.handlers['GET /api/terminals']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('createDeferredEndGate', () => {
  function makeFakeChannel(): { end: ReturnType<typeof vi.fn> } {
    return { end: vi.fn() };
  }

  it('defers end() until markOpened() when end() is called first (the already-exited-at-attach-time replay path)', () => {
    const channel = makeFakeChannel();
    const gate = createDeferredEndGate(channel);

    gate.end();
    expect(channel.end).not.toHaveBeenCalled();

    gate.markOpened();
    expect(channel.end).toHaveBeenCalledTimes(1);
  });

  it('ends immediately when end() is called after markOpened() (a live session that exits post-open)', () => {
    const channel = makeFakeChannel();
    const gate = createDeferredEndGate(channel);

    gate.markOpened();
    expect(channel.end).not.toHaveBeenCalled();

    gate.end();
    expect(channel.end).toHaveBeenCalledTimes(1);
  });

  it('never calls channel.end() when end() is never called at all', () => {
    const channel = makeFakeChannel();
    const gate = createDeferredEndGate(channel);

    gate.markOpened();
    expect(channel.end).not.toHaveBeenCalled();
  });

  it('does not double-fire channel.end() when markOpened() runs with no pending end(), even if end() arrives later', () => {
    const channel = makeFakeChannel();
    const gate = createDeferredEndGate(channel);

    gate.markOpened();
    gate.end();
    expect(channel.end).toHaveBeenCalledTimes(1);
  });
});

describe('registerTerminalEventStream', () => {
  function mount(deps: TerminalsHttpDeps) {
    const app = makeApp();
    registerTerminalEventStream(app as any, deps);
    return app.handlers['GET /api/terminals/:id/stream']!;
  }

  it('responds 400 without touching the manager when id is missing', () => {
    const { deps, manager } = makeDeps();
    const attachSpy = vi.spyOn(manager, 'attach');
    const handler = mount(deps);
    const res = makeSseRes();
    handler(makeSseReq({ id: '' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(attachSpy).not.toHaveBeenCalled();
  });

  it('sends 404 NOT_FOUND without ever calling res.end() first when the terminal is unknown', () => {
    const { deps } = makeDeps();
    const handler = mount(deps);
    const res = makeSseRes();
    handler(makeSseReq({ id: 'missing' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'terminal "missing" was not found' } });
    expect(res.end).not.toHaveBeenCalled();
  });

  it("404s for another principal's terminal", async () => {
    const { deps } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const handler = mount({ ...deps, principal: bob });
    const res = makeSseRes();
    handler(makeSseReq({ id }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('writes SSE headers and keeps the connection open on a running terminal, then delivers live output', async () => {
    const { deps, pty } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const handler = mount(deps);
    const res = makeSseRes();
    handler(makeSseReq({ id }), res);

    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    expect(res.flushHeaders).toHaveBeenCalledTimes(1);
    expect(res.end).not.toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith('close', expect.any(Function));

    pty.emitData('hello');
    await vi.waitFor(() => expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: data')));
  });

  it('ends the stream immediately once an already-open (live) terminal exits mid-stream', async () => {
    const { deps, pty } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const handler = mount(deps);
    const res = makeSseRes();
    handler(makeSseReq({ id }), res);
    expect(res.end).not.toHaveBeenCalled();

    pty.exitCb?.({ exitCode: 0 });
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: exit'));
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('ends the stream and stops delivering output once the client disconnects', async () => {
    const { deps, manager, pty } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const detachSpy = vi.spyOn(manager, 'detach');
    const handler = mount(deps);
    const res = makeSseRes();
    handler(makeSseReq({ id }), res);
    res.emitClose();
    expect(detachSpy).toHaveBeenCalledWith(id, expect.anything());
    res.write.mockClear();
    pty.emitData('should-not-be-delivered');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(res.write).not.toHaveBeenCalled();
  });

  it('prefers the Last-Event-ID header over the afterCursor query parameter', async () => {
    const { deps, manager } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const attachSpy = vi.spyOn(manager, 'attach');
    const handler = mount(deps);
    const res = makeSseRes();
    handler(makeSseReq({ id, headers: { 'last-event-id': '5' }, query: { afterCursor: '1' } }), res);
    expect(attachSpy).toHaveBeenCalledWith(alice, id, 5, expect.anything());
  });

  it('uses lastEventId 0 when neither header nor query parameter is present', async () => {
    const { deps, manager } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    const attachSpy = vi.spyOn(manager, 'attach');
    const handler = mount(deps);
    const res = makeSseRes();
    handler(makeSseReq({ id }), res);
    expect(attachSpy).toHaveBeenCalledWith(alice, id, 0, expect.anything());
  });

  it('replays buffered scrollback and ends immediately for an already-exited terminal', async () => {
    const { deps, manager, pty } = makeDeps();
    const created = await terminalCreateRoute.handle({ resourceRef: 'proj-1' }, deps);
    const id = created.ok ? created.value.id : (() => { throw new Error('create failed'); })();
    pty.exitCb?.({ exitCode: 0 });
    const handler = mount(deps);
    const res = makeSseRes();
    handler(makeSseReq({ id }), res);
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: exit'));
    expect(res.end).toHaveBeenCalledTimes(1);
    void manager;
  });
});
