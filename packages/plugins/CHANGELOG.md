# @jini-ai/plugins

## 0.7.2

### Patch Changes

- @jini-ai/core@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [873f10c]
  - @jini-ai/core@0.7.1

## 0.7.0

### Minor Changes

- 01b36f2: Publish the declarative content-type rules on `@jini-ai/plugins/host`:
  `createDeclarativeContentTypes({ cms, reservedKeys }, {})` returns `validateManifest`, `parse`,
  `plan` and `apply` (usable as `DeclarativeContentTypesPort`), with the `DeclaredContentTypeCms`
  vocabulary contract, `DeclaredContentTypeWritePorts`, the concrete `DeclaredContentTypeDefinition`
  / `DeclaredContentTypeDefinitionPlan` shapes and the `MAX_DECLARED_*` bounds. Hosts supply their
  field kinds, kind checks, identifier grammar, already-exists classifier and reserved keys; the
  package imports no content-type implementation.
- ecefd45: Publish the plugin capability-tool registrar on `@jini-ai/plugins/host`:
  `createPluginCapabilityTools(required, {})` returns `loadSources`, `buildRegistrations` and
  `registerEnabled` for one read-only `plugin_capability_<id>` tool per enabled, field-declaring
  plugin, plus `pluginCapabilityToolDerivedRisk({ sources }, {})`. Hosts supply the identity
  namespace, every model-facing sentence (`PluginCapabilityToolText`), the catalog domain, path and
  metadata, the read permission and entity scope (one object, published and enforced), the
  executable-tool permission and metadata, the approval family and port, and the preview draft.
- 070fe2a: Publish the per-load plugin invocation binding on `@jini-ai/plugins/host/node`:
  `createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook }, {})` returns the
  `coreDeps` for `buildCapabilityScopedSdk()` and the captured beforeSave filter, with
  `content.read`/`content.extend` bound to the running filter through one AsyncLocalStorage per load.
  Hosts supply their SDK's beforeSave hook id; entry and filter types are the plugin-domain
  envelope from `@jini-ai/plugins/host`.
- 7087c13: Add `toAdminPluginResponse({ discovery, activation }, { conflicts })` and `AdminPluginEnvelope` to
  `@jini-ai/plugins/host`, the bounded `readPluginArchive({ archive, reader })` policy with a required
  host `PluginArchiveReaderPort` to `@jini-ai/plugins/host/node`, and `startTier2Worker({ workerData,
parentPort, binding, registerSdkResolver, realImport }, { importModule })` to
  `@jini-ai/plugins/host/worker` (no auto-start on import).
- 0f76f15: Add `createPluginRuntimeCore(required, optional)` and its port types (`PluginRuntimeSource`, `PluginRuntimeHostBinding`, `PluginRuntimeTracker`, `PluginRuntimeLookup`, `PluginRuntimeText`, `PluginRuntimeCoreRequired`/`Optional`/`Bindings`) plus `PluginUninstallPathError` to `@jini-ai/plugins/host/node`: the plugin runtime core (discovery, conflict gates, enable/load/attach, boot re-attach, provider admission, install/source/reload wiring) with every host value injected.
- 3932647: Add the node-only `/host/tools` entry for plugin management, installation and source registrations. Hosts supply catalogs, ids, permissions, descriptions, canonical cross-family operations, command and approval-fingerprint owners, authenticated confirmation transport, runtime copy and telemetry. Existing saved formats and lifecycle owners remain unchanged. This opt-in entry requires semver and @jini-ai/platform, as does `/host/node`.

### Patch Changes

- Updated dependencies [8fe045b]
- Updated dependencies [c393010]
- Updated dependencies [41ff2ff]
- Updated dependencies [a266ba8]
- Updated dependencies [2364f89]
- Updated dependencies [27063ef]
- Updated dependencies [6ab1d81]
- Updated dependencies [699b478]
- Updated dependencies [39cf677]
  - @jini-ai/core@0.7.0
  - @jini-ai/platform@0.7.0
  - @jini-ai/db@0.7.0

## 0.6.22

- Enabling a tier-3 plugin always asks the owner, including a version approved before.

## 0.6.19

- Redact failed widget diagnostics in the universal host without Node-only imports.

## 0.6.17

### Patch Changes

- Version bump only.

## 0.6.15

### Minor Changes

- Release standalone provider distributions and a metadata-only plugin catalog in the
  fixed 0.6.15 release group. Hosts explicitly select @jini-ai/plugin-<id> packages
  instead of the @jini-ai/provider-plugins aggregate; installing a package never
  installs another plugin. Existing artifact IDs, contracts, integrity verification,
  installers and loaders are preserved, including commerce Phase 1's Stripe API.

  The aggregate becomes private build tooling. After rc.2 consumers migrate, deprecate
  its last verified published version with the standalone mapping; keep old tarballs.
  See docs/plugin-packages-migration.md for host migration and first publication.

## 0.6.13

### Patch Changes

- 1f2464f: Add admitted server-provider factory contributions and generation-scoped resource disposal to the
  existing plugin host. Introduce one self-contained provider artifact distribution with a tiny
  fixture, integrity maps, bundled license texts, and build-on-pack support.
  Pending initialization settles on retirement or a configurable `initializeTimeoutMs`, so a
  hung factory cannot block boot or shutdown; shutdown also awaits in-flight direct lease disposal.
- 223fc22: Provider declarations may declare `settings` (public and secret fields, `name` = factory input key) so a host can render its secure settings card and decide "configured?" without executing plugin code. The OTel, Sentry, PostHog and Langfuse provider plugins declare theirs; the OTel factory also accepts the OTLP `Name=Value,…` header text and defaults `tracerName` to `serviceName`.
- 106d9dd: Provider settings fields can declare a `default`, `options` (a select of `{ value, label }`) and `allowCustom` (free text beside the options); public fields only. PostHog and Langfuse declare their cloud regions (PostHog US by default, Langfuse EU); OpenTelemetry takes a username/instance ID + token and builds `Authorization: Basic` (or `Bearer` with no username) itself, keeping raw extra headers as an advanced field (a card saved with raw headers still applies).
- Updated dependencies [7479159]
- Updated dependencies [c31264d]
- Updated dependencies [0728914]
- Updated dependencies [6ecbdb2]
- Updated dependencies [63bacc5]
  - @jini-ai/core@0.6.13

## 0.6.12

### Patch Changes

- @jini-ai/core@0.6.12

## 0.6.11

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10

## 0.5.2 — 2026-10-22

- 2026-10-22: Optional declared effect on plugin tool contributions, security fixes, complexity refactors, coverage.

## 0.5.1 — 2026-10-13

- The plugin manifest is `jini.plugin.json` and the plugin SDK specifier is `@jini-ai/plugin-sdk`. `tovu.plugin.json` and `@tovu/sdk` are still read as legacy aliases (the new name wins when both exist); installs and drafts write only the new name. `./host` exports `PLUGIN_MANIFEST_FILENAME`, `PLUGIN_MANIFEST_FILENAMES`, `LEGACY_PLUGIN_MANIFEST_FILENAME`, `PLUGIN_SDK_SPECIFIER`, `PLUGIN_SDK_SPECIFIERS`, `LEGACY_PLUGIN_SDK_SPECIFIER` and `canonicalizePluginManifest`.
- **BREAKING (type and behavior):** `ManifestHostPorts.identityNamespace` is required. The `"tovu"` fallback is gone; hosts that omitted it must pass `identityNamespace: "tovu"` to keep reading publisher ids from `extensions.tovu`.
- `PluginSourceDeps.localInstallDisabledMessage` (optional) sets the hosted local-install refusal text. Without it the refusal reads "Local plugin install is disabled by the host."

## 0.5.0 — 2026-10-13

- Admit reviewed digest-pinned compiled-in chart browser providers only, retain immutable asset bytes, and initialize bundled site plugins only when activation rows are absent.

## 0.4.0 — 2026-10-02

### BREAKING

- Private glue package retains behavior and public barrels while process/source-grep artifacts are archived or consolidated.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Share publisher identity validation with core, retain the built-in incumbent on duplicate publisher IDs, and omit broken unrelated installed manifests from admission with warnings while preserving link refusals.

- Publish the plugin host runtime at universal `./host` and Node `./host/node`, `./host/worker`,
  `./host/sql`; keep `./glue` unchanged. Require host SDK/catalog, declaration, tier, executable
  import/digest, archive and storage-table ports; preserve package layout, diagnostics and states.
- Remove private-package status and configure public npm publishing without a version bump.
  Host dependencies are optional peers under the 2026-10-07 install-isolation decision.
  Copied behavior tests and entry-purity coverage await coordinator verification.

### Integration of extracted APIs

- Complete the universal `./glue` surface: manifest validation, capability gates, dispatch resolution, content lifecycle/event attachment and isolated tool registration. Host vocabulary, wired sites, dispatcher and delegates remain required inputs; no new runtime dependencies.
- **BREAKING:** Empty glue attachment options use `Record<string, never>`, rejecting scalar options. Public functions, constructors and host delegates use required/optional argument objects; existing names are retained. See `API.md` for examples. Verification remains pending.

- Add host-independent glue validation, capability gates, dispatch and attachment delegates at `./glue`, with required vocabulary and host ports. The host runtime is now publishable; verification remains pending (owner directive).
