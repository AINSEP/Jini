import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolRegistry, type Principal, type ToolPolicy, type ToolRegistry } from '@jini-ai/core';
import type {
  ensureSpawnHelperExecutable as EnsureSpawnHelperExecutableFn,
  spawnHelperCandidatePaths as SpawnHelperCandidatePathsFn,
  PtyProcess,
  PtySpawn,
  PtySpawnOptions,
  TerminalSseSink,
} from '@jini-ai/platform';
import { createToolExecutor, type ToolExecutor } from '../tool-executor.js';
import {
  createTerminalSessionManager,
  createTerminalToolRegistrations,
  denyAllTerminalCreatePolicy,
  loadRealSpawnPty,
  TERMINAL_CREATE_TOOL_ID,
  type TerminalSessionActionResult,
  type TerminalSessionInfo,
  type TerminalSessionManager,
} from '../terminal-session.js';

// `loadRealSpawnPty` touches the real filesystem (`ensureSpawnHelperExecutable`) and dynamically
// imports the real `node-pty` addon — mocked out here so the daemon test suite never spawns a
// real OS process or mutates real files on disk, matching this codebase's "no real subprocess or
// filesystem by default in tests" convention (see `agent-executor.ts`'s injectable `spawn`).
const spawnHelperCandidatePathsMock = vi.fn<typeof SpawnHelperCandidatePathsFn>(() => ['/fake/candidate/spawn-helper']);
const ensureSpawnHelperExecutableMock = vi.fn<typeof EnsureSpawnHelperExecutableFn>();
vi.mock('@jini-ai/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jini-ai/platform')>();
  return {
    ...actual,
    spawnHelperCandidatePaths: (...args: Parameters<typeof actual.spawnHelperCandidatePaths>) =>
      spawnHelperCandidatePathsMock(...args),
    ensureSpawnHelperExecutable: (...args: Parameters<typeof actual.ensureSpawnHelperExecutable>) =>
      ensureSpawnHelperExecutableMock(...args),
  };
});

class FakeIPty {
  dataListener: ((chunk: string) => void) | null = null;
  exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;
  writeCalls: string[] = [];
  resizeCalls: Array<[number, number]> = [];
  killCalls: Array<string | undefined> = [];

  onData(cb: (chunk: string) => void) {
    this.dataListener = cb;
    return { dispose: () => {} };
  }
  onExit(cb: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListener = cb;
    return { dispose: () => {} };
  }
  write(input: string): void {
    this.writeCalls.push(input);
  }
  resize(cols: number, rows: number): void {
    this.resizeCalls.push([cols, rows]);
  }
  kill(signal?: string): void {
    this.killCalls.push(signal);
  }
  emitData(chunk: string): void {
    this.dataListener?.(chunk);
  }
  emitExit(exitCode: number, signal?: number): void {
    this.exitListener?.(signal === undefined ? { exitCode } : { exitCode, signal });
  }
}

const nodePtySpawnMock = vi.fn<(shell: string, args: string[], options: PtySpawnOptions) => FakeIPty>();
vi.mock('node-pty', () => ({
  spawn: (shell: string, args: string[], options: PtySpawnOptions) => nodePtySpawnMock(shell, args, options),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('loadRealSpawnPty', () => {
  it('repairs the spawn-helper executable bit using a resolver anchored at this module before the first import, and adapts a real IPty to PtyProcess', async () => {
    const fakePty = new FakeIPty();
    nodePtySpawnMock.mockReturnValue(fakePty);

    const spawnPty = await loadRealSpawnPty();

    expect(ensureSpawnHelperExecutableMock).toHaveBeenCalledWith(['/fake/candidate/spawn-helper']);
    const [candidatesCallOptions] = spawnHelperCandidatePathsMock.mock.calls[0]!;
    expect(typeof candidatesCallOptions?.resolve).toBe('function');
    // The injected resolver must actually resolve something (this module's own `node-pty`
    // dependency), not silently no-op — proving it is anchored at `@jini-ai/daemon`, which declares
    // `node-pty`, rather than `@jini-ai/platform`'s own default resolver, which would throw since
    // that package deliberately does not depend on `node-pty`.
    expect(candidatesCallOptions!.resolve!('node-pty')).toEqual(expect.stringContaining('node-pty'));

    const process: PtyProcess = spawnPty('/bin/bash', ['-l'], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: '/work',
      env: {},
    });
    expect(nodePtySpawnMock).toHaveBeenCalledWith('/bin/bash', ['-l'], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: '/work',
      env: {},
    });

    const dataChunks: string[] = [];
    process.onData((chunk) => dataChunks.push(chunk));
    fakePty.emitData('hello');
    expect(dataChunks).toEqual(['hello']);

    const exits: Array<{ exitCode: number; signal?: number }> = [];
    process.onExit((event) => exits.push(event));
    fakePty.emitExit(0, 15);
    expect(exits).toEqual([{ exitCode: 0, signal: 15 }]);

    process.write('echo hi\n');
    expect(fakePty.writeCalls).toEqual(['echo hi\n']);

    process.resize(100, 40);
    expect(fakePty.resizeCalls).toEqual([[100, 40]]);

    process.kill('SIGTERM');
    expect(fakePty.killCalls).toEqual(['SIGTERM']);
    process.kill();
    expect(fakePty.killCalls).toEqual(['SIGTERM', undefined]);
  });
});

describe('denyAllTerminalCreatePolicy', () => {
  it('denies regardless of principal, tool, or input', () => {
    expect(
      denyAllTerminalCreatePolicy.authorize({
        principal: { id: 'anyone', roles: ['admin'] },
        run: { id: 'r1' },
        tool: { id: TERMINAL_CREATE_TOOL_ID },
        input: { cwd: '/work' },
      }),
    ).toBe('deny');
  });
});

// --- createTerminalSessionManager: built on the REAL @jini-ai/platform TerminalService (its own
// ring-buffer/coalescing/TTL logic is already covered by that package's own test suite — not
// re-tested here) with an injected fake PtySpawn, so every test below exercises this module's
// actual new behavior (ownership gating, the kill/write/resize lock, resourceRef bookkeeping)
// against the real engine it wraps, without ever touching a real OS process.

function fakeSpawnPty(): { spawnPty: PtySpawn; ptys: Map<string, FakeIPty> } {
  const ptys = new Map<string, FakeIPty>();
  let counter = 0;
  const spawnPty: PtySpawn = () => {
    const pty = new FakeIPty();
    ptys.set(String(counter++), pty);
    return pty as unknown as PtyProcess;
  };
  return { spawnPty, ptys };
}

function lastPty(ptys: Map<string, FakeIPty>): FakeIPty {
  const values = Array.from(ptys.values());
  return values[values.length - 1]!;
}

function makeManager(overrides: Parameters<typeof createTerminalSessionManager>[0] = {}) {
  const { spawnPty, ptys } = fakeSpawnPty();
  const manager = createTerminalSessionManager({ loadSpawnPty: async () => spawnPty, ...overrides });
  return { manager, ptys };
}

const alice: Principal = { id: 'alice' };
const bob: Principal = { id: 'bob' };

describe('createTerminalSessionManager — create/get/list', () => {
  it('create() returns a session shape with no origin-only grouping field, and records resourceRef/ownership', async () => {
    const { manager } = makeManager();
    const session = await manager.create(alice, { resourceRef: 'proj-1', cwd: '/work' });
    expect(Object.keys(session).sort()).toEqual(
      ['cols', 'createdAt', 'cwd', 'exitCode', 'id', 'resourceRef', 'rows', 'shell', 'signal', 'status', 'updatedAt'].sort(),
    );
    expect(session.resourceRef).toBe('proj-1');
    expect(session.status).toBe('running');
  });

  it('create() defaults resourceRef to null when omitted', async () => {
    const { manager } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    expect(session.resourceRef).toBeNull();
  });

  it('create() forwards explicit cols/rows/shell through to the underlying engine', async () => {
    const { manager } = makeManager();
    const session = await manager.create(alice, { cwd: '/work', cols: 132, rows: 43, shell: '/bin/zsh' });
    expect(session.cols).toBe(132);
    expect(session.rows).toBe(43);
    expect(session.shell).toBe('/bin/zsh');
  });

  it('createTerminalSessionManager() defaults loadSpawnPty to loadRealSpawnPty (fully mocked node-pty/spawn-helper machinery), and forwards every tuning knob to the underlying engine', async () => {
    const fakePty = new FakeIPty();
    nodePtySpawnMock.mockReturnValue(fakePty);
    const manager = createTerminalSessionManager({
      maxEvents: 10,
      maxBufferBytes: 1024,
      exitTailBytes: 256,
      flushIntervalMs: 1,
      flushThresholdBytes: 64,
      shutdownGraceMs: 1,
    });
    const session = await manager.create(alice, { cwd: '/work' });
    expect(session.status).toBe('running');
    expect(nodePtySpawnMock).toHaveBeenCalledTimes(1);
  });

  it('get() returns not-found for an unknown id', () => {
    const { manager } = makeManager();
    expect(manager.get(alice, 'missing')).toEqual({ status: 'not-found' });
  });

  it("get() returns not-found for a session owned by a different principal (never a distinguishable 'forbidden')", async () => {
    const { manager } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    expect(manager.get(bob, session.id)).toEqual({ status: 'not-found' });
  });

  it('get() returns the session for its owning principal', async () => {
    const { manager } = makeManager();
    const created = await manager.create(alice, { cwd: '/work' });
    expect(manager.get(alice, created.id)).toEqual({ status: 'ok', session: created });
  });

  it('list() scopes to the calling principal only', async () => {
    const { manager } = makeManager();
    const aliceSession = await manager.create(alice, { cwd: '/a' });
    await manager.create(bob, { cwd: '/b' });
    expect(manager.list(alice).map((s) => s.id)).toEqual([aliceSession.id]);
  });

  it('list() narrows by resourceRef when provided', async () => {
    const { manager } = makeManager();
    const match = await manager.create(alice, { resourceRef: 'r1', cwd: '/a' });
    await manager.create(alice, { resourceRef: 'r2', cwd: '/b' });
    expect(manager.list(alice, { resourceRef: 'r1' }).map((s) => s.id)).toEqual([match.id]);
  });

  it('get() prunes and reports not-found once the underlying service has reaped an exited session past its TTL', async () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys } = makeManager({ ttlMs: 10 });
      const session = await manager.create(alice, { cwd: '/work' });
      const pty = lastPty(ptys);
      pty.emitExit(0, undefined);
      vi.advanceTimersByTime(11);
      expect(manager.get(alice, session.id)).toEqual({ status: 'not-found' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createTerminalSessionManager — write/resize/kill ownership + the kill/write/resize lock', () => {
  it('write() returns not-found for an unknown session', async () => {
    const { manager } = makeManager();
    expect(await manager.write(alice, 'missing', 'x')).toEqual({ status: 'not-found' });
  });

  it("write() returns not-found for another principal's session, and never reaches the pty", async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    expect(await manager.write(bob, session.id, 'x')).toEqual({ status: 'not-found' });
    expect(lastPty(ptys).writeCalls).toEqual([]);
  });

  it('write() forwards to the pty and reports ok:true for the owning principal', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    const result = await manager.write(alice, session.id, 'ls\n');
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.ok).toBe(true);
    expect(lastPty(ptys).writeCalls).toEqual(['ls\n']);
  });

  it('resize() forwards to the pty and reports the updated session', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    const result = await manager.resize(alice, session.id, 120, 40);
    expect(result).toEqual({
      status: 'ok',
      ok: true,
      session: { ...session, cols: 120, rows: 40, updatedAt: expect.any(Number) },
    });
    expect(lastPty(ptys).resizeCalls).toEqual([[120, 40]]);
  });

  it("resize() returns not-found for another principal's session", async () => {
    const { manager } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    expect(await manager.resize(bob, session.id, 10, 10)).toEqual({ status: 'not-found' });
  });

  it('kill() forwards SIGTERM to the pty and returns the updated (still running, until real exit) session', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    const result = await manager.kill(alice, session.id, 'SIGTERM');
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.ok).toBe(true);
    expect(lastPty(ptys).killCalls).toEqual(['SIGTERM']);
  });

  it("kill() returns not-found for another principal's session, and never reaches the pty", async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    expect(await manager.kill(bob, session.id)).toEqual({ status: 'not-found' });
    expect(lastPty(ptys).killCalls).toEqual([]);
  });

  it('kill() on an already-exited session reports ok:false without throwing', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    lastPty(ptys).emitExit(0, undefined);
    const result = await manager.kill(alice, session.id);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.ok).toBe(false);
  });

  it(
    "the kill/write race fix: a write() queued behind a kill() for the same session is rejected via this module's own " +
      "immediate 'killed' flag, even though the underlying pty has not (in this test, ever) reported real process exit",
    async () => {
      const { manager, ptys } = makeManager();
      const session = await manager.create(alice, { cwd: '/work' });
      const pty = lastPty(ptys);

      const killPromise = manager.kill(alice, session.id, 'SIGTERM');
      const writePromise = manager.write(alice, session.id, 'should-be-rejected\n');
      const [killResult, writeResult] = await Promise.all([killPromise, writePromise]);

      expect(killResult).toEqual({ status: 'ok', ok: true, session: expect.any(Object) });
      // The write lost the race for the lock (kill's call was issued first in this test, so it
      // claims the queue slot first) and observes `killed: true` once it acquires the lock —
      // never actually reaching the pty's write(), regardless of the fact that this test never
      // simulated the real OS process dying (no `pty.emitExit()` call at all).
      expect(writeResult).toEqual({ status: 'ok', ok: false, session: expect.any(Object) });
      expect(pty.writeCalls).toEqual([]);
    },
  );

  it('a write() issued and queued before a kill() for the same session still completes normally (the lock enforces call order, not "kill always wins")', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    const pty = lastPty(ptys);

    const writePromise = manager.write(alice, session.id, 'first\n');
    const killPromise = manager.kill(alice, session.id, 'SIGTERM');
    const [writeResult, killResult] = await Promise.all([writePromise, killPromise]);

    expect(writeResult).toEqual({ status: 'ok', ok: true, session: expect.any(Object) });
    expect(killResult).toEqual({ status: 'ok', ok: true, session: expect.any(Object) });
    expect(pty.writeCalls).toEqual(['first\n']);
    expect(pty.killCalls).toEqual(['SIGTERM']);
  });

  it('a resize() queued behind a kill() for the same session is also rejected via the killed flag', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    const pty = lastPty(ptys);

    const killPromise = manager.kill(alice, session.id);
    const resizePromise = manager.resize(alice, session.id, 10, 10);
    const [, resizeResult] = await Promise.all([killPromise, resizePromise]);

    expect(resizeResult).toEqual({ status: 'ok', ok: false, session: expect.any(Object) });
    expect(pty.resizeCalls).toEqual([]);
  });

  it('write() after write() for the same session is serialized through the lock rather than racing (both calls still land, in order)', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    await Promise.all([manager.write(alice, session.id, 'a'), manager.write(alice, session.id, 'b')]);
    expect(lastPty(ptys).writeCalls).toEqual(['a', 'b']);
  });

  it('reports a null session snapshot (rather than throwing) when the underlying session is reaped between a call entering the lock queue and its own turn running', async () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys } = makeManager({ ttlMs: 5 });
      const session = await manager.create(alice, { cwd: '/work' });
      // Outer ownership check runs synchronously here (before any microtask yield) and finds the
      // session present — the lock body itself is only scheduled, not yet run.
      const writePromise = manager.write(alice, session.id, 'queued');
      lastPty(ptys).emitExit(0, undefined);
      // Advancing past the TTL reaps the session from @jini-ai/platform's own registry — still
      // entirely within this synchronous stretch of the test, so it lands before the queued lock
      // body below gets its turn.
      vi.advanceTimersByTime(6);
      const result = await writePromise;
      expect(result).toEqual({ status: 'ok', ok: false, session: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createTerminalSessionManager — attach/detach', () => {
  it('attach() returns not-found for an unknown or foreign session, without adding a sink', () => {
    const { manager } = makeManager();
    const sink: TerminalSseSink = { send: vi.fn(), end: vi.fn() };
    expect(manager.attach(alice, 'missing', 0, sink)).toBe('not-found');
  });

  it('attach() attaches a running session and delivers live output to the sink', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    const sink: TerminalSseSink = { send: vi.fn(), end: vi.fn() };
    expect(manager.attach(alice, session.id, 0, sink)).toBe('attached');
    lastPty(ptys).emitData('hello');
    // Data is coalesced onto a frame timer by the underlying @jini-ai/platform engine — flush it.
    await vi.waitFor(() => expect(sink.send).toHaveBeenCalledWith('data', { data: 'hello' }, expect.any(Number)));
  });

  it("attach() for another principal's session returns not-found even though the session exists", async () => {
    const { manager } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    const sink: TerminalSseSink = { send: vi.fn(), end: vi.fn() };
    expect(manager.attach(bob, session.id, 0, sink)).toBe('not-found');
  });

  it('attach() on an already-exited session replays and ends immediately', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    lastPty(ptys).emitExit(0, undefined);
    const sink: TerminalSseSink = { send: vi.fn(), end: vi.fn() };
    expect(manager.attach(alice, session.id, 0, sink)).toBe('ended');
    expect(sink.end).toHaveBeenCalledTimes(1);
  });

  it('detach() removes a previously attached sink so it stops receiving output', async () => {
    const { manager, ptys } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    const sink: TerminalSseSink = { send: vi.fn(), end: vi.fn() };
    manager.attach(alice, session.id, 0, sink);
    manager.detach(session.id, sink);
    lastPty(ptys).emitData('should-not-arrive');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sink.send).not.toHaveBeenCalled();
  });

  it('detach() on a session that was never attached is a safe no-op', async () => {
    const { manager } = makeManager();
    const session = await manager.create(alice, { cwd: '/work' });
    const sink: TerminalSseSink = { send: vi.fn(), end: vi.fn() };
    expect(() => manager.detach(session.id, sink)).not.toThrow();
  });
});

describe('createTerminalSessionManager — shutdownActive', () => {
  it('kills every active session pty', async () => {
    const { manager, ptys } = makeManager();
    await manager.create(alice, { cwd: '/work' });
    await manager.shutdownActive({ graceMs: 0 });
    expect(lastPty(ptys).killCalls).toEqual(['SIGTERM']);
  });
});

describe('createTerminalToolRegistrations', () => {
  const stubSession: TerminalSessionInfo = {
    id: 'sess-1',
    resourceRef: null,
    cwd: '/work',
    shell: '/bin/bash',
    cols: 80,
    rows: 24,
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    exitCode: null,
    signal: null,
  };
  const notFound: TerminalSessionActionResult = { status: 'not-found' };

  function makeManagerStub(overrides: Partial<TerminalSessionManager> = {}): TerminalSessionManager {
    return {
      create: vi.fn(async () => stubSession),
      get: vi.fn(() => ({ status: 'not-found' as const })),
      list: vi.fn(() => []),
      write: vi.fn(async () => notFound),
      resize: vi.fn(async () => notFound),
      kill: vi.fn(async () => notFound),
      attach: vi.fn(() => 'not-found' as const),
      detach: vi.fn(),
      shutdownActive: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('registers exactly the terminal.create tool id', () => {
    const regs = createTerminalToolRegistrations({ manager: makeManagerStub() });
    expect(regs.create.descriptor.id).toBe(TERMINAL_CREATE_TOOL_ID);
  });

  it('defaults to denyAllTerminalCreatePolicy', () => {
    const regs = createTerminalToolRegistrations({ manager: makeManagerStub() });
    expect(regs.create.policy).toBe(denyAllTerminalCreatePolicy);
  });

  it('a caller-supplied policy overrides the default', () => {
    const policy: ToolPolicy = { authorize: () => 'allow' };
    const regs = createTerminalToolRegistrations({ manager: makeManagerStub(), policy });
    expect(regs.create.policy).toBe(policy);
  });

  it('forwards requiresConfirmation/timeoutMs onto the descriptor', () => {
    const regs = createTerminalToolRegistrations({
      manager: makeManagerStub(),
      requiresConfirmation: true,
      timeoutMs: 5000,
    });
    expect(regs.create.descriptor.requiresConfirmation).toBe(true);
    expect(regs.create.descriptor.timeoutMs).toBe(5000);
  });

  it('the handler throws when input.cwd is missing or not a non-empty string', async () => {
    const regs = createTerminalToolRegistrations({ manager: makeManagerStub() });
    const ctx = { executionId: 'e1', principal: alice, run: { id: 'r1' }, signal: new AbortController().signal };
    await expect(regs.create.handler({ ...ctx, input: undefined })).rejects.toThrow(/input.cwd/);
    await expect(regs.create.handler({ ...ctx, input: { cwd: '' } })).rejects.toThrow(/input.cwd/);
    await expect(regs.create.handler({ ...ctx, input: { cwd: 42 } })).rejects.toThrow(/input.cwd/);
  });

  it('the handler defensively narrows resourceRef/cols/rows/shell and calls manager.create with the calling principal', async () => {
    const manager = makeManagerStub();
    const regs = createTerminalToolRegistrations({ manager });
    await regs.create.handler({
      executionId: 'e1',
      principal: alice,
      run: { id: 'r1' },
      input: { cwd: '/work', resourceRef: 'r1', cols: 100, rows: 40, shell: '/bin/zsh' },
      signal: new AbortController().signal,
    });
    expect(manager.create).toHaveBeenCalledWith(alice, {
      resourceRef: 'r1',
      cwd: '/work',
      cols: 100,
      rows: 40,
      shell: '/bin/zsh',
    });
  });

  it('the handler ignores malformed optional fields rather than throwing', async () => {
    const manager = makeManagerStub();
    const regs = createTerminalToolRegistrations({ manager });
    await regs.create.handler({
      executionId: 'e1',
      principal: alice,
      run: { id: 'r1' },
      input: { cwd: '/work', resourceRef: 42, cols: 'wide', rows: 'tall', shell: 7 },
      signal: new AbortController().signal,
    });
    expect(manager.create).toHaveBeenCalledWith(alice, { resourceRef: null, cwd: '/work', shell: null });
  });

  it('end to end: the real deny-by-default policy blocks creation through a real ToolExecutor, and manager.create is never invoked', async () => {
    const manager = makeManagerStub();
    const registry: ToolRegistry = createToolRegistry();
    const regs = createTerminalToolRegistrations({ manager }); // no policy override — real default applies
    registry.register(regs.create);
    const executor: ToolExecutor = createToolExecutor({ registry });

    const result = await executor.execute(alice, { id: 'r1' }, TERMINAL_CREATE_TOOL_ID, { cwd: '/work' });
    expect(result.status).toBe('denied');
    expect(manager.create).not.toHaveBeenCalled();
  });

  it('end to end: an allow policy lets creation reach manager.create through a real ToolExecutor', async () => {
    const manager = makeManagerStub();
    const registry: ToolRegistry = createToolRegistry();
    const regs = createTerminalToolRegistrations({ manager, policy: { authorize: () => 'allow' } });
    registry.register(regs.create);
    const executor: ToolExecutor = createToolExecutor({ registry });

    const result = await executor.execute(alice, { id: 'r1' }, TERMINAL_CREATE_TOOL_ID, { cwd: '/work' });
    expect(result.status).toBe('completed');
    expect(manager.create).toHaveBeenCalledTimes(1);
  });
});
