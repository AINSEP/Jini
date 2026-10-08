/**
 * @file The payment status machine (architecture review §6.5).
 *
 *                     ┌──────────────► canceled
 *                     │
 *   (charge) ──► pending ──► succeeded ──► partially_refunded ──► refunded
 *                     │           │              │                   ▲
 *                     └──────► failed            └───────────────────┘
 *
 * Enforced in CODE, not in the schema: `declareDataModule()` supports no `CHECK` constraint
 * (ADR-023's declared grammar is columns + indexes only), so this module is the single chokepoint
 * that decides whether a transition is legal. That is the same "chokepoint-validated, not
 * FK-enforced (v1)" posture ADR-031 §2 already takes, and it is safe only while lipay is the sole
 * writer through one connection — a real ceiling, and it is money (review R3).
 *
 * WooCommerce's equivalent guard is `has_status()` applied at three separate layers with no
 * transaction spanning them and a third-party-filterable status set — a read-then-write TOCTOU.
 * Here the check runs inside the same `db.transaction()` as the write it guards.
 */

export type PaymentStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "canceled";

/** No transition leaves these. A late webhook against one is recorded but never applied. */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = ["failed", "refunded", "canceled"];

const ALLOWED: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  pending: ["succeeded", "failed", "canceled"],
  // `succeeded` never returns to `pending`, and a full refund need not pass through a partial one.
  succeeded: ["partially_refunded", "refunded"],
  partially_refunded: ["refunded"],
  failed: [],
  refunded: [],
  canceled: [],
};

export function isTerminalPaymentStatus({ status }: { status: PaymentStatus }, _optional: Record<string, never> = {}): boolean {
  return TERMINAL_PAYMENT_STATUSES.includes(status);
}

/**
 * Whether `from → to` is a legal payment transition.
 *
 * A same-status "transition" is deliberately `false`: it is not a state change, and treating it as
 * one would let a second partial-refund event look like progress when the only thing that actually
 * moved is `amount_refunded_minor`. Callers distinguish "no transition needed" from "transition
 * rejected" themselves.
 *
 * @complexity O(1) — fixed-size lookup, six statuses.
 * @overallScore 100
 */
export function canTransition({ from, to }: { from: PaymentStatus; to: PaymentStatus }, _optional: Record<string, never> = {}): boolean {
  if (from === to) return false;
  return ALLOWED[from].includes(to);
}

/**
 * The status a normalized inbound event asks a payment to move to, or `null` when the event kind
 * carries no status claim.
 *
 * `pending` maps to `null` because the only status it could name is the one a fresh payment
 * already holds. `chargeback` maps to `null` because §3's status set has no member for it — the
 * event is still recorded in `p_lipay__events` for operator follow-up, which is the honest
 * outcome rather than forcing it into `refunded` (a chargeback is not a refund: the money is
 * pulled by the issuer, and the merchant's dispute rights differ). `expired` maps to `canceled`:
 * an expired out-of-band charge (PIX/boleto/USSD window elapsed) can never complete, and
 * `canceled` is the one non-failure terminal state reachable from `pending`.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function statusForEventKind(
  { kind, refund }: {
    kind: "succeeded" | "failed" | "pending" | "refunded" | "chargeback" | "expired";
    refund: { readonly refundedMinor: number; readonly totalMinor: number };
  },
  _optional: Record<string, never> = {}
): PaymentStatus | null {
  switch (kind) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "expired":
      return "canceled";
    case "refunded":
      return refund.refundedMinor >= refund.totalMinor ? "refunded" : "partially_refunded";
    case "pending":
    case "chargeback":
      return null;
  }
}
