import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { createSqliteEventLog } from '../store/event-log/sqlite.js';
import { createRunLifecycle } from '../run-lifecycle.js';

it('resumes a fresh slow-notice window after permanent suspension cancellation', async () => {
  vi.useFakeTimers();
  const db = new Database(':memory:');
  try {
    const eventLog = createSqliteEventLog({ db });
    const lifecycle = createRunLifecycle({ eventLog }, { slowRunThresholdMs: 20 });
    const { run } = await lifecycle.start({ contextRef: 'ctx' });
    await vi.advanceTimersByTimeAsync(5);
    lifecycle.suspendSlowRunNotice({ runId: run.id });
    await vi.advanceTimersByTimeAsync(100);
    let replay = await eventLog.replay({ runId: run.id, afterCursor: null });
    expect(replay.kind === 'ok' ? replay.entries.map(entry => entry.event) : replay.kind).toEqual(['start']);
    lifecycle.resumeSlowRunNotice({ runId: run.id });
    await vi.advanceTimersByTimeAsync(20);
    replay = await eventLog.replay({ runId: run.id, afterCursor: null });
    expect(replay.kind === 'ok' ? replay.entries.map(entry => entry.event) : replay.kind).toEqual(['start', 'agent']);
    if (replay.kind !== 'ok') throw new Error('Expected replay entries');
    const notice = replay.entries[1];
    if (notice === undefined) throw new Error('Expected the slow-run notice');
    expect(notice.data).toMatchObject({ type: 'slow_running' });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
  } finally { db.close(); vi.useRealTimers(); }
});
