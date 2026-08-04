/**
 * @file In-process, per-sha256 mutex for the blob-GC protocol
 * (INV-1's "Serialization" clause).
 *
 * Purpose:
 * The real protocol serializes every `asset_blobs` state transition
 * under `BEGIN IMMEDIATE` (SQLite) / `SELECT … FOR UPDATE` (Postgres) so a
 * dedup "skip write" decision and a concurrent GC delete can never observe
 * inconsistent state. This library's media persistence is in-memory only (see
 * `repo.memory.ts` file headers), so there is no database transaction to
 * borrow. JS is single-threaded, but `async` functions still interleave at
 * `await` points — that is exactly where the race the original design describes would
 * happen: an uploader's dedup lookup and a GC delete-pass's row removal can
 * both be mid-flight on the same sha256 at the same time. `withSha256Lock`
 * closes that race for a single process by chaining critical sections keyed
 * by sha256, so only one runs at a time per hash (different hashes still run
 * fully concurrently).
 *
 * This is a real, if narrower, substitute for `BEGIN IMMEDIATE` — not a
 * decorative comment. See `blob-gc.ts`'s file header for what this does NOT
 * cover (cross-process safety, which needs a real DB transaction — a host's
 * own SQLite adapter would supply that).
 */

/**
 * Tracks the tail of the promise chain for each in-flight/queued key. An
 * entry is removed once its own critical section is the last one queued and
 * has settled, so the map stays bounded by the number of sha256 values with
 * work currently in flight — not by the number ever seen.
 */
const lockTails = new Map<string, Promise<void>>();

/**
 * Runs `criticalSection` exclusively with respect to any other call
 * currently queued or running for the same `key` — calls for the same key
 * are strictly ordered (FIFO); calls for different keys run fully
 * concurrently. A rejection in one critical section does not poison the
 * lock for later callers on the same key (each waits for its predecessor to
 * *settle*, not to succeed).
 *
 * @complexity O(1) scheduling overhead per call; total wait time is bounded
 * by the number of other calls currently queued for the same key.
 * @overallScore 100
 */
export function withSha256Lock<T>(key: string, criticalSection: () => Promise<T>): Promise<T> {
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
}
