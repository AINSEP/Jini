import { expect, it, vi } from 'vitest';
import { dataDirHasExistingPayload, legacyDirHasPayload, type LegacyFilesystemPort } from '../legacy-data-migration.js';

it('uses the supplied filesystem for both proof-file and payload checks', () => {
  const statSync = vi.fn((path: string) => ({ isDirectory: () => path === '/old', isFile: () => path === '/old/data.sqlite' }));
  const existsSync = vi.fn((path: string) => path === '/old/data.sqlite');
  const filesystem = { statSync, existsSync } as unknown as LegacyFilesystemPort;
  const config = { proofEntry: 'data.sqlite', payloadEntries: ['data.sqlite', 'blobs'] };
  expect(legacyDirHasPayload({ legacyDir: '/old', config }, { filesystem })).toBe(true);
  expect(dataDirHasExistingPayload({ dataDir: '/old', config }, { filesystem })).toEqual(['data.sqlite']);
  expect(statSync.mock.calls).toEqual([['/old'], ['/old/data.sqlite'], ['/old']]);
  expect(existsSync.mock.calls).toEqual([['/old/data.sqlite'], ['/old/blobs']]);
});
