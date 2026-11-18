---
"@jini-ai/cms": minor
---

`@jini-ai/cms/trash` exports the registry types (`TrashEntry`, `TrashRegistry`, `TrashMarkerSpec`, `TrashDisplaySpec`, `TrashDisplayJoin`, `TrashCascadeSpec`, `TrashBlockerSpec`, `TrashHiddenWithParentSpec`) and `trashEntityLockKey`, the lock key `trash:<entityType>:<workspaceId>:<entityId>` a Trash transition takes for one entity. The new subpath `@jini-ai/cms/trash/sql` exports `SqlTrashRepo`, the Kysely adapter for `TrashRepoPort` (the host passes its storage kernel and the name of its `trashed_items` table), and the query kit a registry-driven adapter is built from: `notTrashed`, `isTrashedRecord`, `readLiveSnapshot`, `entryWhere`, `loose`.
