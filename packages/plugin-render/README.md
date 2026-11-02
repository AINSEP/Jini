# `@jini-ai/plugin-render`

Portable Agent Plugins payload for Render. Installing this package downloads only this plugin; it
has no runtime or plugin dependencies and no MCP server.

Resolve `@jini-ai/plugin-render/plugin.json` with the host's package resolver. Its containing directory
holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`. Host
policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **1.0.0**
and changes only when the plugin content changes. The publisher id stays `tovu/render`, and the
contribution files keep their frozen names (`tovu-deploy-configs.json`, `tovu-deploy-ops.json`).
The `./render/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/render`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts render`) generates only `render/` here. The plugin-local
`node:test` suites under `packages/agent-plugins/render` are not shipped.

## What it covers

- `skills/render/SKILL.md` — deploy and observe an existing Render server service; environment variables by name only.
- `deploy-configs/render.mjs` — the `render.yaml` generator. It serializes the non-secret `options.env` the host passes (upper-case names, single-line string values, YAML double-quoted) and defaults no host runtime switch.
- `deploy-ops/render.mjs` — deploy, status, logs and environment-variable operations through the host's credentialed HTTP port.

## Host guidance

The shipped text is host-neutral. The host passes its own non-secret runtime variables in
`options.env`, appends its own notes after a generator renders, and adds its product-specific
instructions through its own plugin-guidance wiring, not by editing this payload.
