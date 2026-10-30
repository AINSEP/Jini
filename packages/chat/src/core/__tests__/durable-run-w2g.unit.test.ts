import { setImmediate } from 'node:timers/promises';
import { expect, test, vi } from 'vitest';
import { followDurableRun, type DurableSubscriptionPorts } from '../assistant-client/durable-run-subscription.js';
import type { ChatMessage } from '../messages.js';

const notices = { toolStepLimit: { kind: 'status' as const, label: 'Limit' }, interrupted: { kind: 'status' as const, label: 'Interrupted' },
  neverStarted: { kind: 'status' as const, label: 'Never started' }, canceledLabel: 'Canceled', failedLabel: 'Failed', terminalDetail: () => 'Ended' };

test('a drop during a checkpoint read latches recovery, ignores the retired stream, and schedules one retry', async () => {
  let resolve!: (value: ChatMessage | null) => void;
  const read = vi.fn(() => new Promise<ChatMessage | null>(done => { resolve = done; }));
  const streams: Parameters<DurableSubscriptionPorts['stream']>[0][] = [];
  const timers: Parameters<DurableSubscriptionPorts['schedule']>[0][] = [];
  const close = vi.fn();
  const ports: DurableSubscriptionPorts = { read, stream: input => { streams.push(input); return close; },
    schedule: input => { timers.push(input); return () => {}; } };
  const handlers = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onCheckpoint: vi.fn() };
  const info = vi.fn();
  const stop = followDurableRun({ runId: 'run', handlers, ports, notices, bindings: new Map() }, { logger: { info } });
  try {
    timers[0]!.work();
    streams[0]!.dropped();
    streams[0]!.dropped('duplicate');
    streams[0]!.frame('agent', '{"payload":{"type":"text_delta","delta":"stale"}}', '99');
    expect(timers).toHaveLength(1);
    resolve({ id: 'message', role: 'assistant', content: 'saved', runStatus: 'running' });
    await setImmediate();
    expect(handlers.onEvent).not.toHaveBeenCalled();
    expect(handlers.onCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ content: 'saved' }));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toContain('"reason":"stream-error"');
    expect(timers.map(timer => timer.delayMs)).toEqual([1000, 1000]);
    expect(streams).toHaveLength(2);
    timers[1]!.work();
    expect(read).toHaveBeenLastCalledWith({ runId: 'run', messageId: 'message' }, { recover: true });
    resolve(null);
    await setImmediate();
    expect(timers).toHaveLength(3);
  } finally { stop(); }
  const count = read.mock.calls.length;
  timers.at(-1)!.work();
  await setImmediate();
  expect(read).toHaveBeenCalledTimes(count);
});
