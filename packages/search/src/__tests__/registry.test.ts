import { expect, test } from 'vitest';
import { ProviderRegistryError } from '@jini-ai/core/provider-registry';
import { BUILTIN_SEARCH_PROVIDER_ID, SEARCH_CONTRACT, type SearchProvider } from '../contract.js';
import { createSearchProviderRegistry, validateSearchProvider } from '../registry.js';
import { createInMemorySearchProvider } from '../testkit/memory-provider.js';

const valid = createInMemorySearchProvider();
const withChange = (change: Record<string, unknown>) => ({ ...valid, ...change });
const withCapabilities = (change: Record<string, unknown>) => withChange({ capabilities: { ...valid.capabilities, ...change } });

test('a well-formed provider has no fault, sync or async', () => {
  expect(validateSearchProvider({ provider: valid })).toBeUndefined();
  expect(validateSearchProvider({ provider: createInMemorySearchProvider({}, { asyncIndexing: true }) })).toBeUndefined();
  expect(validateSearchProvider({ provider: withCapabilities({ locales: ['en', 'de'] }) })).toBeUndefined();
  expect(validateSearchProvider({ provider: withChange({ awaitTask: async () => ({ status: 'ok', value: 'succeeded' }) }) })).toBeUndefined();
});

test.each([
  [null, 'a search provider must be an object'],
  ['provider', 'a search provider must be an object'],
  [withChange({ id: 'Bad-Id' }), 'id must be a string matching ^[a-z][a-z0-9_]{0,63}$'],
  [withChange({ id: 7 }), 'id must be a string matching ^[a-z][a-z0-9_]{0,63}$'],
  [withChange({ label: '  ' }), 'label must be a non-empty string'],
  [withChange({ label: undefined }), 'label must be a non-empty string'],
  [withChange({ credentialKeys: 'apiKey' }), 'credentialKeys must be an array of strings'],
  [withChange({ credentialKeys: ['apiKey', 1] }), 'credentialKeys must be an array of strings'],
  [withChange({ capabilities: null }), 'capabilities must be an object'],
  [withCapabilities({ acceptsRestricted: 'no' }), 'capabilities.acceptsRestricted must be a boolean'],
  [withCapabilities({ typoTolerance: undefined }), 'capabilities.typoTolerance must be a boolean'],
  [withCapabilities({ asyncIndexing: 1 }), 'capabilities.asyncIndexing must be a boolean'],
  [withCapabilities({ maxBatch: '10' }), 'capabilities.maxBatch must be a positive integer'],
  [withCapabilities({ maxBatch: 0 }), 'capabilities.maxBatch must be a positive integer'],
  [withCapabilities({ maxBatch: 1.5 }), 'capabilities.maxBatch must be a positive integer'],
  [withCapabilities({ locales: 'en' }), "capabilities.locales must be 'any' or an array of strings"],
  [withCapabilities({ locales: [1] }), "capabilities.locales must be 'any' or an array of strings"],
  [withChange({ query: undefined }), 'query must be a function'],
  [withChange({ revisionOf: 'x' }), 'revisionOf must be a function'],
  [withCapabilities({ asyncIndexing: true }), 'awaitTask must be a function when capabilities.asyncIndexing is true'],
  [withChange({ awaitTask: 'later' }), 'awaitTask must be a function when present'],
])('fault %#: %s', (provider, reason) => {
  expect(validateSearchProvider({ provider })).toBe(reason);
});

test('registry: search contract, built-in default, seed and plugin policies', () => {
  const builtin = createInMemorySearchProvider({}, { id: BUILTIN_SEARCH_PROVIDER_ID });
  const registry = createSearchProviderRegistry({}, { seed: [{ id: BUILTIN_SEARCH_PROVIDER_ID, provider: builtin, label: 'Built-in' }] });
  expect(registry.contract).toBe(SEARCH_CONTRACT);
  expect(registry.getDefault()?.provider).toBe(builtin);
  expect(registry.contribute({ definition: { id: 'vendor', provider: withChange({ label: '' }) as SearchProvider }, pluginId: 'acme', contract: SEARCH_CONTRACT })).toBe(false);
  expect(registry.refusals()[0]?.message).toBe("search provider 'vendor' is invalid: label must be a non-empty string");
  expect(() => registry.register({ definition: { id: 'broken', provider: withCapabilities({ maxBatch: 0 }) as SearchProvider } }))
    .toThrow(new ProviderRegistryError({ code: 'invalid_provider', message: "search provider 'broken' is invalid: capabilities.maxBatch must be a positive integer" }));
});

test('registry: empty by default; a custom default id', () => {
  expect(createSearchProviderRegistry().list()).toEqual([]);
  expect(createSearchProviderRegistry().getDefault()).toBeUndefined();
  const registry = createSearchProviderRegistry({}, { defaultProviderId: 'memory' });
  registry.register({ definition: { id: 'memory', provider: valid } });
  expect(registry.getDefault()?.id).toBe('memory');
  expect(() => createSearchProviderRegistry({}, { defaultProviderId: 'Not Valid' })).toThrow(ProviderRegistryError);
});

// Stryker L5 (2026-10-25): `maxBatch < 1` → `<= 1` survived (1 was never accepted in a test), and
// the provider-id pattern was only tested with one bad id.
test.each([
  [{ maxBatch: 1 }, undefined],
  [{ maxBatch: Number.MAX_SAFE_INTEGER }, undefined],
  [{ maxBatch: Number.MAX_SAFE_INTEGER + 1 }, 'capabilities.maxBatch must be a positive integer'],
  [{ maxBatch: -1 }, 'capabilities.maxBatch must be a positive integer'],
  [{ maxBatch: Number.NaN }, 'capabilities.maxBatch must be a positive integer'],
  [{ locales: [] }, undefined],
  [{ locales: ['en', 2] }, "capabilities.locales must be 'any' or an array of strings"],
])('capability boundary %#', (change, reason) => {
  expect(validateSearchProvider({ provider: withCapabilities(change) })).toBe(reason);
});

test.each([
  ['a', true], ['a'.repeat(64), true], ['a'.repeat(65), false], ['a_1', true], ['1a', false],
  ['_a', false], ['', false], ['a\n', false], ['xa-b', false], ['A', false],
])('provider id %j valid=%s', (id, ok) => {
  expect(validateSearchProvider({ provider: withChange({ id }) })).toBe(ok ? undefined : 'id must be a string matching ^[a-z][a-z0-9_]{0,63}$');
});
