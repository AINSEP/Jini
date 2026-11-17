---
"@jini-ai/node-adapters": minor
"@jini-ai/platform": minor
---

Add `@jini-ai/node-adapters` (kind `runtime-adapter`): `./fs` (`nodeFileLock`, `nodeAtomicWriter`) and `./process` (`nodeProcessControl`, `createProcessControlPort`), moved from `@jini-ai/platform`.

**Breaking, `@jini-ai/platform`:** the `./runtime-ports/fs` and `./runtime-ports/process` entries are removed. Import the same names from `@jini-ai/node-adapters/fs` and `@jini-ai/node-adapters/process`.
