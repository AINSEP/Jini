import { describe, expect, it } from 'vitest';
import { PREFERENCES_UNREADABLE, readPreferenceSettings, readPreferenceValue, writePreferenceValue } from '../preference-file.js';
import type { PreferenceFilePort, PreferenceFileRead, PreferenceProblem } from '../preference-file.js';

/** An in-memory file: `undefined` is missing, a string is unparsable bytes, anything else is JSON. */
function memoryFile(initial?: unknown) {
  let stored: { raw: string } | { json: unknown } | undefined = typeof initial === 'string' ? { raw: initial } : initial === undefined ? undefined : { json: initial };
  const events: string[] = [];
  const file: PreferenceFilePort = {
    read: ({ filePath }): PreferenceFileRead => {
      events.push(`read:${filePath}`);
      if (!stored) return { state: 'missing' };
      return 'raw' in stored ? { state: 'unreadable' } : { state: 'ok', value: stored.json };
    },
    withLock: ({ filePath, critical }) => { events.push(`lock:${filePath}`); try { critical(); } finally { events.push('unlock'); } },
    writeAtomic: ({ filePath, value }) => { events.push(`write:${filePath}`); stored = { json: value }; },
  };
  return { file, events, stored: () => stored };
}

const positive = ({ value }: { value: unknown }) => typeof value === 'number' && value > 0 ? value : undefined;

function readCount(initial: unknown) {
  const problems: PreferenceProblem[] = [];
  const value = readPreferenceValue({ file: memoryFile(initial).file, filePath: '/p.json', key: 'count', parse: positive, fallback: 1 },
    { onProblem: ({ problem }) => { problems.push(problem); } });
  return { value, problems };
}

describe('readPreferenceValue', () => {
  it('a missing file or key reads the fallback silently; a valid value reads back', () => {
    expect(readCount(undefined)).toEqual({ value: 1, problems: [] });
    expect(readCount({ other: true })).toEqual({ value: 1, problems: [] });
    expect(readCount({ count: 4 })).toEqual({ value: 4, problems: [] });
  });

  it('names each fallback problem so the host can word its own warning', () => {
    expect(readCount('{broken')).toEqual({ value: 1, problems: ['unreadable'] });
    expect(readCount([1])).toEqual({ value: 1, problems: ['not-an-object'] });
    expect(readCount(null)).toEqual({ value: 1, problems: ['not-an-object'] });
    expect(readCount({ count: -2 })).toEqual({ value: 1, problems: ['invalid-value'] });
  });

  it('works without a problem listener', () => {
    expect(readPreferenceValue({ file: memoryFile('{x').file, filePath: '/p', key: 'k', parse: positive, fallback: 7 })).toBe(7);
  });
});

describe('readPreferenceSettings', () => {
  it('only a readable JSON object counts as settings', () => {
    expect(readPreferenceSettings({ file: memoryFile({ a: 1 }).file, filePath: '/p' })).toEqual({ a: 1 });
    for (const value of [undefined, '{broken', null, [false], 3]) expect(readPreferenceSettings({ file: memoryFile(value).file, filePath: '/p' })).toEqual({});
  });
});

describe('writePreferenceValue', () => {
  it('saves one key under the lock and keeps every other setting', () => {
    const memory = memoryFile({ future: 42 });
    writePreferenceValue({ file: memory.file, filePath: '/p.json', key: 'flag', value: false });
    expect(memory.stored()).toEqual({ json: { future: 42, flag: false } });
    expect(memory.events).toEqual(['lock:/p.json', 'read:/p.json', 'read:/p.json', 'write:/p.json', 'unlock']);
  });

  it('replaces a non-object file with an object holding only the new key', () => {
    const memory = memoryFile([1]);
    writePreferenceValue({ file: memory.file, filePath: '/p', key: 'flag', value: true });
    expect(memory.stored()).toEqual({ json: { flag: true } });
  });

  it('preserves unreadable bytes and throws instead of overwriting them', () => {
    const memory = memoryFile('{broken');
    expect(() => writePreferenceValue({ file: memory.file, filePath: '/p', key: 'flag', value: true })).toThrow(PREFERENCES_UNREADABLE);
    expect(memory.stored()).toEqual({ raw: '{broken' });
    expect(memory.events.at(-1)).toBe('unlock');
  });
});
