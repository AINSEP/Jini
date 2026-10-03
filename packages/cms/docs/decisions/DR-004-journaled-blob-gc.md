# DR-004: Blob collection rechecks references before journaled unlink

Status: Accepted; documents existing constraints. Recorded 2026-10-02.

## Context

Deleting bytes while a concurrent upload resurrects their hash can leave a live row pointing at missing data. Crashing between row removal and unlink can also leave storage unreconciled.

## Decision

Serialize transitions by hash. Tombstone before deletion, wait the grace interval, and recheck references under the same lock. Journal the deletion before removing the blob row; unlink in a later journal-drain phase after checking that no row has been recreated. Dedup uploads can resurrect a tombstoned row under that lock. Preserve append-only transform versions and serialize rendition creation separately.

## Consequences

The source design called for durable transactional locks and fresh storage epochs; the current portable implementation uses in-process locks, separate awaited journal/row writes and hash-derived keys. Live-content/snapshot checks and the monthly sweep are incomplete. Hosts must supply durable concurrency/recovery before claiming crash-safe collection; grace alone does not repair those gaps.

## Defect prevented

Unlinking resurrected live bytes, duplicate blob creation and losing track of a deletion interrupted by a crash.

## Source and local evidence

The originating rationale was reviewed and restated for any host. External provenance is maintained outside this repository. This record does not introduce a behavior change.

- [packages/cms/src/media/blob-gc.ts](../../src/media/blob-gc.ts).
- [packages/cms/src/media/blob-gc-lock.ts](../../src/media/blob-gc-lock.ts).
- [packages/cms/src/media/media-service.ts](../../src/media/media-service.ts).
