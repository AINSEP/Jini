---
"@jini-ai/cms": major
"@jini-ai/core": minor
---

Fence media byte writers with a cross-process lock: `createBlobGc(...)` in `@jini-ai/cms/media` runs `claimWrite`, `tombstone`, `deletePass`, `unlinkPass` and `unlinkIfUnowned` inside `kernel.transaction` under `kernel.lockKey('blob:<workspaceId>:<storageKey>')`. Ownership probes (`hasLiveEntryRefs`, `oldestRetainedRecoveryAgeMs`, `pendingJobOwners`) are required on the unlink path; a missing or failing probe keeps the bytes. Tombstones record `purgeReason`; legacy tombstones without one are never unlinked, and Trash-TTL purges are unlinked only when a host passes `allowTrashTtl: true`. Breaking: `ImportMediaEntityDeps` and `BlobPutRouteDeps` now require `blobFence`. New neutral DTOs at `@jini-ai/core/contracts/blob-gc`.
