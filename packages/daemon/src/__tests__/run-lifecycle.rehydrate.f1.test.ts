import { describe, expect, it, vi } from 'vitest';
import { createInMemoryEventLog, createRunLifecycle } from '../index.js';

// F1 fix wave (Stryker L8 §4 run-lifecycle.ts:231,263,277,278,288): journal summarisation on
// rehydrate, driven by hand-built durable logs with a controlled clock.
function logWith(times: number[]) {
  let i = 0;
  return createInMemoryEventLog({}, { now: () => times[Math.min(i++, times.length - 1)]! });
}

describe('RunLifecycle.rehydrate — F1 journal summarisation', () => {
  it('a journal with NO start entry falls back to the first entry\'s time for startedAt', async () => {
    const eventLog = logWith([100, 200, 300]);
    await eventLog.append({ runId: 'r', event: 'agent', data: {} });
    await eventLog.append({ runId: 'r', event: 'agent', data: {} });
    await eventLog.append({ runId: 'r', event: 'end', data: { status: 'succeeded', resumable: false } });
    const lifecycle = createRunLifecycle({ eventLog });
    await lifecycle.rehydrate({});
    expect(await lifecycle.get({ runId: 'r' })).toMatchObject({ id: 'r', state: 'succeeded', startedAt: 100, updatedAt: 300, endedAt: 300 });
  });

  it('a start entry later than the first entry is used for startedAt (find, not first)', async () => {
    const eventLog = logWith([100, 150, 400]);
    await eventLog.append({ runId: 'r', event: 'agent', data: {} });
    await eventLog.append({ runId: 'r', event: 'start', data: { contextRef: 'ctx' } });
    await eventLog.append({ runId: 'r', event: 'end', data: { status: 'succeeded' } });
    const lifecycle = createRunLifecycle({ eventLog });
    await lifecycle.rehydrate({});
    expect(await lifecycle.get({ runId: 'r' })).toMatchObject({ startedAt: 150, endedAt: 400 });
  });

  it('with several end entries the LAST one decides state and endedAt', async () => {
    const eventLog = logWith([100, 200, 300, 400]);
    await eventLog.append({ runId: 'r', event: 'start', data: { contextRef: 'ctx' } });
    await eventLog.append({ runId: 'r', event: 'end', data: { status: 'failed', resumable: true } });
    await eventLog.append({ runId: 'r', event: 'agent', data: {} });
    await eventLog.append({ runId: 'r', event: 'end', data: { status: 'succeeded', resumable: false } });
    const lifecycle = createRunLifecycle({ eventLog });
    await lifecycle.rehydrate({});
    expect(await lifecycle.get({ runId: 'r' })).toMatchObject({ state: 'succeeded', startedAt: 100, updatedAt: 400, endedAt: 400 });
    // The earlier resumable `failed` end is NOT what governs resume.
    expect(await lifecycle.resume({ runId: 'r' })).toMatchObject({ resumed: false });
  });

  it.each([
    ['true (boolean)', true, true],
    ['"true" (string)', 'true', false],
    ['1', 1, false],
    ['absent', undefined, false],
  ])('resumable %s on the end entry → resumable=%s', async (_l, resumable, expected) => {
    const eventLog = createInMemoryEventLog({});
    await eventLog.append({ runId: 'r', event: 'start', data: { contextRef: 'ctx' } });
    await eventLog.append({ runId: 'r', event: 'end', data: { status: 'failed', ...(resumable === undefined ? {} : { resumable }) } });
    const lifecycle = createRunLifecycle({ eventLog });
    await lifecycle.rehydrate({});
    expect((await lifecycle.resume({ runId: 'r' })).resumed).toBe(expected);
  });

  it.each([
    ['array start payload', ['ctx']],
    ['null start payload', null],
    ['non-string contextRef', { contextRef: 7, idempotencyKey: 9 }],
  ])('%s yields no contextRef and no idempotency mapping', async (_l, data) => {
    const eventLog = createInMemoryEventLog({});
    await eventLog.append({ runId: 'r', event: 'start', data });
    await eventLog.append({ runId: 'r', event: 'end', data: { status: 'succeeded' } });
    const lifecycle = createRunLifecycle({ eventLog });
    await lifecycle.rehydrate({});
    expect(await lifecycle.get({ runId: 'r' })).toMatchObject({ state: 'succeeded' });
    // A fresh start with a numeric-looking key must not replay onto the rehydrated run.
    const fresh = await lifecycle.start({ contextRef: 'ctx' }, { idempotencyKey: '9' });
    expect(fresh.run.id).not.toBe('r');
  });

  it('a string idempotencyKey on the start entry IS restored (start replays onto the rehydrated run)', async () => {
    const eventLog = createInMemoryEventLog({});
    await eventLog.append({ runId: 'r', event: 'start', data: { contextRef: 'ctx', idempotencyKey: 'k1' } });
    await eventLog.append({ runId: 'r', event: 'end', data: { status: 'succeeded' } });
    const lifecycle = createRunLifecycle({ eventLog });
    await lifecycle.rehydrate({});
    expect((await lifecycle.start({ contextRef: 'ctx' }, { idempotencyKey: 'k1' })).run.id).toBe('r');
  });
});

describe('RunLifecycle.start — F1 failed start append cleanup', () => {
  it('a failing start append clears the run from the correlation store, the index and the idempotency map', async () => {
    const inner = createInMemoryEventLog({});
    let failStart = true;
    const eventLog = { ...inner, append: async (input: Parameters<typeof inner.append>[0], options?: Parameters<typeof inner.append>[1]) => {
      if (failStart && input.event === 'start') throw new Error('disk full');
      return inner.append(input, options);
    } } as typeof inner;
    const clearRun = vi.fn();
    const lifecycle = createRunLifecycle({ eventLog }, { delegatedResultCorrelation: { record: vi.fn(), matches: vi.fn(() => false), clearRun } });
    await expect(lifecycle.start({ contextRef: 'ctx' }, { runId: 'r-fail', idempotencyKey: 'k' })).rejects.toThrow(new Error('disk full'));
    expect(clearRun).toHaveBeenCalledWith({ runId: 'r-fail' });
    expect(await lifecycle.get({ runId: 'r-fail' })).toBeUndefined();
    failStart = false;
    const retry = await lifecycle.start({ contextRef: 'ctx' }, { idempotencyKey: 'k' });
    expect(retry.run.id).not.toBe('r-fail');
  });
});

describe('RunLifecycle — F1 re-score kills', () => {
  it('pins the retention/cap/slow-run defaults', async () => {
    const mod = await import('../run-lifecycle.js');
    expect([mod.DEFAULT_TERMINAL_RETENTION_MS, mod.DEFAULT_MAX_TERMINAL_RUNS, mod.DEFAULT_SLOW_RUN_THRESHOLD_MS]).toEqual([86_400_000, 1000, 45_000]);
  });
  it('a null end-entry payload rehydrates as failed / non-resumable instead of throwing', async () => {
    const eventLog = createInMemoryEventLog({});
    await eventLog.append({ runId: 'r', event: 'start', data: { contextRef: 'ctx' } });
    await eventLog.append({ runId: 'r', event: 'end', data: null });
    const lifecycle = createRunLifecycle({ eventLog });
    await expect(lifecycle.rehydrate({})).resolves.toBeUndefined();
    expect(await lifecycle.get({ runId: 'r' })).toMatchObject({ state: 'failed' });
    expect((await lifecycle.resume({ runId: 'r' })).resumed).toBe(false);
  });
});
