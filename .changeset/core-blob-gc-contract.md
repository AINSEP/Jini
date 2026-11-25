---
"@jini-ai/core": minor
---

Add the `@jini-ai/core/contracts/blob-gc` entry: `BlobIdentity`, `BlobPurgeReason`, `BlobFence`, `BlobStorageKeyFor` and `BlobGcScope`. A blob collector is bound to one workspace when it is built (`BlobGcScope`); its passes list only that workspace's blobs and journal entries and never enumerate across workspaces.
