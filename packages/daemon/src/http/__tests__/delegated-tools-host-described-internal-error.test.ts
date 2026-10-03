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

vi.mock('@jini-ai/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@jini-ai/core')>(),
  isLocalSameOrigin: vi.fn(() => true),
}));

const PRINCIPAL: Principal = { id: 'test-principal' };
const GENERIC = 'an internal error occurred';

/** A real executor over an EMPTY registry: any tool id makes `execute` throw `unknown tool`. */
function emptyRegistryExecutor(): ToolExecutor {
  return createToolExecutor({ registry: createToolRegistry({}) });
}

/** An executor that settles every call with `result`, without running anything. */
function settlingExecutor(result: ToolExecutionResult): ToolExecutor {
  return { ...emptyRegistryExecutor(), execute: async () => result };
}

async function callRoute(
  toolExecutor: ToolExecutor,
  overrides: Partial<DelegatedToolsHttpDeps> = {},
  toolId = 'nope',
) {
  const onInternalError = vi.fn();
  const deps: DelegatedToolsHttpDeps = {
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
  it('an unknown tool id (executor throws) answers with the host text instead of the generic message', async () => {
    const describeInternalError = vi.fn((context: DelegatedToolsInternalErrorContext) =>
      `Error ERR-1: ${(context.error as Error).message}`,
    );
    const { result, onInternalError, runId } = await callRoute(emptyRegistryExecutor(), { describeInternalError });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Error ERR-1: ToolExecutor: unknown tool "nope"', requestId: expect.any(String) },
    });
    const requestId = requestIdOf(result);
    expect(describeInternalError).toHaveBeenCalledTimes(1);
    const context = describeInternalError.mock.calls[0]![0];
    expect(context).toMatchObject({ source: 'delegated-tool-execute', runId, toolId: 'nope', correlationId: requestId });
    expect(context.status).toBeUndefined();
    // The operator sink still sees the same correlated failure — describing never replaces logging.
    expect(onInternalError).toHaveBeenCalledTimes(1);
    expect(onInternalError.mock.calls[0]![0]).toMatchObject({ correlationId: requestId });
  });

  it.each(['timed-out', 'cancelled'] as const)('a %s result reaches the host with its status', async (status) => {
    const describeInternalError = vi.fn((context: DelegatedToolsInternalErrorContext) => `tool ${context.toolId} ${context.status}`);
    const { result } = await callRoute(settlingExecutor({ executionId: 'x', status }), { describeInternalError }, 'slow');

    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: `tool slow ${status}`, requestId: expect.any(String) } });
    expect(describeInternalError.mock.calls[0]![0]).toMatchObject({ source: 'delegated-tool-execute', status });
  });

  it('a failed result the host did not mark model-safe reaches the host with status failed and its error text', async () => {
    const describeInternalError = vi.fn((_context: DelegatedToolsInternalErrorContext) => 'described');
    const { result } = await callRoute(
      settlingExecutor({ executionId: 'x', status: 'failed', error: 'recovery gave up', errorKind: 'internal' }),
      { describeInternalError },
    );

    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'described', requestId: expect.any(String) } });
    expect(describeInternalError.mock.calls[0]![0]).toMatchObject({ status: 'failed', error: 'recovery gave up' });
  });

  it('a throwing resolvePrincipal is described too, with source resolve-principal', async () => {
    const describeInternalError = vi.fn((context: DelegatedToolsInternalErrorContext) => (context.error as Error).message);
    const { result } = await callRoute(emptyRegistryExecutor(), {
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
    ['returns an empty string', () => ''],
    [
      'throws',
      () => {
        throw new Error('describer bug');
      },
    ],
  ])('falls back to the generic message when the host describer %s', async (_label, describeInternalError) => {
    const { result, onInternalError } = await callRoute(emptyRegistryExecutor(), { describeInternalError });

    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: GENERIC, requestId: expect.any(String) } });
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  it('secure by default: without describeInternalError the thrown text never reaches the response', async () => {
    const { result } = await callRoute(emptyRegistryExecutor());

    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: GENERIC, requestId: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain('unknown tool');
  });
});
