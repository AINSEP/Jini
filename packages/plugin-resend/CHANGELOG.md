# @jini-ai/plugin-resend

## Unreleased

### Minor Changes

- New package: the portable `resend` Agent Plugin, moved from Tovu's bundled plugins (inner
  `plugin.json` version 0.2.1). Publisher id stays `tovu/resend`; contribution file name, MCP keys
  and the credential label are unchanged. Product words were made host-neutral; the webhook route,
  signing-secret labels, rotation and suppression guidance moved to the host's overlay. Ships the
  dependency-free Resend mail adapter and the hosted MCP declaration.
