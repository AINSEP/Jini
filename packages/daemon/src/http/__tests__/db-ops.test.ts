import { reportRouteInternalError } from '@jini-ai/http-kit';
import { describe, expect, it, vi } from 'vitest';
import { denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost, injectedRecordingReporter, withInjectedReporter } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { describeRoutes } from '../route-table.js';
import { createToolRegistry, type Principal, type ToolPolicy, type ToolRegistry } from '@jini-ai/core';
import { createToolExecutor, type ToolExecutor } from '../../index.js';
import {
  createDaemonDbToolRegistrations,
  daemonDbInspectRoute,
  daemonDbVacuumRoute,
  daemonDbVerifyRoute,
  DB_INSPECT_TOOL_ID,
  DB_VACUUM_TOOL_ID,
  DB_VERIFY_TOOL_ID,
  denyAllDaemonDbPolicy,
  daemonDbRoutes,
  type DaemonDbHttpDeps,
  type DaemonDbOperations,
} from '../db-ops.js';

const principal: Principal = { id: 'local-daemon-operator' };

const inspectReport = {
  kind: 'sqlite' as const,
  location: '/data/app.sqlite',
  sizeBytes: 4096,
  schemaVersion: 3,
  tables: [{ name: 'runs', rowCount: 12 }],
  generatedAt: 1000,
};

const verifyReportClean = {
  ok: true,
  mode: 'integrity_check' as const,
  issues: [],
  elapsedMs: 5,
  generatedAt: 1000,
};

const vacuumResult = { ok: true as const, beforeBytes: 4096, afterBytes: 2048, reclaimedBytes: 2048, elapsedMs: 12 };

function makeOperations(overrides: Partial<DaemonDbOperations> = {}): DaemonDbOperations {
  return {
    inspect: vi.fn(async () => inspectReport),
    verify: vi.fn(async ({ quick: _quick }: { quick: boolean }) => verifyReportClean),
    vacuum: vi.fn(async () => vacuumResult),
    ...overrides,
  };
}

/**
 * Builds a real ToolExecutor with the three DB tools registered.
 *
 * `useProductionDefaultPolicy: true` forwards no `policy` key at all into
 * `createDaemonDbToolRegistrations`, letting *its own* default
 * (`denyAllDaemonDbPolicy`) apply — this is what the auth-denial tests below
 * need to prove the real production default is wired end to end, not a test
 * fixture's default. Otherwise falls back to an always-allow policy (or an
 * explicitly supplied one) for test convenience, since most tests here want
 * a working happy path and aren't exercising authorization at all.
 */
function makeExecutor(
  operations: DaemonDbOperations,
  useProductionDefaultPolicy: boolean,
  policy: ToolPolicy | undefined,
): { executor: ToolExecutor; registry: ToolRegistry } {
  const registry = createToolRegistry({});
  const registrations = createDaemonDbToolRegistrations(
    { operations },
    useProductionDefaultPolicy ? {} : { policy: policy ?? { authorize: () => 'allow' } },
  );
  registry.register(registrations.inspect);
  registry.register(registrations.verify);
  registry.register(registrations.vacuum);
  return { executor: createToolExecutor({ registry }), registry };
}

function makeDeps(overrides: Partial<DaemonDbHttpDeps> & { operations?: DaemonDbOperations; policy?: ToolPolicy | undefined } = {}): {
  deps: DaemonDbHttpDeps;
  operations: DaemonDbOperations;
} {
  const operations = overrides.operations ?? makeOperations();
  // Distinguish "policy key omitted" (test convenience: default to allow) from "policy key
  // explicitly set to `undefined`" (the caller wants the REAL production default exercised end
  // to end, not masked by this fixture's own allow-by-default convenience).
  const useProductionDefaultPolicy =
    Object.prototype.hasOwnProperty.call(overrides, 'policy') && overrides.policy === undefined;
  const { executor } = overrides.toolExecutor
    ? { executor: overrides.toolExecutor }
    : makeExecutor(operations, useProductionDefaultPolicy, overrides.policy);
  return {
    deps: { reportInternalError: reportRouteInternalError, toolExecutor: executor, principal, ...overrides },
    operations,
  };
}

/**
 * Builds deps wired through the tools' REAL production default policy
 * (`denyAllDaemonDbPolicy` — no policy override at all, unlike `makeDeps`'s
 * convenience `{authorize: () => 'allow'}` default) so the auth-denial tests
 * below exercise the actual shipped default, not a test-only stand-in.
 */
function makeDenyByDefaultDeps(operations: DaemonDbOperations = makeOperations()): {
  deps: DaemonDbHttpDeps;
  operations: DaemonDbOperations;
} {
  const registry = createToolRegistry({});
  const regs = createDaemonDbToolRegistrations({ operations }); // no `policy` field — real default applies
  registry.register(regs.inspect);
  registry.register(regs.verify);
  registry.register(regs.vacuum);
  const executor = createToolExecutor({ registry });
  return { deps: { reportInternalError: reportRouteInternalError, toolExecutor: executor, principal }, operations };
}

/** A minimal fake `ToolExecutor` that resolves `execute()` synchronously with a fixed result — used to test `toolResultToApiResult`'s mapping for statuses (`timed-out`/`cancelled`) a real executor only reaches via a genuine race. */
function fakeExecutorResolving(result: Awaited<ReturnType<ToolExecutor['execute']>>): ToolExecutor {
  return {
    execute: vi.fn(async () => result),
    resumeConfirmation: vi.fn(),
    cancel: vi.fn(),
    getAuditRecord: vi.fn(() => null),
  };
}

describe('createDaemonDbToolRegistrations', () => {
  it('honors optional policy and descriptor settings together, retaining deny by default', () => {
    const operations = makeOperations();
    const policy: ToolPolicy = { authorize: () => 'allow' };
    const configured = createDaemonDbToolRegistrations({ operations }, { policy, requiresConfirmation: true, timeoutMs: 1234 });
    const defaults = createDaemonDbToolRegistrations({ operations }, {});
    for (const key of ['inspect', 'verify', 'vacuum'] as const) {
      expect(configured[key].policy).toBe(policy);
      expect(configured[key].descriptor.requiresConfirmation).toBe(true);
      expect(configured[key].descriptor.timeoutMs).toBe(1234);
      expect(defaults[key].policy).toBe(denyAllDaemonDbPolicy);
    }
  });

  // REGRESSION: fails if options are merged from argument one.
  it('pins required operations and ignores runtime options injected into argument one', () => {
    const operations = makeOperations();
    const policy: ToolPolicy = { authorize: () => 'allow' };
    const required = { operations, policy };
    expect(createDaemonDbToolRegistrations({ ...required }).inspect.policy).toBe(denyAllDaemonDbPolicy);
    expect(createDaemonDbToolRegistrations({ ...required }, { policy }).inspect.policy).toBe(policy);
  });
  it('registers exactly the three documented tool ids', () => {
    const regs = createDaemonDbToolRegistrations({ operations: makeOperations() });
    expect(regs.inspect.descriptor.id).toBe(DB_INSPECT_TOOL_ID);
    expect(regs.verify.descriptor.id).toBe(DB_VERIFY_TOOL_ID);
    expect(regs.vacuum.descriptor.id).toBe(DB_VACUUM_TOOL_ID);
  });

  it('defaults every tool to denyAllDaemonDbPolicy', () => {
    const regs = createDaemonDbToolRegistrations({ operations: makeOperations() });
    expect(regs.inspect.policy).toBe(denyAllDaemonDbPolicy);
    expect(regs.verify.policy).toBe(denyAllDaemonDbPolicy);
    expect(regs.vacuum.policy).toBe(denyAllDaemonDbPolicy);
  });

  it('denyAllDaemonDbPolicy denies regardless of principal', () => {
    expect(
      denyAllDaemonDbPolicy.authorize({
        principal: { id: 'anyone', roles: ['admin'] },
        run: { id: 'r1' },
        tool: { id: DB_INSPECT_TOOL_ID },
        input: undefined,
      }),
    ).toBe('deny');
  });

  it('a caller-supplied policy overrides the default for all three tools', () => {
    const policy: ToolPolicy = { authorize: () => 'allow' };
    const regs = createDaemonDbToolRegistrations({ operations: makeOperations() }, { policy });
    expect(regs.inspect.policy).toBe(policy);
    expect(regs.verify.policy).toBe(policy);
    expect(regs.vacuum.policy).toBe(policy);
  });

  it('forwards requiresConfirmation/timeoutMs onto every descriptor', () => {
    const regs = createDaemonDbToolRegistrations({ operations: makeOperations() }, { requiresConfirmation: true, timeoutMs: 5000 });
    expect(regs.inspect.descriptor.requiresConfirmation).toBe(true);
    expect(regs.verify.descriptor.timeoutMs).toBe(5000);
    expect(regs.vacuum.descriptor.requiresConfirmation).toBe(true);
  });

  it('the verify handler defaults quick to false when input is not a record', async () => {
    const operations = makeOperations();
    const regs = createDaemonDbToolRegistrations({ operations });
    await regs.verify.handler({ executionId: 'e1', principal, run: { id: 'r1' }, input: undefined, signal: new AbortController().signal });
    expect(operations.verify).toHaveBeenCalledWith({ quick: false });
  });

  it('the verify handler passes quick: true through from the input record', async () => {
    const operations = makeOperations();
    const regs = createDaemonDbToolRegistrations({ operations });
    await regs.verify.handler({ executionId: 'e1', principal, run: { id: 'r1' }, input: { quick: true }, signal: new AbortController().signal });
    expect(operations.verify).toHaveBeenCalledWith({ quick: true });
  });

  it('the inspect/vacuum handlers call their operation with no arguments', async () => {
    const operations = makeOperations();
    const regs = createDaemonDbToolRegistrations({ operations });
    await regs.inspect.handler({ executionId: 'e1', principal, run: { id: 'r1' }, input: undefined, signal: new AbortController().signal });
    await regs.vacuum.handler({ executionId: 'e2', principal, run: { id: 'r1' }, input: undefined, signal: new AbortController().signal });
    expect(operations.inspect).toHaveBeenCalledWith();
    expect(operations.vacuum).toHaveBeenCalledWith();
  });
});

describe('daemonDbInspectRoute', () => {
  it('success: returns the inspect report when the policy allows', async () => {
    const { deps, operations } = makeDeps();
    const result = await daemonDbInspectRoute.handle({ input: undefined, deps });
    expect(result).toEqual({ ok: true, value: inspectReport });
    expect(operations.inspect).toHaveBeenCalledTimes(1);
  });

  it('auth-denial: the ToolExecutor gate denies by default, the underlying operation is never invoked, and the route returns 403', async () => {
    // This is the load-bearing proof that the gate is actually in the call path, not
    // bypassable: `makeDenyByDefaultDeps` wires the tools' REAL production default policy
    // (`denyAllDaemonDbPolicy` — no policy override at all) through a REAL ToolExecutor/
    // ToolRegistry (no route-level mock), and asserts the injected operation itself was never
    // called.
    const { deps, operations } = makeDenyByDefaultDeps();
    const result = await daemonDbInspectRoute.handle({ input: undefined, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied by policy' },
    });
    expect(operations.inspect).not.toHaveBeenCalled();
  });

  it('a failed tool execution redacts the real error and reports a correlation id (SEC-005), while invoking onInternalError with the real error', async () => {
    const boom = new Error('disk read failed at /secret/data/app.sqlite');
    const operations = makeOperations({ inspect: vi.fn(async () => { throw boom; }) });
    const onInternalError = vi.fn();
    const { deps } = makeDeps({ operations, reportInternalError: injectedRecordingReporter({ record: onInternalError }) });
    const result = await daemonDbInspectRoute.handle({ input: undefined, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toBe('The database could not be inspected. Try again; if it keeps failing, copy the request ID and report this problem.');
      expect(JSON.stringify(result.error)).not.toContain('/secret/data/app.sqlite');
      expect(result.error.requestId).toEqual(expect.any(String));
    }
    expect(onInternalError).toHaveBeenCalledTimes(1);
    const [context] = onInternalError.mock.calls[0]!;
    expect(context.source).toBe('db-inspect');
    // `ToolExecutor.execute` itself already reduces a caught exception down to `err.message`
    // (a string) before this route ever sees it — `ToolExecutionResult.error` has no room for
    // the original `Error` object. This route's own SEC-005 discipline is therefore "never widen
    // that string back out to the client," which the assertions above already cover; the sink
    // can only ever receive what the executor handed it.
    expect(context.error).toBe(boom.message);
  });

  it('logs to console.error by default when onInternalError is omitted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });
    const operations = makeOperations({ inspect: vi.fn(async () => { throw new Error('boom'); }) });
    const { deps } = makeDeps({ operations });
    const result = await daemonDbInspectRoute.handle({ input: undefined, deps });
    if (result.ok) throw new Error('expected failure');
    expect(result.error.message).toBe('The database could not be inspected. Try again; if it keeps failing, copy the request ID and report this problem.');
    expect(consoleError.mock.calls).toEqual([[`[@jini-ai/http-kit] internal error (db-inspect, correlationId=${result.error.requestId})`, 'string']]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('boom');
    consoleError.mockRestore();
  });

  it('reports a denied confirmation the same as a policy denial', async () => {
    const registry = createToolRegistry({});
    const operations = makeOperations();
    const regs = createDaemonDbToolRegistrations({ operations }, { policy: { authorize: () => 'allow' }, requiresConfirmation: true });
    registry.register(regs.inspect);
    registry.register(regs.verify);
    registry.register(regs.vacuum);
    const executor = createToolExecutor({ registry }, { delegate: { onConfirm: () => 'deny' } });
    const deps: DaemonDbHttpDeps = { reportInternalError: reportRouteInternalError, toolExecutor: executor, principal };
    const result = await daemonDbInspectRoute.handle({ input: undefined, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied during confirmation' },
    });
    expect(operations.inspect).not.toHaveBeenCalled();
  });

  it('reports a timeout as a redacted INTERNAL_ERROR', async () => {
    // `ToolExecutor.execute` only actually returns `timed-out` once the *handler's own* promise
    // settles after observing an abort — see `packages/daemon/src/__tests__/tool-executor.test.ts`'s
    // `abortAwareHandler`, which is the executor's real, generically-tested timeout mechanism.
    // `db-ops.ts`'s own three handlers don't forward `ctx.signal` into `DaemonDbOperations` at all
    // (that interface has no signal parameter: the real collaborator this module documents itself
    // as wiring — `@jini-ai/db/sqlite`'s synchronous `better-sqlite3` calls — cannot be cooperatively
    // cancelled mid-flight regardless of any signal). Re-deriving that generic race here with a
    // mock that ignores the signal would hang forever rather than proving anything. This test
    // instead isolates what actually is `db-ops.ts`'s own responsibility: given a `timed-out`
    // `ToolExecutionResult` (however the executor arrived at it), does the route redact it into a
    // generic `INTERNAL_ERROR` with a correlation id, the same as `failed`/`cancelled`? See
    // `toolResultToApiResult`'s switch.
    const executor = fakeExecutorResolving({ executionId: 'timed-out-1', status: 'timed-out' });
    const deps: DaemonDbHttpDeps = { reportInternalError: reportRouteInternalError, toolExecutor: executor, principal };
    const result = await daemonDbInspectRoute.handle({ input: undefined, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'The database could not be inspected. Try again; if it keeps failing, copy the request ID and report this problem.', requestId: expect.any(String) },
    });
  });

  it('reports a cancellation as a redacted INTERNAL_ERROR', async () => {
    const executor = fakeExecutorResolving({ executionId: 'cancelled-1', status: 'cancelled' });
    const deps: DaemonDbHttpDeps = { reportInternalError: reportRouteInternalError, toolExecutor: executor, principal };
    const result = await daemonDbInspectRoute.handle({ input: undefined, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'The database could not be inspected. Try again; if it keeps failing, copy the request ID and report this problem.', requestId: expect.any(String) },
    });
  });
});

describe('daemonDbVerifyRoute.parse', () => {
  it('malformed input: rejects a non-string quick query value (e.g. a repeated query param becomes an array)', () => {
    const result = daemonDbVerifyRoute.parse({ body: {}, query: { quick: ['1', '2'] }, params: {} });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'quick must be a single query-string value when provided' },
    });
  });

  it('defaults to quick: false when the query parameter is absent', () => {
    expect(daemonDbVerifyRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: { quick: false } });
  });

  it.each([
    ['1', true],
    ['true', true],
    ['TRUE', true],
    ['0', false],
    ['false', false],
    ['garbage', false],
  ])('parses quick=%s as %s', (raw, expected) => {
    const result = daemonDbVerifyRoute.parse({ body: {}, query: { quick: raw }, params: {} });
    expect(result).toEqual({ ok: true, value: { quick: expected } });
  });
});

describe('daemonDbVerifyRoute.handle', () => {
  it('success: forwards quick through the executor to the operation', async () => {
    const { deps, operations } = makeDeps();
    const result = await daemonDbVerifyRoute.handle({ input: { quick: true }, deps });
    expect(result).toEqual({ ok: true, value: verifyReportClean });
    expect(operations.verify).toHaveBeenCalledWith({ quick: true });
  });

  it('auth-denial: denies by default and never calls verify()', async () => {
    const { deps, operations } = makeDeps({ policy: undefined });
    const result = await daemonDbVerifyRoute.handle({ input: { quick: false }, deps });
    expect(result.ok).toBe(false);
    expect(operations.verify).not.toHaveBeenCalled();
  });
});

describe('daemonDbVacuumRoute.handle', () => {
  it('success: returns the vacuum result', async () => {
    const { deps, operations } = makeDeps();
    const result = await daemonDbVacuumRoute.handle({ input: undefined, deps });
    expect(result).toEqual({ ok: true, value: vacuumResult });
    expect(operations.vacuum).toHaveBeenCalledTimes(1);
  });

  it('auth-denial: denies by default and never calls vacuum() — proves VACUUM cannot run unauthorized', async () => {
    const { deps, operations } = makeDeps({ policy: undefined });
    const result = await daemonDbVacuumRoute.handle({ input: undefined, deps });
    expect(result.ok).toBe(false);
    expect(operations.vacuum).not.toHaveBeenCalled();
  });
});

describe('daemonDbRoutes', () => {
  const serve = ({ deps, denyOrigins = false }: { deps: DaemonDbHttpDeps; denyOrigins?: boolean }) =>
    serveRoutes({ routes: daemonDbRoutes({ deps, host: withInjectedReporter({ host: fakeDaemonRouteHost({}, denyOrigins ? { originPolicy: denyAllOrigins } : {}), deps }) }) });
  const call = (path: string, method = 'GET') => jsonRequest({ path, method });

  it('lists exactly the three documented routes, each behind the same-origin gate', () => {
    const { deps } = makeDeps();
    expect(describeRoutes({ routes: daemonDbRoutes({ deps, host: fakeDaemonRouteHost() }) })).toEqual([
      { method: 'GET', path: '/api/daemon/db', gates: ['same-origin'] },
      { method: 'POST', path: '/api/daemon/db/verify', gates: ['same-origin'] },
      { method: 'POST', path: '/api/daemon/db/vacuum', gates: ['same-origin'] },
    ]);
  });

  it('GET /api/daemon/db, POST /api/daemon/db/verify?quick=true and POST /api/daemon/db/vacuum round-trip JSON through a real ToolExecutor', async () => {
    const { deps, operations } = makeDeps();
    const fetch = serve({ deps });
    const inspectRes = await fetch(call('/api/daemon/db'));
    expect([inspectRes.status, inspectRes.headers.get('content-type'), await inspectRes.json()]).toEqual([200, expect.stringContaining('application/json'), inspectReport]);

    const verifyRes = await fetch(call('/api/daemon/db/verify?quick=true', 'POST'));
    expect([verifyRes.status, await verifyRes.json()]).toEqual([200, verifyReportClean]);
    expect(operations.verify).toHaveBeenCalledWith({ quick: true });

    const vacuumRes = await fetch(call('/api/daemon/db/vacuum', 'POST'));
    expect([vacuumRes.status, await vacuumRes.json()]).toEqual([200, vacuumResult]);
    expect(operations.vacuum).toHaveBeenCalledTimes(1);
  });

  it('requires same-origin on all three routes: blocks a cross-origin request before the tool executor ever runs', async () => {
    const { deps, operations } = makeDeps();
    const fetch = serve({ deps, denyOrigins: true });
    for (const [path, method] of [['/api/daemon/db', 'GET'], ['/api/daemon/db/verify', 'POST'], ['/api/daemon/db/vacuum', 'POST']] as const) {
      expect((await fetch(call(path, method))).status).toBe(403);
    }
    expect([operations.inspect, operations.verify, operations.vacuum].map((operation) => vi.mocked(operation).mock.calls.length)).toEqual([0, 0, 0]);
  });

  it('a malformed request (a repeated quick value) never reaches the executor', async () => {
    const { deps, operations } = makeDeps();
    expect((await serve({ deps })(call('/api/daemon/db/verify?quick=a&quick=b', 'POST'))).status).toBe(400);
    expect(operations.verify).not.toHaveBeenCalled();
  });

  it('the production deny-by-default policy blocks a request with 403 TOOL_OPERATION_DENIED, never reaching the operation', async () => {
    const { deps, operations } = makeDenyByDefaultDeps();
    const res = await serve({ deps })(call('/api/daemon/db'));
    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([403, 'TOOL_OPERATION_DENIED']);
    expect(operations.inspect).not.toHaveBeenCalled();
  });

  it("reports a failed operation through the host's reporter with a request ID", async () => {
    const { deps, operations } = makeDeps();
    vi.mocked(operations.inspect).mockRejectedValueOnce(new Error('disk gone'));
    const host = fakeDaemonRouteHost();
    const res = await serveRoutes({ routes: daemonDbRoutes({ deps, host }) })(call('/api/daemon/db'));
    expect([res.status, host.reports.map((report) => report.logSource)]).toEqual([500, ['db-inspect']]);
  });
});

it.each(['verify', 'vacuum'] as const)('retains %s operation and injected reporter ID on failure', async operation => {
  const host = fakeDaemonRouteHost();
  const failure = new Error('database secret');
  const operations = makeOperations({ [operation]: async () => { throw failure; } });
  const { deps } = makeDeps({ operations, reportInternalError: host.reportInternalError });
  const result = operation === 'verify'
    ? await daemonDbVerifyRoute.handle({ input: { quick: false }, deps })
    : await daemonDbVacuumRoute.handle({ input: undefined, deps });
  expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', requestId: 'req-1' } });
  expect(host.reports[0]).toMatchObject({ report: { source: `db-${operation}`, error: failure.message }, requestId: 'req-1' });
});
