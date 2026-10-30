import { rmSync } from 'node:fs';
import { expect, test } from 'vitest';
import { countLegacyOwnerStore, readLegacyOwnerStore, ownerContext } from '../../index.js';
import { legacyStore, open } from '../fixture.js';

test('an empty legacy store can be read without a key and never recreates the removed key', async () => {
  const store = await legacyStore();
  try {
    rmSync(store.keyFilePath);
    expect(await countLegacyOwnerStore({ filePath: store.filePath, open })).toEqual({ entries: 0, grants: 0 });
    expect(await readLegacyOwnerStore({ filePath: store.filePath, keyFilePath: store.keyFilePath, open }))
      .toEqual({ entries: [], grants: [], revocations: [] });
    const { existsSync } = await import('node:fs');
    expect(existsSync(store.keyFilePath)).toBe(false);
  } finally { store.cleanup(); }
});

test('legacy contexts preserve binding and feature ownership within the fixed owner workspace', () => {
  expect(ownerContext({ kind: 'vendor', ownerKey: 'feature', binding: 'connection-1' })).toEqual({
    kind: 'vendor', ownerKey: 'feature', binding: 'connection-1', workspaceId: 'owner', principalId: null,
  });
});
