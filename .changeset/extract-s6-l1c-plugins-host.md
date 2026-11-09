---
"@jini-ai/plugins": minor
---

Add `toAdminPluginResponse({ discovery, activation }, { conflicts })` and `AdminPluginEnvelope` to
`@jini-ai/plugins/host`, the bounded `readPluginArchive({ archive, reader })` policy with a required
host `PluginArchiveReaderPort` to `@jini-ai/plugins/host/node`, and `startTier2Worker({ workerData,
parentPort, binding, registerSdkResolver, realImport }, { importModule })` to
`@jini-ai/plugins/host/worker` (no auto-start on import).
