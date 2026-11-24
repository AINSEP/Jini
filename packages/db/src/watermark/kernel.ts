import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";

/**
 * @file The site write watermark (the host's watermark table, `database_write_watermark` in the
 * first host; SPEC-016 C-004/U-002/U-004) on the storage kernel, every dialect: the stamp, the read,
 * and the read-side mirror reconciliation.
 *
 * The watermark table is a singleton row (id 1, created by the host's content-store preparation)
 * advanced by exactly 1 per gated write. The stamp is async, so it is correct only where the caller
 * awaits it: Jini cms's taxonomy write-service does (owner decision O2, `WriteServiceDeps.stampWatermark:
 * () => Promise<void> | void`). Inside a kernel transaction the UPDATE joins it (the kernel hands
 * `run()` the open transaction); outside one it is its own statement, the same envelope as the write
 * it follows.
 */

/** Host-owned table name. No schema or product table default lives here. */
export interface WriteWatermarkTables { watermark: string }

/** The structural singleton row this module reads and writes; the host's generated table type must match it. */
export interface WriteWatermarkTable {
  id: number;
  value: number;
  last_stamped_at: string | null;
}

/** The schema-erased kernel and the host's table name. */
export interface WriteWatermarkRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: WriteWatermarkTables;
}

/**
 * The read-side mirror slice reconciliation writes to (the host's `MirrorStorePort` matches it):
 * a cheap, possibly-stale copy of the authoritative value that can be marked unrefreshable.
 */
export interface WriteWatermarkMirror {
  set(value: number): Promise<void>;
  markUnrefreshable(): Promise<void>;
}

/** The narrow typed view of the schema-erased kernel's connection. */
function view(db: Kysely<unknown>) {
  return db.withTables<Record<string, WriteWatermarkTable>>();
}

/**
 * A `stampWatermark` binding over `kernel`: `value = value + 1` on the singleton row (id 1, created
 * by the host's content-store preparation).
 *
 * @complexity O(1) — one single-row UPDATE by primary key.
 */
export function kernelStampWatermark({ kernel, tables }: WriteWatermarkRequired, _optional: Record<string, never> = {}): () => Promise<void> {
  return async () => {
    await kernel.run((db) =>
      view(db)
        .updateTable(tables.watermark)
        .set((eb) => ({ value: eb("value", "+", 1), last_stamped_at: new Date().toISOString() }))
        .where("id", "=", 1)
        .execute()
    );
  };
}

/**
 * The current authoritative watermark (0 when the singleton row is missing).
 *
 * @complexity O(1) — single-row lookup by primary key.
 */
export async function readKernelWatermark({ kernel, tables }: WriteWatermarkRequired, _optional: Record<string, never> = {}): Promise<number> {
  const row = await kernel.run((db) => view(db).selectFrom(tables.watermark).select("value").where("id", "=", 1).executeTakeFirst());
  return Number(row?.value ?? 0);
}

/**
 * Boot-time (and on-demand) mirror reconciliation (U-004). `kernel: null` models "the content
 * database failed to open": the mirror keeps its value and is marked `'unrefreshable'`
 * (U-004-B2/REQ-05), never given a precise-looking but wrong value. Otherwise the mirror is
 * overwritten from the authoritative value, its own prior value discarded (U-004-B1: never a merge).
 *
 * @complexity O(1) plus one read when `kernel` is non-null.
 */
export async function reconcileMirror(
  required: { kernel: WriteWatermarkRequired["kernel"] | null; tables: WriteWatermarkTables; mirror: WriteWatermarkMirror },
  _optional: Record<string, never> = {}
): Promise<void> {
  const { kernel, tables, mirror } = required;
  if (kernel === null) {
    await mirror.markUnrefreshable();
    return;
  }
  await mirror.set(await readKernelWatermark({ kernel, tables }));
}
