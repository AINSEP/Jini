import { nowIso, type UUID } from "@jini-ai/core/primitives";
import type { IntentResult, PaymentsPort } from "../payments/contract/payments-port.js";
import type { PaymentScope } from "../payments/contract/scope.js";
import { CommerceCheckoutValidationError } from "./errors.js";
import { loadPayableOrder, type LoadPayableOrderDeps } from "./load-payable-order.js";
import type { CommerceOrderPaymentRepoPort, CommercePriceProviderRefRepoPort } from "./ports.js";
import { settleOrderPayment, type SettleOrderPaymentDeps } from "./settle-order-payment.js";

export interface PayOrderDeps extends LoadPayableOrderDeps {
  priceRefs: CommercePriceProviderRefRepoPort; orderPayments: CommerceOrderPaymentRepoPort;
  payments: PaymentsPort; settle: SettleOrderPaymentDeps;
}
/** Preserve the kernel's payment, replay, risk and rejection contracts verbatim. */
export type PayOrderResult = IntentResult;

/**
 * Reserve the order's scope before dispatch; the kernel owns idempotency and settlement verifies payment truth.
 * @returns The unchanged intent result, after binding any payment and attempting synchronous settlement.
 * @throws {CommerceCheckoutValidationError} Invalid order, conflicting reservation, or missing/conflicting binding.
 * Storage failures propagate so a retry replays the same payment and finishes binding.
 */
export async function payOrder({ deps, input }: {
  deps: PayOrderDeps; input: { workspaceId: UUID; orderId: UUID; scope: PaymentScope };
}, _optional: Record<string, never> = {}): Promise<PayOrderResult> {
  const { order, item } = await loadPayableOrder({ deps, input });
  const reserved = await deps.orderPayments.reserve({ ...input.scope, orderId: order.id, amount: order.totalAmount,
    createdAt: nowIso({ clock: deps.settle.clock }) });
  if (reserved === "conflict") throw new CommerceCheckoutValidationError({ message: "order already reserved for another scope" });
  const { workspaceId, providerId, providerAccountId, mode } = input.scope;
  const providerPriceRef = await deps.priceRefs.find({ workspaceId, priceId: item.priceId, providerId, providerAccountId, mode });
  const result = await deps.payments.createIntent({ scope: input.scope, amount: order.totalAmount, idempotencyKey: `order:${order.id}`, reference: order.id },
    { partyId: order.memberId, line: { description: item.description, quantity: item.quantity, unitAmount: item.unitAmount,
      ...(providerPriceRef === null ? {} : { providerPriceRef }) } });
  if (result.payment) {
    const bound = await deps.orderPayments.bind({ workspaceId, orderId: order.id, paymentId: result.payment.id });
    if (bound === "conflict" || bound === "not_found") throw new CommerceCheckoutValidationError({ message: `order payment association ${bound}` });
    await settleOrderPayment({ deps: deps.settle, input: { workspaceId, mode, paymentId: result.payment.id, reference: order.id } });
  }
  return result;
}
