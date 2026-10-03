import { describe, expect, it } from 'vitest';

import { createExtractionLog, type ExtractionRecord } from '../extraction-log.js';

async function flushImmediate(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('createExtractionLog', () => {
  it('startExtraction pushes a running record and emits it (deferred via setImmediate)', async () => {
    const log = createExtractionLog({});
    const seen: ExtractionRecord[] = [];
    log.events.on('attempt', (r: ExtractionRecord) => seen.push(r));
    const id = log.startExtraction({ userMessage: '  hello world  ', kind: 'llm' });
    expect(seen).toHaveLength(0);
    await flushImmediate();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id, kind: 'llm', phase: 'running', userMessagePreview: 'hello world' });
  });

  it('truncates a long user message preview with an ellipsis', () => {
    const log = createExtractionLog({});
    const id = log.startExtraction({ userMessage: 'x'.repeat(200), kind: 'llm' });
    const record = log.list().find((r) => r.id === id);
    expect(record?.userMessagePreview.length).toBe(120);
    expect(record?.userMessagePreview.endsWith('…')).toBe(true);
  });

  it('recordSkip records a finished, skipped attempt with a reason', () => {
    const log = createExtractionLog({});
    const id = log.recordSkip({ userMessage: 'hi', reason: 'no-provider', kind: 'llm' });
    const record = log.list().find((r) => r.id === id);
    expect(record).toMatchObject({ phase: 'skipped', reason: 'no-provider' });
    expect(record?.finishedAt).toBeDefined();
  });

  describe('recordHeuristic', () => {
    it('records success with written ids when writtenCount > 0', () => {
      const log = createExtractionLog({});
      const id = log.recordHeuristic({ userMessage: 'hi', kind: 'heuristic', writtenCount: 2, writtenIds: ['a', 'b'] });
      const record = log.list().find((r) => r.id === id);
      expect(record).toMatchObject({ phase: 'success', writtenCount: 2, writtenIds: ['a', 'b'] });
      expect(record?.reason).toBeUndefined();
    });

    it('records skipped with reason no-match when writtenCount is 0', () => {
      const log = createExtractionLog({});
      const id = log.recordHeuristic({ userMessage: 'hi', kind: 'heuristic', writtenCount: 0, writtenIds: [] });
      const record = log.list().find((r) => r.id === id);
      expect(record).toMatchObject({ phase: 'skipped', reason: 'no-match', writtenCount: 0 });
    });

    it('normalizes a non-finite or negative writtenCount to 0 and caps writtenIds at 12', () => {
      const log = createExtractionLog({});
      const id = log.recordHeuristic({ userMessage: 'hi', kind: 'heuristic', writtenCount: Number.NaN, writtenIds: Array.from({ length: 20 }, (_, i) => `id${i}`) });
      const record = log.list().find((r) => r.id === id);
      expect(record?.writtenCount).toBe(0);
      expect(record?.writtenIds).toHaveLength(12);
    });

    it('floors a fractional writtenCount', () => {
      const log = createExtractionLog({});
      const id = log.recordHeuristic({ userMessage: 'hi', kind: 'heuristic', writtenCount: 2.9, writtenIds: [] });
      expect(log.list().find((r) => r.id === id)?.writtenCount).toBe(2);
    });
  });

  it('markProvider attaches provider info, defaulting a missing credentialSource to null', () => {
    const log = createExtractionLog({});
    const id = log.startExtraction({ userMessage: 'hi', kind: 'llm' });
    log.markProvider({ id, provider: { kind: 'anthropic', model: 'claude-haiku-4-5' } });
    expect(log.list().find((r) => r.id === id)?.provider).toEqual({ kind: 'anthropic', model: 'claude-haiku-4-5', credentialSource: null });
  });

  it('markProvider/markProposed/markSuccess/markFailed are no-ops for an unknown id', () => {
    const log = createExtractionLog({});
    expect(() => log.markProvider({ id: 'missing', provider: { kind: 'x', model: 'y' } })).not.toThrow();
    expect(() => log.markProposed({ id: 'missing', proposedCount: 1 })).not.toThrow();
    expect(() => log.markSuccess({ id: 'missing', outcome: { writtenCount: 0, writtenIds: [] } })).not.toThrow();
    expect(() => log.markFailed({ id: 'missing', error: new Error('x') })).not.toThrow();
  });

  it('markProposed sets the proposed count', () => {
    const log = createExtractionLog({});
    const id = log.startExtraction({ userMessage: 'hi', kind: 'llm' });
    log.markProposed({ id, proposedCount: 3 });
    expect(log.list().find((r) => r.id === id)?.proposedCount).toBe(3);
  });

  it('markSuccess finalizes phase/writtenCount/writtenIds and sets finishedAt', () => {
    const log = createExtractionLog({});
    const id = log.startExtraction({ userMessage: 'hi', kind: 'llm' });
    log.markSuccess({ id, outcome: { writtenCount: 1, writtenIds: ['a'] } });
    const record = log.list().find((r) => r.id === id);
    expect(record).toMatchObject({ phase: 'success', writtenCount: 1, writtenIds: ['a'] });
    expect(record?.finishedAt).toBeDefined();
  });

  describe('markFailed', () => {
    it('records an Error instance message, trimmed', () => {
      const log = createExtractionLog({});
      const id = log.startExtraction({ userMessage: 'hi', kind: 'llm' });
      log.markFailed({ id, error: new Error('boom') });
      expect(log.list().find((r) => r.id === id)?.error).toBe('boom');
    });

    it('stringifies a non-Error thrown value, defaulting to "unknown error" for nullish', () => {
      const log = createExtractionLog({});
      const id1 = log.startExtraction({ userMessage: 'hi', kind: 'llm' });
      log.markFailed({ id: id1, error: 'plain string error' });
      expect(log.list().find((r) => r.id === id1)?.error).toBe('plain string error');

      const id2 = log.startExtraction({ userMessage: 'hi', kind: 'llm' });
      log.markFailed({ id: id2, error: undefined });
      expect(log.list().find((r) => r.id === id2)?.error).toBe('unknown error');
    });

    it('truncates a very long error message with an ellipsis', () => {
      const log = createExtractionLog({});
      const id = log.startExtraction({ userMessage: 'hi', kind: 'llm' });
      log.markFailed({ id, error: new Error('e'.repeat(400)) });
      const error = log.list().find((r) => r.id === id)?.error ?? '';
      expect(error.length).toBe(240);
      expect(error.endsWith('…')).toBe(true);
    });
  });

  it('list() returns newest-first clones that cannot mutate internal state', () => {
    const log = createExtractionLog({});
    log.recordSkip({ userMessage: 'first', reason: 'r', kind: 'llm' });
    log.recordSkip({ userMessage: 'second', reason: 'r', kind: 'llm' });
    const list = log.list();
    expect(list[0]?.userMessagePreview).toBe('second');
    list[0]!.userMessagePreview = 'mutated';
    expect(log.list()[0]?.userMessagePreview).toBe('second');
  });

  it('evicts the oldest record once more than 20 are recorded', () => {
    const log = createExtractionLog({});
    const ids = Array.from({ length: 25 }, (_, i) => log.recordSkip({ userMessage: `m${i}`, reason: 'r', kind: 'llm' }));
    expect(log.list()).toHaveLength(20);
    expect(log.list().some((r) => r.id === ids[0])).toBe(false);
    expect(log.list().some((r) => r.id === ids[24])).toBe(true);
  });

  describe('remove', () => {
    it('removes a record by id, returns 1, and emits a deleted event', async () => {
      const log = createExtractionLog({});
      const seen: unknown[] = [];
      log.events.on('attempt', (r) => seen.push(r));
      const id = log.recordSkip({ userMessage: 'hi', reason: 'r', kind: 'llm' });
      await flushImmediate();
      seen.length = 0;
      expect(log.remove({ id })).toBe(1);
      expect(log.list()).toHaveLength(0);
      await flushImmediate();
      expect(seen).toEqual([expect.objectContaining({ id, phase: 'deleted' })]);
    });

    it('returns 0 for an unknown id', () => {
      const log = createExtractionLog({});
      expect(log.remove({ id: 'missing' })).toBe(0);
    });
  });

  describe('clear', () => {
    it('empties the log, returns the count removed, and emits a single cleared event', async () => {
      const log = createExtractionLog({});
      const seen: unknown[] = [];
      log.events.on('attempt', (r) => seen.push(r));
      log.recordSkip({ userMessage: 'a', reason: 'r', kind: 'llm' });
      log.recordSkip({ userMessage: 'b', reason: 'r', kind: 'llm' });
      await flushImmediate();
      seen.length = 0;
      expect(log.clear()).toBe(2);
      expect(log.list()).toHaveLength(0);
      await flushImmediate();
      expect(seen).toEqual([expect.objectContaining({ id: 'all', phase: 'cleared' })]);
    });

    it('returns 0 and emits nothing when already empty', async () => {
      const log = createExtractionLog({});
      const seen: unknown[] = [];
      log.events.on('attempt', (r) => seen.push(r));
      expect(log.clear()).toBe(0);
      await flushImmediate();
      expect(seen).toHaveLength(0);
    });
  });

  it('swallows an emit failure from a throwing listener rather than propagating it', async () => {
    const log = createExtractionLog({});
    log.events.on('attempt', () => {
      throw new Error('listener boom');
    });
    expect(() => log.startExtraction({ userMessage: 'hi', kind: 'llm' })).not.toThrow();
    await flushImmediate();
  });

  it('swallows a throwing listener on remove/clear as well', async () => {
    const log = createExtractionLog({});
    const id = log.recordSkip({ userMessage: 'hi', reason: 'r', kind: 'llm' });
    log.events.on('attempt', () => {
      throw new Error('listener boom');
    });
    expect(() => log.remove({ id })).not.toThrow();
    await flushImmediate();
    const log2 = createExtractionLog({});
    log2.recordSkip({ userMessage: 'hi', reason: 'r', kind: 'llm' });
    log2.events.on('attempt', () => {
      throw new Error('listener boom');
    });
    expect(() => log2.clear()).not.toThrow();
    await flushImmediate();
  });
});

it('uses injected identity, clock and deferral ports throughout an attempt', () => {
  const queued: Array<() => void> = [];
  let now = 10;
  const log = createExtractionLog({}, { ids: () => 'attempt-fixed', now: () => now, defer: ({ callback }) => queued.push(callback) });
  const seen: ExtractionRecord[] = [];
  log.events.on('attempt', (record: ExtractionRecord) => seen.push(record));
  const id = log.startExtraction({ userMessage: 'hello', kind: 'host-kind' });
  now = 20;
  log.markSuccess({ id, outcome: { writtenCount: 1, writtenIds: ['note'] } });
  expect(seen).toEqual([]);
  expect(log.list()[0]).toMatchObject({ id: 'attempt-fixed', startedAt: 10, finishedAt: 20, phase: 'success', writtenIds: ['note'] });
  queued.forEach((callback) => callback());
  expect(seen).toHaveLength(2);
});
