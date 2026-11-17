import type { Logger } from '@jini-ai/core/primitives';
import { describe, expect, it } from 'vitest';

import { startCallProgress, type CallProgressScheduler } from '../call-progress.js';

type Notification = { method: string; params: Record<string, unknown> };
type Warning = { message: string; error?: unknown };

/** Fake of the scheduler port: time only moves when the test calls `advance`. */
function createFakeScheduler() {
  const repeating = new Map<number, { callback: () => void; intervalMs: number; nextAt: number }>();
  let now = 0;
  let nextHandle = 1;
  const scheduler: CallProgressScheduler = {
    repeat: ({ callback, intervalMs }) => {
      const handle = nextHandle++;
      repeating.set(handle, { callback, intervalMs, nextAt: now + intervalMs });
      return handle;
    },
    cancel: ({ handle }) => { repeating.delete(handle as number); },
  };
  return {
    scheduler,
    active: () => repeating.size,
    advance: ({ ms }: { ms: number }) => {
      const target = now + ms;
      for (;;) {
        const due = [...repeating.values()].filter(entry => entry.nextAt <= target).sort((a, b) => a.nextAt - b.nextAt)[0];
        if (!due) break;
        now = due.nextAt;
        due.nextAt += due.intervalMs;
        due.callback();
      }
      now = target;
    },
  };
}

function createFakeLogger() {
  const warnings: Warning[] = [];
  const logger: Logger = {
    info: () => {},
    error: () => {},
    warn: ({ message }, optional = {}) => { warnings.push({ message, ...(optional.error === undefined ? {} : { error: optional.error }) }); },
  };
  return { logger, warnings };
}

function progressFrame({ token, progress }: { token: string | number; progress: number }): Notification {
  return { method: 'notifications/progress', params: { progressToken: token, progress, message: 'waiting' } };
}

function setup({ token = 't1' as string | number | null, signal }: { token?: string | number | null; signal?: AbortSignal } = {}) {
  const clock = createFakeScheduler();
  const log = createFakeLogger();
  const sent: Notification[] = [];
  const failure: { error?: Error } = {};
  const extra = {
    ...(token === null ? {} : { _meta: { progressToken: token } }),
    ...(signal === undefined ? {} : { signal }),
    sendNotification: async (notification: Notification) => {
      if (failure.error) throw failure.error;
      sent.push(notification);
    },
  };
  const progress = startCallProgress({ extra }, { scheduler: clock.scheduler, intervalMs: 25_000, logger: log.logger });
  return { clock, log, sent, failure, progress };
}

describe('startCallProgress', () => {
  it('1. with a token, a 120 s wait at a 25 s interval sends frames at 25, 50, 75 and 100 s, and none after stop', () => {
    const { clock, sent, progress } = setup();
    clock.advance({ ms: 24_999 });
    expect(sent).toEqual([]);
    clock.advance({ ms: 95_001 });
    expect(sent).toEqual([1, 2, 3, 4].map(n => progressFrame({ token: 't1', progress: n })));
    progress.stop();
    clock.advance({ ms: 300_000 });
    expect(sent).toHaveLength(4);
    expect(clock.active()).toBe(0);
  });

  it('2. without a token it sends nothing and schedules nothing', () => {
    const { clock, sent } = setup({ token: null });
    clock.advance({ ms: 300_000 });
    expect(sent).toEqual([]);
    expect(clock.active()).toBe(0);
  });

  it('3. an abort at 40 s leaves one frame, then none, and clears the timer', () => {
    const controller = new AbortController();
    const { clock, sent } = setup({ signal: controller.signal });
    clock.advance({ ms: 40_000 });
    controller.abort();
    expect(clock.active()).toBe(0);
    clock.advance({ ms: 300_000 });
    expect(sent).toEqual([progressFrame({ token: 't1', progress: 1 })]);
  });

  it('3b. a signal that is already aborted sends nothing and schedules nothing', () => {
    const controller = new AbortController();
    controller.abort();
    const { clock, sent } = setup({ signal: controller.signal });
    clock.advance({ ms: 300_000 });
    expect(sent).toEqual([]);
    expect(clock.active()).toBe(0);
  });

  it('4. a rejected sendNotification stops the pump and logs one line carrying the error', async () => {
    const { clock, sent, failure, log } = setup();
    failure.error = new Error('transport closed');
    clock.advance({ ms: 25_000 });
    await new Promise<void>(resolve => { setImmediate(resolve); });
    clock.advance({ ms: 300_000 });
    expect(sent).toEqual([]);
    expect(clock.active()).toBe(0);
    expect(log.warnings).toEqual([{ message: 'progress notification failed; this call sends no more progress', error: failure.error }]);
  });

  it('5. numeric tokens are echoed unchanged', () => {
    const { clock, sent } = setup({ token: 7 });
    clock.advance({ ms: 25_000 });
    expect(sent).toEqual([progressFrame({ token: 7, progress: 1 })]);
  });

  it('6. a frame is exactly method, token, count and the word waiting: no output, arguments or ids', () => {
    const { clock, sent } = setup({ token: 'abc' });
    clock.advance({ ms: 50_000 });
    expect(sent).toEqual([
      { method: 'notifications/progress', params: { progressToken: 'abc', progress: 1, message: 'waiting' } },
      { method: 'notifications/progress', params: { progressToken: 'abc', progress: 2, message: 'waiting' } },
    ]);
  });

  it('stop is idempotent', () => {
    const { clock, progress } = setup();
    progress.stop();
    progress.stop();
    expect(clock.active()).toBe(0);
  });
});
