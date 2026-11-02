# @jini-ai/plugin-site-import

## Unreleased (0.6.19)

### Minor Changes

- New package: the portable `site-import` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 1.0.0). Publisher id stays `tovu/site-import`. Product-specific text moved
  to the host's overlay; the shipped text is host-neutral. Skills only: no MCP server, no
  executable tools, no dependencies.
- Fix: references are read through the plugin tool's `file` argument instead of a refused
  repository file root.
