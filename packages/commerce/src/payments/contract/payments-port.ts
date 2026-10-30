/**
 * @file What CONSUMER plugins (donations, Shopify importer, bookings) call. Injected at
 * activation; a consumer never sees a provider, a credential or a ledger row. Replaces `LipayApi`
 * (`lipay-plugin.ts:162`) once L4 implements it.
 *
 * Money-moving calls (`refund`, `capture`, `void`) require a single-use `grant` minted by the
 * approval flow and bound to the exact payment, amount, currency and idempotency key; the kernel
 * re-checks it itself rather than trusting the tool that collected it (design item 8).
 */
import type { Money } from "../../money/money.js";
import type { NextAction } from "./evidence.js";
import type { IntentLine, PaymentError } from "./provider.js";
import type { RiskDecision } from "./risk.js";
import type { PaymentScope } from "./scope.js";
import type { DerivedPaymentStatus, RefundStatus } from "../state/status.js";

export interface PaymentView {
  readonly id: string;
  readonly scope: PaymentScope;
  readonly status: DerivedPaymentStatus;
  readonly amount: Money;
  readonly captured: Money;
  readonly refunded: Money;
  /** Reserved/unknown/pending refunds. */
  readonly refundHeld: Money;
  /** Withdrawn by open or lost disputes. */
  readonly disputed: Money;
  readonly reference: string;
  readonly next: NextAction | null;
}

export interface RefundView {
  readonly id: string;
  readonly paymentId: string;
  readonly amount: Money;
  readonly status: RefundStatus;
}

export type IntentResult =
  | { readonly ok: true; readonly payment: PaymentView; readonly replayed: boolean; readonly risk: RiskDecision }
  | { readonly ok: false; readonly error: PaymentError; readonly payment?: PaymentView };

export type RefundResult =
  | { readonly ok: true; readonly refund: RefundView; readonly payment: PaymentView; readonly replayed: boolean }
  | { readonly ok: false; readonly error: PaymentError };

export interface ProviderSummary {
  readonly id: string;
  readonly displayName: string;
  readonly refunds: "none" | "full" | "partial";
  readonly capture: "auto" | "manual";
}

export interface PaymentsPort {
  createIntent(
    required: { scope: PaymentScope; amount: Money; idempotencyKey: string; reference: string },
    optional?: { captureMode?: "auto" | "manual"; partyId?: string; providerOptions?: Readonly<Record<string, unknown>>; line?: IntentLine }
  ): Promise<IntentResult>;
  refund(
    required: { scope: PaymentScope; paymentId: string; amount: Money; idempotencyKey: string; grant: string },
    optional?: { reason?: string }
  ): Promise<RefundResult>;
  /** Completes a manual-capture authorization (e.g. one held for risk `review`). */
  capture(
    required: { scope: PaymentScope; paymentId: string; amount: Money; idempotencyKey: string; grant: string },
    optional?: Record<string, never>
  ): Promise<IntentResult>;
  /** Releases an uncaptured authorization. */
  void(
    required: { scope: PaymentScope; paymentId: string; idempotencyKey: string; grant: string },
    optional?: Record<string, never>
  ): Promise<IntentResult>;
  getPayment(
    required: { scope: PaymentScope; paymentId: string },
    optional?: Record<string, never>
  ): Promise<PaymentView | null>;
  listProviders(required?: Record<string, never>, optional?: Record<string, never>): readonly ProviderSummary[];
}
