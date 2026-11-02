# @jini-ai/plugin-s3-compatible

## Unreleased

### Minor Changes

- New package: the portable `s3-compatible` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 0.1.0). Publisher id stays `tovu/s3-compatible`. Skill prose, notes, the manifest
  description and module headers now say "the host" instead of the product name; the module JSDoc
  kit types no longer point into Tovu's source tree. Frozen names are unchanged: the `tovu-*.json` contribution file names, the `s3-compatible` target and `s3_compatible` provider ids, the `.tovu/managed-keys.json` bucket manifest, the `TOVU_S3_*` environment names, the `tovu-media/` example prefix and the manifest error texts.
  No MCP server and no npm dependencies.
