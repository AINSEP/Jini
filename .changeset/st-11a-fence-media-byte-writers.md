---
"@jini-ai/cms": major
"@jini-ai/core": minor
---

Fence media byte writers with a cross-process lock: `createBlobGc(...)` in `@jini-ai/cms/media` runs `claimWrite`, `tombstone`, `deletePass`, `unlinkPass` and `unlinkIfUnowned` inside `kernel.transaction` under `kernel.lockKey('blob:<workspaceId>:<storageKey>')`. Ownership probes (`hasLiveEntryRefs`, `oldestRetainedRecoveryAgeMs`, `pendingJobOwners`) are required on the unlink path; a missing or failing probe keeps the bytes. Tombstones record `purgeReason`; legacy tombstones without one are never unlinked, and Trash-TTL purges are unlinked only when a host passes `allowTrashTtl: true`. Breaking: `ImportMediaEntityDeps` and `BlobPutRouteDeps` now require `blobFence`. New neutral DTOs at `@jini-ai/core/contracts/blob-gc`.

Also fenced (breaking, new required `blobFence` deps): `uploadMedia` (`UploadMediaDeps`, `MediaToolDeps`, `ConvertVideoToolDeps`), rendition generation (`ResolveMediaRenditionDeps`), `replaceMediaFile` (`ReplaceMediaFileDeps`) and `hydrateBlobStoreFromSeed` (`HydrateBlobStoreFromSeedRequired`). New exports `verifyWrittenBlob` and `BlobWriteMismatchError`: upload, rendition and replacement read a fresh write back and refuse to publish a row over bytes whose size or sha256 differ.
