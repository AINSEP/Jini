import { describe, expect, it, vi } from 'vitest';
import { withToolCallAnalytics } from '../analytics.js';
import type { ToolExecutionResult, ToolExecutor } from '../../tool-executor.js';

const call = { principal: { id: 'operator' } as never, run: { id: 'run' }, toolId: 'pages_list', input: { private: 'not telemetry' } };
function executor(result: ToolExecutionResult): ToolExecutor {
  return { execute: vi.fn(async () => result), resumeConfirmation: vi.fn(), cancel: vi.fn(), getAuditRecord: vi.fn(() => null) };
}

describe('tool-call product analytics', () => {
  it.each([
    ['completed', false], ['denied', false], ['confirmation-denied', false], ['cancelled', false], ['timed-out', true],
  ] as const)('labels %s outcomes without treating ordinary control flow as failure', async (status, failed) => {
    const result: ToolExecutionResult = { executionId: 'e', status };
    const inner = executor(result);
    const capture = vi.fn();
    const signal = new AbortController().signal;
    const emitSurface = vi.fn();
    const decorated = withToolCallAnalytics({ inner, analytics: { capture } });
    expect(await decorated.execute(call, { signal, emitSurface })).toBe(result);
    expect(inner.execute).toHaveBeenCalledTimes(1);
    expect(inner.execute).toHaveBeenCalledWith(call, { signal, emitSurface });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({ name: 'tool_call', userId: 'operator',
      properties: { tool_id: 'pages_list', outcome: status, failed } });
  });

  it('uses internal for an unclassified failure and forwards optional controls without adding fields', async () => {
    const capture = vi.fn();
    const result: ToolExecutionResult = { executionId: 'e', status: 'failed', error: 'private failure' };
    const inner = executor(result);
    const decorated = withToolCallAnalytics({ inner, analytics: { capture } });
    expect(await decorated.execute(call)).toBe(result);
    expect(inner.execute).toHaveBeenCalledTimes(1);
    expect(inner.execute).toHaveBeenCalledWith(call, {});
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({ name: 'tool_call', userId: 'operator',
      properties: { tool_id: 'pages_list', outcome: 'failed', failed: true, error_kind: 'internal' } });
    const confirmation = { executionId: 'e', decision: 'approve' as never };
    const identity = { executionId: 'e' };
    decorated.resumeConfirmation(confirmation);
    decorated.cancel(identity);
    expect(decorated.getAuditRecord(identity)).toBeNull();
    expect(inner.resumeConfirmation).toHaveBeenCalledTimes(1);
    expect(inner.resumeConfirmation).toHaveBeenCalledWith(confirmation);
    expect(inner.cancel).toHaveBeenCalledTimes(1);
    expect(inner.cancel).toHaveBeenCalledWith(identity);
    expect(inner.getAuditRecord).toHaveBeenCalledTimes(1);
    expect(inner.getAuditRecord).toHaveBeenCalledWith(identity);
  });

  it('preserves results and throws when the analytics vendor itself throws', async () => {
    const capture = vi.fn(() => { throw new Error('analytics unavailable'); });
    const result: ToolExecutionResult = { executionId: 'e', status: 'completed', output: 'kept' };
    const inner = executor(result);
    const decorated = withToolCallAnalytics({ inner, analytics: { capture } });
    expect(await decorated.execute(call)).toBe(result);
    const failure = new Error('executor failure');
    vi.mocked(inner.execute).mockRejectedValueOnce(failure);
    await expect(decorated.execute(call)).rejects.toBe(failure);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenLastCalledWith({ name: 'tool_call', userId: 'operator',
      properties: { tool_id: 'pages_list', outcome: 'threw', failed: true } });
  });
});
