# @jini-ai/plugin-meilisearch

## Unreleased

### Minor Changes

- New package: the portable `meilisearch` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 0.1.0). Publisher id stays `tovu/meilisearch`; the contribution file name
  and the credential label are unchanged. Product words were made host-neutral. Ships the
  dependency-free Meilisearch site-search provider; no MCP server.
