---
"@jini-ai/cms": minor
---

Add `@jini-ai/cms/publish/content/backstop-preview` and `@jini-ai/cms/publish/content/publish-backstop-file`, moved from a host. The hand-send ("backstop") preview builder and the raw site-file adapter now take their host policy as required injected fields instead of importing it: `buildBackstopPreview({ entities, backstop, workspaceId, policy, warn })` and `createRawFileSitePort({ siteDir, checkRawFilePath, maxBytes, normalizeMode }, { filesystem })`. `@jini-ai/cms/publish/content/backstop-refusal` gains the neutral `RawBackstopPolicy` and `RawFilePolicy` types the host implements; deny-list tables, limits and copy stay in the host.
