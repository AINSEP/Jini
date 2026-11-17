import { withReadOnlyToolConstraint, defaultDaemonMessages } from '../../read-only-tools.js';
import { createNodeCredentialCrypto } from '../../run-credentials.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { serveRoutes } from './fakes/serve-routes.js';
import { describeRoutes } from '../route-table.js';
import { createToolRegistry, ToolInputError, type Principal, type ToolRegistry } from '@jini-ai/core';
import {
  createInMemoryEventLog,
  createRunLifecycle,
  createToolExecutor,
  createDelegatedResultCorrelation,
  type RunLifecycle,
  type ToolExecutor,
} from '../../index.js';
import {
  delegatedToolExecuteRoute,
  delegatedToolRoutes,
  type DelegatedToolsHttpDeps,
} from '../delegated-tools.js';

const TEST_PRINCIPAL: Principal = { id: 'test-principal' };

function makeLifecycle(): RunLifecycle {
  return createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
}

/** A real ToolExecutor + ToolRegistry (not a fake) — one always-allowed echo tool, one always-denied tool. */
function makeToolExecutor(): ToolExecutor {
  const registry = createToolRegistry({});
  registry.register({
    descriptor: { id: 'echo' },
    policy: { authorize: () => 'allow' },
    handler: async (ctx) => ({ echoed: ctx.input }),
  });
  registry.register({
    descriptor: { id: 'forbidden' },
    policy: { authorize: () => 'deny' },
    handler: async () => 'never runs',
  });
  return createToolExecutor({ registry });
}

function makeDeps(overrides: Partial<DelegatedToolsHttpDeps> = {}): DelegatedToolsHttpDeps {
  return {
    lifecycle: makeLifecycle(),
    toolExecutor: makeToolExecutor(),
    resolvePrincipal: () => TEST_PRINCIPAL,
    ...overrides,
  };
}

describe('delegatedToolExecuteRoute.parse (parseDelegatedToolExecute)', () => {
  it('rejects a non-object body', () => {
    const result = delegatedToolExecuteRoute.parse({ body: 'nope', query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('rejects a missing runId with a structured validation issue', () => {
    const result = delegatedToolExecuteRoute.parse({ body: { toolUseId: 'tu-1', toolId: 't1' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BAD_REQUEST');
      expect(result.error.details).toEqual({ kind: 'validation', issues: [{ path: 'runId', message: 'required non-empty string' }] });
    }
  });

  it('rejects a whitespace-only runId the same as a missing one', () => {
    const result = delegatedToolExecuteRoute.parse({
      body: { runId: '   ', toolUseId: 'tu-1', toolId: 't1' },
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing toolUseId', () => {
    const result = delegatedToolExecuteRoute.parse({ body: { runId: 'r1', toolId: 't1' }, query: {}, params: {} });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'toolUseId must be a non-empty string', details: { kind: 'validation', issues: [{ path: 'toolUseId', message: 'required non-empty string' }] } },
    });
  });

  it('rejects a missing toolId', () => {
    const result = delegatedToolExecuteRoute.parse({ body: { runId: 'r1', toolUseId: 'tu-1' }, query: {}, params: {} });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'toolId must be a non-empty string', details: { kind: 'validation', issues: [{ path: 'toolId', message: 'required non-empty string' }] } },
    });
  });

  it('accepts a well-formed body without input, passing input through as undefined', () => {
    const result = delegatedToolExecuteRoute.parse({ body: { runId: 'r1', toolUseId: 'tu-1', toolId: 't1' }, query: {}, params: {} });
    expect(result).toEqual({ ok: true, value: { runId: 'r1', toolUseId: 'tu-1', toolId: 't1', input: undefined } });
  });

  it('accepts a well-formed body with an arbitrary JSON input payload', () => {
    const result = delegatedToolExecuteRoute.parse({
      body: { runId: 'r1', toolUseId: 'tu-1', toolId: 't1', input: { city: 'nyc', count: 3 } },
      query: {},
      params: {},
    });
    expect(result).toEqual({ ok: true, value: { runId: 'r1', toolUseId: 'tu-1', toolId: 't1', input: { city: 'nyc', count: 3 } } });
  });
});

describe('delegatedToolExecuteRoute.handle', () => {
  it('shares the host correlation store with the bridge created by the HTTP route', async () => {
    const delegatedResultCorrelation = createDelegatedResultCorrelation({ crypto: createNodeCredentialCrypto({}) });
    const image = { type: 'image', mimeType: 'image/png', data: 'ORIGINAL_PIXELS' };
    const registry = createToolRegistry({});
    registry.register({ descriptor: { id: 'capture' }, policy: { authorize: () => 'allow' }, handler: async () => ({ content: [image] }) });
    const deps = makeDeps({ delegatedResultCorrelation, toolExecutor: createToolExecutor({ registry }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'correlation' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'B', toolId: 'capture' }, deps });
    expect(result).toMatchObject({ ok: true, value: { result: { status: 'completed', output: { content: [image] } } } });
    expect(delegatedResultCorrelation.matches({ runId: run.id, toolUseId: 'B', content: [image], isError: false })).toBe(true);
  });
  it('returns NOT_FOUND when the run does not exist, without ever calling resolvePrincipal', async () => {
    const resolvePrincipal = vi.fn(() => TEST_PRINCIPAL);
    const deps = makeDeps({ resolvePrincipal });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: 'never-started', toolUseId: 'tu-1', toolId: 'echo' }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'run "never-started" was not found' } });
    expect(resolvePrincipal).not.toHaveBeenCalled();
  });

  it('executes an allowed tool end to end through the real ToolExecutor and delegated-tool-bridge, and records tool_use/tool_result run events', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo', input: { city: 'nyc' } }, deps }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.result).toMatchObject({ status: 'completed', output: { echoed: { city: 'nyc' } } });
    }

    const events: unknown[] = [];
    await deps.lifecycle.stream({ runId: run.id, onEvent: (event) => events.push(event) });
    const agentEvents = (events as { kind: string; payload: { type: string } }[]).filter((e) => e.kind === 'agent');
    expect(agentEvents.map((e) => e.payload.type)).toEqual(['tool_use', 'tool_result']);
  });

  it('threads the parsed request into resolvePrincipal and the resolved principal into ToolExecutor.execute', async () => {
    const seenPrincipals: Principal[] = [];
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: 'echo' },
      policy: {
        authorize: (ctx) => {
          seenPrincipals.push(ctx.principal);
          return 'allow';
        },
      },
      handler: async (ctx) => ctx.input,
    });
    const toolExecutor = createToolExecutor({ registry });
    const scopedPrincipal: Principal = { id: 'scoped-principal', roles: ['runner'] };
    const resolvePrincipal = vi.fn(() => scopedPrincipal);
    const deps = makeDeps({ toolExecutor, resolvePrincipal });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, deps });
    expect(resolvePrincipal).toHaveBeenCalledWith({ request: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo' } });
    expect(seenPrincipals).toEqual([scopedPrincipal]);
  });

  it('supports an async resolvePrincipal', async () => {
    const deps = makeDeps({ resolvePrincipal: async () => TEST_PRINCIPAL });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, deps });
    expect(result.ok).toBe(true);
  });

  it('maps a denied ToolExecutionResult to a 403 TOOL_OPERATION_DENIED error, mirroring db-ops.ts', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'forbidden' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied by policy' },
    });
  });

  it('maps a confirmation-denied ToolExecutionResult to a 403 TOOL_OPERATION_DENIED error', async () => {
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: 'confirm-me', requiresConfirmation: true },
      policy: { authorize: () => 'allow' },
      handler: async () => 'should not run',
    });
    const toolExecutor = createToolExecutor({ registry }, { delegate: { onConfirm: () => 'deny' } });
    const deps = makeDeps({ toolExecutor });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'confirm-me' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied during confirmation' },
    });
  });

  it('maps a failed ToolExecutionResult to a SEC-005-redacted INTERNAL_ERROR and reports it via onInternalError', async () => {
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: 'flaky' },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        throw new Error('boom: secret detail');
      },
    });
    const toolExecutor = createToolExecutor({ registry });
    const onInternalError = vi.fn();
    const deps = makeDeps({ toolExecutor, onInternalError });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'flaky' }, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.', requestId: expect.any(String) });
    }
    expect(onInternalError).toHaveBeenCalledTimes(1);
    const context = onInternalError.mock.calls[0]![0];
    expect(context.source).toBe('delegated-tool-execute');
    expect(context.error).toBe('boom: secret detail');
  });

  it('maps a failed ToolExecutionResult with errorKind "validation" to a real 400 BAD_REQUEST, not the SEC-005-redacted 500 — this is the theme_list_files "malformed param name" bug fix', async () => {
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: 'picky' },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        throw new ToolInputError({ message: "'themeId' (non-empty string) is required" });
      },
    });
    const toolExecutor = createToolExecutor({ registry });
    const onInternalError = vi.fn();
    const deps = makeDeps({ toolExecutor, onInternalError });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'picky' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: "'themeId' (non-empty string) is required" },
    });
    // Not redacted, and not reported as an internal error — the caller gets the real message directly.
    expect(onInternalError).not.toHaveBeenCalled();
  });

  it('maps a failed ToolExecutionResult with no errorKind (an internal failure) to the SEC-005-redacted INTERNAL_ERROR, same as a plain Error', async () => {
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: 'flaky-internal' },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        throw new Error('boom: secret detail');
      },
    });
    const toolExecutor = createToolExecutor({ registry });
    const onInternalError = vi.fn();
    const deps = makeDeps({ toolExecutor, onInternalError });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'flaky-internal' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.', requestId: expect.any(String) },
    });
    expect(onInternalError).toHaveBeenCalledTimes(1);
    expect(onInternalError.mock.calls[0]![0].error).toBe('boom: secret detail');
  });

  it('maps a timed-out ToolExecutionResult to a SEC-005-redacted INTERNAL_ERROR', async () => {
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: 'slow', timeoutMs: 10 },
      policy: { authorize: () => 'allow' },
      handler: async (ctx) => {
        await new Promise((resolve, reject) => {
          ctx.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
    });
    const toolExecutor = createToolExecutor({ registry });
    const onInternalError = vi.fn();
    const deps = makeDeps({ toolExecutor, onInternalError });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'slow' }, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
    expect(onInternalError).toHaveBeenCalledTimes(1);
    expect(onInternalError.mock.calls[0]![0].error).toBe('timed-out');
  });

  it('returns an unknown tool id as BAD_REQUEST without an internal-error report', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({ onInternalError });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'nope' }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'ToolExecutor: unknown tool "nope"' } });
    expect(onInternalError).not.toHaveBeenCalled();
  });

  it('SEC-005: falls back to console.error when no onInternalError sink is supplied', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    const toolExecutor: ToolExecutor = {
      ...makeToolExecutor(),
      execute: async () => { throw new Error('executor unavailable'); },
    };
    const deps = makeDeps({ toolExecutor });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'nope' }, deps });
    expect(result.ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('propagates a caller-supplied abort signal through the bridge into ToolExecutor, cancelling a pending confirmation', async () => {
    // No `delegate.onConfirm` at all — `requestConfirmation` parks on an internal deferred (same
    // as `tool-executor.test.ts`'s own "is resumable" tests), which is exactly the unbounded,
    // human-in-the-loop wait a transport disconnect needs to be able to interrupt.
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: 'needs-confirm', requiresConfirmation: true },
      policy: { authorize: () => 'allow' },
      handler: async () => 'should not run',
    });
    const toolExecutor = createToolExecutor({ registry });
    const deps = makeDeps({ toolExecutor });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const controller = new AbortController();

    const resultPromise = delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'needs-confirm' }, deps }, { signal: controller.signal }
    );
    // A small macrotask delay rather than a hand-counted number of microtask ticks — the exact hop
    // count through `lifecycle.emit`, the bridge, and `authorizeToolInvocation` is an internal
    // implementation detail of packages this test doesn't own; this just needs to be past all of it
    // and into the parked confirmation before aborting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.', requestId: expect.any(String) });
    }
  });

  it('SEC-005: redacts a thrown resolvePrincipal failure to a generic INTERNAL_ERROR with source resolve-principal', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({
      onInternalError,
      resolvePrincipal: () => {
        throw new Error('principal resolution failed: secret detail');
      },
    });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.', requestId: expect.any(String) });
    }
    const context = onInternalError.mock.calls[0]![0];
    expect(context.source).toBe('resolve-principal');
    expect(context.error).toBeInstanceOf(Error);
  });
});

describe('delegatedToolRoutes', () => {
  const callPath = '/api/delegated-tool-calls';
  const call = (body: unknown, { signal }: { signal?: AbortSignal } = {}) => new Request(`http://local${callPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  const serve = ({ deps, denyOrigins = false }: { deps: DelegatedToolsHttpDeps; denyOrigins?: boolean }) =>
    serveRoutes({ routes: delegatedToolRoutes({ deps, host: fakeDaemonRouteHost({}, denyOrigins ? { originPolicy: denyAllOrigins } : {}) }) });

  it('lists exactly POST /api/delegated-tool-calls, behind the same-origin gate', () => {
    expect(describeRoutes({ routes: delegatedToolRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) })).toEqual([{ method: 'POST', path: callPath, gates: ['same-origin'] }]);
  });

  it('requires same-origin: blocks a cross-origin request with 403', async () => {
    const response = await serve({ deps: makeDeps(), denyOrigins: true })(call({ runId: 'r1', toolUseId: 'tu-1', toolId: 'echo' }));
    expect(response.status).toBe(403);
  });

  it('executes an allowed tool end to end through the real JSON route pipeline', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const response = await serve({ deps })(call({ runId: run.id, toolUseId: 'tu-1', toolId: 'echo', input: 'hi' }));
    const body = await response.json() as { result: unknown };
    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({ status: 'completed', output: { echoed: 'hi' } });
  });

  it('answers an unknown tool id with HTTP 400', async () => {
    const deps = makeDeps();
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const response = await serve({ deps })(call({ runId: run.id, toolUseId: 'tu-1', toolId: 'nope', input: {} }));
    expect([response.status, await response.json()]).toEqual([400, { error: { code: 'BAD_REQUEST', message: 'ToolExecutor: unknown tool "nope"' } }]);
  });

  it('a client disconnect (the request signal aborting) reaches ToolExecutor and cancels a pending confirmation', async () => {
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: 'needs-confirm', requiresConfirmation: true },
      policy: { authorize: () => 'allow' },
      handler: async () => 'should not run',
    });
    const deps = makeDeps({ toolExecutor: createToolExecutor({ registry }) });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const events: { kind: string; payload: { type: string; content?: string; isError?: boolean } }[] = [];
    await deps.lifecycle.stream({ runId: run.id, onEvent: (event) => events.push(event as (typeof events)[number]) });
    const disconnect = new AbortController();

    const answered = serve({ deps })(call({ runId: run.id, toolUseId: 'tu-1', toolId: 'needs-confirm' }, { signal: disconnect.signal }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    disconnect.abort();
    // The client is gone: the route writes no body for it (499 is only the in-memory server's own status for "nobody is listening").
    expect((await answered).status).toBe(499);

    // The cancellation reached `ToolExecutor` through the whole chain: the run's own event stream, which the bridge writes to whether or not a response ever goes out, shows the pending confirmation ending as cancelled, not left parked forever.
    const agentEvents = events.filter((e) => e.kind === 'agent');
    expect(agentEvents.map((e) => e.payload.type)).toEqual(['tool_use', 'tool_result']);
    expect([agentEvents[1]!.payload.content, agentEvents[1]!.payload.isError]).toEqual(['Tool execution cancelled.', true]);
  });

  it('responds 404 for an unknown runId', async () => {
    const response = await serve({ deps: makeDeps() })(call({ runId: 'never-started', toolUseId: 'tu-1', toolId: 'echo' }));
    expect(response.status).toBe(404);
  });

  it('reports an internal failure through the host reporter, not the default one', async () => {
    const host = fakeDaemonRouteHost();
    const deps = makeDeps({ resolvePrincipal: () => { throw new Error('principal store down'); } });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const response = await serveRoutes({ routes: delegatedToolRoutes({ deps, host }) })(call({ runId: run.id, toolUseId: 'tu-1', toolId: 'echo' }));
    expect([response.status, host.reports.map((report) => report.logSource)]).toEqual([500, ['resolve-principal']]);
  });
});

describe('delegatedToolExecuteRoute read-only constraint (requireReadOnly)', () => {
  /**
   * A registry carrying the two cases the gate exists to separate: a tool whose registration
   * DECLARES `readOnly: true`, and one that does not. Both are otherwise identical and both would
   * execute happily through the unconstrained gateway — the only thing separating them is the
   * declaration, which is the point.
   */
  function makeReadOnlyStack(): { registry: ToolRegistry; toolExecutor: ToolExecutor; ran: string[] } {
    const ran: string[] = [];
    const registry = createToolRegistry({});
    registry.register({
      descriptor: { id: 'reader', readOnly: true },
      policy: { authorize: () => 'allow' },
      handler: async (ctx) => {
        ran.push('reader');
        return { read: ctx.input };
      },
    });
    registry.register({
      descriptor: { id: 'writer' },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        ran.push('writer');
        return 'wrote something durable';
      },
    });
    return { registry, toolExecutor: createToolExecutor({ registry }), ran };
  }

  it('parses requireReadOnly off the body', () => {
    const result = delegatedToolExecuteRoute.parse({
      body: { runId: 'r1', toolUseId: 'tu-1', toolId: 't1', requireReadOnly: true },
      query: {},
      params: {},
    });
    expect(result).toEqual({
      ok: true,
      value: { runId: 'r1', toolUseId: 'tu-1', toolId: 't1', input: undefined, requireReadOnly: true },
    });
  });

  it('leaves requireReadOnly undefined when the body omits it, so the existing gateway is byte-identical', () => {
    const result = delegatedToolExecuteRoute.parse({ body: { runId: 'r1', toolUseId: 'tu-1', toolId: 't1' }, query: {}, params: {} });
    expect(result).toEqual({ ok: true, value: { runId: 'r1', toolUseId: 'tu-1', toolId: 't1', input: undefined } });
  });

  it('refuses a tool that is not declared read-only, with the exact remedy-bearing message, WITHOUT running its handler', async () => {
    const { registry, toolExecutor, ran } = makeReadOnlyStack();
    const deps = makeDeps({ toolExecutor, toolRegistry: registry });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'writer', requireReadOnly: true }, deps }
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TOOL_OPERATION_DENIED',
        message:
          'tool "writer" is not registered as read-only — this gateway executes only tools whose registration declares readOnly; call it through execute_delegated_tool instead',
      },
    });
    // The heart of the task: a readOnlyHint:true gateway that let a write through would launder a
    // write past the caller's own safety gate. The handler must never have been reached.
    expect(ran).toEqual([]);
  });

  it('executes a tool whose registration declares readOnly: true', async () => {
    const { registry, toolExecutor, ran } = makeReadOnlyStack();
    const deps = makeDeps({ toolExecutor, toolRegistry: registry });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'reader', input: { q: 1 }, requireReadOnly: true }, deps }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.result).toMatchObject({ status: 'completed', output: { read: { q: 1 } } });
    }
    expect(ran).toEqual(['reader']);
  });

  it('refuses an unregistered toolId under the constraint rather than falling through to ToolExecutor', async () => {
    const { registry, toolExecutor } = makeReadOnlyStack();
    const onInternalError = vi.fn();
    const deps = makeDeps({ toolExecutor, toolRegistry: registry, onInternalError });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'nope', requireReadOnly: true }, deps }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOOL_OPERATION_DENIED');
      expect(result.error.message).toContain('no tool "nope" is registered');
      expect(result.error.message).not.toContain('execute_delegated_tool');
    }
    expect(onInternalError).not.toHaveBeenCalled();
  });

  it('suggests content_read.<resource> first at read-only preflight without resolving identity or running a handler', async () => {
    const { registry, toolExecutor, ran } = makeReadOnlyStack();
    for (const id of ['content_read.backup_restore_point', 'content_read.theme']) {
      registry.register({ descriptor: { id, readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => ran.push(id) });
    }
    const resolvePrincipal = vi.fn(() => TEST_PRINCIPAL);
    const deps = makeDeps({ toolExecutor, toolRegistry: registry, resolvePrincipal });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: {
      runId: run.id, toolUseId: 'tu-1', toolId: 'content_read', input: { resource: 'theme' }, requireReadOnly: true,
    }, deps });
    expect(result).toEqual({ ok: false, error: {
      code: 'TOOL_OPERATION_DENIED',
      message: 'no tool "content_read" is registered; use search_tools — did you mean content_read.theme, content_read.backup_restore_point?',
    } });
    expect(resolvePrincipal).not.toHaveBeenCalled();
    expect(ran).toEqual([]);
  });

  it('fails CLOSED when the host mounted the route without a toolRegistry — an unverifiable constraint is refused, never waived', async () => {
    const { toolExecutor, ran } = makeReadOnlyStack();
    const deps = makeDeps({ toolExecutor });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'reader', requireReadOnly: true }, deps }
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TOOL_OPERATION_DENIED',
        message:
          'this host cannot verify read-only tools — POST /api/delegated-tool-calls was mounted without DelegatedToolsHttpDeps.toolRegistry, so a requireReadOnly call cannot be checked and is refused',
      },
    });
    expect(ran).toEqual([]);
  });

  it('leaves the unconstrained gateway unchanged: the same write tool still executes when requireReadOnly is absent', async () => {
    const { registry, toolExecutor, ran } = makeReadOnlyStack();
    const deps = makeDeps({ toolExecutor, toolRegistry: registry });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'writer' }, deps });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.result).toMatchObject({ status: 'completed', output: 'wrote something durable' });
    }
    expect(ran).toEqual(['writer']);
  });

  it('routes a permitted read-only call through the SAME bridge as the unconstrained gateway — identical tool_use/tool_result run events', async () => {
    const { registry, toolExecutor } = makeReadOnlyStack();
    const deps = makeDeps({ toolExecutor, toolRegistry: registry });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'reader', requireReadOnly: true }, deps });
    const events: unknown[] = [];
    await deps.lifecycle.stream({ runId: run.id, onEvent: (event) => events.push(event) });
    const agentEvents = (events as { kind: string; payload: { type: string } }[]).filter((e) => e.kind === 'agent');
    expect(agentEvents.map((e) => e.payload.type)).toEqual(['tool_use', 'tool_result']);
  });

  it('checks the constraint before resolvePrincipal, so a refused call costs nothing downstream', async () => {
    const { registry, toolExecutor } = makeReadOnlyStack();
    const resolvePrincipal = vi.fn(() => TEST_PRINCIPAL);
    const deps = makeDeps({ toolExecutor, toolRegistry: registry, resolvePrincipal });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
    await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'writer', requireReadOnly: true }, deps });
    expect(resolvePrincipal).not.toHaveBeenCalled();
  });

  /**
   * `checkReadOnlyConstraint` only ever validates the OUTER `toolId` — the id the caller named.
   * A consumer's own `ToolExecutor` composition can dispatch a DIFFERENT tool id one or more hops
   * in, using the exact same `principal` the outer call carried, and that nested dispatch never
   * passes back through this route's own check. `withNestedRemedyDispatch` below mimics exactly
   * such a composition (a downstream consumer's `withToolFailureRecovery` is the real-world instance
   * this is modeled on): a completed call whose output names a `remedyToolId` triggers one more dispatch,
   * through `inner`, of that id.
   *
   * Deliberately DUMB — it never calls `refuseNonReadOnlyDispatch` itself. The two tests below ask
   * two different questions using the exact same decorator: does `delegatedToolExecuteRoute`'s own
   * outer wrap alone stop this (first test — it must not, structurally: that wrap only ever sees the
   * OUTER `toolId`), and does composing the SHIPPED `withReadOnlyToolConstraint` innermost, the way
   * a real consumer is documented to, stop it (second test — it must, and for a reason this test
   * doesn't itself enforce).
   */
  function withNestedRemedyDispatch(inner: ToolExecutor, ran: string[]): ToolExecutor {
    return {
      ...inner,
      execute: async ({ principal, run, toolId, input }, { signal, emitSurface } = {}) => {
        const result = await inner.execute({ principal, run, toolId, input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) });
        const output = result.output;
        const remedyToolId =
          result.status === 'completed' && typeof output === 'object' && output !== null && typeof (output as Record<string, unknown>)['remedyToolId'] === 'string'
            ? ((output as Record<string, unknown>)['remedyToolId'] as string)
            : undefined;
        if (remedyToolId === undefined) return result;

        // Blindly re-dispatches through the SAME `inner` this decorator was built with — no
        // self-check. Whether this actually reaches a handler depends entirely on what `inner` is.
        await inner.execute({ principal, run, toolId: remedyToolId, input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) });
        return result;
      },
    };
  }

  function registerVerifyAndRemedyWrite(registry: ToolRegistry, ran: string[]): void {
    registry.register({
      descriptor: { id: 'verify', readOnly: true },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        ran.push('verify ran');
        return { hint: 'try the remedy', remedyToolId: 'remedy-write' };
      },
    });
    registry.register({
      descriptor: { id: 'remedy-write' },
      policy: { authorize: () => 'allow' },
      handler: async () => {
        ran.push('remedy-write ran');
        return 'wrote something durable';
      },
    });
  }

  it('the outer wrap `handle` composes around a host-supplied ToolExecutor is NOT enough on its own: a host that has not composed withReadOnlyToolConstraint into its own stack still leaks the nested dispatch', async () => {
    const ran: string[] = [];
    const registry = createToolRegistry({});
    registerVerifyAndRemedyWrite(registry, ran);
    // The host's own composition carries NO read-only gate anywhere in it — exactly what every
    // pre-existing consumer of this package has today, since `withReadOnlyToolConstraint` did not
    // exist before this change.
    const toolExecutor = withNestedRemedyDispatch(createToolExecutor({ registry }), ran);
    const deps = makeDeps({ toolExecutor, toolRegistry: registry });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });

    await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'verify', requireReadOnly: true }, deps });

    // `handle`'s own outer wrap only ever re-checks the OUTER toolId ('verify', already read-only),
    // so it cannot see this nested dispatch — the write handler still runs. This is a known,
    // documented limit (see `withReadOnlyToolConstraint`'s doc), not a regression to fix here: a
    // host MUST compose the decorator itself, innermost, to close this for its own stack — proven
    // by the next test.
    expect(ran).toEqual(['verify ran', 'remedy-write ran']);
  });

  it('a read-only-gated call cannot reach a write tool one hop in through a nested dispatch, when a consumer composes the SHIPPED withReadOnlyToolConstraint innermost around its own ToolExecutor — the real composition, with no bespoke enforcement in the test decorator itself', async () => {
    const ran: string[] = [];
    const registry = createToolRegistry({});
    registerVerifyAndRemedyWrite(registry, ran);

    // The composition a real consumer is expected to build, mirroring a downstream consumer's own
    // `withToolFailureRecovery(withReadOnlyToolConstraint(createToolExecutor(...)))`:
    // `withReadOnlyToolConstraint` innermost, directly around the bare executor, with the
    // consumer's own nested-dispatch decorator on top. `withNestedRemedyDispatch` here does NOT
    // check `refuseNonReadOnlyDispatch` itself (see its own doc above) — whatever refuses the
    // nested dispatch below is the shipped decorator sitting beneath it, nothing this test wrote.
    const gatedExecutor = withReadOnlyToolConstraint({ inner: createToolExecutor({ registry }), registry, messages: defaultDaemonMessages.readOnly, idGenerator: { newId: () => "denial" } });
    const toolExecutor = withNestedRemedyDispatch(gatedExecutor, ran);
    const deps = makeDeps({ toolExecutor, toolRegistry: registry });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });

    await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'verify', requireReadOnly: true }, deps });

    expect(ran).toEqual(['verify ran']);
  });
});

describe('delegated tool route: one incident owner (log safety)', () => {
  it('the sink gets the original error, tool and run IDs and logSource; the default line prints the class only', async () => {
    const failure = new Error('boom api_key=SECRETSECRETSECRETSECRET');
    const toolExecutor: ToolExecutor = { ...makeToolExecutor(), execute: async () => { throw failure; } };
    const onInternalError = vi.fn();
    const deps = makeDeps({ toolExecutor, onInternalError });
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-incident' });
    const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'nope' }, deps });
    if (result.ok) throw new Error('expected failure');
    expect(result.error.message).toBe('The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.');
    expect(onInternalError).toHaveBeenCalledWith({ source: 'delegated-tool-execute', error: failure, runId: run.id, toolId: 'nope', correlationId: result.error.requestId, logSource: 'delegated-tool-execute' });
    expect(onInternalError.mock.calls[0]?.[0].error).toBe(failure);
  });
});
