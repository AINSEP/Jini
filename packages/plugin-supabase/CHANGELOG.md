# @jini-ai/plugin-supabase

## Unreleased

### Minor Changes

- New package: the portable `supabase` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 1.1.0). Publisher id stays `tovu/supabase`. The skill no longer assumes the
  host opens links in a new tab, and product words are host-neutral. Legacy env names, auth
  metadata and tool names are unchanged. Skills plus one hosted MCP connection declaration: no
  executable code, no dependencies.
