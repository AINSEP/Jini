# @jini-ai/plugin-ui-ux-design

## 0.6.15

### Minor Changes

- Breaking package-surface change for the fixed 0.6.15 release: remove the bundled
  ui-ux-design files and wildcard export from @jini-ai/agent-plugins. Hosts must
  explicitly install @jini-ai/plugin-ui-ux-design and resolve its ./plugin.json
  export, stage that payload and seed through the existing Agent Plugin lifecycle.
  The lifecycle implementation remains in @jini-ai/agent-plugins. Inner plugin
  version 0.4.6, deterministic packing, digest selection and operator activation
  decisions are preserved. Tovu wording reconciliation and cutover follow later.

