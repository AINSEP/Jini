# @jini-ai/plugin-google-workspace

## Unreleased

### Minor Changes

- New package: the portable `google-workspace` Agent Plugin (Google sign-in, Google Sheets tools,
  admin panels, `google-sheets` form destination), moved from Tovu's bundled plugins. Inner
  `plugin.json` version stays 0.1.0; publisher id stays `tovu/google-workspace`. The skill text and
  manifest prose are host-neutral; Tovu's tool names, admin paths and callback route moved to Tovu's
  overlay. Contribution contracts and frozen identifiers are unchanged. No MCP server, no
  dependencies.
