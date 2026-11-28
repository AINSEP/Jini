/**
 * @file T18J (dedupe design, Tovu `development/refactor-patterns/dedupe/dedupe-06.terra-prompt.md`):
 * lifecycle characterization for `useOptimisticStoredValue`, generalized from Tovu's three
 * AssistantDock copies (`use-chat-display-preferences.hooks.ts` and its twins). Written by the
 * design before the hook exists; RED until job 06 adds it.
 */
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchQueryProvider } from '../../fetch-query/index.js';
import { useOptimisticStoredValue, type StoredValuePort } from '../use-optimistic-stored-value.hooks.js';

afterEach(() => { cleanup(); });

const QUERY_KEY = ['t18j-optimistic-stored-value'] as const;
const same = ({ a, b }: { a: number; b: number }): boolean => a === b;

function wrapper({ children }: { children: ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}

/** A hand-written stored-value port: `stored` is what `load` returns; `emit` fires every listener. */
function fakePort(initial: number) {
  const state = { stored: initial, failSaves: false };
  const listeners = new Set<() => void>();
  const saves: Array<{ next: number; previous: number }> = [];
  const unsubscribe = vi.fn();
  const port: StoredValuePort<number> = {
    load: vi.fn(async () => state.stored),
    save: vi.fn(async (required: { next: number; previous: number }) => {
      saves.push(required);
      if (state.failSaves) throw new Error('save refused');
    }),
    subscribe: vi.fn(({ listener }: { listener: () => void }) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); unsubscribe(); };
    }),
  };
  return { port, state, saves, unsubscribe, emit: () => { for (const listener of listeners) listener(); } };
}

function mount(port: StoredValuePort<number>) {
  return renderHook(
    ({ current }: { current: StoredValuePort<number> }) => useOptimisticStoredValue({ queryKey: QUERY_KEY, port: current, fallback: 0, same }),
    { wrapper, initialProps: { current: port } },
  );
}

describe('useOptimisticStoredValue (T18J lifecycle)', () => {
  it('a new port unsubscribes the old one, subscribes the new one, and refetches through the new load', async () => {
    const a = fakePort(1);
    const b = fakePort(5);
    const { rerender } = mount(a.port);
    await waitFor(() => expect(a.port.subscribe).toHaveBeenCalledTimes(1));

    rerender({ current: b.port });
    await waitFor(() => expect(b.port.subscribe).toHaveBeenCalledTimes(1));
    expect(a.unsubscribe).toHaveBeenCalledTimes(1);

    const loadsBefore = vi.mocked(b.port.load).mock.calls.length;
    act(() => { b.emit(); });
    await waitFor(() => expect(vi.mocked(b.port.load).mock.calls.length).toBeGreaterThan(loadsBefore));
  });

  it('two quick updates: the second save receives the first one\'s next as previous', async () => {
    const fake = fakePort(1);
    const { result } = mount(fake.port);
    await waitFor(() => expect(result.current.value).toBe(1));

    act(() => {
      result.current.update((previous) => previous + 1);
      result.current.update((previous) => previous + 1);
    });
    expect(fake.saves).toEqual([{ next: 2, previous: 1 }, { next: 3, previous: 2 }]);
    expect(result.current.value).toBe(3);
  });

  it('keeps the optimistic value until a re-read equals it, then drops it', async () => {
    const fake = fakePort(1);
    const { result } = mount(fake.port);
    await waitFor(() => expect(result.current.value).toBe(1));

    act(() => { result.current.update(() => 2); });
    expect(result.current.value).toBe(2);
    // The save settles and the re-read is still stale (1): the optimistic 2 must stay.
    const loads = () => vi.mocked(fake.port.load).mock.calls.length;
    await waitFor(() => expect(loads()).toBeGreaterThanOrEqual(2));
    expect(result.current.value).toBe(2);

    // A re-read that equals the optimistic value drops it ...
    fake.state.stored = 2;
    const loadsBeforeEqualRead = loads();
    act(() => { fake.emit(); });
    await waitFor(() => expect(loads()).toBeGreaterThan(loadsBeforeEqualRead));
    // ... which is visible once the store moves on: the value now follows the store.
    fake.state.stored = 7;
    act(() => { fake.emit(); });
    await waitFor(() => expect(result.current.value).toBe(7));
  });

  it('keeps the optimistic value when the re-read after a save brings a different stored value', async () => {
    const fake = fakePort(1);
    const { result } = mount(fake.port);
    await waitFor(() => expect(result.current.value).toBe(1));

    // Another writer stores 9 while our save of 2 is in flight: the re-read moves the stored value
    // (1 -> 9) without ever equalling the optimistic copy, so the copy must stay.
    fake.state.stored = 9;
    const loadsBefore = vi.mocked(fake.port.load).mock.calls.length;
    act(() => { result.current.update(() => 2); });
    await waitFor(() => expect(vi.mocked(fake.port.load).mock.calls.length).toBeGreaterThan(loadsBefore));
    await act(async () => { await Promise.resolve(); });
    expect(fake.saves).toEqual([{ next: 2, previous: 1 }]);
    expect(result.current.saveFailed).toBe(false);
    expect(result.current.value).toBe(2);

    // The copy still yields once a re-read equals it, after which the store shows through again.
    fake.state.stored = 2;
    act(() => { fake.emit(); });
    await waitFor(() => expect(vi.mocked(fake.port.load).mock.calls.length).toBeGreaterThan(loadsBefore + 1));
    fake.state.stored = 5;
    act(() => { fake.emit(); });
    await waitFor(() => expect(result.current.value).toBe(5));
  });

  it('a rejected save sets saveFailed and keeps the optimistic value', async () => {
    const fake = fakePort(1);
    fake.state.failSaves = true;
    const { result } = mount(fake.port);
    await waitFor(() => expect(result.current.value).toBe(1));

    act(() => { result.current.update(() => 4); });
    await waitFor(() => expect(result.current.saveFailed).toBe(true));
    expect(result.current.value).toBe(4);
  });
});
