# @jini-ai/plugin-fly

## Unreleased

### Minor Changes

- New package: the portable `fly` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 1.0.0). Publisher id stays `tovu/fly`; contribution file names are frozen.
  Product-specific text, notes and runtime switches moved to the host's overlay; the shipped text
  is host-neutral. No dependencies.
- The workflow renderer requires `--values` and `--repo-root`; the template's host regions are
  filled only from the host's values file and blocks.
