import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatHistoryMaintenance } from '../../ports.js';
import { ChatStoreError } from '../../errors.js';
import { createSqliteChatMaintenance } from '../../sqlite/index.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { CHAT_EXPIRY_SWEEP_INTERVAL_MS, startChatExpirySweep, sweepExpiredChats } from '../chat-expiry-sweep.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

const guest = { scopeId: 'ws', ownerKind: 'guest', ownerId: 'guest-hash' } as const;
const isDaemonRunId = () => false;

let f: RuntimeFixture | undefined;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); f?.close(); f = undefined; });

/** Real SQLite maintenance over `count` guest chats expiring at 10, plus one that never expires. */
async function sqliteMaintenance(count: number): Promise<ChatHistoryMaintenance> {
  f = runtimeFixture();
  const history = createChatHistoryStore({ kernel: f.kernel, scope: guest, isDaemonRunId });
  for (let i = 0; i < count; i++) await history.create({ id: `g${String(i).padStart(4, '0')}`, expiresAt: 10 });
  await history.create({ id: 'kept' });
  return createSqliteChatMaintenance({ kernel: f.kernel });
}
const chatIds = () => f!.rows<{ id: string }>('SELECT id FROM ai_chats ORDER BY id').map((r) => r.id);

/** Scripted maintenance: each call returns the next count (or throws it) and is recorded. */
function scripted(results: Array<number | Error | Promise<number> | (() => Promise<number>)>) {
  const calls: Array<{ now: number; limit?: number }> = [];
  const maintenance: ChatHistoryMaintenance = {
    async sweepExpired({ now }, { limit } = {}) {
      calls.push({ now, limit });
      const next = results.shift() ?? 0;
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next() : next;
    },
  };
  return { maintenance, calls };
}

describe('sweepExpiredChats', () => {
  it('drains a backlog larger than one bounded batch and leaves unexpired and never-expiring chats', async () => {
    const maintenance = await sqliteMaintenance(501);
    expect(await sweepExpiredChats({ maintenance }, { now: 9 })).toBe(0);
    expect(await sweepExpiredChats({ maintenance }, { now: 10 })).toBe(501);
    expect(chatIds()).toEqual(['kept']);
  });

  it('asks for batches of 500 until a partial batch comes back, at the given instant', async () => {
    const { maintenance, calls } = scripted([500, 500, 3]);
    expect(await sweepExpiredChats({ maintenance }, { now: 42 })).toBe(1003);
    expect(calls).toEqual([{ now: 42, limit: 500 }, { now: 42, limit: 500 }, { now: 42, limit: 500 }]);
  });

  it('defaults the instant to the current time', async () => {
    vi.useFakeTimers({ now: 1234 });
    const { maintenance, calls } = scripted([0]);
    await sweepExpiredChats({ maintenance });
    expect(calls[0]?.now).toBe(1234);
  });

  it('rethrows the driver cause of a store error, and any other error as is', async () => {
    const driver = new Error('disk I/O error');
    await expect(sweepExpiredChats(scripted([new ChatStoreError({ code: 'unavailable' }, { cause: driver })]))).rejects.toBe(driver);
    const bare = new ChatStoreError({ code: 'invalid-input' });
    await expect(sweepExpiredChats(scripted([bare]))).rejects.toBe(bare);
    const other = new TypeError('boom');
    await expect(sweepExpiredChats(scripted([other]))).rejects.toBe(other);
  });
});

describe('startChatExpirySweep', () => {
  it('sweeps at once and then every interval until stopped, and stop is idempotent', async () => {
    vi.useFakeTimers({ now: 0 });
    let clock = 100;
    const { maintenance, calls } = scripted([]);
    const stop = startChatExpirySweep({ maintenance }, { intervalMs: 1000, now: () => clock });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.now)).toEqual([100]);
    clock = 200;
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.map((c) => c.now)).toEqual([100, 200]);
    await stop();
    await stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
  });

  it('never keeps the process alive: its real interval timer is unref\'d', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { maintenance } = scripted([]);
    const stop = startChatExpirySweep({ maintenance }, { intervalMs: 60_000 });
    const timer = setIntervalSpy.mock.results[0]!.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    await stop();
  });

  it('defaults to an hourly interval over the current time', async () => {
    vi.useFakeTimers({ now: 7 });
    const { maintenance, calls } = scripted([]);
    const stop = startChatExpirySweep({ maintenance });
    await vi.advanceTimersByTimeAsync(CHAT_EXPIRY_SWEEP_INTERVAL_MS - 1);
    expect(calls.map((c) => c.now)).toEqual([7]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.now)).toEqual([7, 7 + CHAT_EXPIRY_SWEEP_INTERVAL_MS]);
    expect(CHAT_EXPIRY_SWEEP_INTERVAL_MS).toBe(3_600_000);
    await stop();
  });

  it('skips a tick while a pass is still running, and stop waits for that pass', async () => {
    vi.useFakeTimers({ now: 0 });
    let release!: (n: number) => void;
    const slow = new Promise<number>((resolve) => { release = resolve; });
    const { maintenance, calls } = scripted([slow, 0]);
    const stop = startChatExpirySweep({ maintenance }, { intervalMs: 10, now: () => 1 });
    await vi.advanceTimersByTimeAsync(35);
    expect(calls).toHaveLength(1);
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    release(0);
    await stopping;
    expect(stopped).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('reports a failed pass through onError and still runs the next one', async () => {
    vi.useFakeTimers({ now: 0 });
    const failure = new Error('locked');
    const { maintenance, calls } = scripted([failure, 0]);
    const onError = vi.fn();
    const stop = startChatExpirySweep({ maintenance }, { intervalMs: 10, now: () => 1, onError });
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(calls).toHaveLength(2);
    await stop();
  });

  it('warns on the console by default, naming Error messages and stringifying anything else', async () => {
    vi.useFakeTimers({ now: 0 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { maintenance } = scripted([new Error('locked'), () => Promise.reject('plain')]);
    const stop = startChatExpirySweep({ maintenance }, { intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(warn.mock.calls).toEqual([['[chat-expiry-sweep] sweep failed: locked'], ['[chat-expiry-sweep] sweep failed: plain']]);
    await stop();
  });
});
