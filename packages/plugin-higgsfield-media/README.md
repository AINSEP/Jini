# `@jini-ai/plugin-higgsfield-media`

Portable Agent Plugins payload with one skill, `higgsfield-media`, and one hosted MCP connection declaration
(`mcp.json`). Installing this package downloads only this plugin; it has no runtime or plugin
dependencies and no executable tools. Higgsfield runs the MCP server; the host connects to it.

Resolve `@jini-ai/plugin-higgsfield-media/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission and connects
nothing.

The npm version follows Jini's fixed release group. The inner `plugin.json` version changes only
when the plugin content changes. The publisher id stays `tovu/higgsfield-media`. The `./higgsfield-media/*` export
exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/higgsfield-media`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts higgsfield-media`) generates only `higgsfield-media/` here. The plugin-local
`node:test` suite in `packages/agent-plugins/higgsfield-media/__tests__` is not shipped.

## What the plugin covers

- `SKILL.md` — connecting Higgsfield by browser sign-in, discovering the account's live tools and
  models, the write grant generation needs, and the asynchronous pipeline: submit, poll
  `job_status` without `sync: true`, then import the returned URL with `media_import_from_url`.
- `references/models-and-plan-gates.md` — reading plan and credit errors; worked examples are
  historical, not current entitlements.
- `references/failure-modes.md` — each observed failure, its cause and what to do.
- `mcp.json` — the hosted server at `https://mcp.higgsfield.ai/mcp`.

## Host guidance

The shipped text is host-neutral. It names the tools a host serves (`agent_plugin_connect`,
`external_mcp_*` and others) but not the host's screens, settings or restart rules. Hosts add
those through their own plugin-guidance wiring, not by editing this payload. The `tovu` keys in
`plugin.json` and `mcp.json` are that host's metadata (connection cards, auth mode, default tool
grants); other hosts add their own key.
