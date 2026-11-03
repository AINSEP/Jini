# @jini-ai/agent-plugins/ui-ux-design

## Unreleased

- Publishes in place as the `@jini-ai/agent-plugins/ui-ux-design` subpath; the wrapper and assembler are retired.
- One shared copy with Tovu: the skills carry Tovu's newer AI-Dev-Shop sync (c10abee: UI loop,
  Chrome mobile matrix, animation and kUInetic references), Tovu's card summary and Jini's search
  keywords. Host chat rules are replaced by host-neutral tool-use wording; hosts add their own at
  delivery. Inner plugin version 0.6.1 (above Tovu's installed 0.6.0).

## 0.6.17

### Patch Changes

- Version bump only.

## 0.6.15

### Minor Changes

- Breaking package-surface change for the fixed 0.6.15 release: remove the bundled
  ui-ux-design files and wildcard export from @jini-ai/agent-plugins. Hosts must
  explicitly install @jini-ai/agent-plugins/ui-ux-design and resolve its ./plugin.json
  export, stage that payload and seed through the existing Agent Plugin lifecycle.
  The lifecycle implementation remains in @jini-ai/agent-plugins. Inner plugin
  version 0.4.6, deterministic packing, digest selection and operator activation
  decisions are preserved. Tovu wording reconciliation and cutover follow later.

