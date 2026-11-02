# `@jini-ai/plugin-composio`

Portable Agent Plugins payload with one skill, `composio`, and one hosted MCP connection declaration
(`mcp.json`). Installing this package downloads only this plugin; it has no runtime or plugin
dependencies and no executable tools. Composio runs the MCP server; the host connects to it.

Resolve `@jini-ai/plugin-composio/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission and connects
nothing.

The npm version follows Jini's fixed release group. The inner `plugin.json` version changes only
when the plugin content changes. The publisher id stays `tovu/composio`. The `./composio/*` export
exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/composio`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts composio`) generates only `composio/` here. The plugin-local
`node:test` suite in `packages/agent-plugins/composio/__tests__` is not shipped.

## What the plugin covers

- `SKILL.md` — connecting Composio Connect by browser sign-in (never an API key), the tool grants
  the connection needs (and the remote workbench and Bash tools never to grant), and the per-app
  flow: search, read the schema, connect the app by a sign-in link, then execute, asking before
  anything that sends, posts, pays or deletes.
- `mcp.json` — the hosted server at `https://connect.composio.dev/mcp`, OAuth sign-in.

## Host guidance

The shipped text is host-neutral. It names the tools a host serves (`agent_plugin_connect`,
`external_mcp_*` and others) but not the host's screens, settings or restart rules. Hosts add
those through their own plugin-guidance wiring, not by editing this payload. The `tovu` keys in
`plugin.json` and `mcp.json` are that host's metadata (connection cards, auth mode, default tool
grants); other hosts add their own key.
