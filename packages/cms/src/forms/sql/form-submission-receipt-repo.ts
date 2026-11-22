import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";

interface ReceiptRow {
  workspace_id: string;
  destination_key: string;
  remote_id: string;
  submission_id: string;
  imported_at: string;
}

/**
 * @file Dedupe receipts for submissions imported from a form destination (migration 0018). One
 * Kysely body for SQLite and Postgres. `claim` is a single `INSERT … ON CONFLICT DO NOTHING
 * RETURNING`, so it never raises a unique violation, which on Postgres would abort the surrounding
 * import transaction. Called inside the submissions store's transaction, it joins it (the kernel's
 * transactions are ambient).
 */
export class SqlFormSubmissionReceiptRepo {
  constructor(private readonly required: { kernel: StorageKernel<Kysely<unknown>, unknown>; table: string }, _optional: Record<string, never> = {}) {}

  /** True when this call recorded the receipt; false when the remote row was already imported. @complexity O(1). */
  async claim(required: { workspaceId: string; destinationKey: string; remoteId: string; submissionId: string; importedAt: string }, _optional: Record<string, never> = {}): Promise<boolean> {
    const rows = await this.required.kernel.run((db) => db.withTables<Record<string, ReceiptRow>>().insertInto(this.required.table)
      .values({ workspace_id: required.workspaceId, destination_key: required.destinationKey, remote_id: required.remoteId,
        submission_id: required.submissionId, imported_at: required.importedAt })
      .onConflict((conflict) => conflict.columns(["workspace_id", "destination_key", "remote_id"]).doNothing())
      .returning("remote_id")
      .execute());
    return rows.length === 1;
  }
}
