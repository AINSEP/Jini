# @jini-ai/plugin-wordpress

## Unreleased (0.6.19)

### Minor Changes

- New package: the portable `wordpress` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 0.1.0). Publisher id stays `tovu/wordpress`. Product words were made
  host-neutral; tool names the host serves are unchanged. Skills only: no MCP server, no
  executable tools, no dependencies.
