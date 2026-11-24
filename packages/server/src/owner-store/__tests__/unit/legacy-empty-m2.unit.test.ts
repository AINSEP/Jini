import { rmSync } from 'node:fs';
import { expect, test } from 'vitest';
import { countLegacyOwnerStore, readLegacyOwnerStore } from '../../index.js';
import { legacyStore, open, ports } from '../fixture.js';

test('an empty legacy store can be read without a key and never recreates the removed key', async () => {
  const store = await legacyStore();
  try {
    rmSync(store.keyFilePath);
    expect(await countLegacyOwnerStore({ filePath: store.filePath, open, ports })).toEqual({ entries: 0, grants: 0 });
    expect(await readLegacyOwnerStore({ filePath: store.filePath, keyFilePath: store.keyFilePath, open, ports }))
      .toEqual({ entries: [], grants: [], revocations: [] });
    const { existsSync } = await import('node:fs');
    expect(existsSync(store.keyFilePath)).toBe(false);
  } finally { store.cleanup(); }
});
