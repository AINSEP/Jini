# Changelog

## 0.6.15

### Minor Changes

- Add opt-in plugin source suffix exclusions and test-file inclusion. Explicit allow-paths and their ancestors now override name exclusions, while excluded descendants and suffix exclusions still skip. Default packing stays unchanged when the new options and conflicting allow/name rules are absent.

  Export ResponseLimitExceededError with limitBytes from platform/fetch-with-timeout and the platform root. Guarded response-text overflow throws this RangeError subclass; invalid caps keep plain RangeError and existing truncation behavior is preserved.

  Accept jsdom 26 and 27 as optional CMS peers alongside 25; media uses DOM APIs shared across these versions.

- Breaking package-surface change for the fixed 0.6.15 release: remove the bundled
  ui-ux-design files and wildcard export from @jini-ai/agent-plugins. Hosts must
  explicitly install @jini-ai/plugin-ui-ux-design and resolve its ./plugin.json
  export, stage that payload and seed through the existing Agent Plugin lifecycle.
  The lifecycle implementation remains in @jini-ai/agent-plugins. Inner plugin
  version 0.4.6, deterministic packing, digest selection and operator activation
  decisions are preserved. Tovu wording reconciliation and cutover follow later.

## 0.6.13

### Patch Changes

- 2dd5b11: Exclude `__tests__` directories and `.test.`/`.spec.` files from bundled plugin archives so installed runtime contents and their digest are unaffected by test-only changes.
- 7479159: Tighten diagnostic identifier exemptions and ignore ordinary header values shorter than eight characters during exact-secret masking (credential headers are masked at any length; exact secrets still match inside other text but never inside a credential label, URL scheme, secret-named query parameter or existing redaction marker, so they cannot split another credential's label). Keep null tool schemas informational. Preserve safe reader refusals for explicit plugin skill/file requests and use host-formatted plugin tool pointers for relevance, deferred instructions, and supporting files (optional for automatic use; omitted when the host supplies none).
- 0728914: Engine guard clean-up (`pnpm guard` 106 -> 0): layer, subpath-isolation and module-state findings fixed by moving
  shared contracts to their owners instead of reaching across domains. Additive public API: `@jini-ai/core/filesystem`
  (guarded-reader contracts), `useFetchQueryScope` from `@jini-ai/ui` fetch-query (per-provider query scope),
  `@jini-ai/chat/react` re-exports of the accepted-input, run-state and agent-plugin chat-state helpers. The Claude
  filesystem probe cache in `@jini-ai/agent-runtime` is instance-owned. No behaviour change intended; host-facing
  breaks are listed in `owner-store-to-server` and `guard-host-ports`.
- 6ecbdb2: Add optional bundled plugin selection, packing limits, link policies, and canonical file digest snapshots, with shared or per-source seeding options. Existing packing and seeding defaults are unchanged.

## 0.6.12

## 0.6.11

### Patch Changes

- Tool inputs apply a sole near-miss and declared input aliases; plugin-load outcomes are reported; `web_fetch` reads SVG/JS as text; `content_read` suggests its resource first; the browser falls back to system Chrome.

## 0.6.10

## 0.4.8 — 2026-10-22

- 2026-10-22: Provider contributions refuse failures by default (core peer floor ^0.4.9), durable update transaction for operator-installed plugins, coverage.

- `./lifecycle`: `defineProviderContribution()` wraps `defineExecutablePluginContribution` so a bundled plugin can contribute a provider for `@jini-ai/core/provider-registry` (id checked before import), and `contributeProviders()` merges loader and registry refusals. Needs `@jini-ai/core` with `./provider-registry`: the peer range is raised to `^0.4.9` (the first core release carrying that subpath), so release core 0.4.9 before this. Without recovery policies, an unreadable manifest, a throwing module/validator/parser or a hostile descriptor is now a refusal line (never a throw), so one broken plugin no longer discards the healthy contributions loaded with it.

## Unreleased — compatibility and advisory requirements

- Uses `semver`, the same library as site plugins (`@jini-ai/plugins` checks `sdkRange` with
  `semver.satisfies`), for `hostRange` and update ordering. Declared the way site plugins declare it
  (optional peer + dev dependency, as `pnpm guard`'s subpath isolation requires): hosts that parse
  manifests or use `./lifecycle` must install `semver@^7.6.2`.
- `extensions.<ns>.hostRange` is checked against `AGENT_PLUGIN_CONTRACT_VERSION` (the host's Agent
  Plugin contract, not an app version). A malformed range is listable with a parse warning but is
  incompatible: `setAgentPluginEnabled({ enabled: true })` throws `AgentPluginHostIncompatibleError`
  (`PLUGIN_HOST_INCOMPATIBLE`). Disabling is never refused.
- `extensions.<ns>.requires` (capability ids) is advisory and computed live from other active
  plugins: enabling returns `warnings: ['Needs <cap>']`; disabling a provider returns
  `'<dependent> needs <cap>'`. Never blocks.
- `setAgentPluginEnabled` now runs under the per-plugin state lock shared with install/update/uninstall.
- `planAgentPluginUpdate()`: manifest semver orders releases, the digest identifies bytes.

## 0.4.7 — 2026-10-15 — folder uploads share one ZIP encoder

- New `./folder-zip` (universal): `zipFolderFiles()`, the binary-safe stored-mode folder encoder,
  moved here from Tovu's admin so browser and server folder installs pack identically.
- New `./folder-zip/node`: `zipLocalFolder()` reads a local folder into that same encoder. Refuses
  symlinks and special files, bounds entries (4096) and bytes before reading, and sorts paths so the
  same folder always packs to the same digest.
- The bundled `ui-ux-design/plugin.json` declares its version (abb0009e).

## 0.4.6 — 2026-10-13 — skills' supporting files are readable

- New `createSkillFileReader()` and lifecycle `readInstalledSkillFile()`: read `SKILL.md` or a
  supporting text file (`references/…`, `examples/…`, …) relative to one skill folder, with a sorted
  `files` inventory. Refused: `..`, absolute or drive paths, symlinks resolving outside the skill
  (including sibling skills), non-text extensions, binary or invalid UTF-8, files over 256 KiB.
  Refusals return a note naming the valid files; no host path ever appears in output.
- Run-start injection lists supporting files relative to the skill folder instead of absolute host
  paths, and points at the plugin tool's `file` argument. Activation-read refusals no longer echo
  the native error (which could name a host path).

## 0.4.5 — 2026-10-12 — retirement waits for usable successors

- `retireBundledAgentPlugins()` (and so the boot seeder) keeps a retired bundled plugin until EVERY
  successor is installed at the digest `bundled-digests.json` records for it. Before, a successor
  whose seed had failed still got an activation record and the predecessor was removed — a switch
  with no code behind it. The kept plugin's outcome is `failed` with the reason; the next boot retries.
- `retiredBundledPlugins` (and the `retired` option) may list several successors for a plugin split
  across them; such outcomes carry `successorIds` and, when retired, per-successor `successors`.
  Single-successor outcomes are unchanged.

## 0.4.4 — 2026-10-12 — Agent Plugins 1.1.0

- `parseAgentPluginManifest()` / `parseAgentPluginMcpConfig()` (and so the installer and MCP
  projection) select the grammar by `$schema` and accept Agent Plugins 1.1.0 identifiers alongside
  1.0.0. 1.1.0 changes only the version identifiers, so both map to the same validator; 1.0.0
  behavior is unchanged. When a `plugin.json` is supplied, `mcp.json` must target the same version
  (§10).
- Forward-compatible within major 1 (owner decision): an unknown 1.x (e.g. 1.2.0) is validated with
  the newest known (1.1.0) grammar and reports one warning naming the version. A different major
  (2.x, 0.x) is refused as an unsupported major version; a non-canonical `$schema` is refused with
  the accepted identifiers listed.

## 0.4.2

- Use shared plugin identity metadata with a required `@jini-ai/core` peer at `^0.4.2`. Repair identity-lock publication syntax and isolate unreadable or invalid installed manifests with warnings so one damaged install cannot block healthy installs or bundled seeding.

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.4.1).

## 0.4.1 — 2026-10-04

- Layout B per-plugin state with a build-free `@jini-ai/agent-plugins/persistent-state` entry; migration completes after quarantining rejected entries.
- A directory-shaped ZIP entry with a symlink mode is still treated as a symlink.

## Unreleased — lifecycle consumer adoption

- Expose narrow `createAgentPluginActivations(required, optional)` composition without
  requiring unrelated network, layout or federation ports.
- Supply raw transport entries to the optional metadata reader, including servers with
  no declared extension, so hosts can translate legacy fields through the shared validators.
  Malformed declared extensions still exclude the server before translation.
- Preserve the original lifecycle validation, integrity, streaming, symlink and durability
  rationale alongside the canonical implementations; move the URL-install real-HTTP/ZIP
  integration suite into the package and add paired metadata-translation regression cases.

## Unreleased — lifecycle test compilation

- Preserve copied test timeouts and conditional skips through Vitest registration.
- Match the native process signal mock type, retain assertion-based result narrowing, and allow explicitly unset delivery-mode environment fixtures.

## 0.4.0 — 2026-10-02

### BREAKING

- Generic locking moved to platform/fs/file-lock, lifecycle ports use core primitives, and the product-specific theme plugin was evicted. The neutral ui-ux-design plugin remains bundled.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased — canonical lifecycle effects

### BREAKING

- Product-specific theme assets are no longer bundled or exported; products own these assets.
- Remove the local exclusive lock, lock passthroughs/errors/constants from lifecycle, and filesystem/handle wrapper factory/types. Use platform locks directly.
- Lifecycle accepts native fs/promises operations and FileHandles. Clocks extend core Clock (`nowMs()`), IDs extend IdGenerator (`newId()`) with random().

### Changed

- Activation explicitly retains 15000ms timeout and 10000ms staleness through the shared lock; polling is now fixed at 10ms and timeout uses core wall-clock elapsed time.
- Shared ownership checks bind token and inode/device; release preserves failed critical-section errors.
- Native liveness treats only ESRCH as death; unknown probe failures never authorize stale-owner eviction.
- Archive-error specification now matches safe generic transport/body causes and redacted URL diagnostics.

## Unreleased

- Add the host-injected plugin lifecycle on `./lifecycle`: archive installation, activation and locks, bundled digests and seeding/retirement, trusted files, reference resolution and local ranking.
- Add typed Agent Plugins 1.0.0 manifest extension readers on `./manifest`, with a required namespace and optional host metadata translation. Inline transport fields cannot supply reviewed read metadata.
- Add explicit MCP provisioning ports and helpers. Federation stays in the host; this package has no dependency on `@jini-ai/mcp`.
- Add opt-in native effects (`./lifecycle/node`) and a yauzl adapter (`./lifecycle/yauzl`) with an optional peer, supplied by the host.
- Preserve existing exports and the package version. Tests and verification are deferred by owner directive.

- Integrate `./manifest`, `./lifecycle`, `./lifecycle/node` and `./lifecycle/yauzl` barrels and runtime metadata; add object structural validators to the root/manifest and an instrumentable node filesystem adapter.
- Preserve standard object-shaped manifest authors and legacy string authors; remove the malformed optional archive-entry union and module-namespace type.
- BREAKING (new lifecycle APIs): filesystem and file-handle ports, fetch ports, archive entries/readers, lifecycle error constructors and callbacks now accept required/optional objects. Callers of the unpublished extraction must update their adapters.
- BREAKING (new lifecycle APIs): optional lifecycle observers/translators, MCP pluginManifest, digest clock overrides and trusted-file query options belong in the second object. Legacy root validator signatures and all existing export names remain available.

- Restore ten real-ZIP lifecycle parity cases using the actual optional yauzl peer and a test-only yazl writer; retain injected-reader tests and add malformed-archive coverage.
- Redact credentials, query strings and fragments from archive failure diagnostics. Unparseable URLs use a fixed placeholder; transport messages/causes use safe text, body transport errors use `REQUEST_FAILED`, and HTTP reason phrases use standard status labels.
