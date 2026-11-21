---
"@jini-ai/plugins": minor
---

`createPluginSourceService` takes its cross-process lock from a required `fileLock: FileLockPort` (on `PluginSourceDeps`, and on `PluginRuntimeHostBinding`, which the runtime spreads into it) instead of importing `@jini-ai/platform/fs/file-lock`. Node hosts pass `nodeFileLock` from `@jini-ai/node-adapters/fs`. The lock options are unchanged (`timeoutMs: 100`, `staleMs: Infinity`, the caller's `lockPorts` first). `@jini-ai/platform` is no longer a peer of plugins.
