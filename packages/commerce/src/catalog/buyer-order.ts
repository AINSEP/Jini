/** Buyer reads intentionally omit scope, provider references and resumable checkout capabilities. */
import type { CommerceOrderView } from "./plugin-server.js";
import type { CommerceOrderRecord } from "./types.js";
import type { PaymentView } from "../payments/contract/payments-port.js";
import type { Money } from "../money/money.js";

export interface CommerceBuyerOrder {
  order: Pick<CommerceOrderRecord, "id" | "status" | "totalAmount" | "placedAt" | "version">;
  payment: Pick<PaymentView, "status" | "amount" | "captured" | "refunded"> | null;
}

const copyMoney = (value: Money): Money => ({ minorUnits: value.minorUnits, currency: value.currency });

/** Explicit allowlist, so future internal fields cannot silently become buyer data. O(1), no I/O. */
export function toCommerceBuyerOrder({ view }: { view: CommerceOrderView }, _optional = {}): CommerceBuyerOrder {
  const { order, payment } = view;
  return {
    order: { id: order.id, status: order.status, totalAmount: copyMoney(order.totalAmount), placedAt: order.placedAt, version: order.version },
    payment: payment ? { status: payment.status, amount: copyMoney(payment.amount), captured: copyMoney(payment.captured), refunded: copyMoney(payment.refunded) } : null,
  };
}

/** Confirmation follows owned ledger truth; a return/cancel URL is never payment evidence. O(1), no I/O. */
export function commerceBuyerStatus({ view }: { view: CommerceBuyerOrder }, _optional = {}): { title: string; message: string } {
  if (view.order.status === "paid") return { title: "Payment confirmed", message: "Your payment is confirmed. Thank you for your purchase." };
  if (view.order.status === "failed") return { title: "Payment unsuccessful", message: "This order has not been paid. Return to the shop for help with your purchase." };
  if (view.order.status === "canceled") return { title: "Order canceled", message: "This order was canceled. Return to the shop when you are ready." };
  return { title: "Payment status pending", message: "Your payment has not been confirmed yet. Check this same order again shortly; returning from checkout does not confirm payment." };
}
