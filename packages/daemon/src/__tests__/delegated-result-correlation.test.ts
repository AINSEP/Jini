import { describe, expect, it, vi } from 'vitest';
import { createDelegatedResultCorrelation } from '../delegated-result-correlation.js';
import { createNodeCredentialCrypto } from '../run-credentials.js';
import { createRunLifecycle } from '../run-lifecycle.js';
import { createInMemoryEventLog } from '../event-log.js';

const content = [{ type: 'image', mimeType: 'image/png', data: 'PIXELS' }];
const saved = { runId: 'run', toolUseId: 'B', content, isError: false };
const makeStore = () => createDelegatedResultCorrelation({ crypto: createNodeCredentialCrypto({}) });

describe('delegated result correlation', () => {
  it('requires the same run, completed call, outcome and entire content digest', () => {
    const store = makeStore();
    expect(store.matches(saved)).toBe(false);
    store.record(saved);
    expect(store.matches(saved)).toBe(true);
    expect(store.matches({ ...saved, runId: 'other' })).toBe(false);
    expect(store.matches({ ...saved, toolUseId: 'forged' })).toBe(false);
    expect(store.matches({ ...saved, isError: true })).toBe(false);
    expect(store.matches({ ...saved, content: [...content, { type: 'text', text: 'changed' }] })).toBe(false);
    expect(store.matches({ ...saved, content: [{ ...content[0], data: 'OTHER' }] })).toBe(false);
  });
  it('normalizes key order and the CLI base64 source representation', () => {
    const store = makeStore();
    store.record(saved);
    expect(store.matches({ ...saved, content: [{ data: 'PIXELS', mimeType: 'image/png', type: 'image' }] })).toBe(true);
    expect(store.matches({ ...saved, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'PIXELS' } }] })).toBe(true);
  });
  it('retains both representations of dual-format images in the digest', () => {
    const store = makeStore();
    const source = { type: 'base64', media_type: 'image/png', data: 'PIXELS' };
    const image = { type: 'image', mimeType: 'image/png', data: 'PIXELS', source };
    store.record(saved);
    expect(store.matches({ ...saved, content: [image] })).toBe(false);
    store.record({ ...saved, content: [image] });
    expect(store.matches({ ...saved, content: [image] })).toBe(true);
    expect(store.matches({ ...saved, content: [{ ...image, data: 'OTHER' }] })).toBe(false);
    expect(store.matches({ ...saved, content: [{ ...image, mimeType: 'image/jpeg' }] })).toBe(false);
    expect(store.matches({ ...saved, content: [{ ...image, source: { ...source, data: 'OTHER' } }] })).toBe(false);
    expect(store.matches({ ...saved, content: [{ ...image, source: { ...source, media_type: 'image/jpeg' } }] })).toBe(false);
    expect(store.matches(saved)).toBe(false);
  });
  it('preserves extra source fields rather than normalizing away their differences', () => {
    const store = makeStore();
    const source = { type: 'base64', media_type: 'image/png', data: 'PIXELS', detail: 'original' };
    const image = { type: 'image', source };
    store.record({ ...saved, content: [image] });
    expect(store.matches({ ...saved, content: [image] })).toBe(true);
    expect(store.matches(saved)).toBe(false);
    expect(store.matches({ ...saved, content: [{ ...image, source: { ...source, detail: 'changed' } }] })).toBe(false);
  });
  it('keeps distinct calls sharing pixels and repeated echoes independent', () => {
    const store = makeStore();
    store.record(saved);
    store.record({ ...saved, toolUseId: 'B2' });
    expect(store.matches(saved)).toBe(true);
    expect(store.matches({ ...saved, toolUseId: 'B2' })).toBe(true);
    expect(store.matches(saved)).toBe(true);
    store.clearRun({ runId: 'run' });
    expect(store.matches(saved)).toBe(false);
  });
  it('retains digests rather than references to the original mutable content', () => {
    const store = makeStore();
    const image = { type: 'image', mimeType: 'image/png', data: 'PIXELS' };
    store.record({ ...saved, content: [image] });
    image.data = 'CHANGED';
    expect(store.matches(saved)).toBe(true);
    expect(store.matches({ ...saved, content: [image] })).toBe(false);
  });
  it('falls back when an in-process result cannot be fingerprinted', () => {
    const store = makeStore();
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => store.record({ ...saved, content: cyclic })).not.toThrow();
    expect(store.matches({ ...saved, content: cyclic })).toBe(false);
    expect(store.matches(saved)).toBe(false);
  });
  it('bounds records and safely falls back after eviction or process restart', () => {
    const store = createDelegatedResultCorrelation({ crypto: createNodeCredentialCrypto({}) }, { maxRuns: 1, maxCallsPerRun: 1 });
    store.record(saved);
    store.record({ ...saved, toolUseId: 'B2' });
    expect(store.matches(saved)).toBe(false);
    store.record({ ...saved, runId: 'next' });
    expect(store.matches({ ...saved, toolUseId: 'B2' })).toBe(false);
    expect(makeStore().matches(saved)).toBe(false);
  });
  it('clears proofs when the lifecycle evicts a terminal run', async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) }, { delegatedResultCorrelation: store, terminalRetentionMs: 10, slowRunThresholdMs: 0 });
      const { run } = await lifecycle.start({ contextRef: 'eviction' });
      const identity = { ...saved, runId: run.id };
      store.record(identity);
      await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
      expect(store.matches(identity)).toBe(true);
      await vi.advanceTimersByTimeAsync(11);
      expect(store.matches(identity)).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
