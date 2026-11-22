---
"@jini-ai/platform": minor
---

Add `@jini-ai/platform/runtime-ports/process` (`nodeProcessControl`, `createProcessControlPort`) and `@jini-ai/platform/runtime-ports/fs` (`nodeFileLock`, `nodeAtomicWriter`): Node bindings of core's `ProcessControlPort`, `FileLockPort` and `AtomicFileWriterPort`. The process adapter reshapes `{ pids }` and `{ pid }` arguments to the positional form platform's functions take.
