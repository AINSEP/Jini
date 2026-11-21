---
"@jini-ai/mcp": minor
---

`installOwnedJsonAgent` takes its file effects as a required `files: { fileLock, writer }` (`OwnedJsonInstallFiles`: core's `FileLockPort` and `Pick<AtomicFileWriterPort, 'writeText' | 'backupOriginalOnce'>`) instead of importing `@jini-ai/platform/fs`. Lock path, lock options, backup-before-write order and `refuseSymlink: true` are unchanged. Node hosts pass `{ fileLock: nodeFileLock, writer: nodeAtomicWriter }` from `@jini-ai/node-adapters/fs`.
