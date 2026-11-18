---
"@jini-ai/cms": minor
---

Add the trash agent tools to `@jini-ai/cms/trash`: `buildTrashAgentToolCatalog` (the two-tool list/restore catalog, built per call from the kinds it is given), `buildTrashToolRegistrations` over `TrashPackageToolDeps`, and the authored `trashDerivedRisk` map. The host supplies its permission, visibility, days-left and kind-list rules as `deps.trashPolicy` and binds its tool metadata with `withToolMetadata`.
