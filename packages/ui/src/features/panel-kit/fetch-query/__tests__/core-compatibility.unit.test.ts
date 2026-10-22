// @vitest-environment node
import { expect, expectTypeOf, it } from 'vitest';
import * as core from '@jini-ai/core/fetch';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type * as legacy from '../index.js';
import type * as tanstack from '../tanstack.js';

it('routes deprecated public contracts directly to core without private shims', async () => {
  // Package entries must resolve the canonical owner without passing through dead shims.
  const directory = path.resolve(__dirname, '..');
  expect(existsSync(path.join(directory, 'cache.ts'))).toBe(false);
  expect(existsSync(path.join(directory, 'types.ts'))).toBe(false);
  const cache = new core.FetchQueryCache({}, { scheduler: { schedule: () => 0, cancel: () => {} } });
  try {
    const key: core.QueryKey = ['compatibility', 1];
    const entry = cache.entry({ key });
    await expect(cache.load({ entry, fetch: async () => 'shared value', staleTime: 0 })).resolves.toBe('shared value');
    expect(entry.state.data).toBe('shared value');
  } finally {
    cache.dispose();
  }
});

it('preserves neutral contract types at both existing UI entry points', () => {
  expectTypeOf<legacy.QueryKey>().toEqualTypeOf<core.QueryKey>();
  expectTypeOf<legacy.QueryStatus>().toEqualTypeOf<core.QueryStatus>();
  expectTypeOf<legacy.QueryResult<string>>().toEqualTypeOf<core.QueryResult<string>>();
  expectTypeOf<legacy.FetchQueryOptions<string>>().toEqualTypeOf<core.FetchQueryOptions<string>>();
  expectTypeOf<legacy.MutationStatus>().toEqualTypeOf<core.MutationStatus>();
  expectTypeOf<legacy.MutationResult<string, number>>().toEqualTypeOf<core.MutationResult<string, number>>();
  expectTypeOf<legacy.FetchMutationOptions<string, number>>().toEqualTypeOf<core.FetchMutationOptions<string, number>>();
  expectTypeOf<legacy.CachedLoaderOptions<string>>().toEqualTypeOf<core.CachedLoaderOptions<string>>();
  expectTypeOf<legacy.CachedLoader<string>>().toEqualTypeOf<core.CachedLoader<string>>();
  expectTypeOf<legacy.FetchQueryAdapter>().toEqualTypeOf<core.FetchQueryAdapter>();
  expectTypeOf<legacy.FetchQueryEnvironmentPort>().toEqualTypeOf<core.FetchQueryEnvironmentPort>();
  expectTypeOf<tanstack.QueryKey>().toEqualTypeOf<core.QueryKey>();
  expectTypeOf<tanstack.FetchQueryAdapter>().toEqualTypeOf<core.FetchQueryAdapter>();
  expectTypeOf<tanstack.FetchQueryEnvironmentPort>().toEqualTypeOf<core.FetchQueryEnvironmentPort>();
});
