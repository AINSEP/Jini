import assert from "node:assert/strict";

import type { StorageKernel } from "@jini-ai/db/kernel";

/**
 * @file Test helper: run a repo write while ANOTHER async context holds a content-db transaction
 * open, then roll that one back. A write on the kernel's own transaction waits its turn and
 * survives; a synchronous Drizzle `db.transaction()` became a savepoint inside the open `BEGIN` and
 * was rolled back with it.
 */

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A concurrent write must survive another caller's rollback on the same kernel.
 * @param required.kernel the real storage kernel; required.write the repo write under test.
 * @returns The write result; propagates its rejection and asserts the other transaction rolled back.
 * @complexity O(1) orchestration and space, plus the write/driver costs.
 * @example await writeDuringOthersRollback({ kernel, write: () => repo.save(record) }, {});
 */
export async function writeDuringOthersRollback<T, DB = unknown>(
  { kernel, write }: { kernel: StorageKernel<DB>; write: () => Promise<T> },
  _optional: Record<string, never> = {},
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const other = kernel.transaction(async () => {
    await gate;
    throw new Error("the other caller rolls back");
  });
  await tick();
  const mine = write();
  await tick();
  release();
  await assert.rejects(other, /the other caller rolls back/);
  return mine;
}
