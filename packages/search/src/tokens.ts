/**
 * @file Composition tokens of the search capability. Consumers (routes, theme blocks, agent tools)
 * resolve only {@link SearchServiceToken}; the composition root alone resolves the indexer and binds
 * one {@link SearchDocumentSourceToken} per collection (CMS posts, pages, a plugin's catalog …).
 */
import { manyToken, token } from '@jini-ai/core';
import type { SearchIndexer, SearchService } from './api.js';
import type { SearchDocumentSource } from './ports.js';
import type { SearchProviderRegistry } from './registry.js';

export const SearchProviderRegistryToken = token<SearchProviderRegistry>({ id: 'search.provider-registry' });
export const SearchServiceToken = token<SearchService>({ id: 'search.service' });
export const SearchIndexerToken = token<SearchIndexer>({ id: 'search.indexer' });
/** Many-bound: every collection that can be searched contributes its own source. */
export const SearchDocumentSourceToken = manyToken<SearchDocumentSource>({ id: 'search.document-source' });
