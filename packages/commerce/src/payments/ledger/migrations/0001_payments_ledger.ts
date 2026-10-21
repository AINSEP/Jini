import { type CreateTableBuilder, sql } from "kysely";
import type { MigrationStep } from "@jini-ai/db/migrate";
import type { StorageKernel } from "@jini-ai/db/kernel";

/**
 * @file The payments ledger's first schema (ADR-066 step; design 2026-10-21 lot L2). Portable DDL:
 * TEXT, BIGINT and INTEGER only, built with Kysely's schema builder so one body is valid on SQLite
 * and Postgres with no dialect branch.
 *
 * - Money is BIGINT minor units, times BIGINT epoch ms (SQLite stores both as INTEGER affinity).
 * - Every money table is keyed by workspace + mode (and provider account where a provider ref is
 *   unique), never by a provider ref alone.
 * - CHECKs only on what is stable forever (mode, non-negative amounts). Status vocabularies grow,
 *   and SQLite cannot alter a CHECK without rebuilding the table, so statuses are free TEXT that
 *   the writer validates.
 * - Child rows reference `commerce_payments(id)`; payments are never deleted (legal retention).
 *
 * Frozen once shipped: its checksum is pinned in `checksums.ts`. Change the schema with a new step.
 */
export const PAYMENTS_LEDGER_ID = "0001_payments_ledger";

type Column = readonly [name: string, type: "text" | "bigint" | "integer", flag?: "pk" | "null"];

interface TableSpec {
  readonly name: string;
  readonly columns: readonly Column[];
  readonly uniques: readonly (readonly [name: string, columns: readonly string[]])[];
  readonly checks: readonly (readonly [name: string, expression: string])[];
  readonly referencesPayment: boolean;
}

const MODE_CHECK = "mode IN ('test', 'live')";

const PAYMENTS: TableSpec = {
  name: "commerce_payments",
  columns: [
    ["id", "text", "pk"], ["workspace_id", "text"], ["site_id", "text"], ["provider_id", "text"],
    ["provider_account_id", "text"], ["mode", "text"], ["idempotency_key", "text"], ["reference", "text"],
    ["party_id", "text", "null"], ["currency", "text"], ["amount_minor", "bigint"], ["captured_minor", "bigint"],
    ["intent_status", "text"], ["refunded_minor", "bigint"], ["refund_held_minor", "bigint"], ["disputed_minor", "bigint"],
    ["status", "text"], ["provider_ref", "text", "null"], ["next_action_json", "text", "null"],
    ["fee_currency", "text", "null"], ["fee_minor", "bigint", "null"], ["net_currency", "text", "null"],
    ["net_minor", "bigint", "null"], ["settlement_currency", "text", "null"], ["settlement_minor", "bigint", "null"],
    ["version", "integer"], ["created_at", "bigint"], ["updated_at", "bigint"],
  ],
  uniques: [
    ["commerce_payments_idempotency", ["workspace_id", "mode", "idempotency_key"]],
    ["commerce_payments_provider_ref", ["workspace_id", "mode", "provider_id", "provider_account_id", "provider_ref"]],
  ],
  checks: [
    ["commerce_payments_mode", MODE_CHECK],
    ["commerce_payments_amounts", "amount_minor >= 0 AND captured_minor >= 0 AND refunded_minor >= 0 AND refund_held_minor >= 0 AND disputed_minor >= 0"],
  ],
  referencesPayment: false,
};

const ATTEMPTS: TableSpec = {
  name: "commerce_payment_attempts",
  columns: [
    ["id", "text", "pk"], ["payment_id", "text"], ["workspace_id", "text"], ["mode", "text"], ["op", "text"],
    ["operation_key", "text"], ["refund_id", "text", "null"], ["outcome", "text"], ["error_code", "text", "null"],
    ["error_message", "text", "null"], ["created_at", "bigint"], ["updated_at", "bigint"],
  ],
  uniques: [["commerce_payment_attempts_operation", ["workspace_id", "mode", "operation_key"]]],
  checks: [["commerce_payment_attempts_mode", MODE_CHECK]],
  referencesPayment: true,
};

const REFUNDS: TableSpec = {
  name: "commerce_refunds",
  columns: [
    ["id", "text", "pk"], ["payment_id", "text"], ["workspace_id", "text"], ["site_id", "text"], ["provider_id", "text"],
    ["provider_account_id", "text"], ["mode", "text"], ["idempotency_key", "text", "null"],
    ["provider_refund_ref", "text", "null"], ["currency", "text"], ["amount_minor", "bigint"], ["status", "text"],
    ["reason", "text", "null"], ["created_at", "bigint"], ["updated_at", "bigint"],
  ],
  uniques: [
    ["commerce_refunds_provider_ref", ["workspace_id", "mode", "provider_id", "provider_account_id", "provider_refund_ref"]],
    ["commerce_refunds_idempotency", ["workspace_id", "mode", "idempotency_key"]],
  ],
  checks: [["commerce_refunds_mode", MODE_CHECK], ["commerce_refunds_amount", "amount_minor >= 0"]],
  referencesPayment: true,
};

const DISPUTES: TableSpec = {
  name: "commerce_disputes",
  columns: [
    ["id", "text", "pk"], ["payment_id", "text"], ["workspace_id", "text"], ["provider_id", "text"],
    ["provider_account_id", "text"], ["mode", "text"], ["provider_dispute_ref", "text"], ["currency", "text"],
    ["amount_minor", "bigint"], ["status", "text"], ["due_by", "bigint", "null"], ["created_at", "bigint"], ["updated_at", "bigint"],
  ],
  uniques: [["commerce_disputes_provider_ref", ["workspace_id", "mode", "provider_id", "provider_account_id", "provider_dispute_ref"]]],
  checks: [["commerce_disputes_mode", MODE_CHECK], ["commerce_disputes_amount", "amount_minor >= 0"]],
  referencesPayment: true,
};

const EVIDENCE: TableSpec = {
  name: "commerce_payment_evidence",
  columns: [
    ["id", "text", "pk"], ["payment_id", "text"], ["workspace_id", "text"], ["mode", "text"], ["source", "text"],
    ["subject", "text"], ["subject_ref", "text"], ["observed_status", "text"], ["currency", "text", "null"],
    ["amount_minor", "bigint", "null"], ["inbox_id", "text", "null"], ["recorded_at", "bigint"],
  ],
  uniques: [],
  checks: [["commerce_payment_evidence_mode", MODE_CHECK]],
  referencesPayment: true,
};

const INBOX: TableSpec = {
  name: "commerce_webhook_inbox",
  columns: [
    ["id", "text", "pk"], ["workspace_id", "text"], ["site_id", "text"], ["provider_id", "text"],
    ["provider_account_id", "text"], ["mode", "text"], ["provider_event_id", "text"], ["facts_json", "text", "null"],
    ["body_sha256", "text"], ["state", "text"], ["attempts", "integer"], ["next_attempt_at", "bigint"],
    ["last_error", "text", "null"], ["received_at", "bigint"], ["applied_at", "bigint", "null"], ["purged_at", "bigint", "null"],
  ],
  uniques: [["commerce_webhook_inbox_event", ["workspace_id", "mode", "provider_id", "provider_account_id", "provider_event_id"]]],
  checks: [["commerce_webhook_inbox_mode", MODE_CHECK]],
  referencesPayment: false,
};

const OUTBOX: TableSpec = {
  name: "commerce_outbox",
  columns: [
    ["id", "text", "pk"], ["workspace_id", "text"], ["mode", "text"], ["topic", "text"], ["aggregate_id", "text"],
    ["payload_json", "text"], ["created_at", "bigint"], ["published_at", "bigint", "null"],
  ],
  uniques: [],
  checks: [["commerce_outbox_mode", MODE_CHECK]],
  referencesPayment: false,
};

const QUARANTINE: TableSpec = {
  name: "commerce_quarantine",
  columns: [
    ["id", "text", "pk"], ["workspace_id", "text"], ["mode", "text"], ["payment_id", "text", "null"], ["subject", "text"],
    ["reason", "text"], ["evidence_json", "text"], ["created_at", "bigint"], ["resolved_at", "bigint", "null"],
  ],
  uniques: [],
  checks: [["commerce_quarantine_mode", MODE_CHECK]],
  referencesPayment: false,
};

const TABLES: readonly TableSpec[] = [PAYMENTS, ATTEMPTS, REFUNDS, DISPUTES, EVIDENCE, INBOX, OUTBOX, QUARANTINE];

const INDEXES: readonly (readonly [name: string, table: string, columns: readonly string[]])[] = [
  ["commerce_payment_attempts_payment", "commerce_payment_attempts", ["payment_id"]],
  ["commerce_refunds_payment", "commerce_refunds", ["payment_id"]],
  ["commerce_disputes_payment", "commerce_disputes", ["payment_id"]],
  ["commerce_payment_evidence_payment", "commerce_payment_evidence", ["payment_id"]],
  ["commerce_webhook_inbox_due", "commerce_webhook_inbox", ["state", "next_attempt_at"]],
  ["commerce_outbox_pending", "commerce_outbox", ["published_at", "created_at"]],
  ["commerce_quarantine_scope", "commerce_quarantine", ["workspace_id", "mode", "created_at"]],
];

async function createTable(kernel: StorageKernel<unknown>, spec: TableSpec): Promise<void> {
  await kernel.run((db) => {
    // Columns are added in a loop, so Kysely cannot track their names: widen the builder to `string`.
    let builder = db.schema.createTable(spec.name) as unknown as CreateTableBuilder<string, string>;
    for (const [name, type, flag] of spec.columns) {
      builder = builder.addColumn(name, type, (column) => (flag === "pk" ? column.primaryKey() : flag === "null" ? column : column.notNull()));
    }
    for (const [name, columns] of spec.uniques) builder = builder.addUniqueConstraint(name, [...columns]);
    for (const [name, expression] of spec.checks) builder = builder.addCheckConstraint(name, sql.raw(expression));
    if (spec.referencesPayment) {
      builder = builder.addForeignKeyConstraint(`${spec.name}_payment_fk`, ["payment_id"], "commerce_payments", ["id"]);
    }
    return builder.execute();
  });
}

async function up(kernel: StorageKernel<unknown>): Promise<void> {
  for (const spec of TABLES) await createTable(kernel, spec);
  for (const [name, table, columns] of INDEXES) {
    await kernel.run((db) => db.schema.createIndex(name).on(table).columns([...columns]).execute());
  }
}

/** The step, carrying its pinned checksum. @example paymentsLedger({ checksum }) */
export function paymentsLedger(required: { checksum: string }, _optional: Record<string, never> = {}): MigrationStep {
  return { id: PAYMENTS_LEDGER_ID, checksum: required.checksum, up };
}
