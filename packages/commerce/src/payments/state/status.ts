/**
 * @file The payments status model (gap check item 3). Evidence is append-only; each RECORD's
 * status merges forward along a transition table; the PAYMENT's status is DERIVED from its intent,
 * refunds and disputes — never stored as the source of truth.
 *
 * Why not "statuses only move forward" for the payment: a Stripe refund can go succeeded → failed
 * (returning money to the merchant), and a won dispute returns withdrawn money. A forward-only
 * payment status could not express either. Each merge function below takes the CURRENT and the
 * INCOMING status and returns the one to keep, so reversed delivery order and stale `retrieve`
 * snapshots can never regress a record.
 *
 * Replaces `state-machine.ts` once `lipay-plugin.ts` is split (L4).
 */
import type { ProviderDisputeStatus, ProviderPaymentStatus } from "../contract/evidence.js";

/** A payment intent's own status. `unknown` is ours: a dispatched call whose outcome we could not tell. */
export type IntentStatus = ProviderPaymentStatus | "unknown";

/** `reserved` = held by us before dispatch; `unknown` = dispatched, outcome not known. Both still hold money. */
export type RefundStatus = "reserved" | "unknown" | "pending" | "succeeded" | "failed";

export type DisputeStatus = ProviderDisputeStatus;

export type DerivedPaymentStatus = IntentStatus | "partially_refunded" | "refunded";

/** Where each status may go next. Absent targets are ignored (stale or reordered evidence). */
const INTENT_NEXT: Readonly<Record<IntentStatus, readonly IntentStatus[]>> = {
  unknown: ["requires_action", "pending", "authorized", "succeeded", "failed", "canceled"],
  requires_action: ["pending", "authorized", "succeeded", "failed", "canceled"],
  pending: ["authorized", "succeeded", "failed", "canceled"],
  authorized: ["succeeded", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
};

// `succeeded → failed` is the Stripe late refund failure; nothing leaves `failed`.
const REFUND_NEXT: Readonly<Record<RefundStatus, readonly RefundStatus[]>> = {
  reserved: ["unknown", "pending", "succeeded", "failed"],
  unknown: ["pending", "succeeded", "failed"],
  pending: ["succeeded", "failed"],
  succeeded: ["failed"],
  failed: [],
};

const DISPUTE_NEXT: Readonly<Record<DisputeStatus, readonly DisputeStatus[]>> = {
  open: ["won", "lost"],
  won: [],
  lost: [],
};

function merge<S extends string>(table: Readonly<Record<S, readonly S[]>>, current: S, incoming: S): S {
  return table[current].includes(incoming) ? incoming : current;
}

/** The intent status to keep after `incoming` evidence. */
export function mergeIntentStatus(
  { current, incoming }: { current: IntentStatus; incoming: IntentStatus },
  _optional: Record<string, never> = {}
): IntentStatus {
  return merge(INTENT_NEXT, current, incoming);
}

/** The refund status to keep after `incoming` evidence. */
export function mergeRefundStatus(
  { current, incoming }: { current: RefundStatus; incoming: RefundStatus },
  _optional: Record<string, never> = {}
): RefundStatus {
  return merge(REFUND_NEXT, current, incoming);
}

/** The dispute status to keep after `incoming` evidence. */
export function mergeDisputeStatus(
  { current, incoming }: { current: DisputeStatus; incoming: DisputeStatus },
  _optional: Record<string, never> = {}
): DisputeStatus {
  return merge(DISPUTE_NEXT, current, incoming);
}

export interface RefundTotals {
  /** Sum of succeeded refunds — THE refunded total. Never an increment (bugs B1/B2). */
  readonly succeeded: number;
  /** Reserved + unknown + pending: money promised back but not yet confirmed. */
  readonly held: number;
}

/** Derived refund totals over one payment's refund rows. */
export function refundTotals(
  { refunds }: { refunds: readonly { readonly status: RefundStatus; readonly amountMinor: number }[] },
  _optional: Record<string, never> = {}
): RefundTotals {
  let succeeded = 0;
  let held = 0;
  for (const refund of refunds) {
    if (refund.status === "succeeded") succeeded += refund.amountMinor;
    else if (refund.status !== "failed") held += refund.amountMinor;
  }
  return { succeeded, held };
}

/** Money currently withdrawn by disputes: open and lost ones. A won dispute returns its amount. */
export function disputedMinor(
  { disputes }: { disputes: readonly { readonly status: DisputeStatus; readonly amountMinor: number }[] },
  _optional: Record<string, never> = {}
): number {
  return disputes.reduce((sum, dispute) => (dispute.status === "won" ? sum : sum + dispute.amountMinor), 0);
}

/**
 * The payment's status, derived. Refunds only shape a SUCCEEDED intent; any other intent status
 * is reported as is. `capturedMinor` is the refund base, not the requested amount, so a partial
 * capture refunded in full reads `refunded`.
 */
export function derivePaymentStatus(
  { intent, capturedMinor, refundedMinor }: { intent: IntentStatus; capturedMinor: number; refundedMinor: number },
  _optional: Record<string, never> = {}
): DerivedPaymentStatus {
  if (intent !== "succeeded" || refundedMinor <= 0) return intent;
  return refundedMinor >= capturedMinor ? "refunded" : "partially_refunded";
}

/** What may still be refunded: captured − succeeded − held. Never negative. */
export function refundableMinor(
  { capturedMinor, totals }: { capturedMinor: number; totals: RefundTotals },
  _optional: Record<string, never> = {}
): number {
  return Math.max(0, capturedMinor - totals.succeeded - totals.held);
}
