/**
 * Regression (2026-10-05): the slow-run notice fired while a delegated tool was parked on a surface
 * exchange (a form or card the human is filling in). Nothing reached the run's event stream while the
 * human typed, so after 45s the watchdog emitted `slow_running` — and once the form was answered and
 * the client stopped hiding the notice, "Still working…" reappeared on a run that had never stalled.
 * The daemon knows exactly why such a run is quiet, so it must suspend the notice for as long as the
 * surface is pending, and re-arm it once the call settles so a genuine stall afterwards is still caught.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import type { SurfaceEmitter } from '@jini-ai/core';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createDelegatedToolBridge } from '../delegated-tool-bridge.js';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';
import { createToolExecutor } from '../tool-executor.js';

const THRESHOLD_MS = 1_000;

function slowNotices(events: readonly RunProtocolEvent[]): number {
  return events.filter((event) => event.kind === 'agent' && (event.payload as { type: string }).type === 'slow_running').length;
}

async function setUp(handler: (emit: SurfaceEmitter) => Promise<unknown>) {
  const registry = createToolRegistry({});
  registry.register({
    descriptor: { id: 'ask_form' },
    handler: async (_ctx, { emitSurface } = {}) => {
      if (emitSurface === undefined) throw new Error('Expected a surface emitter');
      return handler(emitSurface);
    },
    policy: { authorize: () => 'allow' },
  });
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) }, { slowRunThresholdMs: THRESHOLD_MS });
  const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: createToolExecutor({ registry }) });
  const { run } = await lifecycle.start({ contextRef: 'surface-slow-run' });
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream({ runId: run.id, onEvent: (event) => events.push(event) });
  return { lifecycle, bridge, runId: run.id, events };
}

describe('DelegatedToolBridge — slow-run notice while a surface is pending', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire while the human is answering a surface, however long that takes', async () => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => { answer = resolve; });
    const { bridge, runId, events } = await setUp(async (emit) => {
      await emit({ channel: 'mcp-ui', payload: { resource: { uri: 'ui://form' } } });
      await answered;
      return { submitted: true };
    });

    const call = bridge.execute({ runId, toolUseId: 'call-1', toolId: 'ask_form', principal: { id: 'user-1' }, input: {} });
    await vi.advanceTimersByTimeAsync(THRESHOLD_MS * 10);
    expect(slowNotices(events)).toBe(0);

    answer();
    await call;
    expect(slowNotices(events)).toBe(0);
  });

  it('re-arms once the call settles, so a genuine stall after the answer is still caught', async () => {
    const { bridge, runId, events } = await setUp(async (emit) => {
      await emit({ channel: 'mcp-ui', payload: { resource: { uri: 'ui://form' } } });
      return { submitted: true };
    });

    await bridge.execute({ runId, toolUseId: 'call-1', toolId: 'ask_form', principal: { id: 'user-1' }, input: {} });
    await vi.advanceTimersByTimeAsync(THRESHOLD_MS);
    expect(slowNotices(events)).toBe(1);
  });

  it('a call that shows no surface leaves the notice armed as before', async () => {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const { bridge, runId, events } = await setUp(async () => {
      await done;
      return { ok: true };
    });

    const call = bridge.execute({ runId, toolUseId: 'call-1', toolId: 'ask_form', principal: { id: 'user-1' }, input: {} });
    await vi.advanceTimersByTimeAsync(THRESHOLD_MS);
    expect(slowNotices(events)).toBe(1);
    finish();
    await call;
  });
});

describe('RunLifecycle — overlapping slow-run suspensions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays suspended until EVERY suspension is resumed (two parallel calls: one finishing must not re-arm over the other\'s open form)', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) }, { slowRunThresholdMs: THRESHOLD_MS });
    const { run } = await lifecycle.start({ contextRef: 'nested' });
    const events: RunProtocolEvent[] = [];
    await lifecycle.stream({ runId: run.id, onEvent: (event) => events.push(event) });

    lifecycle.suspendSlowRunNotice({ runId: run.id });
    lifecycle.suspendSlowRunNotice({ runId: run.id });
    lifecycle.resumeSlowRunNotice({ runId: run.id });
    await vi.advanceTimersByTimeAsync(THRESHOLD_MS * 5);
    expect(slowNotices(events)).toBe(0);

    lifecycle.resumeSlowRunNotice({ runId: run.id });
    await vi.advanceTimersByTimeAsync(THRESHOLD_MS);
    expect(slowNotices(events)).toBe(1);
  });
});
