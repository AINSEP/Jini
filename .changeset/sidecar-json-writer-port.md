---
"@jini-ai/sidecar": minor
---

`writeJsonFile`, `writeDaemonRegistryRecord` and `createSupervisorRegistry` take the host's atomic JSON writer as a required `writer` (`JsonFileWriter`, core's `Pick<AtomicFileWriterPort, 'writeJson'>`) instead of importing `@jini-ai/platform/fs`. The write options are unchanged (`createParent`, `trailingNewline`, umask-derived `defaultMode`, per-process unique temp path). Node hosts pass `nodeAtomicWriter` from `@jini-ai/node-adapters/fs`; the `server` preset already does.
