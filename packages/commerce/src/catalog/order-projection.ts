import type { PaymentsOutboxMessage } from "../payments/ingest/outbox-relay.js";
import { settleOrderPayment, type SettleOrderPaymentDeps, type SettleOutcome } from "./settle-order-payment.js";

/** Route committed successes through the same association checks used by synchronous checkout. */
export function createOrderPaymentProjector({ deps }: { deps: SettleOrderPaymentDeps }, _optional: Record<string, never> = {}): {
  handle(required: { message: PaymentsOutboxMessage }, optional?: Record<string, never>): Promise<SettleOutcome | "ignored">;
} {
  return {
    async handle({ message }, _optional = {}) {
      if (message.topic !== "payment.succeeded" || typeof message.payload.reference !== "string") return "ignored";
      return settleOrderPayment({ deps, input: { workspaceId: message.workspaceId, mode: message.mode,
        paymentId: message.aggregateId, reference: message.payload.reference } });
    },
  };
}
