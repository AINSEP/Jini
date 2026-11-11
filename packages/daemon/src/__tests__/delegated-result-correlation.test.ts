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

// F1 fix wave (Stryker L8 §4 delegated-result-correlation.ts: image-source guards → false and the
// limits/eviction branches survived). A malformed CLI source image must NOT be normalized into the
// canonical {data,mimeType} form, so it can never be passed off as the recorded result.
describe('delegated result correlation — F1 malformed image sources', () => {
  const good = { type: 'base64', media_type: 'image/png', data: 'PIXELS' };
  it.each([
    ['source null', null],
    ['source string', 'PIXELS'],
    ['source array', ['base64', 'image/png', 'PIXELS']],
    ['non-base64 source type', { ...good, type: 'url' }],
    ['numeric media_type', { ...good, media_type: 1 }],
    ['numeric data', { ...good, data: 1 }],
    ['missing media_type', { type: 'base64', data: 'PIXELS' }],
    ['extra source field', { ...good, url: 'https://x' }],
  ])('%s is not normalized and does not match the recorded canonical image', (_l, source) => {
    const store = makeStore();
    store.record(saved);
    expect(store.matches({ ...saved, content: [{ type: 'image', source }] })).toBe(false);
  });

  it('a non-image block with a base64 source is left alone', () => {
    const store = makeStore();
    store.record(saved);
    expect(store.matches({ ...saved, content: [{ type: 'document', source: good }] })).toBe(false);
  });

  it('an image that already has mimeType (but no data) is not re-derived from its source', () => {
    const store = makeStore();
    store.record(saved);
    expect(store.matches({ ...saved, content: [{ type: 'image', mimeType: 'image/png', source: good }] })).toBe(false);
  });

  it.each([[0, 1], [1, 0], [1.5, 1], [1, Number.NaN], [-1, 1]])('limits maxRuns=%s maxCallsPerRun=%s are refused', (maxRuns, maxCallsPerRun) => {
    expect(() => createDelegatedResultCorrelation({ crypto: createNodeCredentialCrypto({}) }, { maxRuns, maxCallsPerRun })).toThrow(new Error('correlation limits must be positive integers'));
  });

  it('evicts the OLDEST run first once maxRuns is reached, and the oldest call first per run', () => {
    const store = createDelegatedResultCorrelation({ crypto: createNodeCredentialCrypto({}) }, { maxRuns: 2, maxCallsPerRun: 2 });
    const at = (runId: string, toolUseId: string) => ({ ...saved, runId, toolUseId });
    store.record(at('r1', 'a')); store.record(at('r2', 'a')); store.record(at('r3', 'a'));
    expect([store.matches(at('r1', 'a')), store.matches(at('r2', 'a')), store.matches(at('r3', 'a'))]).toEqual([false, true, true]);
    store.record(at('r3', 'b')); store.record(at('r3', 'c'));
    expect([store.matches(at('r3', 'a')), store.matches(at('r3', 'b')), store.matches(at('r3', 'c'))]).toEqual([false, true, true]);
  });

  it('a digest failure (cyclic content) silently records nothing and never matches', () => {
    const store = makeStore();
    const cyclic: Record<string, unknown> = { type: 'text' }; cyclic.self = cyclic;
    expect(() => store.record({ ...saved, content: [cyclic] })).not.toThrow();
    expect(store.matches({ ...saved, content: [cyclic] })).toBe(false);
  });

  it('clearRun forgets only that run', () => {
    const store = makeStore();
    store.record(saved); store.record({ ...saved, runId: 'keep' });
    store.clearRun({ runId: 'run' });
    expect([store.matches(saved), store.matches({ ...saved, runId: 'keep' })]).toEqual([false, true]);
  });
});

describe('delegated result correlation — F1 re-score kills (malformed ≠ canonical, both directions)', () => {
  const canonical = { type: 'image', mimeType: 'image/png', data: 'PIXELS' };
  it.each([
    ['url source', { type: 'url', media_type: 'image/png', data: 'PIXELS' }],
    ['numeric media_type', { type: 'base64', media_type: 7, data: 'PIXELS' }],
    ['numeric data', { type: 'base64', media_type: 'image/png', data: 7 }],
  ])('a recorded image with a %s is not interchangeable with the canonical form', (_l, source) => {
    const store = makeStore();
    store.record({ ...saved, content: [{ type: 'image', source }] });
    expect(store.matches({ ...saved, content: [canonical] })).toBe(false);
    expect(store.matches({ ...saved, content: [{ type: 'image', source }] })).toBe(true);
  });
  it('a recorded null-source image still matches itself (the guard must not throw the digest away)', () => {
    const store = makeStore();
    store.record({ ...saved, content: [{ type: 'image', source: null }] });
    expect(store.matches({ ...saved, content: [{ type: 'image', source: null }] })).toBe(true);
  });
  it('a recorded non-image block with a base64 source is not interchangeable with a {data,mimeType} block', () => {
    const store = makeStore();
    store.record({ ...saved, content: [{ type: 'document', source: { type: 'base64', media_type: 'image/png', data: 'PIXELS' } }] });
    expect(store.matches({ ...saved, content: [{ type: 'document', mimeType: 'image/png', data: 'PIXELS' }] })).toBe(false);
  });
});
