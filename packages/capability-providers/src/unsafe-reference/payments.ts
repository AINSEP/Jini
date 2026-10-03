/**
 * UNSAFE REFERENCE IMPLEMENTATION — not production code. See the header
 * comment in `src/unsafe-reference/index.ts` for the full warning; the
 * short version: `createInMemoryPaymentsProvider` deterministically
 * succeeds every charge (rejecting only a non-positive amount) — no
 * idempotency, no replay protection, no real money movement. It exists
 * only to prove `PaymentsProvider` (defined in `../payments.ts`) is
 * implementable and unit-testable. Never wire this into anything that
 * handles real payments.
 *
 * A real adapter (Stripe, a payment processor) implements the same
 * `PaymentsProvider` interface without importing this file.
 */
import type { Charge, ChargeInput, PaymentsProvider } from '../payments.js';

/** Creates the in-memory reference `PaymentsProvider`. No persistence, no real money movement. */
export function createInMemoryPaymentsProvider(_required: Record<string, never>, optional: { now?: () => number } = {}): PaymentsProvider {
  const now = optional.now ?? Date.now;
  const charges = new Map<string, Charge>();
  let nextChargeId = 1;

  return {
    async charge(input: ChargeInput, optional: { description?: string } = {}): Promise<Charge> {
      if (input.amountCents <= 0) {
        throw new Error('amountCents must be positive');
      }
      const record: Charge = {
        id: `charge-${nextChargeId++}`,
        status: 'succeeded',
        amountCents: input.amountCents,
        currency: input.currency,
        customerRef: input.customerRef,
        createdAt: now(),
      };
      charges.set(record.id, record);
      return record;
    },

    async getCharge({ id }: { id: string }): Promise<Charge | null> {
      return charges.get(id) ?? null;
    },

    async refund({ id }: { id: string }): Promise<Charge> {
      const existing = charges.get(id);
      if (!existing) {
        throw new Error(`unknown charge: ${id}`);
      }
      if (existing.status !== 'succeeded') {
        throw new Error(`charge ${id} is not refundable from status "${existing.status}"`);
      }
      const refunded: Charge = { ...existing, status: 'refunded' };
      charges.set(id, refunded);
      return refunded;
    },
  };
}
