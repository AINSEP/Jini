---
"@jini-ai/platform": minor
"@jini-ai/agent-plugins": minor
---

Publish the A2 mail seams: platform exposes `toPluginHttpClient`, `fromPositionalMailer`,
`toPositionalMailer` and `createProviderMailer`; agent-plugins exposes
`createMailContributions`, `createMailCatalog`, `createMailConfiguration`,
`createMailSelection` and `createHostMailer`.

Hosts inject `parseSetup` and their credential-label policy. The legacy raw-only
`parseMailAdaptersFile({ raw }, optional)` call remains supported through a local
validation boundary, preserving declared setup validation and v1/v2 descriptors.
Provider-status and credential-save factories also require host wording and catalog
provenance so a second host supplies its own navigation without changing Tovu bytes.
