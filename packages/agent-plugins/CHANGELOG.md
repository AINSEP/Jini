# Changelog

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
