Spec ID: SPEC-JINI-AGENT-PLUGINS-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:22bfa1146045bb9b565faeb3d41e5f0e0583535fabdd790766c503b9a8b7b615
spec_mode: reverse_spec


# API Contract: Agent Plugins

## Entry-point registry

| Import | Runtime | Surface |
|---|---|---|
| `@jini-ai/agent-plugins` | Universal | Standard manifest types, filenames, schema URLs, shallow guards |
| `@jini-ai/agent-plugins/manifest` | Universal | Lifecycle manifest/MCP parsers, extension reader, shallow validators |
| `@jini-ai/agent-plugins/lifecycle` | Node | Lifecycle factory, layout, fetching, MCP delegation, errors and types |
| `@jini-ai/agent-plugins/lifecycle/node` | Node | Explicit native effects and filesystem adapter |
| `@jini-ai/agent-plugins/lifecycle/yauzl` | Node | Explicit ZIP reader adapter |
| `@jini-ai/agent-plugins/ui-ux-design/*` | Static assets | Portable plugin manifest, skill markdown/resources and illustrative client files |

Wildcards resolve packaged files; they do not register functions or mount UI. The UI-design bundle declares an empty MCP-server map.

## Signature convention

The intended convention is `(required, optional = {})`. Tables below record the source now: a dash means there is no second argument, not an implicit supported optional object. Named input/result types refer to the exported declarations. Factory internals are not independently exported entry points.

## Root and manifest contracts

| Entry point | Required/current argument | Optional | Return |
|---|---|---|---|
| `isPluginManifest` | `value: unknown` (positional legacy guard) | — | `value is PluginManifest` |
| `isMcpManifest` | `value: unknown` (positional legacy guard) | — | `value is McpManifest` |
| `validatePluginManifest` | `{ value: unknown }` | — | `boolean` |
| `validateMcpManifest` | `{ value: unknown }` | — | `boolean` |
| `parseAgentPluginManifest` | `{ value: unknown }` | — | `ParseAgentPluginManifestResult` |
| `parseAgentPluginMcpConfig` | `{ value: unknown, extensionNamespace: string }` | `{ pluginManifest?: unknown, readServerMetadata?: AgentPluginServerMetadataReader } = {}` | `ParseAgentPluginMcpConfigResult` |
| `readAgentPluginExtension<T>` | `{ manifest: Pick<AgentPluginManifest, 'extensions'>, namespace: string, read: ({ value: Readonly<Record<string, unknown>> }) => T }` | — | `T \| undefined` |

The root exports `PluginManifest`, `PluginManifestAuthor`, `McpManifest`, and `McpServerEntry`. `PluginManifest` has required `name`, optional `$schema`, version, description, author object, homepage, repository, license, keywords, extensions, and open-ended keys. `McpManifest` has optional `$schema` and required `mcpServers`; typed server entries are stdio, streamable HTTP, or SSE. The shallow predicates do not establish all these field types.

Root constants: `AGENT_PLUGINS_SCHEMA_URL` and `AGENT_PLUGINS_MCP_SCHEMA_URL` point to version 1.0.0 schemas; `PLUGIN_MANIFEST_FILENAME = 'plugin.json'`, `PLUGIN_MCP_MANIFEST_FILENAME = 'mcp.json'`, `PLUGIN_SKILLS_DIRNAME = 'skills'`.

`./manifest` additionally exports `AgentPluginManifest`, both parse-result unions, `AgentPluginServerMetadataReader`, `MCP_SERVER_TRANSPORTS`, `McpServerTransport`, `StdioMcpServerConfig`, `RemoteMcpServerConfig`, `McpServerConfig`, `AgentPluginMcpConfig`, `AgentPluginServerMetadata`, `AgentPluginTokenAuth`, and `AgentPluginDefaultTools`. These are also exported through `./lifecycle`. Its manifest allows a legacy string author; its normalized shape omits homepage/repository. Parse results are `{ ok: true, manifest, warnings }` / `{ ok: false, errors }` and `{ ok: true, config: { serverIds, servers } }` / `{ ok: false, errors }`.

## Lifecycle construction and supplied ports

`createAgentPluginLayout({ root: string }): AgentPluginLayoutPort` requires an absolute root. `forWorkspace({ workspaceId })` returns `{ root, packages, staging, pluginDataDir({ pluginId }): string }`.

`createAgentPluginLifecycle(required: AgentPluginLifecycleRequired, optional: AgentPluginLifecycleOptional = {})` returns the methods below. Required dependencies are `filesystem`, `clock`, `ids`, `process`, `layout`, `fetch`, `outboundGuard`, and `mcpProvisioning`. Required policy is `productName`, `extensionNamespace`, `bundledArchiveMagic`, `deliveryMode: 'inject' | 'pointer'`, `seededEnabledPluginIds: ReadonlySet<string>`, `retiredBundledPlugins: ReadonlyMap<string, string>`, and `formatPluginToolPointer({ pluginId }): string`. Optional observers/translators are `onEvent({ event, message }): void` and `readServerMetadata({ serverId, value }): Readonly<Record<string, unknown>>`.

| Port | Current member contract |
|---|---|
| `FilesystemPort` | Native `Pick<typeof import('node:fs/promises'), ...>` with unwrapped native FileHandles; eleven operations: chmod/mkdir/mkdtemp/open/readdir/readFile/rename/rm/stat/realpath/unlink |
| `AgentPluginClockPort` | core `Clock.nowMs(): number`, `monotonicMs(): number`, `sleep({ ms }): Promise<void>` |
| `AgentPluginIdsPort` | core `IdGenerator.newId(): string`, `random(): number` |
| `AgentPluginProcessPort` | `pid`, `platform`, `hostname({}): string`, `isAlive({ pid }): boolean` |
| `AgentPluginFetchPort` | `({ url }, optional?: RequestInit) => Promise<Response>`; honor manual redirects and cancellation |
| `AgentPluginOutboundGuardPort` | `assertAllowed({ url }): Promise<void>`; reject forbidden destinations on every hop; connection-time DNS pinning belongs to the fetch adapter |
| `AgentPluginMcpProvisioningPort` | Async `provision({ workspaceId, installed })`, `setEnabled({ workspaceId, pluginId, enabled })`, `remove({ workspaceId, pluginId })`, `notifyRosterChanged({ workspaceId })`, each returning void |
| `AgentPluginArchiveReaderPort` / `ArchiveReaderPort` | `entries({ archive: Uint8Array }): AsyncIterable<AgentPluginArchiveEntry>`; file entries expose `openReadStream({}): AsyncIterable<Uint8Array>` |

Filesystem methods return Node stats/dirents/Buffer where applicable; mutations return `Promise<void>` except mkdir, which returns a path or undefined, and open, which returns a handle. Native effects are opt-in. Keep the lifecycle context stable for its lifetime.

## Lifecycle methods

All inputs are required object records. Types grouped below are exported through `./lifecycle`.

| Method | Required record/type | Optional record | Return |
|---|---|---|---|
| `fetchAgentPluginArchive` | `{ url }` | `FetchAgentPluginArchiveOptional = {}` | `Promise<FetchedAgentPluginArchive>` |
| `maxAgentPluginArchiveBytes` | `{}` | — | `number` |
| `maxAgentPluginInstallArchiveBytes` | `{}` | — | `number` |
| `installAgentPlugin` | `InstallAgentPluginRequired`: `{ archive, expectedSha256, archiveReader, layout, workspaceId }` | `InstallAgentPluginOptional = {}` | `Promise<InstalledAgentPlugin>` |
| `installAgentPluginFromUrl` | `{ url, integrity, layout, workspaceId, archiveReader }` | `{ fetch?: FetchAgentPluginArchiveOptional } = {}` | `Promise<InstalledAgentPluginFromUrl>` |
| `indexInstalledRoot` | `{ packageRoot, archiveDigest }` | — | `Promise<InstalledAgentPlugin>` |
| `seedBundledAgentPlugins` | `{ layout, workspaceId, sourceRoot }` | — | `Promise<SeedBundledAgentPluginsResult>` |
| `retireBundledAgentPlugins` | `{ layout, workspaceId }` | `{ retired?: ReadonlyMap<string, string>, now?: ({}) => Date } = {}` | `Promise<readonly RetiredAgentPluginOutcome[]>` |
| `setAgentPluginEnabled` | `{ workspaceId, pluginId, enabled, actor }` | — | `Promise<{ pluginId, enabled }>` |
| `setAgentPluginActivation` | `{ workspaceRoot, pluginId, enabled, actor }` | `{ origin?: AgentPluginOrigin, now?: ({}) => Date } = {}` | `Promise<AgentPluginActivations>` |
| `recordBundledAgentPluginIfAbsent` | `{ workspaceRoot, pluginId }` | `{ now?: ({}) => Date, enabled?: boolean } = {}` | `Promise<{ recorded: boolean }>` |
| `enableBundledAgentPluginUnlessOperatorDisabled` | `{ workspaceRoot, pluginId, actor, now?: ({}) => Date }` | — | `Promise<BundledAgentPluginEnableOutcome>` |
| `deleteAgentPluginActivation` | `{ workspaceRoot, pluginId }` | — | `Promise<void>` |
| `readAgentPluginActivations` | `{ workspaceRoot }` | — | `Promise<AgentPluginActivations>`; permissive read |
| `assertAgentPluginActivationsWritable` | `{ workspaceRoot }` | — | `Promise<void>`; strict write preflight |
| `resolveAgentPluginActivation` | `{ workspaceRoot, pluginId }` | — | `Promise<AgentPluginActivationVerdict>` |
| `isAgentPluginRecordedAsBundled` | `{ workspaceRoot, pluginId }` | — | `Promise<boolean>` |
| `normalizeActivations` | `{ value: unknown }` | — | `AgentPluginActivations` |
| `isAgentPluginActive` | `{ activations, pluginId }` | — | `boolean` |
| `filterActiveAgentPlugins<T>` | `{ activations, items: readonly T[], pluginIdOf: ({ item: T }) => string }` | — | `readonly T[]` |
| `readBundledAgentPluginDigests` | `{ workspaceRoot }` | — | `Promise<BundledAgentPluginDigests>` |
| `normalizeBundledDigests` | `{ value: unknown }` | — | `BundledAgentPluginDigests` |
| `recordBundledAgentPluginDigests` | `{ workspaceRoot, seeded: readonly SeededBundledAgentPluginDigest[] }` | `{ now?: ({}) => Date } = {}` | `Promise<void>` |
| `removeBundledAgentPluginDigest` | `{ workspaceRoot, pluginId }` | — | `Promise<boolean>` |
| `preferBundledAgentPluginDigests<T extends InstalledDigestIdentity>` | `{ installed: readonly T[], bundled }` | — | `readonly T[]` |
| `previewAgentPluginUninstall` | `{ layout, workspaceId, pluginId }` | — | `Promise<AgentPluginUninstallPreview>` |
| `uninstallAgentPlugin` | `{ layout, workspaceId, pluginId }` | `{ confirmedPreview?: AgentPluginUninstallPreview, retiredBundled?: boolean } = {}` | `Promise<UninstallAgentPluginResult>` |
| `findTrustedPluginPackages` | `{ workspaceId, filename, contribution, requireActive }` | `{ orderByPluginId?: boolean, onInactive?: ({ plugin }) => Promise<void> } = {}` | `Promise<readonly TrustedPluginVerdict[]>` |
| `readTrustedPluginFile` | `{ plugin: TrustedPluginPackage, filename }` | — | `Promise<string>` |
| `importContainedModule` | `{ plugin: TrustedPluginPackage, modulePath }` | — | `Promise<{ exported: unknown } \| string>`; default export or refusal/error text |
| `normalizePackageEntryPath` | `{ rawEntryPath }` | — | `string` |
| `assertContainedOnDisk` | `{ packageRoot, entryPath }` | — | `Promise<string>` |
| `classifyAgentPluginMcpServerTrust` | `{ server: Pick<McpServerConfig, 'type'> }` | — | `'auto-admit' \| 'requires-confirmation'` |
| `readInstalledSkillMarkdown` | `{ packageRoot, skillPath }` | — | `Promise<string>` |
| `readInstalledMcpServerIds` | `{ packageRoot }` | — | `Promise<readonly string[]>` |
| `readInstalledMcpServers` | `{ packageRoot }` | — | `Promise<Readonly<Record<string, McpServerConfig>>>` |
| `resolveAgentPluginRefs` | `{ pluginRefIds: readonly string[], workspaceLayout: Pick<AgentPluginWorkspaceLayout, 'packages' \| 'root'> }` | `{ deliveryMode?: AgentPluginDeliveryMode } = {}` | `Promise<ResolveAgentPluginRefsResult>` |
| `listInstalledPlugins` | `{ packagesDir }` | — | `Promise<readonly InstalledAgentPlugin[]>` |
| `isInstalledDigestPresent` | `{ packagesDir, archiveDigest }` | — | `Promise<boolean>` |
| `rankInstalledAgentPlugins` | `{ query, candidates: readonly AgentPluginSearchCandidate[], limit: number }` | — | `readonly AgentPluginSearchMatch[]` |
| `packAgentPluginDirectory` | `{ sourceDir }` | — | `Promise<PackedAgentPluginArchive>` |
| `createBundledSourceArchiveReader` | `{}` | — | `AgentPluginArchiveReaderPort` |

String-valued path/id/query fields in this table are `string`; flags are `boolean`. Integrity is `{ kind: 'pinned', sha256 } | { kind: 'trust-on-first-use' }`. An installed result carries plugin id, archive digest, package root, sorted files/skills, and optional version/description/keywords/author/license. A fetched result is `{ archive, sha256, resolvedUrl }`; URL installation adds `{ installed, digestWasPinned }`. Seed results contain source root, per-plugin seeded/failed outcomes, retirements, and optional ledger failure. Uninstall preview has plugin id, versions, and digests; result has plugin id and removed digests. Trust results are `{ trusted: { pluginId, packageRoot } } | { refusal: string }`. Activation/ledger/lock structures are specified in `state.spec.md`; errors and exported constructors are in `errors.spec.md`.

## Standalone effects and adapters

`fetchAgentPluginArchive(required: { url, fetch, outboundGuard }, optional: { maxBytes?: number, signal?: AbortSignal } = {}): Promise<FetchedAgentPluginArchive>` and `maxAgentPluginArchiveBytes({}): number` are also standalone lifecycle exports.

`provisionAgentPluginMcp({ mcpProvisioning, workspaceId, installed })`, `syncAgentPluginMcpEnabled({ mcpProvisioning, workspaceId, pluginId, enabled })`, and `removeAgentPluginMcp({ mcpProvisioning, workspaceId, pluginId })` each return `Promise<void>` with no second argument. They perform the named host operation, then roster notification. Install, enable, and uninstall do not invoke them automatically.

`createNodeAgentPluginEffects({}, { filesystem?: FilesystemPort } = {})` returns `{ filesystem, clock, ids, process }`; injected native filesystem effects retain their identity. The wrapper factory and wrapper FileHandle/NodeFilesystem types are removed. Generic locks/errors/holder types come directly from `@jini-ai/platform/fs/file-lock`; activation passes 15000ms timeout, 10000ms staleness and 10ms polling.

`createYauzlAgentPluginArchiveReader({ yauzl: YauzlPort }): AgentPluginArchiveReaderPort` has no second argument. The exported `YauzlPort`, `YauzlZipFile`, and `YauzlEntry` model the peer library's positional `fromBufferPromise(buffer, options)`, `eachEntry()`, `openReadStreamPromise(entry)`, and `close()` APIs. The consumer supplies the compatible library; imports do not load it automatically.

Constants exported by lifecycle: `ACTIVATIONS_FILENAME`, `ACTIVATIONS_LOCK_FILENAME`, `BUNDLED_DIGESTS_FILENAME`; values are in `state.spec.md`.

## Minimal wiring

```ts
import { createAgentPluginLifecycle, createAgentPluginLayout,
  parseAgentPluginManifest, provisionAgentPluginMcp } from '@jini-ai/agent-plugins/lifecycle';
import { createNodeAgentPluginEffects } from '@jini-ai/agent-plugins/lifecycle/node';

// fetchPort, outboundGuard and mcpProvisioning are host adapters.
const layout = createAgentPluginLayout({ root: '/var/lib/example/agent-plugins' });
const plugins = createAgentPluginLifecycle({ ...createNodeAgentPluginEffects({}),
  layout, fetch: fetchPort, outboundGuard, mcpProvisioning,
  productName: 'Example', extensionNamespace: 'org.example.client',
  bundledArchiveMagic: 'EXAMPLE-PLUGIN-1\n', deliveryMode: 'pointer',
  seededEnabledPluginIds: new Set(), retiredBundledPlugins: new Map(),
  formatPluginToolPointer: ({ pluginId }) => `Read plugin ${pluginId} using the host tool.` });
const parsed = parseAgentPluginManifest({ value: {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'example' } });
if (!parsed.ok) throw new Error(parsed.errors.join('; '));
const installed = await plugins.installAgentPluginFromUrl({
  url: 'https://plugins.example/example.zip', integrity: { kind: 'pinned', sha256 },
  layout, workspaceId: 'workspace-1', archiveReader });
await provisionAgentPluginMcp({ mcpProvisioning, workspaceId: 'workspace-1',
  installed: installed.installed });
```

`sha256` is a host-approved lowercase digest and `archiveReader` is the injected reader for the archive format. Evidence: current `package.json`, `src/index.ts`, `src/manifest.ts`, `src/lifecycle/index.ts`, and re-exported sources; tests were inspected, not executed.

Exported input records also name the table's contracts: `InstallAgentPluginFromUrlRequired` / `InstallAgentPluginFromUrlOptional`, `SetAgentPluginActivationRequired` / `SetAgentPluginActivationOptional`, `DeleteAgentPluginActivationRequired`, `SeedBundledAgentPluginsRequired`, `RetireBundledAgentPluginsRequired` / `RetireBundledAgentPluginsOptional`, `UninstallAgentPluginRequired` / `UninstallAgentPluginOptional`, and `TrustedPluginPackagesQuery`. `AgentPluginIntegrity` is pinned/sha256 or trust-on-first-use. `SetAgentPluginEnabledInput` requires workspaceId/pluginId/enabled/actor; `SetAgentPluginEnabledResult` returns pluginId/enabled.

`AgentPluginLifecyclePorts` is the injected effect/policy bundle used by the factory. `AgentPluginLayout` names the host layout contract; `FetchAgentPluginArchiveRequired` requires url/fetch/outboundGuard. `AgentPluginFetchErrorCode` is the five-code fetch union listed in `errors.spec.md`.

`AgentPluginActivationRecord` contains enabled/origin/updatedAt/updatedBy. `FileLockHolder` contains pid/hostname/token/acquiredAt. `InstalledAgentPluginSkill` contains name/skillPath, while `AgentPluginSearchSkill` contains name/summary. `SeededAgentPluginOutcome` is seeded/pluginId/archiveDigest/activationRecorded or failed/pluginId/reason. `AgentPluginInstallErrorCode` is the install-code union listed in `errors.spec.md`. These records have no independent effects or lifecycle.

To use the ZIP peer adapter and static assets:

```ts
import { createYauzlAgentPluginArchiveReader }
  from '@jini-ai/agent-plugins/lifecycle/yauzl';
const archiveReader = createYauzlAgentPluginArchiveReader({ yauzl: yauzlPort });
const bundledManifestUrl = import.meta.resolve('@jini-ai/agent-plugins/ui-ux-design/plugin.json');
// yauzlPort is the compatible peer API; read the resolved asset through host filesystem policy.
```

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `AgentPluginActivationsBusyError`, `AgentPluginActivationsUnreadableError` | class; [activation.ts](../../src/lifecycle/activation.ts) |
| `AgentPluginChangedSincePreviewError`, `AgentPluginNotFoundError`, `AgentPluginNotUninstallableError` | class; [uninstall.ts](../../src/lifecycle/uninstall.ts) |
| `AgentPluginFetchError` | class; [fetch-archive.ts](../../src/lifecycle/fetch-archive.ts) |
| `AgentPluginInstallError` | class; [install.ts](../../src/lifecycle/install.ts) |
| `AgentPluginNotInstalledError` | class; [set-enabled.ts](../../src/lifecycle/set-enabled.ts) |
| `PackagePathViolation` | class; [package-paths.ts](../../src/lifecycle/package-paths.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./ui-ux-design/*`, `./lifecycle`, `./lifecycle/node`, `./lifecycle/yauzl`, `./manifest`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
