# @jini-ai/search

A generic site-search capability: one provider contract every search backend implements, a
registry for those providers, a single-writer indexer, a query service that re-checks access before
showing a hit, agent tools, and a conformance kit that every provider must pass unchanged.

The engine holds no product wiring. A host supplies its document sources, its index bookkeeping
table, its per-site target pointer and its access check as ports (`src/ports.ts`), and binds the
results through the composition tokens.

## Entry points

| Import | Runtime | What it gives you |
|---|---|---|
| `@jini-ai/search` | universal | The contract (`SearchProvider`, documents, keys, revisions, tombstones), host ports, the `SearchService`/`SearchIndexer` APIs, `createSearchProviderRegistry`, `validateSearchProvider`, and the tokens `SearchProviderRegistryToken`, `SearchServiceToken`, `SearchIndexerToken`, `SearchDocumentSourceToken` (many). |
| `@jini-ai/search/tools` | universal | Agent tools over a `SearchService`. |
| `@jini-ai/search/contribution` | node | `defineSearchProviderContribution({ filename })` for plugin-contributed providers, loaded through `@jini-ai/agent-plugins`' executable contribution loader (an optional peer dependency), plus `contributeProviders`. |
| `@jini-ai/search/testkit` | universal | `runSearchProviderConformance`, the in-memory reference provider, and fakes (`createFakeHttpClient`, `createUnavailableHttpClient`, `createInMemorySearchState`, `createStaticAccessPort`, `createPredicateAccessPort`). Test-only. |

## Plugin providers

A plugin ships a manifest at its package root, under the filename the host chooses:

```json
{ "schemaVersion": 1, "providers": [{ "id": "meilisearch", "label": "Meilisearch", "module": "dist/provider.mjs" }] }
```

The module's default export must be a `SearchProvider` whose `id` equals the manifest id. Plugin
providers are public-only: one that declares `capabilities.acceptsRestricted: true` is refused,
because audience-restricted content may only live in the host's own built-in provider. Every fault
becomes a refusal line, never a boot crash.

## Running the conformance kit

```ts
import { test } from 'vitest';
import { runSearchProviderConformance, createUnavailableHttpClient } from '@jini-ai/search/testkit';

runSearchProviderConformance({
  name: 'my provider',
  test,
  makeProvider: () => createMyProvider(),
  makeContext: ({ siteId, indexName }) => ({ workspaceId: 'w', siteId, indexName, mode: 'test', credentials, httpClient, timeoutMs: 5000, now: Date.now }),
}, { makeUnavailableContext: input => ({ ...contextFor(input), httpClient: createUnavailableHttpClient() }) });
```

The runner is injected, so the kit works with vitest, node:test or jest. Each case uses its own
index name, drops and re-creates it first, and settles `pending` writes through `awaitTask` when the
provider declares `asyncIndexing`.

## What a built-in provider must implement

The owner's built-in provider is a plain `SearchProvider`, registered by the composition root as a
core provider (`createSearchProviderRegistry({}, { seed: [{ id: 'builtin', provider }] })`). It must:

- use `id: 'builtin'` (`BUILTIN_SEARCH_PROVIDER_ID`, also the registry's default) and
  `credentialKeys: []`;
- declare honest capabilities. `acceptsRestricted: true` is allowed here and only here, since the
  built-in is the one provider that may hold audience-restricted documents. It must then return a
  restricted document only to a query whose `audiences` intersect the document's;
- keep its data in its own tables, reached through `ctx.storage`, created by its own TS migration.
  It never reads or writes host tables;
- partition everything by `ctx.indexName`, so two sites or two generations never see each
  other's documents;
- follow the revision rules. Revisions are numbers. A write (document or tombstone) whose revision
  is not strictly greater than what is held for the key is `stale` and changes nothing. `remove`
  writes a versioned tombstone, also for a key that was never indexed, so a delayed lower-revision
  upsert can never resurrect a removed document. `revisionOf` reports absent as
  `{ revision: null, deleted: false }` and a tombstone as `{ revision, deleted: true }`;
- report one write outcome per input, in input order;
- return plain-text snippets (never HTML) with highlight ranges as UTF-16 offsets inside the snippet;
- reject empty or whitespace query text as `invalid_request`, and paginate with an opaque cursor that
  gives stable pages with no overlap;
- never throw. A definite refusal is `rejected`. An indeterminate outcome (timeout, storage down) is
  `unknown`;
- pass `runSearchProviderConformance` unchanged. The in-memory reference provider in the testkit
  shows the expected semantics, but it is not the built-in and must never be registered in a host.
