import { type CreateTableBuilder, sql } from "kysely";
import type { MigrationStep } from "@jini-ai/db/migrate";
import type { StorageKernel } from "@jini-ai/db/kernel";

/**
 * @file Payments ledger step 2 (ADR-066; lot L4): the append-only operator-action audit, the
 * two indexes the reconciler's scans need, and the outbox enqueue order. Same portable-DDL rules as `0001_payments_ledger`
 * (TEXT/BIGINT only, NOT NULL primary key, mode CHECK, a foreign key over the payment's
 * id + workspace + mode). Step 1 is frozen, so the table is added here rather than there.
 *
 * - `commerce_operator_actions`: one row per operator resolution of an `unknown` payment or
 *   refund (who, what, why, when). Written in the same transaction as the state change, never
 *   updated or deleted. `actor` is an opaque operator id; `reason` is free text the operator types.
 * - `commerce_payments_unknown` (intent_status, updated_at) and `commerce_refunds_unsettled`
 *   (status, updated_at): the reconciler lists stale `unknown` intents and unsettled refunds.
 * - `commerce_outbox.seq`: a per-database enqueue counter. Every message one apply enqueues shares
 *   its `created_at`, and ids are random, so `created_at, id` could relay `refund.succeeded` before
 *   the `payment.succeeded` of the same apply (L5 review). Pending messages order by
 *   `created_at, seq, id`. Rows enqueued before this step keep `seq` 0 (their old order).
 *
 * Frozen once shipped: its checksum is pinned in `checksums.ts`.
 */
export const PAYMENTS_OPERATOR_ACTIONS_ID = "0002_payments_operator_actions";

const REQUIRED_TEXT = [
  "payment_id", "workspace_id", "site_id", "provider_id", "provider_account_id", "mode", "action", "outcome", "actor", "reason",
];

const INDEXES: readonly (readonly [name: string, table: string, columns: readonly string[]])[] = [
  ["commerce_operator_actions_payment", "commerce_operator_actions", ["payment_id"]],
  ["commerce_payments_unknown", "commerce_payments", ["intent_status", "updated_at"]],
  ["commerce_refunds_unsettled", "commerce_refunds", ["status", "updated_at"]],
  ["commerce_outbox_seq", "commerce_outbox", ["seq"]],
];

async function up(kernel: StorageKernel<unknown>): Promise<void> {
  await kernel.run((db) => {
    // Columns are added in a loop, so Kysely cannot track their names: widen the builder to `string`.
    let builder = db.schema.createTable("commerce_operator_actions") as unknown as CreateTableBuilder<string, string>;
    builder = builder.addColumn("id", "text", (column) => column.primaryKey().notNull());
    for (const name of REQUIRED_TEXT) builder = builder.addColumn(name, "text", (column) => column.notNull());
    builder = builder.addColumn("refund_id", "text").addColumn("created_at", "bigint", (column) => column.notNull());
    builder = builder.addCheckConstraint("commerce_operator_actions_mode", sql.raw("mode IN ('test', 'live')"));
    builder = builder.addForeignKeyConstraint(
      "commerce_operator_actions_payment_fk", ["payment_id", "workspace_id", "mode"], "commerce_payments", ["id", "workspace_id", "mode"]
    );
    return builder.execute();
  });
  await kernel.run((db) => db.schema.alterTable("commerce_outbox").addColumn("seq", "bigint", (column) => column.notNull().defaultTo(0)).execute());
  for (const [name, table, columns] of INDEXES) {
    await kernel.run((db) => db.schema.createIndex(name).on(table).columns([...columns]).execute());
  }
}

/** The step, carrying its pinned checksum. @example paymentsOperatorActions({ checksum }) */
export function paymentsOperatorActions(required: { checksum: string }, _optional: Record<string, never> = {}): MigrationStep {
  return { id: PAYMENTS_OPERATOR_ACTIONS_ID, checksum: required.checksum, up };
}
