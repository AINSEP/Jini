import { describe, expect, it } from 'vitest';
import { createBrowserComposerHistoryStorage } from '../composer-history-storage.js';

function memoryStorage() {
  const rows = new Map<string, string>();
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
}

describe('composer history storage port', () => {
  it('persists across adapter recreation, isolates users, and stores text only with a cap', async () => {
    const storage = memoryStorage();
    const first = createBrowserComposerHistoryStorage({}, { storage });
    const entries = Array.from({ length: 110 }, (_, i) => `message ${i}`);
    await first.write({ scope: 'alice', entries }, {});
    await first.write({ scope: 'bob', entries: ['bob draft'] }, {});
    const reloaded = createBrowserComposerHistoryStorage({}, { storage });
    expect(await reloaded.read({ scope: 'alice' }, {})).toEqual(entries.slice(10));
    expect(await reloaded.read({ scope: 'bob' }, {})).toEqual(['bob draft']);
    expect(await reloaded.read({ scope: 'unknown' }, {})).toEqual([]);
  });
  it('ignores corrupt data and filters non-text data and consecutive duplicates', async () => {
    const storage = memoryStorage();
    const adapter = createBrowserComposerHistoryStorage({}, { storage });
    storage.setItem('jini:composer-history:v1:alice', '{bad json');
    expect(await adapter.read({ scope: 'alice' }, {})).toEqual([]);
    storage.setItem('jini:composer-history:v1:alice', JSON.stringify(['a', { path: 'attachment' }, 'a', 'b', '']));
    expect(await adapter.read({ scope: 'alice' }, {})).toEqual(['a', 'b']);
  });
  it('keeps scoped in-memory recall when storage is denied', async () => {
    const adapter = createBrowserComposerHistoryStorage({}, { storage: {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    } });
    await adapter.write({ scope: 'alice', entries: ['a', 'a', 'b'] }, {});
    expect(await adapter.read({ scope: 'alice' }, {})).toEqual(['a', 'b']);
    expect(await adapter.read({ scope: 'bob' }, {})).toEqual([]);
  });
});
