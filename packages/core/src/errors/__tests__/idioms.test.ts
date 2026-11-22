/**
 * @file Each idiom's contract, including what must NOT happen: `observed` does not hide a rejection
 * from an awaiter, `absentWhen` does not turn a real failure into "absent", and no idiom lets an
 * observer or a log sink turn an optional step into a failure.
 */
import { describe, expect, test } from 'vitest';
import { absentWhen, afterSettled, bestEffort, observed, orFallback, orFallbackSync } from '../idioms.js';
import { createRecordingLogger } from '../testing.js';

class MissingError extends Error {}
const enoent = (): Error => Object.assign(new Error('no such file'), { code: 'ENOENT' });

describe('observed', () => {
  test('marks the promise handled, returns nothing, and every awaiter still gets the rejection', async () => {
    const failure = new Error('save failed');
    const promise = Promise.reject(failure);
    expect(observed({ promise })).toBeUndefined();
    await expect(promise).rejects.toBe(failure);
  });

  test('an observed rejection that nobody awaits is not reported as unhandled', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', listener);
    try {
      observed({ promise: Promise.reject(new Error('its owner already shows this')) });
      await new Promise(resolve => { setTimeout(resolve, 20); });
    } finally { process.off('unhandledRejection', listener); }
    expect(unhandled).toEqual([]);
  });
});

describe('afterSettled', () => {
  test('resolves after a fulfilment and after a rejection, with no value', async () => {
    await expect(afterSettled({ promise: Promise.resolve('value') })).resolves.toBeUndefined();
    await expect(afterSettled({ promise: Promise.reject(new Error('previous job failed')) })).resolves.toBeUndefined();
  });

  test('does not resolve before the promise settles', async () => {
    let release!: () => void;
    const order: string[] = [];
    const tail = afterSettled({ promise: new Promise<void>(resolve => { release = resolve; }) }).then(() => order.push('tail'));
    await Promise.resolve();
    order.push('before release');
    release();
    await tail;
    expect(order).toEqual(['before release', 'tail']);
  });
});

describe('orFallback', () => {
  test('returns the work result, sync or async, and does not call the observer', async () => {
    const seen: unknown[] = [];
    const observe = (required: { error: unknown; step: string }) => { seen.push(required); };
    expect(await orFallback({ work: () => 'sync', fallback: 'fallback', step: 'probe' }, { observe })).toBe('sync');
    expect(await orFallback({ work: async () => 'async', fallback: 'fallback', step: 'probe' }, { observe })).toBe('async');
    expect(seen).toEqual([]);
  });

  test('any failure gives the fallback unchanged, and the observer receives the error with the step', async () => {
    const failure = new TypeError('fetch failed');
    const fallback = { status: null };
    const seen: unknown[] = [];
    expect(await orFallback({ work: () => Promise.reject(failure), fallback, step: 'HEAD probe' }, { observe: required => { seen.push(required); } })).toBe(fallback);
    expect(await orFallback({ work: () => { throw failure; }, fallback, step: 'HEAD probe' })).toBe(fallback);
    expect(seen).toEqual([{ error: failure, step: 'HEAD probe' }]);
  });

  test('a throwing observer still gives the fallback', async () => {
    const observe = (): void => { throw new Error('observer bug'); };
    expect(await orFallback({ work: () => Promise.reject(new Error('x')), fallback: 0, step: 'probe' }, { observe })).toBe(0);
    expect(orFallbackSync({ work: () => { throw new Error('x'); }, fallback: 0, step: 'probe' }, { observe })).toBe(0);
  });
});

describe('orFallbackSync', () => {
  test('returns the result, or the fallback on a throw, and reports the error to the observer', () => {
    const failure = new Error('storage is disabled');
    const seen: unknown[] = [];
    expect(orFallbackSync({ work: () => 'stored', fallback: null, step: 'read draft' })).toBe('stored');
    expect(orFallbackSync({ work: (): string => { throw failure; }, fallback: null, step: 'read draft' }, { observe: required => { seen.push(required); } })).toBeNull();
    expect(seen).toEqual([{ error: failure, step: 'read draft' }]);
  });
});

describe('bestEffort', () => {
  test('a cleanup failure is logged once with its step and the original error, and is not thrown', async () => {
    const { logger, entries } = createRecordingLogger();
    const failure = new Error('socket already closed');
    await expect(bestEffort({ work: () => Promise.reject(failure), step: 'close export stream', logger })).resolves.toBeUndefined();
    await bestEffort({ work: () => { throw failure; }, step: 'remove temp file', logger });
    expect(entries).toEqual([
      { level: 'warn', message: '[cleanup] close export stream failed', meta: { step: 'close export stream' }, error: failure },
      { level: 'warn', message: '[cleanup] remove temp file failed', meta: { step: 'remove temp file' }, error: failure },
    ]);
  });

  test('a successful cleanup logs nothing, and a failing log sink is not thrown either', async () => {
    const { logger, entries } = createRecordingLogger();
    await bestEffort({ work: () => undefined, step: 'close', logger });
    expect(entries).toEqual([]);
    const broken = { warn: (): void => { throw new Error('sink down'); } };
    await expect(bestEffort({ work: () => Promise.reject(new Error('x')), step: 'close', logger: broken })).resolves.toBeUndefined();
  });
});

describe('absentWhen', () => {
  test('returns the value when the work succeeds', async () => {
    expect(await absentWhen({ work: async () => 'contents', codes: ['ENOENT'], kinds: [] })).toBe('contents');
  });

  test('a listed code or a listed class reads as absent', async () => {
    expect(await absentWhen({ work: () => Promise.reject(enoent()), codes: ['ENOENT'], kinds: [] })).toBeUndefined();
    expect(await absentWhen({ work: () => { throw new MissingError('gone'); }, codes: [], kinds: [MissingError] })).toBeUndefined();
  });

  test('every other failure is rethrown unchanged: a storage error never reads as absent', async () => {
    const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    await expect(absentWhen({ work: () => Promise.reject(busy), codes: ['ENOENT'], kinds: [MissingError] })).rejects.toBe(busy);
    await expect(absentWhen({ work: () => Promise.reject('ENOENT'), codes: ['ENOENT'], kinds: [] })).rejects.toBe('ENOENT');
    await expect(absentWhen({ work: () => Promise.reject({ code: 7 }), codes: ['ENOENT'], kinds: [] })).rejects.toEqual({ code: 7 });
    await expect(absentWhen({ work: () => Promise.reject(null), codes: ['ENOENT'], kinds: [] })).rejects.toBeNull();
  });
});
