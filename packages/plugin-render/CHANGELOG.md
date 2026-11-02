# @jini-ai/plugin-render

## Unreleased

### Minor Changes

- New package: the portable `render` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 1.0.0). Publisher id stays `tovu/render`; contribution file names are frozen.
  Product-specific text, notes and runtime switches moved to the host's overlay; the shipped text
  is host-neutral. No dependencies.
- Fix: `render.yaml` carries the non-secret `options.env` the host passes (it was ignored), and no
  longer hard-codes a host runtime switch.
