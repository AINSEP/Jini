# `@jini-ai/plugins`

**This package is a reserved placeholder.** It has no real exports today.

## What used to be here

Support for the third-party **Agent Plugins** open standard (types, validators) plus this
package's bundled plugins (`ui-ux-design`, `create-tovu-theme`) lived here under a `./agent-plugins`
subpath through 2026-08-17. On 2026-08-18 all of that moved out to its own package,
**`@jini-ai/agent-plugins`**, since there was no longer a second plugin format sharing this
namespace to disambiguate against. See that package's README for everything Agent-Plugins-related.

## What's actually reserved here: `./host`

Jini's own host-extension plugin format — manifest + `setup()` + hooks + activation. **Not yet
implemented.** No loader, installer, or manifest type exists in this package for it today. The
only working implementation of this concept anywhere in the Tovu/Jini codebase is Tovu's
`src/features/plugin-runtime/` (SPEC-005), which has not moved here.

Per this repo's own speculative-generality rule (ADR-006, "rule of two"): no stub code ships under
`./host` until that concern has a real second caller in this package. This package is marked
`"private": true` and carries no `exports` field until then — there is nothing to install or
import yet.
