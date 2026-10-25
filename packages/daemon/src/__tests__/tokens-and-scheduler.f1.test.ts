import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentExecutorToken, EventLogToken, RunLifecycleToken, ToolExecutorToken } from '../tokens.js';
import { createTimeoutScheduler } from '../scheduler.js';

// F1 fix wave (Stryker L8 §3: tokens.ts 0 %, scheduler.ts 22 %).
describe('kernel DI tokens', () => {
  it('carry their exact, distinct ids', () => {
    const ids = [RunLifecycleToken, EventLogToken, ToolExecutorToken, AgentExecutorToken].map((t) => (t as { id: string }).id);
    expect(ids).toEqual(['jini.runLifecycle', 'jini.eventLog', 'jini.toolExecutor', 'jini.agentExecutor']);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('createTimeoutScheduler', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  function spyTimers() {
    const unref = vi.fn();
    const handle = { unref };
    const setSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => handle) as never);
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
    return { handle, unref, setSpy, clearSpy };
  }

  it('default (keepAlive=false) unrefs the timer and schedules with the exact delay and callback', () => {
    const { unref, setSpy } = spyTimers();
    const callback = () => undefined;
    createTimeoutScheduler({}).schedule({ delayMs: 1234, callback });
    expect(setSpy).toHaveBeenCalledWith(callback, 1234);
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('keepAlive=true does NOT unref the timer', () => {
    const { unref } = spyTimers();
    createTimeoutScheduler({}, { keepAlive: true }).schedule({ delayMs: 1, callback: () => undefined });
    expect(unref).not.toHaveBeenCalled();
  });

  it('a host timer without unref() is tolerated', () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => ({})) as never);
    expect(() => createTimeoutScheduler({}).schedule({ delayMs: 1, callback: () => undefined })).not.toThrow();
  });

  it('the returned cancel clears exactly that timer', () => {
    const { handle, clearSpy } = spyTimers();
    const cancel = createTimeoutScheduler({}).schedule({ delayMs: 1, callback: () => undefined });
    expect(clearSpy).not.toHaveBeenCalled();
    cancel();
    expect(clearSpy).toHaveBeenCalledWith(handle);
  });

  it('really fires asynchronously, and a cancelled timer never fires (fake timers)', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const s = createTimeoutScheduler({});
    s.schedule({ delayMs: 10, callback: () => fired.push('a') });
    const cancel = s.schedule({ delayMs: 10, callback: () => fired.push('b') });
    expect(fired).toEqual([]);
    cancel();
    cancel();
    vi.advanceTimersByTime(10);
    expect(fired).toEqual(['a']);
  });
});
