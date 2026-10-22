Spec ID: SPEC-JINI-REGISTRY-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:da20f97921e9d97f55d05b4cd719b66112efb49f85b176f194c4e8312d567b0d
spec_mode: reverse_spec

# API Contract: @jini-ai/registry

## Entry points and dependencies

Public exports are `.`, `./tool-catalog`, `./tool-catalog/sqlite`, `./tool-catalog-builder`, and `./tool-catalog-builder/sqlite`. Root provides content-registry implementations and trust/version helpers; catalog is a separate tool-discovery port. Root uses Node crypto and protocol wire schemas; the catalog port is type-only and universal. SQLite integrations require consumer-owned connections and driver support.

Public functions and constructors use required objects and optional configuration objects where declared. A one-object signature has no declared second argument. Base Clock, JSON and HTTP contracts come from `@jini-ai/core/primitives`; native SQL and source descriptor ports retain their own callback shapes.

## Root: backends

| Export | Current constructor/factory | Consumer supplies |
|---|---|---|
| `StaticRegistryBackend` | `new StaticRegistryBackend({id, trust, manifest}, options: StaticRegistryBackendOptions = {})` | Required identity/policy/manifest; options `{kind?, trustRoot?, clock?}`; kind defaults to `http` |
| `GithubRegistryBackend` | `GithubRegistryBackend.create({id, owner, repo, client}, options: GithubRegistryBackendOptions = {}): Promise<GithubRegistryBackend>`; constructor private | `{ id, owner, repo, client, ref?, manifestPath?, trust?, trustRoot? }` |
| `DatabaseRegistryBackend` | `new DatabaseRegistryBackend({id, db}, options: DatabaseRegistryBackendOptions = {})` | Host-owned structural RegistryDatabasePort; options `{trust?, trustRoot?, clock?}` |
| `GithubApiRegistryClient` | `new GithubApiRegistryClient({http: HttpClientPort}, options: GithubApiRegistryClientOptions = {})` | Optional `{ token, apiUrl }`; required core HTTP transport |
| `ensureRegistryTables` | `({db: RegistryDatabasePort}): void` | Live synchronous SQLite connection |
| `upsertRegistryEntry` | `({db, backendId, entry}, {now = Date.now()} = {}): void` | Connection, backend key, schema-shaped entry; this helper itself does not validate |

Every backend exposes readonly `id`, `kind`, and `trust`. The common methods are:

```ts
list(required: Record<string, never>, filter: NonNullable<RegistryListFilter> = {}): Promise<RegistryEntry[]>;
search(required: Pick<RegistrySearchQuery, "query">, optional: Omit<RegistrySearchQuery, "query"> = {}): Promise<RegistrySearchResult[]>;
resolve({name}: {name: string}, {range}: {range?: string} = {}): Promise<ResolvedRegistryEntry | null>;
manifest({name, version}: {name: string; version: string}): Promise<RegistryEntry | null>;
doctor(required: Record<string, never>): Promise<RegistryDoctorReport>;
```

The static backend has no publish/yank method. Both mutable backends add `publish(required: Pick<RegistryPublishRequest, "entry">, optional: Omit<RegistryPublishRequest, "entry"> = {}): Promise<RegistryPublishOutcome>` and `yank({name, version, reason}: {name: string; version: string; reason: string}): Promise<RegistryYankOutcome>`.

`RegistryEntry`, manifest/filter/query/results/backend/trust/publish/yank/doctor types belong to `@jini-ai/protocol`, not this barrel. A manifest contains `entries`; entries identify `vendor/name`, version and source, optional versions/dist-tags/yank metadata/signatures. A resolved result includes backend ID/kind, configured trust, `verified`, optional verified identity metadata, original entry, selected version, source/ref/integrity/digest. Doctor returns `{ ok, backendId, checkedAt, entriesChecked, issues }`. Publish returns `{ ok, dryRun, changedFiles, warnings, pullRequestUrl? }`; yank also returns name/version/reason.

GitHub defaults: ref `main`, manifest `registry/index.json`, trust `restricted`. Database defaults: kind `db`, trust `restricted`. `GithubRegistryClient.readManifest({owner, repo, ref, path}): Promise<RegistryManifest>` is required; optional `createPublishPullRequest(request: GithubPublishMutation): Promise<{ url: string }>` enables writes. Mutations supply `{ owner, repo, baseRef, branchName, title, body, files: { path, content }[] }`. The concrete API client implements both methods; anonymous reads work, mutations require a token. API URL defaults to `https://api.github.com`.

```ts
import { StaticRegistryBackend, GithubRegistryBackend, GithubApiRegistryClient } from '@jini-ai/registry';
const registry = new StaticRegistryBackend({ id: 'local', trust: 'restricted',
  manifest: { specVersion: '1.0.0', name: 'local', version: '1.0.0', entries: [] } });
await registry.list({});
const remote = await GithubRegistryBackend.create({ id: 'remote', owner: 'acme', repo: 'catalog',
  client: new GithubApiRegistryClient({ http }, { token: credentials.registryToken }) });
await remote.resolve({ name: 'acme/tool' }, { range: '^1.0.0' });
```

```ts
import { DatabaseRegistryBackend } from '@jini-ai/registry';
// db is the consumer's better-sqlite3-compatible connection.
const persistent = new DatabaseRegistryBackend({ id: 'catalog', db });
await persistent.doctor({});
```

## Root: version and signature helpers

| Export | Current signature and return |
|---|---|
| `parseRegistrySpecifier` | `({input: string}): ParsedRegistrySpecifier` |
| `resolveRegistryEntryVersion` | `({entry: RegistryEntry}, {requestedRange?: string} = {}): ResolvedRegistryEntryVersion | null` |
| `canonicalRegistrySigningPayload` | `({entry: RegistryEntry}): string` |
| `verifyRegistrySignature` | `({entry, signature: RegistrySignature}, {trustRoot?: RegistryTrustRoot} = {}): SignatureVerificationResult` |
| `verifyRegistryEntrySignatures` | `({entry}, {trustRoot?: RegistryTrustRoot} = {}): SignatureVerificationResult` |
| `GITHUB_ACTIONS_OIDC_ISSUER` | Constant `https://token.actions.githubusercontent.com` |

`ParsedRegistrySpecifier` is `{ name, range? }`. `ResolvedRegistryEntryVersion` has required `{ version, source }` and optional `{ ref, manifestDigest, archiveIntegrity, deprecated }`. `SignatureVerificationResult` contains `verified`, optional kind/reason/issuer/subject. `RegistryTrustRoot` has optional `githubOidc: GithubOidcTrustRoot`; that root requires PEM `caCertificates: string[]`, with optional `allowedIssuers: string[]` and `allowedIdentities: (string | RegExp)[]`. These named types and all constructor options/client/mutation interfaces above are root exports.

```ts
import { parseRegistrySpecifier, verifyRegistryEntrySignatures } from '@jini-ai/registry';
const specifier = parseRegistrySpecifier({ input: 'acme/tool@^1.0.0' });
const verification = verifyRegistryEntrySignatures({ entry }, { trustRoot: {
  githubOidc: { caCertificates: [trustedCaPem], allowedIdentities: ['https://github.com/acme/catalog/.github/workflows/publish.yml@refs/heads/main'] }
} });
// Apply the consumer's admission policy to verification.verified.
```

## ./tool-catalog

This entry exports only three interfaces, with no factory or singleton:

```ts
interface ToolCatalogEntry {
  readonly id: string; readonly description: string;
  readonly inputSchema?: unknown; readonly source: string;
}
interface ToolCatalogSearchHit {
  readonly id: string; readonly description: string;
  readonly source: string; readonly score: number;
}
interface ToolCatalogQuery {
  search(required: {query: string}, optional?: {limit?: number}): readonly ToolCatalogSearchHit[];
  describe(required: {id: string}): ToolCatalogEntry | null;
}
```

The consumer supplies an implementation. Catalog discovery does not authorize or execute tools.

## ./tool-catalog/sqlite

| Export | Current signature and return |
|---|---|
| `ensureToolCatalogTables` | `({db: SqliteDb}): void` |
| `reseedToolCatalog` | `({db, entries: readonly ToolCatalogEntry[]}, {now = Date.now()} = {}): void` |
| `getToolCatalogEntry` | `({db, id: string}): ToolCatalogEntry | null` |
| `searchToolCatalog` | `({db, query: string}, {limit = 10} = {}): readonly ToolCatalogSearchHit[]` |

This entry also re-exports the `ToolCatalogEntry` and `ToolCatalogSearchHit` types. `SqliteDb` is imported from `@jini-ai/db/sqlite`; consumers provide synchronous `exec`, `prepare`, and `transaction` operations with SQLite FTS5 and JSON support. The adapter opens/closes no connection.

```ts
import type { ToolCatalogQuery } from '@jini-ai/registry/tool-catalog';
import { ensureToolCatalogTables, reseedToolCatalog, searchToolCatalog, getToolCatalogEntry } from '@jini-ai/registry/tool-catalog/sqlite';
ensureToolCatalogTables({ db });
reseedToolCatalog({ db, entries: [{ id: 'echo', description: 'Echo text', source: 'first-party' }] });
const tools: ToolCatalogQuery = {
  search: ({ query }, options) => searchToolCatalog({ db, query }, options),
  describe: ({ id }) => getToolCatalogEntry({ db, id }),
};
```

## Coverage and evidence

All five exported entries are documented. The builder has dedicated universal and SQLite subpaths. `assertValidPublishRequest` is likewise source-exported but omitted by the public barrel and export map.

Evidence: `package.json`, `src/index.ts`, backend/version/trust/API-client source, and catalog source; `src/__tests__/*`, `src/tool-catalog/__tests__/sqlite.test.ts`, and `loads-without-driver.test.ts` were read as static evidence. No tests or builds ran. There is no UI surface.

## ./tool-catalog-builder and ./tool-catalog-builder/sqlite

`buildToolCatalogQuery(required: CatalogBuilderArgs, {includeSearchKeywords = true, includeDoc2query = true} = {}): ToolCatalogQuery`. Required dependencies are `{source, storeFactory, enricher, classifier, clock}`. Clock is core Clock. Source provides `list(): readonly ToolDescriptor[]` with id, optional description/inputSchema. Store factory `create({entries, builtAtIso})` returns a query. Enricher supplies `indexedDescription({id, description}, {includeDoc2query})` and `authoredDescription({description})`; classifier supplies `classify({id})`. The builder rejects duplicate IDs before backend allocation. Search takes `({query}, {limit = 10} = {})` and rejects negative or unsafe-integer limits; describe takes `{id}`. Returned descriptions are authored text even when indexed text contains enrichment.

`listToolCatalogEntries({source, enricher, classifier}): ToolCatalogEntry[]` rereads the source in registration order and returns id/source/authored description; it does not include inputSchema. `createLiveToolCatalogQuery({initial}): LiveToolCatalogQuery` returns a stable query forwarding to the latest snapshot plus `rebind({next}): void`. Rebinding does not dispose the old backend.

`createSearchEnricher({marker, keywords, questions}): SearchEnricher` requires nonempty marker and host dictionaries. It strips text from the first marker for authored descriptions; indexed descriptions append keywords and optional questions. `createPrefixSourceClassifier({separator, fallbackSource}): SourceClassifier` requires nonempty separator/fallback and uses the ID's first segment or fallback. Exported structural types are CatalogBuilderArgs, CatalogStoreFactory, SearchEnricher, SourceClassifier, ToolDescriptor, ToolDescriptorSource, ToolCatalogEntry, ToolCatalogHit, ToolCatalogQuery and LiveToolCatalogQuery. Builder ToolCatalogQuery is structurally compatible with the catalog port, but its search result type also carries optional inputSchema.

`createSqliteCatalogStoreFactory({db: SqliteDb}): CatalogStoreFactory` borrows a host connection, validates builtAtIso, creates tables and replaces the shared catalog using its parsed timestamp. Independent snapshots require independent databases; rebinding alone does not isolate shared-table reseeds. Neither entry authorizes or executes tools.

## Current manifest boundary

The current `package.json` exposes `.`, `./tool-catalog`, `./tool-catalog/sqlite`, `./tool-catalog-builder`, `./tool-catalog-builder/sqlite`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
