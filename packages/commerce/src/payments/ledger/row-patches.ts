import { type PaymentRecord, type AttemptRecord, type RefundRecord, type DisputeRecord } from './row-records.js';
import { type PaymentsTable, type AttemptsTable, type RefundsTable, type DisputesTable } from './row-tables.js';
import { encodeColumns } from './rows.js';
// ---------------------------------------------------------------------------------------------
// Patches: the fields an update may change, mapped to their columns.

export type PaymentPatch = Partial<
  Pick<
    PaymentRecord,
    | "partyId" | "capturedMinor" | "intentStatus" | "refundedMinor" | "refundHeldMinor" | "disputedMinor" | "status"
    | "providerRef" | "nextActionJson" | "feeCurrency" | "feeMinor" | "netCurrency" | "netMinor"
    | "settlementCurrency" | "settlementMinor"
  >
> & { readonly updatedAt: number };

export type AttemptPatch = Partial<Pick<AttemptRecord, "outcome" | "errorCode" | "errorMessage" | "dispatchJson" | "recoveryAttempts" | "recoveryClaimUntil">> & { readonly updatedAt: number };
export type RefundPatch = Partial<Pick<RefundRecord, "status" | "providerRefundRef" | "reason">> & { readonly updatedAt: number };
export type DisputePatch = Partial<Pick<DisputeRecord, "status" | "amountMinor" | "dueBy">> & { readonly updatedAt: number };

export const PAYMENT_PATCH_COLUMNS: Readonly<Record<keyof PaymentPatch, keyof PaymentsTable>> = {
  partyId: "party_id",
  capturedMinor: "captured_minor",
  intentStatus: "intent_status",
  refundedMinor: "refunded_minor",
  refundHeldMinor: "refund_held_minor",
  disputedMinor: "disputed_minor",
  status: "status",
  providerRef: "provider_ref",
  nextActionJson: "next_action_json",
  feeCurrency: "fee_currency",
  feeMinor: "fee_minor",
  netCurrency: "net_currency",
  netMinor: "net_minor",
  settlementCurrency: "settlement_currency",
  settlementMinor: "settlement_minor",
  updatedAt: "updated_at",
};

export const ATTEMPT_PATCH_COLUMNS: Readonly<Record<keyof AttemptPatch, keyof AttemptsTable>> = {
  dispatchJson: "dispatch_json",
  recoveryAttempts: "recovery_attempts",
  recoveryClaimUntil: "recovery_claim_until",
  outcome: "outcome",
  errorCode: "error_code",
  errorMessage: "error_message",
  updatedAt: "updated_at",
};

export const REFUND_PATCH_COLUMNS: Readonly<Record<keyof RefundPatch, keyof RefundsTable>> = {
  status: "status",
  providerRefundRef: "provider_refund_ref",
  reason: "reason",
  updatedAt: "updated_at",
};

export const DISPUTE_PATCH_COLUMNS: Readonly<Record<keyof DisputePatch, keyof DisputesTable>> = {
  status: "status",
  amountMinor: "amount_minor",
  dueBy: "due_by",
  updatedAt: "updated_at",
};

/**
 * The column→value `set` for a patch, integers encoded: only the keys the patch actually carries,
 * so an omitted (or `undefined`) field is left alone rather than written as NULL. `columns` is the
 * allow-list: a key it does not name (a scope column, the version, a typo smuggled past the type)
 * throws a `TypeError` instead of being written. Both adapters build every patch through this.
 */
export function patchColumns<P extends object>(
  { patch, columns }: { patch: P; columns: Readonly<Record<keyof P, string>> },
  _optional: Record<string, never> = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(columns, key)) throw new TypeError(`ledger: ${key} is not a patchable field`);
    if (value !== undefined) out[columns[key as keyof P]] = value;
  }
  return encodeColumns(out);
}
