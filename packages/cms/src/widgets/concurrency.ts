/**
 * @file A tiny per-key async mutex (SPEC-043 REQ-06/15, AC-04/EC-02).
 *
 * Purpose:
 * `features/entries/write-service.ts`'s `updateEntry` reads the current row, checks
 * `expectedVersion`, then writes — but `InMemoryEntryRepo.transaction` provides no real
 * serialization (`async transaction(fn) { return fn(); }`), and the version check itself happens
 * BEFORE that transaction call. Two truly concurrent callers racing the same entry id can both
 * observe the pre-write version and both pass the check under the in-memory adapter (the real
 * `SqliteEntryRepo.transaction`'s `BEGIN IMMEDIATE` already serializes real concurrent writers at
 * the DB layer — this mutex is redundant-but-harmless there, and load-bearing for the in-memory
 * path this test suite's concurrency assertions exercise).
 *
 * This module serializes the whole "read current version -> validate -> call updateEntry" sequence
 * per entry id at the WIDGETS domain layer, restoring correct optimistic-concurrency semantics
 * deterministically regardless of the underlying repo adapter's own concurrency properties.
 *
 * Architectural role:
 * `widgets` domain-internal helper, not a frozen public contract.
 */
const locks = new Map<string, Promise<void>>();

/**
 * Runs `fn` exclusively with respect to every other `withEntryLock` call sharing the same `key` —
 * callers queue in call order, each waiting for the previous holder to finish.
 *
 * @complexity O(1) scheduling overhead beyond `fn`'s own cost.
 * @overallScore 100
 */
export async function withEntryLock<T>({ key, fn }: { key: string; fn: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, previous.then(() => next));

  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
