---
"@jini-ai/admin": minor
---

Security root key: status badge (env var name from the status or the host `defaultEnvVarName`, key file, none; warning tone when invalid), fingerprint with its title, a source note per source, a production backup caveat in the scope notice, `rootKeyTab.generate: 'hidden'`, a create-only generate guard (also refuses env/file sources), and typed generate refusals (`locked`/`refused`/`already-exists`/`generic`) read through an injected `describeRootKeyError` so a raw error message never reaches the snapshot. Adds `classifyRootKeyRefusal`, `rootKeyBadge`, `rootKeySourceNote` and the `DescribeRootKeyError` type.
