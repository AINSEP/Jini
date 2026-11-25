import { expect, test, vi } from 'vitest';
import { pseudonymousUserId, toolCallLabel, withToolCallObservability, ToolExecutionFailure } from '../observability.js';
import type { ToolExecutor } from "../../tool-executor-types.js";
import type { Principal } from '@jini-ai/core';
import { createRecordingReporter } from '@jini-ai/core/errors/testing';

test.each(['', 'a'.repeat(129), 'person@example.org'])('replaces unsafe principal id %s', id => {
  expect(pseudonymousUserId({ principal: { id } as Principal })).toBe('unidentified');
});

test('an absent registration answer permits a safe id, while an explicit refusal hides it', () => {
  expect(toolCallLabel({ toolId: 'pages.list' }, {})).toBe('pages.list');
  expect(toolCallLabel({ toolId: 'pages.list' }, { isRegisteredTool: () => false })).toBe('unregistered');
});

test('missing failure text reports the stable status and execute forwards cancellation and surface ports', async () => {
  const result = { executionId: 'e', status: 'failed' as const };
  const execute = vi.fn(async () => result);
  const inner: ToolExecutor = { execute, resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null };
  const { reporter, reports } = createRecordingReporter({ ids: ['ERR-0001-0000-0000-0000'], iso: '2026-11-25T00:00:00.000Z' });
  const end = vi.fn();
  const wrapped = withToolCallObservability({ inner, reporter, observability: {
    trackOperation: () => ({ run: work => work(), end }),
  } });
  const input = { principal: { id: 'owner' } as Principal, run: { id: 'r' }, toolId: 'pages.list', input: { page: 1 } };
  const signal = new AbortController().signal;
  const emitSurface = vi.fn();
  expect(await wrapped.execute(input, { signal, emitSurface })).toBe(result);
  expect(execute).toHaveBeenCalledWith(input, { signal, emitSurface });
  expect(reports).toHaveLength(1);
  const error = reports[0]!.error as Error;
  expect(error).toBeInstanceOf(ToolExecutionFailure);
  expect(error.message).toBe('failed');
  expect(end).toHaveBeenCalledWith({ outcome: 'failed', failed: true, attributes: { 'tool.error_kind': 'internal' } });
});
