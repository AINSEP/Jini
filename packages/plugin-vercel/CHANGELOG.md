# @jini-ai/plugin-vercel

## Unreleased

### Minor Changes

- New package: the portable `vercel` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 0.1.0). Publisher id stays `tovu/vercel`. Skill prose, notes, the manifest
  description and module headers now say "the host" instead of the product name; the module JSDoc
  kit types no longer point into Tovu's source tree. Frozen names are unchanged: the `tovu-*.json` contribution file names, the `vercel` target and object-store provider ids, the credential-card target, and the `_share/<token>/<name>.tovu.zip` share keys.
  No MCP server and no npm dependencies.
