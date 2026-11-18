---
"@jini-ai/core": patch
---

`ChangeSetRecord.actorId`, `appliedAt`, `revertedAt` and `OutboxRecord.lastError` accept an explicit `undefined`, like their sibling optional fields, so a storage adapter that reads an absent column as `undefined` type-checks under `exactOptionalPropertyTypes`.
