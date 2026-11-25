---
"@jini-ai/core": minor
"@jini-ai/cms": major
---

Add optional `description` to `AdminMediaDto` and include stored descriptions in CMS admin responses and media search. DTO projection remains compatible: missing descriptions are omitted and the existing 2,000-character validation bound is unchanged.

Breaking CMS call-site change: `buildMediaViewImageAgentToolCatalog`, `buildMediaViewImageRegistrations`, and `contributeMediaViewImageTools` now require `mediaMetadataWriteToolId`. Hosts must pass their authorized metadata-write tool ID alongside `mediaAssetReadToolId`. Viewing remains read-only and the catalog explains the separate authorized save step.
