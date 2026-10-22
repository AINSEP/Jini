/**
 * @file Evidence: what a provider says happened. Synchronous responses, webhooks and `retrieve`
 * snapshots are all turned into these shapes and go through ONE writer (L3's
 * `applyPaymentEvidence` / `applyRefundEvidence`). Today's code had two paths each incrementing
 * the refunded total (`lipay-plugin.ts:825` and `:456-459`), which is how a refund got counted twice.
 *
 * Evidence is append-only: it is never corrected in place. Statuses are DERIVED from it
 * (`state/derive.ts`), because a refund can go succeeded → failed and a won dispute returns money,
 * so "statuses only move forward" is not true of payments (gap check item 3).
 */
import type { Money } from "../../money/money.js";

/** The provider's view of a payment intent. `unknown` is never evidence: it is OUR state when we could not tell. */
export type ProviderPaymentStatus =
  | "pending"
  | "requires_action"
  | "authorized"
  | "succeeded"
  | "failed"
  | "canceled";

export type ProviderRefundStatus = "pending" | "succeeded" | "failed";

/** `won` returns the money; `lost` keeps it withdrawn. Disputes are their own dimension, not a payment status. */
export type ProviderDisputeStatus = "open" | "won" | "lost";

export type NextActionKind = "none" | "redirect" | "client_action" | "out_of_band";

/** What the shopper must do next. Stored as `next_action_json` so a 3-D Secure step is resumable. */
export type NextAction =
  | { readonly kind: "none" }
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "client_action"; readonly payload: Readonly<Record<string, unknown>> }
  | { readonly kind: "out_of_band"; readonly instructions?: string };

export interface RefundEvidence {
  /** The provider's refund id. Unique per provider account + mode. */
  readonly providerRefundRef: string;
  /** OUR refund id, when the provider echoes it back (Stripe metadata, PayPal `invoice_id`). Matched first. */
  readonly correlationId?: string;
  readonly amount: Money;
  readonly status: ProviderRefundStatus;
}

export interface DisputeEvidence {
  readonly providerDisputeRef: string;
  readonly amount: Money;
  readonly status: ProviderDisputeStatus;
  /** Epoch ms by which evidence must be submitted, when the provider says. */
  readonly dueBy?: number;
}

/** Fee / net / settlement facts (gap check item 5). All optional: most providers report them late. */
export interface SettlementEvidence {
  readonly fee?: Money;
  readonly net?: Money;
  /** Settlement currency and amount when it differs from the charge currency. */
  readonly settlement?: Money;
}

export interface PaymentEvidence {
  /** The provider's payment / intent id. */
  readonly providerRef: string;
  /** OUR payment id, when the provider echoes it. */
  readonly correlationId?: string;
  readonly status: ProviderPaymentStatus;
  /** What the provider authorized/charged, when it says. Checked against our amount; a mismatch is quarantined. */
  readonly amount?: Money;
  /** Captured so far. Absent = equal to `amount` once `succeeded`. */
  readonly captured?: Money;
  readonly next?: NextAction;
  readonly settlement?: SettlementEvidence;
  /** Refunds this evidence carries (a snapshot or a refund webhook). Missing refunds are NEVER deleted. */
  readonly refunds: readonly RefundEvidence[];
  readonly disputes: readonly DisputeEvidence[];
}

/**
 * One verified webhook fact. `providerEventId` is the inbox's dedupe key (scoped by account +
 * mode). `evidence` is absent when the event carries ids only — the ingest worker then calls
 * `retrieve`.
 */
export interface WebhookFact {
  readonly providerEventId: string;
  readonly providerRef: string;
  readonly occurredAt?: number;
  readonly evidence?: PaymentEvidence;
}
