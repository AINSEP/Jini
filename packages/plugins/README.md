# `@jini-ai/plugins`

The `./glue` subpath provides host-independent manifest validation, capability gates, dispatch and attachment delegates. The package remains private pending release preparation.

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

## What's actually reserved here: `./host`

Jini's own host-extension plugin format — manifest + `setup()` + hooks + activation. **Not yet
implemented.** No loader, installer, or manifest type exists in this package for it today. The
existing consumer implementation of this concept is its
host-owned plugin runtime, which has not moved here.

Per the [portable package boundary decision](../../docs/decisions/DR-005-portable-package-boundaries.md), no stub code ships under
`./host` until that concern has a real second caller in this package. This package is marked
`"private": true`; only the additive `./glue` subpath is implemented. No host plugin lifecycle is added by this extraction.

## Design decisions

- [Attachment vocabulary and failure containment are separate decisions](docs/decisions/DR-001-category-specific-glue-containment.md).
