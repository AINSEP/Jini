/**
 * `PaymentsProvider` — a swappable payment-charge port. Speculative
 * port-design exploration (see `source-map.md`) — no OD source; named
 * explicitly in `foundry/docs/jini-port/recon/r5b-consumers-matrix.md` §3.3 as one
 * of the capabilities Zana/Tovu's independent provider layers converge on
 * (alongside auth/storage/db/realtime).
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
  readonly description?: string;
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
  charge(input: ChargeInput): Promise<Charge>;
  /** Looks up a previously created charge by id, or `null` if unknown. */
  getCharge(id: string): Promise<Charge | null>;
  /** Refunds a `'succeeded'` charge. Rejects if the charge is unknown or not in a refundable state. */
  refund(id: string): Promise<Charge>;
}
