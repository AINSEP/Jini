import { sql } from "kysely";
import { listColumns, type StorageKernel } from "@jini-ai/db/kernel";
import type { FormsTables, FormSubmissionDatabase } from "./tables.js";
import type { SubmissionIpRetentionPort } from "../submission-ip-retention.js";

/** Site-owned schema adapter; no retention policy or timer lives here. */
export function createSubmissionIpRetentionRepo<DB>(
  { kernel: suppliedKernel, tables }: { kernel: StorageKernel<DB>; tables: FormsTables },
  _optional: Record<string, never> = {},
): SubmissionIpRetentionPort {
  const kernel = suppliedKernel as unknown as StorageKernel<FormSubmissionDatabase>;
  let nullableConfirmed = false;
  return {
    async clearExpiredIps({ submittedBeforeOrAt }, { limit = 500 } = {}) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("submission IP batch limit must be positive");
      if (!nullableConfirmed) {
        // A database not yet at migration 0006 still has NOT NULL source_ip. Fail before
        // writing while that old schema is present; a failed probe is retried on the next pass.
        // The kernel's catalog helper spells the dialect-specific lookup (SQLite table_info,
        // Postgres information_schema), so this adapter stays dialect-neutral.
        const columns = await listColumns(kernel, tables.submissions);
        nullableConfirmed = columns.some(column => column.name === "source_ip" && !column.notNull);
        if (!nullableConfirmed) throw new Error("submission IP retention requires the nullable source_ip migration (0006)");
      }
      // Single statement, with the predicate repeated on the write: another process may have
      // cleared a selected row already. NULL→NULL is excluded from the count. No read/modify/
      // save of data_json, no Trash filter, and no lease/outbox event to race or retain the IP.
      // The raw NULL expression bridges the still-published NOT NULL generated table type;
      // the readiness probe above verifies the real schema before issuing it.
      const result = await kernel.run(db => db.updateTable(tables.submissions)
        .set({ source_ip: sql<string>`NULL` })
        .where("source_ip", "is not", null)
        .where("submitted_at", "<=", submittedBeforeOrAt)
        .where("id", "in", db.selectFrom(tables.submissions)
          .select("id")
          .where("source_ip", "is not", null)
          .where("submitted_at", "<=", submittedBeforeOrAt)
          .orderBy("submitted_at").orderBy("id").limit(limit))
        .executeTakeFirst());
      return Number(result.numUpdatedRows);
    },
  };
}
