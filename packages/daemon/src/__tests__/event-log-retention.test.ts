import { describe, expect, it } from 'vitest';
import type { SchedulerPort } from '../scheduler.js';
import { createInMemoryEventLog, DEFAULT_MAX_EVENT_LOG_RUNS, DEFAULT_TERMINAL_EVENT_RETENTION_MS } from '../event-log.js';

/** Fake clock for the log's timer port: `advance(ms)` fires every due, uncancelled callback. */
function createFakeScheduler(): SchedulerPort & { advance(ms: number): void; pending(): number } {
  let now = 0;
  const timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
  return {
    schedule({ delayMs, callback }) {
      const timer = { at: now + delayMs, callback, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    advance(ms) {
      now += ms;
      for (const timer of timers.splice(0)) {
        if (timer.cancelled) continue;
        if (timer.at <= now) timer.callback();
        else timers.push(timer);
      }
    },
    pending: () => timers.filter((timer) => !timer.cancelled).length,
  };
}

const BIG = 'x'.repeat(300 * 1024);

async function runToEnd(log: ReturnType<typeof createInMemoryEventLog>, runId: string): Promise<void> {
  await log.append({ runId, event: 'start', data: {} });
  await log.append({ runId, event: 'agent', data: { type: 'tool_result', content: BIG } });
  await log.append({ runId, event: 'end', data: { status: 'succeeded' } });
}

describe('createInMemoryEventLog — post-end retention', () => {
  it('exports the documented defaults', () => {
    expect(DEFAULT_TERMINAL_EVENT_RETENTION_MS).toBe(15 * 60 * 1000);
    expect(DEFAULT_MAX_EVENT_LOG_RUNS).toBe(1000);
  });

  it('compacts each ended run to its end entry once retention passes (N runs: 3N entries -> N)', async () => {
    const scheduler = createFakeScheduler();
    const log = createInMemoryEventLog({}, { scheduler, terminalRetentionMs: 1000 });
    const N = 20;
    for (let i = 0; i < N; i += 1) await runToEnd(log, `r${i}`);
    const countEntries = async () => {
      let total = 0;
      for (const runId of await log.listRunIds({})) {
        const replay = await log.replay({ runId, afterCursor: null });
        if (replay.kind === 'ok') total += replay.entries.length;
      }
      return total;
    };
    expect(await countEntries()).toBe(3 * N);
    scheduler.advance(999);
    expect(await countEntries()).toBe(3 * N);
    scheduler.advance(1);
    expect(await countEntries()).toBe(N);

    const replay = await log.replay({ runId: 'r0', afterCursor: null });
    expect(replay).toEqual({ kind: 'ok', entries: [expect.objectContaining({ id: '3', event: 'end' })], truncated: true });
    expect(await log.replay({ runId: 'r0', afterCursor: '1' })).toEqual({ kind: 'replay-gap', requestedCursor: '1', oldestAvailableCursor: '3' });
    expect(await log.replay({ runId: 'r0', afterCursor: '2' })).toEqual({ kind: 'ok', entries: [expect.objectContaining({ id: '3' })] });
  });

  it('cancels the pending compaction when the run is appended to again (resume), and keeps cursors increasing', async () => {
    const scheduler = createFakeScheduler();
    const log = createInMemoryEventLog({}, { scheduler, terminalRetentionMs: 10 });
    await runToEnd(log, 'r1');
    expect(scheduler.pending()).toBe(1);
    const resumed = await log.append({ runId: 'r1', event: 'agent', data: 'after resume' });
    expect(resumed.id).toBe('4');
    expect(scheduler.pending()).toBe(0);
    scheduler.advance(100);
    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay.kind === 'ok' && replay.entries.length).toBe(4);
  });

  it('forgets dedupe keys of compacted entries but keeps the key of the retained end entry', async () => {
    const scheduler = createFakeScheduler();
    const log = createInMemoryEventLog({}, { scheduler, terminalRetentionMs: 10 });
    const first = await log.append({ runId: 'r1', event: 'agent', data: 1 }, { dedupeKey: 'a' });
    const end = await log.append({ runId: 'r1', event: 'end', data: 2 }, { dedupeKey: 'b' });
    scheduler.advance(10);
    expect(await log.append({ runId: 'r1', event: 'end', data: 'dup' }, { dedupeKey: 'b' })).toBe(end);
    const again = await log.append({ runId: 'r1', event: 'agent', data: 1 }, { dedupeKey: 'a' });
    expect(again).not.toBe(first);
    expect(again.id).toBe('3');
  });

  it('terminalRetentionMs: null keeps every entry (previous behaviour)', async () => {
    const scheduler = createFakeScheduler();
    const log = createInMemoryEventLog({}, { scheduler, terminalRetentionMs: null });
    await runToEnd(log, 'r1');
    expect(scheduler.pending()).toBe(0);
    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay.kind === 'ok' && replay.entries.length).toBe(3);
  });

  it('defaults to unref-ed native timers, so an ended run never keeps the process alive', async () => {
    const log = createInMemoryEventLog({});
    await runToEnd(log, 'r1');
    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay.kind === 'ok' && replay.entries.length).toBe(3);
    await log.drop({ runId: 'r1' });
  });
});

describe('createInMemoryEventLog — run cap', () => {
  it('holds at most maxRuns ended runs (N=50 runs, cap 10: before 50, after 10), evicting the oldest first', async () => {
    const scheduler = createFakeScheduler();
    const log = createInMemoryEventLog({}, { scheduler, maxRuns: 10 });
    for (let i = 0; i < 50; i += 1) await runToEnd(log, `r${String(i).padStart(2, '0')}`);
    const runIds = await log.listRunIds({});
    expect(runIds).toHaveLength(10);
    expect(runIds[0]).toBe('r40');
    expect(scheduler.pending()).toBe(10);
  });

  it('never evicts a live run: live runs past the cap are all kept, ended ones go first', async () => {
    const scheduler = createFakeScheduler();
    const log = createInMemoryEventLog({}, { scheduler, maxRuns: 2 });
    await runToEnd(log, 'ended');
    await log.append({ runId: 'live1', event: 'start', data: {} });
    await log.append({ runId: 'live2', event: 'start', data: {} });
    expect(await log.listRunIds({})).toEqual(['live1', 'live2']);
    await log.append({ runId: 'live3', event: 'start', data: {} });
    expect(await log.listRunIds({})).toEqual(['live1', 'live2', 'live3']);
  });

  it('a resumed run is live again and is not evicted by the cap', async () => {
    const scheduler = createFakeScheduler();
    const log = createInMemoryEventLog({}, { scheduler, maxRuns: 1 });
    await runToEnd(log, 'a');
    await log.append({ runId: 'a', event: 'agent', data: 'resumed' });
    await log.append({ runId: 'b', event: 'start', data: {} });
    expect(await log.listRunIds({})).toEqual(['a', 'b']);
  });

  it('maxRuns: null disables the cap', async () => {
    const log = createInMemoryEventLog({}, { scheduler: createFakeScheduler(), maxRuns: null });
    for (let i = 0; i < 5; i += 1) await runToEnd(log, `r${i}`);
    expect(await log.listRunIds({})).toHaveLength(5);
  });

  it('drop() cancels a pending compaction, and dropping an unknown run is a no-op', async () => {
    const scheduler = createFakeScheduler();
    const log = createInMemoryEventLog({}, { scheduler, terminalRetentionMs: 10 });
    await runToEnd(log, 'r1');
    await log.drop({ runId: 'r1' });
    expect(scheduler.pending()).toBe(0);
    await log.drop({ runId: 'never' });
    expect(await log.listRunIds({})).toEqual([]);
  });
});
