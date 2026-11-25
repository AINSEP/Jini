import { createReporterRouteInternalError } from '@jini-ai/http-kit';
import { createRecordingReporter } from '@jini-ai/core/errors/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolRegistry, type Principal } from '@jini-ai/core';
import { createInMemoryEventLog, createRunLifecycle, createToolExecutor, type ToolExecutionResult, type ToolExecutor } from '../../index.js';
import { delegatedToolErrorDisclosure } from '../../tool-recovery/redaction.js';
import { withToolCallObservability } from '../../tool-recovery/observability.js';
import { delegatedToolExecuteRoute, type DelegatedToolsHttpDeps } from '../delegated-tools.js';

const PRINCIPAL: Principal = { id: 'test-principal' };
const IDS = ['ERR-0001-0000-0000-0000', 'ERR-0002-0000-0000-0000', 'ERR-0003-0000-0000-0000'];
const CLIENT_ID = 'ERR-FFFF-FFFF-FFFF-FFFF';
const GENERIC = 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.';

function executorDoing(execute: ToolExecutor['execute']): ToolExecutor {
  return { ...createToolExecutor({ registry: createToolRegistry({}) }), execute };
}

/** The daemon's own wiring: one recording reporter behind the tool decorator, the disclosure and the route fallback. */
function wired({ inner, decorate = true, disclose = true }: { inner: ToolExecutor; decorate?: boolean; disclose?: boolean }, overrides: Partial<DelegatedToolsHttpDeps> = {}) {
  const rec = createRecordingReporter({ ids: IDS, iso: '2026-11-25T00:00:00.000Z' });
  const disclosure = delegatedToolErrorDisclosure({ reporter: rec.reporter, redactSecretShapes: ({ text }) => ({ text, redactions: 0 }) });
  const deps: DelegatedToolsHttpDeps = {
    reportInternalError: createReporterRouteInternalError({ reporter: rec.reporter }),
    lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}) }),
    toolExecutor: decorate ? withToolCallObservability({ inner, reporter: rec.reporter }, {}) : inner,
    resolvePrincipal: () => PRINCIPAL,
    ...(disclose ? disclosure : {}),
    ...overrides,
  };
  const call = async (input: unknown = {}, toolId = 'slow') => {
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-incident' });
    return delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId, input }, deps });
  };
  return { rec, call };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('delegated tool route: one incident, one id', () => {
  it("a thrown tool error answered by the delegated route keeps the decorator's id and is reported once", async () => {
    const { rec, call } = wired({ inner: executorDoing(async () => { throw new Error('db down'); }) });
    const result = await call();
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: `Error ${IDS[0]}: db down`, requestId: IDS[0] } });
    expect(rec.entries).toHaveLength(1);
    expect(rec.reports).toHaveLength(1);
  });

  it('a timed-out tool answered by the delegated route is reported once with one id', async () => {
    const timedOut: ToolExecutionResult = { executionId: 'x', status: 'timed-out' };
    for (const disclose of [true, false]) {
      const { rec, call } = wired({ inner: executorDoing(async () => timedOut), disclose });
      const result = await call();
      const message = disclose ? `Error ${IDS[0]}: tool "slow" timed out before it finished` : `${GENERIC} (error ${IDS[0]})`;
      expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message, requestId: IDS[0] } });
      expect(rec.entries).toHaveLength(1);
      expect(rec.reports).toHaveLength(1);
    }
  });

  it('a throwing describeInternalError writes no console line and keeps one id', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const describerFailure = new Error('describer bug sk-live-0123456789abcdefghij');
    const describeInternalError = () => { throw describerFailure; };
    for (const warn of [vi.fn(), vi.fn(() => { throw new Error('logger down'); })]) {
      const { rec, call } = wired({ inner: executorDoing(async () => { throw new Error('db down'); }) }, { describeInternalError, logger: { warn } });
      const result = await call();
      expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: `${GENERIC} (error ${IDS[0]})`, requestId: IDS[0] } });
      expect(rec.entries).toHaveLength(1);
      expect(rec.reports).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('describer bug');
    }
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('a client-supplied id is never taken as proof of recording', async () => {
    const { rec, call } = wired({ inner: executorDoing(async () => ({ executionId: 'x', status: 'timed-out' })), decorate: false, disclose: false });
    const result = await call({ errorId: CLIENT_ID });
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: `${GENERIC} (error ${IDS[0]})`, requestId: IDS[0] } });
    expect(rec.entries).toHaveLength(1);
  });
});
