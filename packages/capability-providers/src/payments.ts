/**
 * Swappable payment-charge port. See index.ts for capability-provider ownership and adoption scope.
 *
 * This file defines the port's stable interface/type surface and nothing else —
 * it has no imports at all, so a consumer implementing `PaymentsProvider`
 * themselves installs nothing. The one real, production-quality adapter
 * (`StripePaymentsProvider`, against Stripe's Charges/Refunds REST API) lives
 * at the separate `@jini-ai/capability-providers/adapters/stripe` entry point;
 * the non-production in-memory reference stub
 * (`createInMemoryPaymentsProvider`) lives under `src/unsafe-reference/`,
 * exported only from `@jini-ai/capability-providers/unsafe-reference`.
 */

export type ChargeStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export interface ChargeInput {
  readonly amountCents: number;
  readonly currency: string;
  readonly customerRef: string;
}

export interface Charge {
  readonly id: string;
  readonly status: ChargeStatus;
  readonly amountCents: number;
  readonly currency: string;
  readonly customerRef: string;
  readonly createdAt: number;
}

export interface PaymentsProvider {
  /** Creates and (in the reference stub) immediately settles a charge. Rejects on a non-positive amount. */
  charge(input: ChargeInput, optional?: { description?: string }): Promise<Charge>;
  /** Looks up a previously created charge by id, or `null` if unknown. */
  getCharge(required: { id: string }): Promise<Charge | null>;
  /** Refunds a `'succeeded'` charge. Rejects if the charge is unknown or not in a refundable state. */
  refund(required: { id: string }): Promise<Charge>;
}
