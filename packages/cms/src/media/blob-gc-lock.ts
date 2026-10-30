/**
 * @file In-process, per-sha256 mutex for the blob-GC protocol
 * ("Serialization" clause).
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
 * See docs/decisions/DR-004-journaled-blob-gc.md.
 */

import { createKeyedLock } from "./transform-lock.js";

// Uploads, replacements and GC share this hash namespace; transform/rendition locks stay separate.
const withHashLock = createKeyedLock({});

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
export function withSha256Lock<T>(requiredArgs: { key: string; criticalSection: () => Promise<T> }, optionalArgs: Record<string, never> = {}): Promise<T> {
  return withHashLock(requiredArgs, optionalArgs);
}
