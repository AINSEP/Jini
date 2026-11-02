# @jini-ai/plugin-railway

## Unreleased

### Minor Changes

- New package: the portable `railway` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 1.0.0). Publisher id stays `tovu/railway`; contribution file names are frozen.
  Product-specific text, notes and runtime switches moved to the host's overlay; the shipped text
  is host-neutral. No dependencies.
