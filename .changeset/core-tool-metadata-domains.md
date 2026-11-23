---
"@jini-ai/core": minor
---

Add per-domain tool metadata declarations under `@jini-ai/core/tool-metadata/<domain>` (files-copy, forms, identity, mail-status, media, media-import, navigation, observability, pages, analytics, change-sets, consent, content-duplication, content-types, database, database-transfer, email-templates, entries, external-mcp). Values live outside `contracts/` (types-only there).

The custom-credentials map is not shipped here: its search vocabulary names a model provider, so it stays with the host's Integrations owner.
