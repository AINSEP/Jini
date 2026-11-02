# `@jini-ai/plugin-jev`

Portable Agent Plugins payload with one skill, `jev`. Installing this package downloads only this
plugin; it has no runtime or plugin dependencies, no MCP server and no executable tools.

Resolve `@jini-ai/plugin-jev/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **1.0.0**
and changes only when the skill content changes. The publisher id stays `tovu/jev`. The
`./jev/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/jev`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts jev`) generates only `jev/` here. The plugin-local
`node:test` suite in `packages/agent-plugins/jev/__tests__` is not shipped.

## What the skill covers

- `SKILL.md` — what Jev is (a fast, non-generative model that answers typed Choice, Score and
  Noul questions with calibrated probabilities), when it belongs in a design, and how to read and
  threshold confidence.
- `references/primitives-reference.md` — exact request and response shapes for the three primitives.
- `references/javascript-sdk.md` — the JavaScript SDK, server-side only.
- `references/patterns.md`, `references/cookbooks.md` — documented architectural patterns.
- `references/jaggedness.md` — the model's known weak spots.

The plugin declares no MCP server: Jev has no official MCP integration, so the skill helps design
and write code that calls Jev with an API key the operator sets outside chat.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
