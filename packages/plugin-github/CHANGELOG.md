# @jini-ai/plugin-github

## Unreleased

### Minor Changes

- New package: the portable `github` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 1.1.0). Publisher id stays `tovu/github`; contribution file names and the
  `.tovu/managed-files.json` manifest path are unchanged. Product words were made host-neutral; the
  deploy workflow's `expected_sha` protocol, the Site key start commands and the restore note moved
  to the host's overlay. Ships the dependency-free source-control, deployments and Actions deploy-ops
  modules; no MCP server, no added tool.
