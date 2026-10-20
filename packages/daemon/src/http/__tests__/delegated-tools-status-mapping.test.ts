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

/**
 * Pins `toolExecutionResultToApiResult`'s full status table through the public route, one settled
 * `ToolExecutionResult` per test, so the mapping can be split without changing any outcome.
 */

const PRINCIPAL: Principal = { id: 'test-principal' };

/** An executor that settles every call with `result`, without running anything. */
function settlingExecutor(result: ToolExecutionResult): ToolExecutor {
  return { ...createToolExecutor({ registry: createToolRegistry({}) }), execute: async () => result };
}

async function callRoute(result: ToolExecutionResult, overrides: Partial<DelegatedToolsHttpDeps> = {}) {
  const onInternalError = vi.fn<(context: DelegatedToolsInternalErrorContext) => void>();
  const deps: DelegatedToolsHttpDeps = {
    lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}) }),
    toolExecutor: settlingExecutor(result),
    resolvePrincipal: () => PRINCIPAL,
    onInternalError,
    ...overrides,
  };
  const { run } = await deps.lifecycle.start({ contextRef: 'ctx-status-mapping' });
  const response = await delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'any' }, deps });
  return { response, onInternalError, runId: run.id };
}

describe('delegated tool route: ToolExecutionResult status mapping', () => {
  it('completed answers ok with the result itself', async () => {
    const result: ToolExecutionResult = { executionId: 'x', status: 'completed', output: 'done' };
    const { response, onInternalError } = await callRoute(result);
    expect(response).toEqual({ ok: true, value: { result } });
    expect(onInternalError).not.toHaveBeenCalled();
  });

  it('denied answers TOOL_OPERATION_DENIED with the policy message', async () => {
    const { response } = await callRoute({ executionId: 'x', status: 'denied' });
    expect(response).toEqual({ ok: false, error: { code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied by policy' } });
  });

  it('confirmation-denied answers TOOL_OPERATION_DENIED with the confirmation message', async () => {
    const { response } = await callRoute({ executionId: 'x', status: 'confirmation-denied' });
    expect(response).toEqual({ ok: false, error: { code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied during confirmation' } });
  });

  it('timed-out reports the status itself as the error and as context.status', async () => {
    const { response, onInternalError, runId } = await callRoute({ executionId: 'x', status: 'timed-out', error: 'ignored text' });
    expect(response).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred' } });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ source: 'delegated-tool-execute', runId, toolId: 'any', error: 'timed-out', status: 'timed-out' }));
  });

  it('cancelled reports the status itself as the error and as context.status', async () => {
    const { onInternalError } = await callRoute({ executionId: 'x', status: 'cancelled' });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ error: 'cancelled', status: 'cancelled' }));
  });

  it('failed + validation with an error answers BAD_REQUEST carrying that error', async () => {
    const { response } = await callRoute({ executionId: 'x', status: 'failed', errorKind: 'validation', error: 'themeId "zz" does not exist' });
    expect(response).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'themeId "zz" does not exist' } });
  });

  it('failed + validation without an error answers BAD_REQUEST with the fallback message', async () => {
    const { response, onInternalError } = await callRoute({ executionId: 'x', status: 'failed', errorKind: 'validation' });
    expect(response).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'invalid tool input' } });
    expect(onInternalError).not.toHaveBeenCalled();
  });

  it('failed + validation wins over a host model-safe marker (the marker is never consulted)', async () => {
    const isModelSafeToolFailure = vi.fn(() => true);
    const { response } = await callRoute({ executionId: 'x', status: 'failed', errorKind: 'validation', error: 'bad field' }, { isModelSafeToolFailure });
    expect(response).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'bad field' } });
    expect(isModelSafeToolFailure).not.toHaveBeenCalled();
  });

  it('failed with an empty error never consults the model-safe marker and stays the redacted 500', async () => {
    const isModelSafeToolFailure = vi.fn(() => true);
    const { response, onInternalError } = await callRoute({ executionId: 'x', status: 'failed', errorKind: 'internal', error: '' }, { isModelSafeToolFailure });
    expect(response).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred' } });
    expect(isModelSafeToolFailure).not.toHaveBeenCalled();
    // `''` is not nullish, so the sink receives the empty text rather than the status.
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ error: '', status: 'failed' }));
  });

  it('failed without an error reports the status as the error, with context.status "failed"', async () => {
    const { onInternalError } = await callRoute({ executionId: 'x', status: 'failed' });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ error: 'failed', status: 'failed' }));
  });

  it('failed + internal that the host declines stays the redacted 500 with the raw error in the sink', async () => {
    const result: ToolExecutionResult = { executionId: 'x', status: 'failed', errorKind: 'internal', error: 'secret detail' };
    const isModelSafeToolFailure = vi.fn(() => false);
    const { response, onInternalError } = await callRoute(result, { isModelSafeToolFailure });
    expect(response).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred' } });
    expect(isModelSafeToolFailure).toHaveBeenCalledWith({ result });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ error: 'secret detail', status: 'failed' }));
  });

  it('failed + internal the host vouches for answers TOOL_EXECUTION_FAILED with the text verbatim', async () => {
    const { response, onInternalError } = await callRoute({ executionId: 'x', status: 'failed', errorKind: 'internal', error: 'no frontend bound' }, { isModelSafeToolFailure: () => true });
    expect(response).toEqual({ ok: false, error: { code: 'TOOL_EXECUTION_FAILED', message: 'no frontend bound' } });
    expect(onInternalError).not.toHaveBeenCalled();
  });
});
