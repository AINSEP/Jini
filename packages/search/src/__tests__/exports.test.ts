import { expect, test } from 'vitest';
import * as search from '../index.js';
import * as testkit from '../testkit/index.js';

test('the root entry exposes the registry and tokens next to the contract', () => {
  expect(typeof search.createSearchProviderRegistry).toBe('function');
  expect(typeof search.validateSearchProvider).toBe('function');
  expect(search.SEARCH_CONTRACT).toBe('search');
});

test('tokens: ids and cardinality', () => {
  expect([search.SearchProviderRegistryToken, search.SearchServiceToken, search.SearchIndexerToken, search.SearchDocumentSourceToken]
    .map(token => [token.id, token.cardinality, token.version])).toEqual([
    ['search.provider-registry', 'one', 1],
    ['search.service', 'one', 1],
    ['search.indexer', 'one', 1],
    ['search.document-source', 'many', 1],
  ]);
});

test('the testkit entry exposes the kit, the reference provider and the fakes', () => {
  expect(Object.keys(testkit).sort()).toEqual([
    'SearchConformanceError', 'check', 'createFakeHttpClient', 'createInMemorySearchProvider', 'createInMemorySearchState',
    'createPredicateAccessPort', 'createStaticAccessPort', 'createUnavailableHttpClient', 'runSearchProviderConformance',
  ]);
  expect(() => testkit.check(false, 'boom')).toThrow(new testkit.SearchConformanceError('boom'));
  expect(new testkit.SearchConformanceError('x').message).toBe('search conformance: x');
});
