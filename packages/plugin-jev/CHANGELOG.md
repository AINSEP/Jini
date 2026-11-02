# @jini-ai/plugin-jev

## Unreleased (0.6.19)

### Minor Changes

- New package: the portable `jev` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 1.0.0). Publisher id stays `tovu/jev`. Product words were made
  host-neutral; tool names the host serves are unchanged. Skills only: no MCP server, no
  executable tools, no dependencies.
