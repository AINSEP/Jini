# @jini-ai/plugin-composio

## Unreleased

### Minor Changes

- New package: the portable `composio` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 1.0.0). Publisher id stays `tovu/composio`. The host's public-URL setting,
  settings-screen path and restart step moved to the host's own guidance; tool names the host
  serves and the `tovu` manifest metadata are unchanged. Skills plus one hosted MCP connection
  declaration: no executable code, no dependencies.
