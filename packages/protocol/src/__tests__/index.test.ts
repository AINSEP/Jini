import { describe, expect, it } from 'vitest';
import {
  createApiError,
  createApiErrorResponse,
  isTerminalRunState,
  RUN_PROTOCOL_VERSION,
  type ApiError,
  type RunCancelRequest,
  type RunProtocolEvent,
  type RunStatus,
} from '../index.js';

describe('@injini/protocol', () => {
  it('constructs a full run event sequence through the transport-neutral envelope', () => {
    const runId = 'run_1';
    const envelope = (cursor: string, kind: RunProtocolEvent['kind'], payload: unknown) => ({
      runId,
      eventId: `${runId}:${cursor}`,
      opaqueCursor: cursor,
      protocolVersion: RUN_PROTOCOL_VERSION,
      ts: Number(cursor),
      kind,
      payload,
      durability: 'durable' as const,
    });
    const events: RunProtocolEvent[] = [
      envelope('0', 'start', { runId, idempotencyKey: 'req_1' }),
      envelope('1', 'agent', { type: 'text_delta', delta: 'hello' }),
      envelope('2', 'agent', { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.ts' } }),
      envelope('3', 'agent', { type: 'tool_result', toolUseId: 'tu_1', content: 'ok' }),
      envelope('4', 'end', { code: 0, status: 'succeeded' }),
    ] as RunProtocolEvent[];

    expect(events).toHaveLength(5);
    expect(events[0]?.kind).toBe('start');
    expect(events.at(-1)?.kind).toBe('end');
    expect(events.every((e) => e.runId === runId)).toBe(true);
    expect(events.every((e) => e.protocolVersion === RUN_PROTOCOL_VERSION)).toBe(true);
  });

  it('carries a generic ApiError without any product-specific error code', () => {
    const error: ApiError = createApiError('VALIDATION_FAILED', 'missing field', {
      details: { field: 'name' },
      retryable: false,
    });

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({ field: 'name' });
  });

  it('wraps an ApiError in the standard { error } response envelope', () => {
    const error = createApiError('NOT_FOUND', 'run "run_1" was not found');
    expect(createApiErrorResponse(error)).toEqual({ error });
  });

  it('tracks a run through queued -> running -> succeeded', () => {
    const run: RunStatus = { id: 'run_1', state: 'queued' };
    expect(isTerminalRunState(run.state)).toBe(false);

    const running: RunStatus = { ...run, state: 'running', startedAt: 1 };
    expect(isTerminalRunState(running.state)).toBe(false);

    const done: RunStatus = { ...running, state: 'succeeded', endedAt: 2 };
    expect(isTerminalRunState(done.state)).toBe(true);
  });

  it('models a cancellation request against a run id, not a transport detail', () => {
    const cancel: RunCancelRequest = { runId: 'run_1', reason: 'user requested' };
    expect(cancel.runId).toBe('run_1');
  });
});
