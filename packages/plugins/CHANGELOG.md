# @jini-ai/plugins

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
