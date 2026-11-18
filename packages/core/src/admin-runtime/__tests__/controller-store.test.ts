/**
 * Direct tests for the admin controllers' shared store. useSyncExternalStore requires the snapshot
 * identity to change only on a write; dispose must abort in-flight calls and stop late writes.
 */
import { describe, expect, it } from 'vitest';
import { createControllerStore } from '../controller-store.js';

describe('admin createControllerStore', () => {
  it('serves a frozen snapshot whose identity is stable until a write', () => {
    const store = createControllerStore({ initial: { count: 1, label: 'a' } });
    const first = store.getSnapshot();
    expect(first).toEqual({ count: 1, label: 'a' });
    expect(Object.isFrozen(first)).toBe(true);
    expect(store.getSnapshot()).toBe(first);
  });

  it('merges a patch into a new frozen snapshot and notifies every subscriber', () => {
    const store = createControllerStore({ initial: { count: 1, label: 'a' } });
    const before = store.getSnapshot();
    const seen: string[] = [];
    store.subscribe({ listener: () => seen.push(`one:${store.getSnapshot().count}`) });
    store.subscribe({ listener: () => seen.push(`two:${store.getSnapshot().label}`) });
    store.set({ patch: { count: 2 } });
    expect(store.getSnapshot()).toEqual({ count: 2, label: 'a' });
    expect(store.getSnapshot()).not.toBe(before);
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    expect(before).toEqual({ count: 1, label: 'a' });
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
  });

  it('dispose aborts the signal once, drops listeners and ignores later writes', () => {
    const store = createControllerStore({ initial: { n: 0 } });
    let calls = 0;
    let aborts = 0;
    store.signal.addEventListener('abort', () => { aborts++; });
    store.subscribe({ listener: () => { calls++; } });
    expect(store.signal.aborted).toBe(false);
    store.dispose();
    store.dispose();
    expect(store.signal.aborted).toBe(true);
    expect(aborts).toBe(1);
    const frozen = store.getSnapshot();
    store.set({ patch: { n: 5 } });
    expect(store.getSnapshot()).toBe(frozen);
    expect(calls).toBe(0);
  });

  it('never notifies a subscriber added after dispose, and its unsubscribe is safe', () => {
    const store = createControllerStore({ initial: { n: 0 } });
    store.dispose();
    let calls = 0;
    const unsubscribe = store.subscribe({ listener: () => { calls++; } });
    store.set({ patch: { n: 1 } });
    expect(() => unsubscribe()).not.toThrow();
    expect(calls).toBe(0);
  });
});
