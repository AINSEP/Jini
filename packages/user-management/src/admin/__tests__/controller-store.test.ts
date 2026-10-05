/**
 * Direct tests for the People controllers' store. useSyncExternalStore depends on the snapshot
 * identity changing only on a write, and the dispose contract is what stops a late settlement from
 * updating a retired page scope.
 */
import { describe, expect, it } from 'vitest';
import { createControllerStore } from '../controllers/controller-store.js';

describe('user-management createControllerStore', () => {
  it('copies and freezes the initial state, so caller mutation cannot rebind the snapshot', () => {
    const initial = { count: 1, label: 'a' };
    const store = createControllerStore({ initial });
    const first = store.getSnapshot();
    expect(first).toEqual({ count: 1, label: 'a' });
    expect(first).not.toBe(initial);
    expect(Object.isFrozen(first)).toBe(true);
    initial.count = 99;
    expect(store.getSnapshot().count).toBe(1);
    expect(store.getSnapshot()).toBe(first);
  });

  it('merges a patch into a new frozen snapshot and notifies every subscriber once', () => {
    const store = createControllerStore({ initial: { count: 1, label: 'a' } });
    const before = store.getSnapshot();
    const seen: string[] = [];
    store.subscribe({ listener: () => seen.push(`one:${store.getSnapshot().count}`) });
    store.subscribe({ listener: () => seen.push(`two:${store.getSnapshot().label}`) });
    store.set({ patch: { count: 2 } });
    const after = store.getSnapshot();
    expect(after).toEqual({ count: 2, label: 'a' });
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(seen).toEqual(['one:2', 'two:a']);
  });

  it('stops notifying a listener after its unsubscribe', () => {
    const store = createControllerStore({ initial: { n: 0 } });
    let calls = 0;
    const unsubscribe = store.subscribe({ listener: () => { calls++; } });
    store.set({ patch: { n: 1 } });
    unsubscribe();
    store.set({ patch: { n: 2 } });
    expect(calls).toBe(1);
    expect(store.getSnapshot().n).toBe(2);
  });

  it('dispose aborts the call signal, drops listeners, ignores later writes and is idempotent', () => {
    const store = createControllerStore({ initial: { n: 0 } });
    let calls = 0;
    let aborts = 0;
    store.call.signal.addEventListener('abort', () => { aborts++; });
    store.subscribe({ listener: () => { calls++; } });
    expect(store.active()).toBe(true);
    expect(store.call.signal.aborted).toBe(false);
    store.dispose();
    store.dispose();
    expect(store.active()).toBe(false);
    expect(store.call.signal.aborted).toBe(true);
    expect(aborts).toBe(1);
    const frozen = store.getSnapshot();
    store.set({ patch: { n: 5 } });
    expect(store.getSnapshot()).toBe(frozen);
    expect(store.getSnapshot().n).toBe(0);
    expect(calls).toBe(0);
  });

  it('never notifies a subscriber added after dispose, and its unsubscribe is safe', () => {
    const store = createControllerStore({ initial: { n: 0 } });
    store.dispose();
    let calls = 0;
    const unsubscribe = store.subscribe({ listener: () => { calls++; } });
    expect(() => unsubscribe()).not.toThrow();
    expect(calls).toBe(0);
  });
});
