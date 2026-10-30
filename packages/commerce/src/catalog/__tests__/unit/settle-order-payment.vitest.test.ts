import { expect, it, vi } from "vitest";
import type { PaymentView } from "../../../payments/contract/payments-port.js";
import type { CommerceOrderPaymentRecord } from "../../ports.js";
import type { CommerceOrderRecord } from "../../types.js";
import { settleOrderPayment, type SettleOrderPaymentDeps } from "../../settle-order-payment.js";

const at = "2026-10-29T00:00:00.000Z";
const input = { workspaceId: "ws", mode: "test" as const, paymentId: "payment", reference: "order" };
const scope = { workspaceId: "ws", siteId: "site", providerId: "regional-pay", providerAccountId: "account", mode: "test" as const };
const amount = { minorUnits: 123, currency: "USD" };
const unused = async () => { throw new Error("unexpected operation"); };
function world() {
  const state = {
    association: { ...scope, orderId: "order", amount, paymentId: null, createdAt: at } as CommerceOrderPaymentRecord | null,
    order: { id: "order", workspaceId: "ws", memberId: "member", status: "pending", totalAmount: amount,
      provider: scope.providerId, placedAt: at, createdAt: at, updatedAt: at, version: 1 } as CommerceOrderRecord | null,
    payment: { id: "payment", scope, reference: "order", status: "succeeded", amount, captured: amount,
      refunded: { ...amount, minorUnits: 0 }, refundHeld: { ...amount, minorUnits: 0 }, disputed: { ...amount, minorUnits: 0 }, next: null } as PaymentView | null,
  };
  const orders = { findById: vi.fn(async () => state.order), listItems: unused, placeOrder: unused,
    markPaid: vi.fn<SettleOrderPaymentDeps["orders"]["markPaid"]>(async () => "paid") };
  const orderPayments = { findByOrder: vi.fn(async () => state.association), reserve: unused,
    bind: vi.fn<SettleOrderPaymentDeps["orderPayments"]["bind"]>(async () => "bound") };
  const payments = { getPayment: vi.fn(async () => state.payment), createIntent: unused, refund: unused, capture: unused, void: unused, listProviders: () => [] };
  const alerts = { raise: vi.fn<SettleOrderPaymentDeps["alerts"]["raise"]>(async () => {}) };
  const deps: SettleOrderPaymentDeps = { orders, orderPayments, payments, alerts, clock: { nowMs: () => Date.parse(at) } };
  return { state, orders, orderPayments, payments, alerts, deps, run: () => settleOrderPayment({ deps, input }) };
}
it("settles a reserved but unbound order using only its stored scope", async () => {
  const w = world(); expect(await settleOrderPayment({ deps: w.deps, input }, {})).toBe("paid");
  expect(w.orderPayments.findByOrder).toHaveBeenCalledWith({ workspaceId: "ws", orderId: "order" });
  expect(w.orders.findById).toHaveBeenCalledWith({ workspaceId: "ws", id: "order" });
  expect(w.payments.getPayment).toHaveBeenCalledWith({ scope, paymentId: "payment" });
  expect(w.payments.getPayment.mock.invocationCallOrder[0]).toBeLessThan(w.orders.findById.mock.invocationCallOrder[0]!);
  expect(w.orderPayments.bind).toHaveBeenCalledWith({ workspaceId: "ws", orderId: "order", paymentId: "payment" });
  expect(w.orders.markPaid).toHaveBeenCalledWith({ workspaceId: "ws", orderId: "order", at });
  expect(w.orderPayments.bind.mock.invocationCallOrder[0]).toBeLessThan(w.orders.markPaid.mock.invocationCallOrder[0]!);
  expect(w.alerts.raise).not.toHaveBeenCalled();
});
const mismatches: Array<[string, (w: ReturnType<typeof world>) => void]> = [
  ...(["workspaceId", "siteId", "providerId", "providerAccountId"] as const).map(field =>
    [field, (w: ReturnType<typeof world>) => { w.state.payment = { ...w.state.payment!, scope: { ...scope, [field]: "other" } }; }] as [string, (w: ReturnType<typeof world>) => void]),
  ["payment mode", w => { w.state.payment = { ...w.state.payment!, scope: { ...scope, mode: "live" } }; }],
  ["message mode", w => { w.state.association!.mode = "live"; }],
  ["association workspace", w => { w.state.association!.workspaceId = "other"; }],
  ["association order", w => { w.state.association!.orderId = "other"; }],
  ["missing payment", w => { w.state.payment = null; }],
  ["payment identity", w => { w.state.payment = { ...w.state.payment!, id: "other" }; }],
  ["reference", w => { w.state.payment = { ...w.state.payment!, reference: "other" }; }],
  ["amount", w => { w.state.payment = { ...w.state.payment!, amount: { ...amount, minorUnits: 124 } }; }],
  ["currency", w => { w.state.payment = { ...w.state.payment!, amount: { ...amount, currency: "EUR" } }; }],
  ["captured", w => { w.state.payment = { ...w.state.payment!, captured: { ...amount, minorUnits: 122 } }; }],
  ["captured currency", w => { w.state.payment = { ...w.state.payment!, captured: { ...amount, currency: "EUR" } }; }],
  ["association amount", w => { w.state.association!.amount = { ...amount, minorUnits: 124 }; }],
  ["association currency", w => { w.state.association!.amount = { ...amount, currency: "EUR" }; }],
  ["order total", w => { w.state.order!.totalAmount = { ...amount, minorUnits: 124 }; }],
  ["order currency", w => { w.state.order!.totalAmount = { ...amount, currency: "EUR" }; }],
  ["order workspace", w => { w.state.order!.workspaceId = "other"; }],
  ["order identity", w => { w.state.order!.id = "other"; }],
  ["order provider", w => { w.state.order!.provider = "other"; }],
  ["missing order", w => { w.state.order = null; }],
  ["second payment", w => { w.state.association!.paymentId = "first-payment"; }],
  ["missing association", w => { w.state.association = null; }],
];
it.each(mismatches)("blocks %s without binding or fulfilling", async (_name, change) => {
  const w = world(); change(w); expect(await w.run()).toBe("blocked");
  expect(w.orders.markPaid).not.toHaveBeenCalled(); expect(w.orderPayments.bind).not.toHaveBeenCalled();
  expect(w.alerts.raise).toHaveBeenCalledTimes(1);
  expect(w.alerts.raise).toHaveBeenCalledWith({ alert: { kind: "fulfillment-blocked", workspaceId: "ws", mode: "test",
    paymentId: "payment", detail: expect.stringContaining("order") } });
});
it.each(["pending", "unknown", "failed", "authorized", "canceled"] as const)("leaves %s payments unsettled without an alert", async status => {
  const w = world(); w.state.payment = { ...w.state.payment!, status };
  expect(await w.run()).toBe("not_succeeded"); expect(w.alerts.raise).not.toHaveBeenCalled(); expect(w.orders.markPaid).not.toHaveBeenCalled();
});
it("ignores payments outside the order flow", async () => {
  const w = world(); w.state.association = null; w.state.order = null;
  expect(await w.run()).toBe("not_ours"); expect(w.payments.getPayment).not.toHaveBeenCalled(); expect(w.alerts.raise).not.toHaveBeenCalled();
});
it("accepts an already bound, already paid replay without rebinding", async () => {
  const w = world(); w.state.association!.paymentId = "payment"; w.orders.markPaid.mockResolvedValue("already_paid");
  expect(await w.run()).toBe("already_paid"); expect(w.orderPayments.bind).not.toHaveBeenCalled();
});
it.each(["bound", "already_bound", "conflict", "not_found"] as const)("handles bind result %s", async result => {
  const w = world(); w.orderPayments.bind.mockResolvedValue(result); const success = result === "bound" || result === "already_bound";
  expect(await w.run()).toBe(success ? "paid" : "blocked"); expect(w.orders.markPaid).toHaveBeenCalledTimes(success ? 1 : 0);
  expect(w.alerts.raise).toHaveBeenCalledTimes(success ? 0 : 1);
});
it.each(["not_pending", "not_found"] as const)("alerts when markPaid returns %s", async result => {
  const w = world(); w.orders.markPaid.mockResolvedValue(result);
  expect(await w.run()).toBe("blocked"); expect(w.alerts.raise).toHaveBeenCalledTimes(1);
});
it.each(["association", "order", "payment", "bind", "mark", "alert"] as const)("propagates %s storage/port failures for redelivery", async step => {
  const w = world(), fault = new Error("storage unavailable");
  const calls = { association: w.orderPayments.findByOrder, order: w.orders.findById, payment: w.payments.getPayment,
    bind: w.orderPayments.bind, mark: w.orders.markPaid, alert: w.alerts.raise };
  calls[step].mockRejectedValueOnce(fault); if (step === "alert") w.state.association = null;
  await expect(w.run()).rejects.toBe(fault);
  if (step !== "mark") expect(w.orders.markPaid).not.toHaveBeenCalled();
});
