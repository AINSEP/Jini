import { describe, expect, it } from 'vitest';
import { RUN_PROTOCOL_VERSION, type RunEventPayload, type RunProtocolEvent } from '@jini/protocol';
import { createAguiEncoder } from '../encoder.js';

const RUN_ID = 'run-1';
let eventCounter = 0;

/**
 * Builds a minimal, real `RunProtocolEvent` for a test fixture — every field the encoder itself
 * does not read (`runId`/`opaqueCursor`/`protocolVersion`/`ts`/`durability`) gets a fixed
 * placeholder value; only `kind`/`payload` (and `eventId`, for readable failure output) vary per
 * call. `payload`'s type is tied to `Name` via `RunEventPayload` (rather than a plain generic
 * inferred from the argument) specifically so a literal like `status: 'succeeded'` stays narrowed
 * to that literal type instead of widening to `string` during inference.
 */
function runEvent<Name extends RunProtocolEvent['kind']>(
  kind: Name,
  payload: RunEventPayload<RunProtocolEvent, Name>,
  eventId = `evt-${++eventCounter}`,
): RunProtocolEvent {
  return {
    runId: RUN_ID,
    eventId,
    opaqueCursor: eventId,
    protocolVersion: RUN_PROTOCOL_VERSION,
    ts: 0,
    kind,
    payload,
    durability: 'durable',
  } as RunProtocolEvent;
}

function agentEvent(payload: RunEventPayload<RunProtocolEvent, 'agent'>, eventId?: string): RunProtocolEvent {
  return runEvent('agent', payload, eventId);
}

describe('createAguiEncoder — kernel lifecycle events', () => {
  it('encodes a start event as run.lifecycle started', () => {
    const encoder = createAguiEncoder();
    const event: RunProtocolEvent = runEvent('start', { runId: RUN_ID, contextRef: 'ctx-1' });
    expect(encoder.encode(event, { runId: RUN_ID, now: () => 100 })).toEqual({
      kind: 'run.lifecycle',
      status: 'started',
      runId: RUN_ID,
      ts: 100,
    });
  });

  it('encodes an end event with status "succeeded" as completed', () => {
    const encoder = createAguiEncoder();
    const event: RunProtocolEvent = runEvent('end', { code: 0, status: 'succeeded' });
    expect(encoder.encode(event, { runId: RUN_ID, now: () => 1 })).toMatchObject({ kind: 'run.lifecycle', status: 'completed' });
  });

  it('encodes an end event with no status field at all as completed (default fallback)', () => {
    const encoder = createAguiEncoder();
    const event: RunProtocolEvent = runEvent('end', { code: 0 });
    expect(encoder.encode(event, { runId: RUN_ID, now: () => 1 })).toMatchObject({ kind: 'run.lifecycle', status: 'completed' });
  });

  it('encodes an end event with status "failed" as failed', () => {
    const encoder = createAguiEncoder();
    const event: RunProtocolEvent = runEvent('end', { code: 1, status: 'failed' });
    expect(encoder.encode(event, { runId: RUN_ID, now: () => 1 })).toMatchObject({ kind: 'run.lifecycle', status: 'failed' });
  });

  it('encodes an end event with status "canceled" as cancelled', () => {
    const encoder = createAguiEncoder();
    const event: RunProtocolEvent = runEvent('end', { code: null, status: 'canceled' });
    expect(encoder.encode(event, { runId: RUN_ID, now: () => 1 })).toMatchObject({ kind: 'run.lifecycle', status: 'cancelled' });
  });

  it('drops stdout/stderr/error events (no AG-UI equivalent)', () => {
    const encoder = createAguiEncoder();
    const ctx = { runId: RUN_ID, now: () => 1 };
    expect(encoder.encode(runEvent('stdout', { chunk: 'x' }), ctx)).toBeNull();
    expect(encoder.encode(runEvent('stderr', { chunk: 'x' }), ctx)).toBeNull();
    expect(encoder.encode(runEvent('error', { message: 'boom' }), ctx)).toBeNull();
  });
});

describe('createAguiEncoder — agent text', () => {
  it('encodes a text_delta as agent.message', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(agentEvent({ type: 'text_delta', delta: 'hello' }), { runId: RUN_ID, now: () => 5 });
    expect(result).toEqual({ kind: 'agent.message', text: 'hello', runId: RUN_ID, ts: 5 });
  });

  it('drops status/thinking_start/thinking_delta/tool_input_delta/usage/raw agent payloads', () => {
    const encoder = createAguiEncoder();
    const ctx = { runId: RUN_ID, now: () => 1 };
    expect(encoder.encode(agentEvent({ type: 'status', label: 'thinking' }), ctx)).toBeNull();
    expect(encoder.encode(agentEvent({ type: 'thinking_start' }), ctx)).toBeNull();
    expect(encoder.encode(agentEvent({ type: 'thinking_delta', delta: 'x' }), ctx)).toBeNull();
    expect(encoder.encode(agentEvent({ type: 'tool_input_delta', id: 't1', name: 'x', delta: '{}' }), ctx)).toBeNull();
    expect(encoder.encode(agentEvent({ type: 'usage' }), ctx)).toBeNull();
    expect(encoder.encode(agentEvent({ type: 'raw', line: 'x' }), ctx)).toBeNull();
  });
});

describe('createAguiEncoder — tool_use/tool_result correlation', () => {
  it('encodes tool_use as a started tool_call', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(agentEvent({ type: 'tool_use', id: 'call-1', name: 'search', input: { q: 'x' } }), {
      runId: RUN_ID,
      now: () => 1,
    });
    expect(result).toEqual({
      kind: 'tool_call',
      toolName: 'search',
      args: { q: 'x' },
      callId: 'call-1',
      status: 'started',
      runId: RUN_ID,
      ts: 1,
    });
  });

  it('encodes a matching tool_result as a completed tool_call, reusing the correlated name/args', () => {
    const encoder = createAguiEncoder();
    encoder.encode(agentEvent({ type: 'tool_use', id: 'call-1', name: 'search', input: { q: 'x' } }), { runId: RUN_ID, now: () => 1 });
    const result = encoder.encode(agentEvent({ type: 'tool_result', toolUseId: 'call-1', content: 'result text' }), {
      runId: RUN_ID,
      now: () => 2,
    });
    expect(result).toEqual({
      kind: 'tool_call',
      toolName: 'search',
      args: { q: 'x' },
      callId: 'call-1',
      status: 'completed',
      result: 'result text',
      runId: RUN_ID,
      ts: 2,
    });
  });

  it('encodes an isError tool_result as a failed tool_call', () => {
    const encoder = createAguiEncoder();
    encoder.encode(agentEvent({ type: 'tool_use', id: 'call-1', name: 'search', input: {} }), { runId: RUN_ID, now: () => 1 });
    const result = encoder.encode(agentEvent({ type: 'tool_result', toolUseId: 'call-1', content: 'oops', isError: true }), {
      runId: RUN_ID,
      now: () => 2,
    });
    expect(result).toMatchObject({ status: 'failed', result: 'oops' });
  });

  it('a tool_result with no matching prior tool_use falls back to an unknown name and null args', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(agentEvent({ type: 'tool_result', toolUseId: 'never-seen', content: 'x' }), {
      runId: RUN_ID,
      now: () => 1,
    });
    expect(result).toMatchObject({ toolName: 'unknown', args: null, callId: 'never-seen' });
  });

  it('a second tool_use with a duplicate id overwrites the first; the following tool_result correlates against the second', () => {
    const encoder = createAguiEncoder();
    encoder.encode(agentEvent({ type: 'tool_use', id: 'call-1', name: 'first-name', input: 'first-args' }), { runId: RUN_ID, now: () => 1 });
    encoder.encode(agentEvent({ type: 'tool_use', id: 'call-1', name: 'second-name', input: 'second-args' }), { runId: RUN_ID, now: () => 2 });
    const result = encoder.encode(agentEvent({ type: 'tool_result', toolUseId: 'call-1', content: 'done' }), { runId: RUN_ID, now: () => 3 });
    expect(result).toMatchObject({ toolName: 'second-name', args: 'second-args' });
  });

  it('resolving one tool_result does not affect a different in-flight tool_use', () => {
    const encoder = createAguiEncoder();
    encoder.encode(agentEvent({ type: 'tool_use', id: 'call-a', name: 'toolA', input: 'a' }), { runId: RUN_ID, now: () => 1 });
    encoder.encode(agentEvent({ type: 'tool_use', id: 'call-b', name: 'toolB', input: 'b' }), { runId: RUN_ID, now: () => 2 });
    encoder.encode(agentEvent({ type: 'tool_result', toolUseId: 'call-a', content: 'resultA' }), { runId: RUN_ID, now: () => 3 });
    const resultB = encoder.encode(agentEvent({ type: 'tool_result', toolUseId: 'call-b', content: 'resultB' }), { runId: RUN_ID, now: () => 4 });
    expect(resultB).toMatchObject({ toolName: 'toolB', args: 'b', result: 'resultB' });
  });

  it('a run ending mid-tool-call clears the correlation map: a tool_result for the same id afterward falls back to unknown', () => {
    const encoder = createAguiEncoder();
    encoder.encode(agentEvent({ type: 'tool_use', id: 'call-1', name: 'search', input: 'x' }), { runId: RUN_ID, now: () => 1 });
    encoder.encode(runEvent('end', { code: null, status: 'canceled' }), { runId: RUN_ID, now: () => 2 });
    const result = encoder.encode(agentEvent({ type: 'tool_result', toolUseId: 'call-1', content: 'late' }), { runId: RUN_ID, now: () => 3 });
    expect(result).toMatchObject({ toolName: 'unknown', args: null });
  });
});

describe('createAguiEncoder — generalized pipeline-stage events', () => {
  it('encodes stage_start as run.lifecycle pipeline_stage_started, with iteration when present', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(agentEvent({ type: 'stage_start', stageId: 'plan', label: 'Planning', iteration: 2 }), {
      runId: RUN_ID,
      now: () => 1,
    });
    expect(result).toEqual({ kind: 'run.lifecycle', status: 'pipeline_stage_started', stageId: 'plan', iteration: 2, runId: RUN_ID, ts: 1 });
  });

  it('encodes stage_start with no iteration, omitting the field entirely', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(agentEvent({ type: 'stage_start', stageId: 'plan' }), { runId: RUN_ID, now: () => 1 });
    expect(result).toEqual({ kind: 'run.lifecycle', status: 'pipeline_stage_started', stageId: 'plan', runId: RUN_ID, ts: 1 });
    expect(result).not.toHaveProperty('iteration');
  });

  it('encodes stage_end as run.lifecycle pipeline_stage_completed, with iteration when present', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(agentEvent({ type: 'stage_end', stageId: 'plan', iteration: 2 }), { runId: RUN_ID, now: () => 1 });
    expect(result).toEqual({ kind: 'run.lifecycle', status: 'pipeline_stage_completed', stageId: 'plan', iteration: 2, runId: RUN_ID, ts: 1 });
  });

  it('encodes stage_end with no iteration, omitting the field entirely', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(agentEvent({ type: 'stage_end', stageId: 'plan' }), { runId: RUN_ID, now: () => 1 });
    expect(result).not.toHaveProperty('iteration');
  });
});

describe('createAguiEncoder — generalized surface request/response events', () => {
  it('encodes surface_request as ui.surface_requested', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(
      agentEvent({ type: 'surface_request', surfaceId: 'sf-1', surfaceKind: 'confirmation', payload: { message: 'proceed?' } }),
      { runId: RUN_ID, now: () => 1 },
    );
    expect(result).toEqual({
      kind: 'ui.surface_requested',
      surfaceId: 'sf-1',
      surfaceKind: 'confirmation',
      payload: { message: 'proceed?' },
      runId: RUN_ID,
      ts: 1,
    });
  });

  it('encodes surface_response as ui.surface_responded, preserving respondedBy', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(agentEvent({ type: 'surface_response', surfaceId: 'sf-1', value: true, respondedBy: 'user' }), {
      runId: RUN_ID,
      now: () => 1,
    });
    expect(result).toEqual({ kind: 'ui.surface_responded', surfaceId: 'sf-1', value: true, respondedBy: 'user', runId: RUN_ID, ts: 1 });
  });

  it('encodes a timeout-driven surface_response with respondedBy "auto"', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(
      agentEvent({ type: 'surface_response', surfaceId: 'sf-1', value: { resolution: 'timed-out' }, respondedBy: 'auto' }),
      { runId: RUN_ID, now: () => 1 },
    );
    expect(result).toMatchObject({ respondedBy: 'auto' });
  });
});

describe('createAguiEncoder — context/base-field handling', () => {
  it('omits seq entirely when the caller does not supply one', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(runEvent('start', { runId: RUN_ID, contextRef: 'ctx-1' }), { runId: RUN_ID, now: () => 1 });
    expect(result).not.toHaveProperty('seq');
  });

  it('includes seq when the caller supplies one', () => {
    const encoder = createAguiEncoder();
    const result = encoder.encode(runEvent('start', { runId: RUN_ID, contextRef: 'ctx-1' }), { runId: RUN_ID, seq: 42, now: () => 1 });
    expect(result).toMatchObject({ seq: 42 });
  });

  it('defaults ts to Date.now() when no clock is injected', () => {
    const encoder = createAguiEncoder();
    const before = Date.now();
    const result = encoder.encode(runEvent('start', { runId: RUN_ID, contextRef: 'ctx-1' }), { runId: RUN_ID });
    const after = Date.now();
    expect(result).not.toBeNull();
    const ts = (result as { ts: number }).ts;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('two independent encoder instances do not share correlation state', () => {
    const encoderA = createAguiEncoder();
    const encoderB = createAguiEncoder();
    encoderA.encode(agentEvent({ type: 'tool_use', id: 'shared-id', name: 'fromA', input: 'a' }), { runId: RUN_ID, now: () => 1 });
    const resultB = encoderB.encode(agentEvent({ type: 'tool_result', toolUseId: 'shared-id', content: 'x' }), { runId: RUN_ID, now: () => 2 });
    expect(resultB).toMatchObject({ toolName: 'unknown' });
  });
});
