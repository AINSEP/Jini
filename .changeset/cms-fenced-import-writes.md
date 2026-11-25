---
"@jini-ai/cms": major
---

Require `blobFence`, `storageKeyFor` and `verifyStoredBlob` on `ImportMediaEntityDeps`,
`BlobPutRouteDeps` and `HydrateBlobStoreFromSeedRequired`. Keep imports fenced through
conditional row publication, resurrect tombstones, and verify stored bytes even for an
existing ownership row or an occupied create-only key. Blob PUT's store result now includes
its `storageKey`; reject a returned key that differs from the canonical fenced key.

Seed hydration validates the source path and digest and reports corrupt occupied objects
as per-item failures. Staging and hydration do not create media ownership. Existing subpaths
are unchanged. Pair this major with the host's shared durable fence and stored-object
verification bindings before advancing its CMS dependency.
