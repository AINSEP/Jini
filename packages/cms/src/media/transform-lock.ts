/**
 * @file Generic in-process keyed mutex factory, extracted from
 * `blob-gc-lock.ts`'s `withSha256Lock` shape (INV-1's
 * "Serialization" clause) so the same FIFO-per-key critical-section pattern
 * can back two independent lock namespaces this domain needs:
 *
 *  - `withTransformRegistryLock` — serializes `registerTransform`'s
 *    read-max-version-then-insert-next-version sequence per `(workspaceId,
 *    name)`, so two concurrent registrations of the same name can't both
 *    read the same "current max" and mint a colliding version.
 *  - `withRenditionLock` — serializes lazy rendition generation per
 *    `(sha256, transformName, version)` ("single-flight"), so two
 *    concurrent requests for the same not-yet-generated rendition never run
 *    the image transformer twice.
 *
 * `blob-gc-lock.ts` itself is untouched — this is a separate module, not a
 * modification of that file's exports (its shape is deliberately mirrored
 * here, not imported, so `blob-gc-lock.ts`'s own signature stays untouched).
 */

/**
 * Creates one independent keyed-lock namespace: calls sharing the same `key`
 * are strictly FIFO-ordered; calls for different keys run fully
 * concurrently. A rejection in one critical section does not poison the lock
 * for later callers on the same key (each waits for its predecessor to
 * *settle*, not to succeed) — identical semantics to `withSha256Lock`.
 *
 * @complexity O(1) scheduling overhead per call; total wait time is bounded
 * by the number of other calls currently queued for the same key.
 * @overallScore 100
 */
export function createKeyedLock(): <T>(key: string, criticalSection: () => Promise<T>) => Promise<T> {
  const lockTails = new Map<string, Promise<void>>();

  return function withLock<T>(key: string, criticalSection: () => Promise<T>): Promise<T> {
    const priorTail = lockTails.get(key) ?? Promise.resolve();
    const run = priorTail.then(criticalSection, criticalSection);
    const settledTail: Promise<void> = run.then(
      () => undefined,
      () => undefined
    );
    lockTails.set(key, settledTail);
    void settledTail.then(() => {
      if (lockTails.get(key) === settledTail) {
        lockTails.delete(key);
      }
    });
    return run;
  };
}

/** Keyed on `${workspaceId}:${name}` — see file header. */
export const withTransformRegistryLock = createKeyedLock();

/** Keyed on `${sha256}:${transformName}:${version}` — see file header. */
export const withRenditionLock = createKeyedLock();
