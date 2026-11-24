# `@jini-ai/plugins`

The `./glue` subpath provides host-independent manifest validation, capability gates, dispatch and attachment delegates. The package is publishable with public npm access.

Supply `vocabulary` to `validateGlueManifest`, `vocabulary` and `coreDelegates` to `buildGlueCapabilityGate`, and `wiredCallSites` to dispatch. Host delegates use required/optional argument objects. Content lifecycle and event failures propagate; tool contributions are quarantined independently. `registerTools` must mount a module atomically or throw without leaving a partial mount.

`./glue` is a universal runtime entry with no runtime dependencies. Every public callable takes
a required argument object and accepts an optional settings object; empty settings use
`Record<string, never>`. See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/plugins/API.md) for the full glue surface and host-port examples.

## What used to be here

Support for the third-party **Agent Plugins** open standard (types, validators) plus this
package's bundled plugins (`ui-ux-design`, `create-the host-theme`) lived here under a `./agent-plugins`
subpath through 2026-08-17. On 2026-08-18 all of that moved out to its own package,
**`@jini-ai/agent-plugins`**, since there was no longer a second plugin format sharing this
namespace to disambiguate against. See that package's README for everything Agent-Plugins-related.

## Plugin host runtime

- `./host` is universal: manifest validation, claim conflicts, activation, quarantine, hook composition,
  declarative-enable orchestration and uninstall policy. It has no Node imports or code evaluation.
- `./host/node` owns discovery, bounded package reads, installation and snapshots, and the ordered
  integrity → SDK compatibility → injected import → setup pipeline.
- `./host/worker` provides the Tier-2 protocol, proxy importer and worker call orchestration.
- `./host/sql` adapts `StorageKernel` using required `tables: { activations }`; it retains the existing
  `plugin_activations` columns without assuming a host table name.

All functions use `(required, optional = {})`. Registry methods take objects. Existing error
constructors and plugin SDK callbacks retain their established ABI. Bind `PluginSdkBinding` (hook
ids, semantics, runtime SDK version, export validation and SDK assembly), `capabilityVocabulary`,
`declarativeContentTypes`, and the host's `coreOwnerName`. Node loading requires `importModule`,
`verifyDigest` and `tierPolicy`; installation additionally requires `archiveReader`. These inputs
have no executable or product-policy defaults. The import port matches Phase 13's
`{ plugin, modulePath } → { exported } | refusal` contract structurally, without an L4 dependency.

The application owns contained executable import and fresh snapshot selection, including Tier-2
worker execution. Tier-1 never imports code, Tier-2 requires `tierPolicy.execution: 'worker'`, and
Tier-3 requires `tierPolicy.allowLoad` to allow it. Archive readers own ZIP parsing, zip-slip checks,
entry limits and bounded decompression; `readSitePluginArchive` remains the host adapter.
The content-type grammar and create/write implementation remain host ports.

```ts
import { validateManifest } from '@jini-ai/plugins/host';
const result = validateManifest({
  manifest, folderName, builtInIds,
  pluginSdkBinding, capabilityVocabulary, declarativeContentTypes, coreOwnerName,
}, {});
```

Host-only packages are optional peers so installing the dependency-free `./glue` domain does not
install them. Hosts using `./host` must install `semver` and `@jini-ai/core`; SQL hosts also install
`kysely` and `@jini-ai/db`.

Historical note — 2026-08-18: [DR-005 portable package boundaries](../../docs/decisions/DR-005-portable-package-boundaries.md)
kept the host format reserved until a real consumer justified its implementation. The 2026-10-07
p6 extraction implements that format under the approved CMS/Jini modular design Rev 3.

## Wiring

`./runtime/*` holds host-neutral pieces lifted from a host's plugin runtime. They need nothing
injected: `./runtime/plugin-export`'s `readDefinedPlugin({ moduleValue }, {})` is pure and returns
the module's `definePlugin()` default export (`DefinedPlugin` from `@jini-ai/core/contracts/plugin-sdk`)
or `null`. A host binds it as its `PluginSdkBinding.readDefinedPlugin`:

```ts
import type { PluginSdkBinding } from '@jini-ai/plugins/host';
import { readDefinedPlugin } from '@jini-ai/plugins/runtime/plugin-export';

const pluginSdkBinding: PluginSdkBinding = {
  ...hostSdkAbi, // hook ids, semantics, runtimeSdkVersion, buildSdk, definePlugin
  readDefinedPlugin: ({ moduleValue }) => readDefinedPlugin({ moduleValue }, {}),
};
```

`./runtime/*` must never import a host SDK package, node built-ins, or another `@jini-ai/*`
implementation; types come from `@jini-ai/core` contracts. Boundaries: [DR-005](../../docs/decisions/DR-005-portable-package-boundaries.md).

Model-facing plugin text takes the host's product copy (`PluginHostCopy` from
`./runtime/plugin-host-copy`: `productName`, `sitePluginFormat`, `localInstallEnv`,
`pluginListToolName` — the host's plugin list tool). The host binds
it once, in its own composition module, and passes the results to its tool bindings:

- `./runtime/agent-tools` — `createPluginAgentToolCatalog({ copy })` (plus `PluginFamily`,
  `PLUGINS_SET_ENABLED_TOOL_ID`, `AgentToolDefinition`).
- `./runtime/source-tool-catalog` — `createPluginSourceAgentToolCatalog({ copy })`.
- `./runtime/install-tool-catalog` — `createInstallToolCatalog({ copy, installSourceSchema })`; the
  host also injects its install-source JSON Schema. `PLUGINS_INSTALL_TOOL_ID` is a plain constant.
- `./runtime/plugin-tool-messages` — `createPluginToolMessages({ copy })` /
  `createPluginInstallMessages({ copy })` return the `messages` objects the `./host/tools`
  registrations take, with the same call shapes as before.
- `./runtime/capability-card` — `createCapabilityCard({ pluginsAdminHref, pluginListToolName })`; the host says where its
  Plugins admin screen lives and which tool lists plugins.

`./site/lipay/manifest` and `./site/store/manifest` are the bundled first-party data-module
declarations (`LIPAY_MANIFEST`, `STORE_MANIFEST`). Nothing is injected; the host lists them in its
first-party data-module set. Their provenance publisher is `"jini-core"` — persisted in
`_plugin_identity`, so changing it is a migration (see CHANGELOG).

`./runtime/enable-confirmation-ui` (`describeEnableApproval`, `EnableConfirmationSubject`) and
`./runtime/uninstall-confirmation-ui` (`describeUninstallApproval`, `PLUGINS_UNINSTALL_TOOL_ID`) are
pure: they return a `HumanConfirmSpec` (`@jini-ai/core/contracts/site/human-confirm`) and inject
nothing. The host renders and redeems that spec through its own approval transport; it passes both
builders as the `descriptions: { enable, uninstall }` field of `PluginManagementToolsRequired`
(`./host/tools`) when it binds the plugin management tools.

## Design decisions

- [Attachment vocabulary and failure containment are separate decisions](docs/decisions/DR-001-category-specific-glue-containment.md).

Server provider plugins extend this same host with `contributes.providers` and a capability-gated
`sdk.providers.register`. The loader captures factories privately and publishes after admission;
`createPluginProviderHost` validates returned ports through injected domain validators and retires
resources on contribution detach/replacement or shutdown. See [API.md](API.md#server-provider-contributions).
Self-contained artifacts are distributed by `@jini-ai/provider-plugins`; there are no domain or
vendor imports in this host extension.

## Wiring

- `@jini-ai/plugins/host/hook-refusals`: the host wraps each save domain's handler map with `withPluginHookRefusals` (or maps one rejection with `toModelFacingPluginHookError`) and uses `pluginHookRefusalText` for its HTTP envelope; nothing to inject.
- `@jini-ai/plugins/host` activation polling: the serving host calls `startPluginActivationPolling({ workspaceId, pluginActivationRepo, onPluginEnabled, onPluginDisabled, pluginLoadedVersion?, pluginRuntimeReady }, { intervalMs })` once and calls `stop()` on shutdown; it injects its activation repo and its registry attach/detach callbacks.
