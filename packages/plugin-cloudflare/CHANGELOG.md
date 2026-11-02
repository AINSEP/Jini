# @jini-ai/plugin-cloudflare

## Unreleased

### Minor Changes

- New package: the portable `cloudflare` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 0.3.1). Publisher id stays `tovu/cloudflare`. Prose, comments and the
  form-publish messages now say "the host" / "the site admin" instead of the product name. Frozen
  identifiers are unchanged: deploy targets `cloudflare-workers` and `cloudflare-pages`, form
  destination `cloudflare-d1`, the `TOVU_FORMS` and `TOVU_FORMS_SECRET` bindings, `tovu-forms-*` D1
  database names, the `/_tovu/*` receiver routes, the `tovu-*.json` contribution files and the
  credential-card targets. No MCP server and no npm dependencies.
