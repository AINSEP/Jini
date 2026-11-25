import { reportRouteInternalError } from '@jini-ai/http-kit';
import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry, type Principal } from '@jini-ai/core';
import {
  createInMemoryEventLog,
  createRunLifecycle,
  createToolExecutor,
  type ToolExecutionResult,
  type ToolExecutor,
} from '../../index.js';
import { delegatedToolExecuteRoute, type DelegatedToolsHttpDeps, type DelegatedToolsInternalErrorContext } from '../delegated-tools.js';

const PRINCIPAL: Principal = { id: 'test-principal' };
const DESCRIBED_ID = 'ERR-00AA-0000-0000-0001';
/** A describer answer: the id the host recorded under, and the words. */
const said = (message: string) => ({ errorId: DESCRIBED_ID, message });
const GENERIC = 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.';

/** Injects an infrastructure failure; unknown tool ids are caller input errors. */
function throwingExecutor(): ToolExecutor {
  return {
    ...createToolExecutor({ registry: createToolRegistry({}) }),
    execute: async () => { throw new Error('executor unavailable'); },
  };
}

/** An executor that settles every call with `result`, without running anything. */
function settlingExecutor(result: ToolExecutionResult): ToolExecutor {
  return { ...throwingExecutor(), execute: async () => result };
}

async function callRoute(
  toolExecutor: ToolExecutor,
  overrides: Partial<DelegatedToolsHttpDeps> = {},
  toolId = 'nope',
) {
  const onInternalError = vi.fn();
  const deps: DelegatedToolsHttpDeps = { reportInternalError: reportRouteInternalError,
    lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}) }),
    toolExecutor,
    resolvePrincipal: () => PRINCIPAL,
    onInternalError,
    ...overrides,
  };
  const { run } = await deps.lifecycle.start({ contextRef: 'ctx-described' });
  const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId }, deps });
  return { result, onInternalError, runId: run.id };
}

/** The `requestId` of an INTERNAL_ERROR result, failing the test for any other shape. */
function requestIdOf(result: Awaited<ReturnType<typeof callRoute>>['result']): string {
  if (result.ok) throw new Error('expected an error result');
  expect(result.error.code).toBe('INTERNAL_ERROR');
  expect(typeof result.error.requestId).toBe('string');
  return result.error.requestId as string;
}

describe('delegated tool route: describeInternalError (host-supplied model-safe text for the 500)', () => {
  it.each([false, true])('redacts the default failure log while retaining request IDs; a throwing describer adds no console line (describer=%s)', async (describerThrows) => {
    const secret = 'sk-live-0123456789abcdefghijklmnopqrstuv';
    const failure = Object.assign(new Error(`UPSTREAM_FAILED ${secret} Bearer abcdefghijklmnopqrst password=hunter2`), { code: 'ECONNREFUSED' });
    const executor = { ...throwingExecutor(), execute: async () => { throw failure; } };
    const deps: DelegatedToolsHttpDeps = { reportInternalError: reportRouteInternalError,
      lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}) }),
      toolExecutor: executor,
      resolvePrincipal: () => PRINCIPAL,
      ...(describerThrows ? { describeInternalError: () => { throw failure; } } : {}),
    };
    const { run } = await deps.lifecycle.start({ contextRef: 'ctx-log-redaction' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-log', toolId: 'broken' }, deps });
      const requestId = requestIdOf(result);
      expect(log).toHaveBeenCalledTimes(1);
      for (const line of log.mock.calls) {
        const output = line.map(String).join(' ');
        expect(output).toContain(requestId);
        expect(output).not.toContain('UPSTREAM_FAILED');
        for (const value of [secret, 'abcdefghijklmnopqrst', 'hunter2']) expect(output).not.toContain(value);
        expect(output).toContain('ECONNREFUSED');
      }
    } finally { log.mockRestore(); }
  });

  it('an executor infrastructure failure answers with the host id and text instead of the generic message', async () => {
    const describeInternalError = vi.fn((context: DelegatedToolsInternalErrorContext) =>
      said(`Error ${DESCRIBED_ID}: ${(context.error as Error).message}`),
    );
    const { result, onInternalError, runId } = await callRoute(throwingExecutor(), { describeInternalError });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: `Error ${DESCRIBED_ID}: executor unavailable`, requestId: DESCRIBED_ID },
    });
    expect(describeInternalError).toHaveBeenCalledTimes(1);
    const context = describeInternalError.mock.calls[0]![0];
    expect(context).toMatchObject({ source: 'delegated-tool-execute', runId, toolId: 'nope' });
    expect(context.status).toBeUndefined();
    expect(context.errorId).toBeUndefined();
    // The operator sink still sees the same correlated failure — describing never replaces logging, it
    // moves it: the describer owns the incident (recording under the id it returns), so the route writes
    // no second record under another id.
    expect(onInternalError).not.toHaveBeenCalled();
  });

  it.each(['timed-out', 'cancelled'] as const)('a %s result reaches the host with its status', async (status) => {
    const describeInternalError = vi.fn((context: DelegatedToolsInternalErrorContext) => said(`tool ${context.toolId} ${context.status}`));
    const { result } = await callRoute(settlingExecutor({ executionId: 'x', status }), { describeInternalError }, 'slow');

    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: `tool slow ${status}`, requestId: DESCRIBED_ID } });
    expect(describeInternalError.mock.calls[0]![0]).toMatchObject({ source: 'delegated-tool-execute', status });
  });

  it('a failed result the host did not mark model-safe reaches the host with status failed and its error text', async () => {
    const describeInternalError = vi.fn((_context: DelegatedToolsInternalErrorContext) => said('described'));
    const { result } = await callRoute(
      settlingExecutor({ executionId: 'x', status: 'failed', error: 'recovery gave up', errorKind: 'internal' }),
      { describeInternalError },
    );

    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'described', requestId: DESCRIBED_ID } });
    expect(describeInternalError.mock.calls[0]![0]).toMatchObject({ status: 'failed', error: 'recovery gave up' });
  });

  it('a throwing resolvePrincipal is described too, with source resolve-principal', async () => {
    const describeInternalError = vi.fn((context: DelegatedToolsInternalErrorContext) => said((context.error as Error).message));
    const { result } = await callRoute(throwingExecutor(), {
      describeInternalError,
      resolvePrincipal: () => {
        throw new Error('no principal is tracked for run "r"');
      },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'no principal is tracked for run "r"', requestId: expect.any(String) },
    });
    expect(describeInternalError.mock.calls[0]![0]).toMatchObject({ source: 'resolve-principal' });
  });

  it.each([
    ['returns undefined', () => undefined],
    ['returns empty words', () => ({ errorId: DESCRIBED_ID, message: '' })],
    ['returns no id', () => ({ errorId: '', message: 'words' })],
    [
      'throws',
      () => {
        throw new Error('describer bug');
      },
    ],
  ])('falls back to the generic message when the host describer %s', async (_label, describeInternalError) => {
    const { result, onInternalError } = await callRoute(throwingExecutor(), { describeInternalError });

    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: GENERIC, requestId: expect.any(String) } });
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  it('secure by default: without describeInternalError the thrown text never reaches the response', async () => {
    const { result } = await callRoute(throwingExecutor());

    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: GENERIC, requestId: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain('executor unavailable');
  });
});

it('loads bounded host recovery facts once after interruption and hands them to the redacted describer', async () => {
  const recoverInterruptedTool = vi.fn(async (_required: Parameters<NonNullable<DelegatedToolsHttpDeps['recoverInterruptedTool']>>[0]) => 'Deployment: created; files: 4/5; read job-1 before retrying.');
  const describeInternalError = vi.fn((context: DelegatedToolsInternalErrorContext) => said(context.recoveryMessage ?? 'unknown'));
  const { result } = await callRoute(settlingExecutor({ executionId: 'x', status: 'timed-out' }), { recoverInterruptedTool, describeInternalError }, 'publish');
  expect(recoverInterruptedTool).toHaveBeenCalledTimes(1);
  expect(recoverInterruptedTool.mock.calls[0]![0]).toMatchObject({ principal: PRINCIPAL, toolId: 'publish', result: { executionId: 'x', status: 'timed-out' } });
  expect(result).toMatchObject({ ok: false, error: { message: 'Deployment: created; files: 4/5; read job-1 before retrying.' } });
});

it('recovery lookup failure preserves the interruption response and never leaks the thrown value', async () => {
  const { result } = await callRoute(settlingExecutor({ executionId: 'x', status: 'timed-out' }), {
    recoverInterruptedTool: async () => { throw new Error('secret-canary'); },
    describeInternalError: context => said(`interrupted: ${context.status}`),
  }, 'publish');
  expect(result).toMatchObject({ ok: false, error: { message: 'interrupted: timed-out' } });
  expect(JSON.stringify(result)).not.toContain('secret-canary');
});
