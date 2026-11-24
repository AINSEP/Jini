# media/site

## Wiring

- `document-archive.ts` — `createDocumentArchiveReader({ yauzl, createArchiveReader })`. cms (L4) may not
  import `@jini-ai/agent-plugins` (L4), so the host injects the promise-style `yauzl` SDK and the streaming
  archive reader factory (agent-plugins' `createYauzlAgentPluginArchiveReader`). The host binds both at each call site.
