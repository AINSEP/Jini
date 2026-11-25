import { describe, expect, it, vi } from 'vitest';
import { fakeDaemonRouteHost, injectedRecordingReporter, withInjectedReporter } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { createToolRegistry, type Principal } from '@jini-ai/core';
import {
  createInMemoryEventLog,
  createRunLifecycle,
  createToolExecutor,
  type ToolExecutionResult,
  type ToolExecutor,
} from '../../index.js';
import { delegatedToolExecuteRoute, delegatedToolRoutes, type DelegatedToolsHttpDeps } from '../delegated-tools.js';

const PRINCIPAL: Principal = { id: 'test-principal' };
const ERROR_ID = 'ERR-E498-0000-1111-2222';
const SAFE_MESSAGE = `Error ${ERROR_ID}: no frontend is bound to run "admin-run", so "admin.publish_content" cannot be executed`;
const SECRET = 'FAKE-SECRET-VALUE-MUST-NOT-REACH-THE-WIRE';

/** A host-style marker: the host's own redaction layer adds `errorId` after blanking secrets. */
type HostResult = ToolExecutionResult & { readonly errorId?: string };
const hostRedacted = ({ result }: { result: ToolExecutionResult }): boolean => 'errorId' in result && typeof result.errorId === 'string';

/** A real executor whose one tool throws `message`, wrapped the way a host redaction decorator
 * would — attaching `errorId` to a `failed` result only when `errorId` is given. */
function makeExecutor(message: string, errorId?: string): ToolExecutor {
  const registry = createToolRegistry({});
  registry.register({
    descriptor: { id: 'fails' },
    policy: { authorize: () => 'allow' },
    handler: async () => {
      throw new Error(message);
    },
  });
  const inner = createToolExecutor({ registry });
  return {
    ...inner,
    execute: async (...args: Parameters<ToolExecutor['execute']>) => {
      const result = await inner.execute(...args);
      return result.status === 'failed' && errorId !== undefined ? { ...result, errorId } : result;
    },
  };
}

async function callRoute(toolExecutor: ToolExecutor, overrides: Partial<DelegatedToolsHttpDeps> = {}) {
  const onInternalError = vi.fn();
  const deps: DelegatedToolsHttpDeps = { lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}) }),
    toolExecutor,
    resolvePrincipal: () => PRINCIPAL,
    reportInternalError: injectedRecordingReporter({ record: onInternalError }),
    ...overrides,
  };
  const { run } = await deps.lifecycle.start({ contextRef: 'ctx-host-safe' });
  const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'fails' }, deps });
  return { result, onInternalError, deps, runId: run.id };
}

describe('delegated tool route: a failure the host marks model-safe', () => {
  it('failed + host marker: returns the host-redacted message as TOOL_EXECUTION_FAILED, not a redacted 500', async () => {
    const { result, onInternalError } = await callRoute(makeExecutor(SAFE_MESSAGE, ERROR_ID), {
      isModelSafeToolFailure: hostRedacted,
    });
    expect(result).toEqual({ ok: false, error: { code: 'TOOL_EXECUTION_FAILED', message: SAFE_MESSAGE } });
    expect(onInternalError).not.toHaveBeenCalled();
  });

  it('answers the marked failure with HTTP 422 on the mounted route', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-http' });
    const fetch = serveRoutes({ routes: delegatedToolRoutes({ deps: { lifecycle, toolExecutor: makeExecutor(SAFE_MESSAGE, ERROR_ID), resolvePrincipal: () => PRINCIPAL, isModelSafeToolFailure: hostRedacted }, host: fakeDaemonRouteHost() }) });
    const response = await fetch(jsonRequest({ path: '/api/delegated-tool-calls', method: 'POST' }, { body: { runId: run.id, toolUseId: 'tu-1', toolId: 'fails' } }));
    expect([response.status, await response.json()]).toEqual([422, { error: { code: 'TOOL_EXECUTION_FAILED', message: SAFE_MESSAGE } }]);
  });

  it('failed WITHOUT the marker: still the SEC-005-redacted INTERNAL_ERROR even with the predicate wired', async () => {
    const { result, onInternalError } = await callRoute(makeExecutor('boom: internal detail'), {
      isModelSafeToolFailure: hostRedacted,
    });
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.', requestId: expect.any(String) },
    });
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  it('a secret-looking message without the marker never reaches the response', async () => {
    const { result } = await callRoute(makeExecutor(`upstream said: token=${SECRET}`), {
      isModelSafeToolFailure: hostRedacted,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('secure by default: a host that does not opt in keeps the redacted 500 even when errorId is present', async () => {
    const { result } = await callRoute(makeExecutor(`token=${SECRET}`, ERROR_ID));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('only ever applies to `failed`: a timed-out result stays redacted even if the predicate says yes', async () => {
    const timedOut: ToolExecutor = {
      ...makeExecutor('unused'),
      execute: async () => ({ executionId: 'x', status: 'timed-out', error: `token=${SECRET}` }),
    };
    const { result } = await callRoute(timedOut, { isModelSafeToolFailure: () => true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('a marked failure with no error text falls back to the redacted 500 (nothing safe to show)', async () => {
    const noText: ToolExecutor = {
      ...makeExecutor('unused'),
      execute: async () => ({ executionId: 'x', status: 'failed', errorKind: 'internal', errorId: ERROR_ID }) as HostResult,
    };
    const { result } = await callRoute(noText, { isModelSafeToolFailure: hostRedacted });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTERNAL_ERROR');
  });
});
