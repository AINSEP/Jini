import { createHash } from "node:crypto";

import { type Kysely, sql } from "kysely";
import type { MigrationStep } from "@jini-ai/db/migrate";
import type { StorageKernel } from "@jini-ai/db/kernel";

/**
 * @file Payments ledger step 5 (ADR-066; review R2-F7): carries the retired lipay runtime's tables
 * (`p_lipay__payments`, `p_lipay__refunds`, `p_lipay__events`, removed from Jini in 3e0122f4) into
 * the kernel ledger, so a site that ran lipay keeps its idempotency keys, refund holds and event
 * history reachable from the new `commerce_*` tables.
 *
 * - No-op when the legacy payments table is absent (a site that never ran lipay), and when it is
 *   empty. The legacy tables are only READ, never altered or dropped: they stay the record of
 *   anything the new schema cannot hold (see {@link readLegacyLipayHistory}).
 * - The legacy rows carry a workspace and a provider id but no site, provider account or mode, and
 *   guessing them would file money under the wrong account. So the host names them explicitly
 *   (`legacyLipay` on `migrateCommercePayments`). Rows present without a mapping, or a row the
 *   mapping declines (`null`), fail the step: its transaction rolls back and it reruns at next boot.
 * - Idempotent: ids are kept and every insert is `ON CONFLICT DO NOTHING`, so a row already in the
 *   ledger (same id or same idempotency / provider-event key) is left as it is.
 *
 * Column mapping. Payments: `status` becomes the kernel's intent status plus derived status
 * (`partially_refunded`/`refunded` were charges that succeeded); `captured_minor` is the amount for
 * a charge that succeeded, else 0; `refunded_minor` is `amount_refunded_minor`; `refund_held_minor`
 * is the sum of the payment's still-open refunds (the legacy runtime reserved `pending` refunds
 * against the refundable balance the same way); a status the kernel does not know becomes `unknown`
 * for the reconciler. A NULL `reference` (the kernel requires one) becomes `''`. Refunds keep their
 * id, key, provider ref, amount, reason and status (`pending`/`succeeded`/`failed`; anything else is
 * `unknown`, which also holds money); a refund whose payment was not imported stays legacy-only.
 * Events become webhook-inbox rows keyed by their provider event id (so a redelivery is still
 * deduplicated), `applied` when the legacy runtime applied them and `dead` (terminal, never
 * retried) when it only recorded them; `body_sha256` is the hash of the stored raw payload.
 *
 * Not representable in the kernel schema, served by {@link readLegacyLipayHistory} from the
 * retained legacy tables instead: a payment's `last_error`, and an event's `kind`, `occurred_at`,
 * payment link and verbatim `payload` (the inbox stores facts, not bodies).
 *
 * Frozen once shipped: its checksum is pinned in `checksums.ts`.
 */
export const LEGACY_LIPAY_IMPORT_ID = "0005_legacy_lipay_import";

const LEGACY = { payments: "p_lipay__payments", refunds: "p_lipay__refunds", events: "p_lipay__events" } as const;

/** Where a legacy workspace's rows for one provider belong in the kernel ledger. */
export interface LegacyLipayScope {
  readonly siteId: string;
  readonly providerAccountId: string;
  readonly mode: "test" | "live";
}

/** The host's explicit mapping; `null` refuses the rows (the step then fails rather than guess). */
export type LegacyLipayMapping = (required: { workspaceId: string; providerId: string }) => LegacyLipayScope | null;

type Row = Record<string, unknown>;
// The legacy tables are not part of the ledger's typed schema: address them as plain rows.
type AnyDb = Kysely<Record<string, Row>>;

interface LegacyPayment {
  readonly id: string;
  readonly workspace_id: string;
  readonly provider_id: string;
  readonly idempotency_key: string;
  readonly status: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly amount_refunded_minor: number;
  readonly provider_ref: string | null;
  readonly reference: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface LegacyRefund {
  readonly id: string;
  readonly workspace_id: string;
  readonly payment_id: string;
  readonly idempotency_key: string;
  readonly provider_ref: string | null;
  readonly amount_minor: number;
  readonly currency: string;
  readonly status: string;
  readonly reason: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface LegacyEvent {
  readonly id: string;
  readonly workspace_id: string;
  readonly provider_id: string;
  readonly provider_event_id: string;
  readonly payment_id: string | null;
  readonly kind: string;
  readonly occurred_at: number;
  readonly received_at: number;
  readonly applied: number;
  readonly payload: string;
}

/** Legacy payment status → kernel intent status + derived status + whether the money was captured. */
const PAYMENT_STATUS: Readonly<Record<string, readonly [intent: string, status: string, captured: boolean]>> = {
  pending: ["pending", "pending", false],
  succeeded: ["succeeded", "succeeded", true],
  partially_refunded: ["succeeded", "partially_refunded", true],
  refunded: ["succeeded", "refunded", true],
  failed: ["failed", "failed", false],
  canceled: ["canceled", "canceled", false],
};
const UNKNOWN_PAYMENT = ["unknown", "unknown", false] as const;

const REFUND_STATUS: Readonly<Record<string, string>> = { pending: "pending", succeeded: "succeeded", failed: "failed" };
/** Refund statuses whose money is still held against the payment's refundable balance. */
const HELD = new Set(["pending", "unknown"]);

const minor = (value: unknown): number => Number(value);

async function tableNames(kernel: StorageKernel<unknown>): Promise<ReadonlySet<string>> {
  const tables = await kernel.run((db) => db.introspection.getTables());
  return new Set(tables.map((table) => table.name));
}

async function readAll<T>(required: { kernel: StorageKernel<unknown>; table: string; present: ReadonlySet<string> }): Promise<T[]> {
  if (!required.present.has(required.table)) return [];
  const result = await required.kernel.run((db) => sql<T>`SELECT * FROM ${sql.table(required.table)} ORDER BY id`.execute(db));
  return [...result.rows];
}

function scopeFor(required: { mapping: LegacyLipayMapping; workspaceId: string; providerId: string }): LegacyLipayScope {
  const scope = required.mapping({ workspaceId: required.workspaceId, providerId: required.providerId });
  if (scope === null) {
    throw new Error(`commerce payments ${LEGACY_LIPAY_IMPORT_ID}: no legacy lipay mapping for workspace '${required.workspaceId}' provider '${required.providerId}'`);
  }
  return scope;
}

function refundStatus(status: string): string {
  return REFUND_STATUS[status] ?? "unknown";
}

/** A payment's key across workspaces: the legacy runtime scoped every read by workspace + id. */
const paymentKey = (workspaceId: string, paymentId: string): string => JSON.stringify([workspaceId, paymentId]);

function heldByPayment(refunds: readonly LegacyRefund[]): Map<string, number> {
  const held = new Map<string, number>();
  for (const refund of refunds) {
    if (!HELD.has(refundStatus(refund.status))) continue;
    const key = paymentKey(refund.workspace_id, refund.payment_id);
    held.set(key, (held.get(key) ?? 0) + minor(refund.amount_minor));
  }
  return held;
}

function paymentRow(required: { payment: LegacyPayment; scope: LegacyLipayScope; heldMinor: number }): Row {
  const { payment, scope } = required;
  const [intent, status, captured] = PAYMENT_STATUS[payment.status] ?? UNKNOWN_PAYMENT;
  const amount = minor(payment.amount_minor);
  return {
    id: payment.id, workspace_id: payment.workspace_id, site_id: scope.siteId, provider_id: payment.provider_id,
    provider_account_id: scope.providerAccountId, mode: scope.mode, idempotency_key: payment.idempotency_key,
    reference: payment.reference ?? "", party_id: null, currency: payment.currency, amount_minor: amount,
    captured_minor: captured ? amount : 0, intent_status: intent, refunded_minor: minor(payment.amount_refunded_minor),
    refund_held_minor: required.heldMinor, disputed_minor: 0, status, provider_ref: payment.provider_ref,
    next_action_json: null, fee_currency: null, fee_minor: null, net_currency: null, net_minor: null,
    settlement_currency: null, settlement_minor: null, version: 1,
    created_at: minor(payment.created_at), updated_at: minor(payment.updated_at),
  };
}

function refundRow(required: { refund: LegacyRefund; payment: Row }): Row {
  const { refund, payment } = required;
  return {
    id: refund.id, payment_id: refund.payment_id, workspace_id: refund.workspace_id, site_id: payment.site_id,
    provider_id: payment.provider_id, provider_account_id: payment.provider_account_id, mode: payment.mode,
    idempotency_key: refund.idempotency_key, provider_refund_ref: refund.provider_ref, currency: refund.currency,
    amount_minor: minor(refund.amount_minor), status: refundStatus(refund.status), reason: refund.reason,
    created_at: minor(refund.created_at), updated_at: minor(refund.updated_at),
  };
}

function inboxRow(required: { event: LegacyEvent; scope: LegacyLipayScope }): Row {
  const { event, scope } = required;
  const applied = minor(event.applied) === 1;
  const receivedAt = minor(event.received_at);
  return {
    id: event.id, workspace_id: event.workspace_id, site_id: scope.siteId, provider_id: event.provider_id,
    provider_account_id: scope.providerAccountId, mode: scope.mode, provider_event_id: event.provider_event_id,
    facts_json: null, body_sha256: createHash("sha256").update(event.payload, "utf8").digest("hex"),
    state: applied ? "applied" : "dead", attempts: 0, next_attempt_at: receivedAt,
    last_error: applied ? null : "legacy lipay event: recorded, never applied", received_at: receivedAt,
    applied_at: applied ? receivedAt : null, purged_at: null,
  };
}

async function insertRows(required: { kernel: StorageKernel<unknown>; table: string; rows: readonly Row[] }): Promise<void> {
  for (const row of required.rows) {
    await required.kernel.run((db) => (db as unknown as AnyDb).insertInto(required.table).values(row).onConflict((oc) => oc.doNothing()).execute());
  }
}

/** The ledger payments (by id) that were imported from, or already held, the legacy ids. */
async function importedPayments(kernel: StorageKernel<unknown>): Promise<Map<string, Row>> {
  const rows = await kernel.run((db) => (db as unknown as AnyDb).selectFrom("commerce_payments").selectAll().execute());
  return new Map(rows.map((row) => [String(row.id), row]));
}

async function importLegacy(required: { kernel: StorageKernel<unknown>; mapping: LegacyLipayMapping; present: ReadonlySet<string>; payments: readonly LegacyPayment[] }): Promise<void> {
  const { kernel, mapping, present } = required;
  const refunds = await readAll<LegacyRefund>({ kernel, table: LEGACY.refunds, present });
  const events = await readAll<LegacyEvent>({ kernel, table: LEGACY.events, present });
  const held = heldByPayment(refunds);
  const paymentRows = required.payments.map((payment) => paymentRow({
    payment, scope: scopeFor({ mapping, workspaceId: payment.workspace_id, providerId: payment.provider_id }), heldMinor: held.get(paymentKey(payment.workspace_id, payment.id)) ?? 0,
  }));
  await insertRows({ kernel, table: "commerce_payments", rows: paymentRows });
  // Only a payment the ledger now holds under the same workspace can take children (the scoped FK).
  const ledger = await importedPayments(kernel);
  const refundRows = refunds.flatMap((refund) => {
    const payment = ledger.get(refund.payment_id);
    return payment !== undefined && payment.workspace_id === refund.workspace_id ? [refundRow({ refund, payment })] : [];
  });
  await insertRows({ kernel, table: "commerce_refunds", rows: refundRows });
  const inboxRows = events.map((event) => inboxRow({ event, scope: scopeFor({ mapping, workspaceId: event.workspace_id, providerId: event.provider_id }) }));
  await insertRows({ kernel, table: "commerce_webhook_inbox", rows: inboxRows });
}

async function up(required: { kernel: StorageKernel<unknown>; mapping: LegacyLipayMapping | undefined }): Promise<void> {
  const { kernel, mapping } = required;
  const present = await tableNames(kernel);
  const payments = await readAll<LegacyPayment>({ kernel, table: LEGACY.payments, present });
  if (payments.length === 0) return;
  if (mapping === undefined) {
    throw new Error(
      `commerce payments ${LEGACY_LIPAY_IMPORT_ID}: ${LEGACY.payments} holds ${payments.length} row(s); pass \`legacyLipay\` to migrateCommercePayments to name their site, provider account and mode`
    );
  }
  await importLegacy({ kernel, mapping, present, payments });
}

/**
 * The step, carrying its pinned checksum.
 * @param optional.mapping - The host's legacy scope mapping; required only when legacy rows exist.
 * @example legacyLipayImport({ checksum }, { mapping: () => ({ siteId: "site", providerAccountId: "acct", mode: "live" }) })
 */
export function legacyLipayImport(required: { checksum: string }, optional: { mapping?: LegacyLipayMapping } = {}): MigrationStep {
  return { id: LEGACY_LIPAY_IMPORT_ID, checksum: required.checksum, up: (kernel) => up({ kernel, mapping: optional.mapping }) };
}

/** What the kernel schema cannot hold about a migrated lipay payment, read from the retained legacy tables. */
export interface LegacyLipayHistory {
  readonly lastError: string | null;
  readonly events: readonly {
    readonly id: string;
    readonly providerEventId: string;
    readonly kind: string;
    readonly occurredAt: number;
    readonly receivedAt: number;
    readonly applied: boolean;
    readonly payload: string;
  }[];
}

/**
 * The compat read path for the columns step 5 could not map: a legacy payment's `last_error` and its
 * events' kind, timing, applied flag and verbatim payload. `null` when the legacy tables are absent
 * or hold no such payment in `workspaceId`.
 * @example await readLegacyLipayHistory({ kernel, workspaceId, paymentId })
 */
export async function readLegacyLipayHistory(
  required: { kernel: StorageKernel<unknown>; workspaceId: string; paymentId: string },
  _optional: Record<string, never> = {}
): Promise<LegacyLipayHistory | null> {
  const { kernel, workspaceId, paymentId } = required;
  const present = await tableNames(kernel);
  if (!present.has(LEGACY.payments)) return null;
  const payment = await kernel.run((db) =>
    (db as unknown as AnyDb).selectFrom(LEGACY.payments).select("last_error").where("workspace_id", "=", workspaceId).where("id", "=", paymentId).executeTakeFirst()
  );
  if (payment === undefined) return null;
  const events = present.has(LEGACY.events)
    ? await kernel.run((db) =>
      (db as unknown as AnyDb).selectFrom(LEGACY.events).selectAll().where("workspace_id", "=", workspaceId).where("payment_id", "=", paymentId).orderBy("occurred_at").orderBy("id").execute()
    )
    : [];
  return {
    lastError: payment.last_error as string | null,
    events: events.map((event) => ({
      id: String(event.id), providerEventId: String(event.provider_event_id), kind: String(event.kind),
      occurredAt: minor(event.occurred_at), receivedAt: minor(event.received_at), applied: minor(event.applied) === 1, payload: String(event.payload),
    })),
  };
}
