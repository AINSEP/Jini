# @jini-ai/plugin-netlify

## Unreleased

### Minor Changes

- New package: the portable `netlify` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 0.1.0). Publisher id stays `tovu/netlify`. Skill prose, notes, the manifest
  description and module headers now say "the host" instead of the product name; the module JSDoc
  kit types no longer point into Tovu's source tree. Frozen names are unchanged: the `tovu-*.json` contribution file names, the `netlify` target id and credential-card target, and the `jini-<project>` site-name prefix.
  No MCP server and no npm dependencies.
