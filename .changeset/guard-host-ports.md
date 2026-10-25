---
"@jini-ai/vibecoding": patch
"@jini-ai/integrations": patch
---

BREAKING (host composition): two native effects are now injected by the host instead of loaded from a sibling
domain (guard L1 / SI-domain clean-up). No default is provided because a default would reintroduce exactly
that edge.

- `@jini-ai/vibecoding` node: `openFileTreeProject` (and the node store/paths inputs) require
  `filesystem: ProjectFilesystemPort` (`createReader`, `withFileLock`, `writeFileAtomicAsync`,
  `writeJsonFileAtomicAsync`). Bind the existing `@jini-ai/platform` implementations in the host's composition root (see the `ProjectFilesystemPort` doc example).
  Hosts that only use `@jini-ai/vibecoding/html*` are unaffected.
- `@jini-ai/integrations` saved requests: `SavedRequestDeps` requires `executeCredentialedRequest`;
  pass `makeCredentialedRequest` from `@jini-ai/integrations/credentialed-http` so auditing and redaction stay bound
  to that owner.
