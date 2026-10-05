/** Direct tests for the shared in-flight model load: one load per key, never a stuck entry. */
import { describe, expect, it } from 'vitest';
import { coalesceModelLoad, type ModelLoadingState } from '../model-loading-state.js';

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('coalesceModelLoad', () => {
  it('shares one in-flight load across concurrent callers and clears the entry after it settles', async () => {
    const state: ModelLoadingState = { inFlight: null };
    const gate = deferred();
    let loads = 0;
    const load = () => { loads++; return gate.promise; };
    const first = coalesceModelLoad({ state, load });
    const second = coalesceModelLoad({ state, load });
    expect(second).toBe(first);
    expect(state.inFlight).toBe(first);
    gate.resolve();
    await first;
    await Promise.resolve();
    expect(loads).toBe(1);
    expect(state.inFlight).toBeNull();
    await coalesceModelLoad({ state, load: async () => { loads++; } });
    expect(loads).toBe(2);
  });

  it('rejects every sharer with the load error and allows a retry afterwards', async () => {
    const state: ModelLoadingState = { inFlight: null };
    const failure = new Error('catalog offline');
    const gate = deferred();
    const first = coalesceModelLoad({ state, load: () => gate.promise });
    const second = coalesceModelLoad({ state, load: async () => { throw new Error('never called'); } });
    gate.reject(failure);
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    await Promise.resolve();
    expect(state.inFlight).toBeNull();
    await expect(coalesceModelLoad({ state, load: async () => {} })).resolves.toBeUndefined();
  });

  it('turns a synchronous throw from the loader into a rejection without leaving a stuck entry', async () => {
    const state: ModelLoadingState = { inFlight: null };
    const failure = new Error('sync boom');
    const pending = coalesceModelLoad({ state, load: () => { throw failure; } });
    await expect(pending).rejects.toBe(failure);
    expect(state.inFlight).toBeNull();
  });

  it('installs the shared promise before invoking the loader, so a re-entrant call joins it', async () => {
    const state: ModelLoadingState = { inFlight: null };
    let inner: Promise<void> | undefined;
    const outer = coalesceModelLoad({ state, load: async () => { inner = coalesceModelLoad({ state, load: async () => { throw new Error('second load'); } }); } });
    await outer;
    expect(inner).toBe(outer);
  });
});
