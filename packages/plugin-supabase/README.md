# `@jini-ai/plugin-supabase`

Portable Agent Plugins payload with one skill, `supabase`, and one hosted MCP connection declaration
(`mcp.json`). Installing this package downloads only this plugin; it has no runtime or plugin
dependencies and no executable tools. Supabase runs the MCP server; the host connects to it.

Resolve `@jini-ai/plugin-supabase/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission and connects
nothing.

The npm version follows Jini's fixed release group. The inner `plugin.json` version changes only
when the plugin content changes. The publisher id stays `tovu/supabase`. The `./supabase/*` export
exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/supabase`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts supabase`) generates only `supabase/` here. The plugin-local
`node:test` suite in `packages/agent-plugins/supabase/__tests__` is not shipped.

## What the plugin covers

- `SKILL.md` — setting up a hosted database from chat in plain words: sign in, find or create the
  database, handle the free plan's two-active-database limit, and run small database changes one
  approved statement at a time.
- `references/failure-modes.md` — what to say and do for each failure, including the
  access-token fallback when browser sign-in cannot start.
- `mcp.json` — the hosted server at `https://mcp.supabase.com`, OAuth sign-in with a Management
  API token fallback, default tool grants and legacy env names.

## Host guidance

The shipped text is host-neutral. It names the tools a host serves (`agent_plugin_connect`,
`external_mcp_*` and others) but not the host's screens, settings or restart rules. Hosts add
those through their own plugin-guidance wiring, not by editing this payload. The `tovu` keys in
`plugin.json` and `mcp.json` are that host's metadata (connection cards, auth mode, default tool
grants); other hosts add their own key.
