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
entry limits and bounded decompression; `readSitePluginArchive` remains the Tovu adapter.
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

## Design decisions

- [Attachment vocabulary and failure containment are separate decisions](docs/decisions/DR-001-category-specific-glue-containment.md).
