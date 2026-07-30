import { describe, expect, it } from 'vitest';

import {
  DatabaseRegistryBackend,
  GithubRegistryBackend,
  StaticRegistryBackend,
  ensureRegistryTables,
  parseRegistrySpecifier,
  resolveRegistryEntryVersion,
  upsertRegistryEntry,
} from '../index.js';

describe('@jini-ai/registry — barrel', () => {
  it('re-exports the versioning helpers and every backend class', () => {
    expect(parseRegistrySpecifier('vendor/name')).toEqual({ name: 'vendor/name' });
    expect(
      resolveRegistryEntryVersion({ name: 'vendor/name', version: '1.0.0', source: 's' }),
    ).toMatchObject({ version: '1.0.0', source: 's' });
    expect(StaticRegistryBackend).toBeTypeOf('function');
    expect(GithubRegistryBackend).toBeTypeOf('function');
    expect(DatabaseRegistryBackend).toBeTypeOf('function');
    expect(ensureRegistryTables).toBeTypeOf('function');
    expect(upsertRegistryEntry).toBeTypeOf('function');
  });
});
