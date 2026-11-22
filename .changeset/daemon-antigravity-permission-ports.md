---
"@jini-ai/daemon": minor
---

`ensureAntigravityMcpPermission` and `prepareAntigravityBridge` take `fileLock` and `writer` (core's `FileLockPort` and `AtomicFileWriterPort`) as required fields; `resolveMcpBridgeForRun`'s `deps` carry them, and the executor supplies its `runtime.fileLock` / `runtime.writer`. The lock, backup-once, atomic-write order and the lock release on every path are unchanged.
