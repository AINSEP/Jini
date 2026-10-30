import { nowIso, type Clock as ClockPort } from "@jini-ai/core/primitives";
import type { PaymentsAlertPort } from "../payments/contract/alerts.js";
import type { PaymentsPort, PaymentView } from "../payments/contract/payments-port.js";
import { sameScope, type PaymentMode, type PaymentScope } from "../payments/contract/scope.js";
import type { CommerceOrderPaymentRecord, CommerceOrderPaymentRepoPort, CommerceOrderRepoPort } from "./ports.js";
import type { CommerceOrderRecord } from "./types.js";

export interface SettleOrderPaymentDeps {
  orders: CommerceOrderRepoPort; orderPayments: CommerceOrderPaymentRepoPort; payments: PaymentsPort;
  alerts: PaymentsAlertPort; clock: ClockPort;
}
export type SettleOutcome = "paid" | "already_paid" | "not_ours" | "not_succeeded" | "blocked";
interface SettlementRequired {
  deps: SettleOrderPaymentDeps;
  input: { workspaceId: string; mode: PaymentMode; paymentId: string; reference: string };
}

/** Acknowledged mismatches remain visible to operators; storage and alert failures must redeliver. */
async function blocked({ deps, input, reason }: SettlementRequired & { reason: string }, _optional: Record<string, never> = {}): Promise<"blocked"> {
  await deps.alerts.raise({ alert: { kind: "fulfillment-blocked", workspaceId: input.workspaceId, mode: input.mode,
    paymentId: input.paymentId, detail: `order ${input.reference}: ${reason}` } });
  return "blocked";
}

/** Compare ledger truth with the reservation and order, including ports that return a foreign row. */
function settlementProblem({ association, order, payment, input }: {
  association: CommerceOrderPaymentRecord; order: CommerceOrderRecord | null; payment: PaymentView;
  input: SettlementRequired["input"];
}, _optional: Record<string, never> = {}): string | null {
  if (!order) return "order missing";
  if (!sameScope({ a: association, b: payment.scope })) return "payment scope differs";
  const identityMatches = [order.workspaceId === input.workspaceId, association.workspaceId === input.workspaceId,
    order.id === input.reference, association.orderId === order.id, payment.reference === order.id, order.provider === association.providerId];
  if (identityMatches.includes(false)) return "order identity or ownership differs";
  const amounts = [association.amount, payment.amount, payment.captured];
  return amounts.every(amount => amount.minorUnits === order.totalAmount.minorUnits && amount.currency === order.totalAmount.currency)
    ? null : "amount or currency differs";
}

/** Binding precedes fulfillment, so concurrent payments cannot both fulfill the same reservation. */
async function finishSettlement({ deps, input, association }: SettlementRequired & {
  association: CommerceOrderPaymentRecord;
}, _optional: Record<string, never> = {}): Promise<SettleOutcome> {
  const key = { workspaceId: input.workspaceId, orderId: input.reference };
  if (association.paymentId === null) {
    const bound = await deps.orderPayments.bind({ ...key, paymentId: input.paymentId });
    if (bound === "conflict" || bound === "not_found") return blocked({ deps, input, reason: `association ${bound}` });
  }
  const result = await deps.orders.markPaid({ ...key, at: nowIso({ clock: deps.clock }) });
  if (result === "not_pending" || result === "not_found") return blocked({ deps, input, reason: `order ${result}` });
  return result;
}

/** Verify the reserved scope and exact captured total before fulfilling; throws preserve redelivery. */
export async function settleOrderPayment({ deps, input }: SettlementRequired, _optional: Record<string, never> = {}): Promise<SettleOutcome> {
  const association = await deps.orderPayments.findByOrder({ workspaceId: input.workspaceId, orderId: input.reference });
  if (!association) {
    const order = await deps.orders.findById({ workspaceId: input.workspaceId, id: input.reference });
    return order ? blocked({ deps, input, reason: "association missing" }) : "not_ours";
  }
  if (association.mode !== input.mode) return blocked({ deps, input, reason: "message mode differs" });
  const { workspaceId, siteId, providerId, providerAccountId, mode } = association;
  const scope: PaymentScope = { workspaceId, siteId, providerId, providerAccountId, mode };
  const payment = await deps.payments.getPayment({ scope, paymentId: input.paymentId });
  if (!payment) return blocked({ deps, input, reason: "payment missing" });
  if (payment.status !== "succeeded") return "not_succeeded";
  if (payment.id !== input.paymentId) return blocked({ deps, input, reason: "payment identity differs" });
  if (association.paymentId !== null && association.paymentId !== payment.id) return blocked({ deps, input, reason: "second payment" });
  const order = await deps.orders.findById({ workspaceId: input.workspaceId, id: input.reference });
  const problem = settlementProblem({ association, order, payment, input });
  if (problem) return blocked({ deps, input, reason: problem });
  return finishSettlement({ deps, input, association });
}
