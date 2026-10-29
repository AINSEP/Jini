import { expect, it, vi } from "vitest";
import { world, LIPAY, USD } from "../../../payments/ops/__tests__/harness.js";
import { createWebhookReceiver } from "../../../payments/ingest/receive.js";
import { createInboxWorker } from "../../../payments/ingest/worker.js";
import { createOutboxRelay } from "../../../payments/ingest/outbox-relay.js";
import type { CommerceOrderPaymentRecord } from "../../ports.js";
import type { CommerceOrderRecord } from "../../types.js";
import { payOrder, createOrderPaymentProjector, CommerceCheckoutValidationError, type PayOrderDeps } from "../../index.js";

const input = { workspaceId: "ws", orderId: "order", scope: LIPAY };
const at = "2026-10-29T00:00:00.000Z";
const unused = async () => { throw new Error("unexpected operation"); };
async function fixture() {
  const w = await world(), state = { association: null as CommerceOrderPaymentRecord | null };
  const order: CommerceOrderRecord = { id: "order", workspaceId: "ws", memberId: "member", status: "pending", totalAmount: USD(369),
    provider: LIPAY.providerId, placedAt: at, createdAt: at, updatedAt: at, version: 1 };
  const item = { id: "item", workspaceId: "ws", orderId: "order", priceId: "price", productId: "product",
    description: "Notebook", quantity: 3, unitAmount: USD(123), createdAt: at };
  const orders = { findById: async () => order, listItems: async () => [item], placeOrder: unused,
    markPaid: vi.fn<PayOrderDeps["orders"]["markPaid"]>(async () => { order.status = "paid"; return "paid"; }) };
  const orderPayments = { findByOrder: async () => state.association,
    reserve: vi.fn<PayOrderDeps["orderPayments"]["reserve"]>(async record => {
      if (state.association) return "same_scope";
      state.association = { ...record, paymentId: null }; return "reserved";
    }), bind: vi.fn<PayOrderDeps["orderPayments"]["bind"]>(async ({ paymentId }) => { state.association!.paymentId = paymentId; return "bound"; }) };
  const payments = { ...w.service, createIntent: vi.fn(w.service.createIntent) };
  const priceRefs = { find: vi.fn<PayOrderDeps["priceRefs"]["find"]>(async () => "provider-price"), save: unused };
  const prices = { findById: async () => ({ id: "price", workspaceId: "ws", productId: "product", unitAmount: USD(999),
    status: "active" as const, createdAt: at, version: 2 }), listByProduct: unused, save: unused };
  const settle = { orders, orderPayments, payments, alerts: { raise: vi.fn(async () => {}) }, clock: { nowMs: () => Date.parse(at) } };
  const deps: PayOrderDeps = { orders, prices, priceRefs, orderPayments, payments, settle };
  const dispatch = vi.spyOn(w.lipay.provider, "createIntent");
  return { ...w, kernelDeps: w.deps, dispatch, state, order, orders, orderPayments, payments, priceRefs, deps, run: () => payOrder({ deps, input }) };
}
it("reserves before dispatch, sends the exact snapshot and scoped mapping, binds, then settles synchronous success", async () => {
  const w = await fixture(), result = await payOrder({ deps: w.deps, input }, {});
  expect(result).toMatchObject({ ok: true, replayed: false, payment: { status: "succeeded" } });
  expect(w.orderPayments.reserve).toHaveBeenCalledWith({ ...LIPAY, orderId: "order", amount: USD(369), createdAt: at });
  expect(w.priceRefs.find).toHaveBeenCalledWith({ workspaceId: "ws", priceId: "price", providerId: LIPAY.providerId, providerAccountId: LIPAY.providerAccountId, mode: "test" });
  expect(w.payments.createIntent).toHaveBeenCalledWith({ scope: LIPAY, amount: USD(369), idempotencyKey: "order:order", reference: "order" },
    { partyId: "member", line: { description: "Notebook", quantity: 3, unitAmount: USD(123), providerPriceRef: "provider-price" } });
  expect(w.orderPayments.reserve.mock.invocationCallOrder[0]).toBeLessThan(w.payments.createIntent.mock.invocationCallOrder[0]!);
  expect(w.orderPayments.bind).toHaveBeenCalledWith({ workspaceId: "ws", orderId: "order", paymentId: result.payment!.id });
  expect(w.orderPayments.bind.mock.invocationCallOrder[0]).toBeLessThan(w.orders.markPaid.mock.invocationCallOrder[0]!);
  expect(w.order.status).toBe("paid"); expect(w.deps.settle.alerts.raise).not.toHaveBeenCalled();
});
it("refuses reservation conflicts before dispatch", async () => {
  const w = await fixture(); w.orderPayments.reserve.mockResolvedValue("conflict");
  await expect(w.run()).rejects.toThrow("order already reserved for another scope");
  expect(w.payments.createIntent).not.toHaveBeenCalled(); expect(w.orderPayments.bind).not.toHaveBeenCalled();
});
it("replays an unresolved payment without a second dispatch and omits an absent provider price ref", async () => {
  const w = await fixture(); w.priceRefs.find.mockResolvedValue(null); w.lipay.server.script({ op: "createIntent", behaviours: ["timeout"] });
  const first = await w.run(), second = await w.run();
  expect(first).toMatchObject({ ok: false, payment: { status: "unknown" } });
  expect(second).toMatchObject({ ok: true, replayed: true, payment: first.payment });
  expect(w.payments.createIntent.mock.calls[0]![1]!.line).toEqual({ description: "Notebook", quantity: 3, unitAmount: USD(123) });
  expect(w.orderPayments.bind).toHaveBeenCalledTimes(2); expect(w.dispatch).toHaveBeenCalledTimes(1);
  expect(w.order.status).toBe("pending"); expect(w.orders.markPaid).not.toHaveBeenCalled();
});
it("concurrent double clicks converge on one kernel payment", async () => {
  const w = await fixture(), original = w.service.createIntent;
  let release!: () => void; const bothEntered = new Promise<void>(resolve => { release = resolve; });
  w.payments.createIntent.mockImplementation(async (...args) => {
    if (w.payments.createIntent.mock.calls.length === 2) release();
    await bothEntered; return original(...args);
  });
  const [a, b] = await Promise.all([w.run(), w.run()]);
  expect(a.ok).toBe(true); expect(b.ok).toBe(true); expect(a.payment!.id).toBe(b.payment!.id);
  expect(w.state.association!.paymentId).toBe(a.payment!.id); expect(w.dispatch).toHaveBeenCalledTimes(1);
});
it("propagates a crash after dispatch; a signed webhook then fulfills through the unbound reservation", async () => {
  const w = await fixture(), fault = new Error("bind storage unavailable"); w.orderPayments.bind.mockRejectedValueOnce(fault);
  await expect(w.run()).rejects.toBe(fault); expect(w.state.association!.paymentId).toBeNull(); expect(w.order.status).toBe("pending");
  const receiver = createWebhookReceiver({ ...w.kernelDeps, endpoints: { resolve: async () => LIPAY } });
  const endpoint = await receiver.resolveEndpoint({ path: { siteId: LIPAY.siteId, providerId: LIPAY.providerId, endpointId: "configured" } });
  if (!endpoint.ok) throw new Error("fixture endpoint missing");
  expect(await receiver.receive({ endpoint: endpoint.endpoint, ...w.lipay.server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "late" }) }))
    .toEqual({ status: 200, body: { received: 1, duplicates: 0, ignored: false } });
  expect(await createInboxWorker(w.kernelDeps).runOnce({ limit: 10 })).toMatchObject({ applied: 1 });
  const projector = createOrderPaymentProjector({ deps: w.deps.settle });
  expect(await createOutboxRelay({ ledger: w.ledger, now: w.kernelDeps.now, publish: { publish: async ({ message }) => {
    expect(await projector.handle({ message })).toBe("paid");
  } } }).runOnce({ limit: 10 })).toEqual({ published: 1, stopped: false });
  expect(w.order.status).toBe("paid"); expect(w.state.association!.paymentId).toBe(w.dispatch.mock.calls[0]![0].req.correlationId);
  expect(w.dispatch).toHaveBeenCalledTimes(1);
});
it("passes a rejection without a payment through unchanged and performs no binding or fulfillment", async () => {
  const w = await fixture(), result = { ok: false as const, error: { code: "DECLINED" as const, message: "declined", retryable: false } };
  w.payments.createIntent.mockResolvedValue(result); expect(await w.run()).toBe(result);
  expect(w.orderPayments.bind).not.toHaveBeenCalled(); expect(w.orders.markPaid).not.toHaveBeenCalled();
});
it.each(["conflict", "not_found"] as const)("refuses binding result %s without fulfillment", async result => {
  const w = await fixture(); w.orderPayments.bind.mockResolvedValue(result);
  await expect(w.run()).rejects.toBeInstanceOf(CommerceCheckoutValidationError); expect(w.orders.markPaid).not.toHaveBeenCalled();
});
it.each(["reserve", "mapping", "dispatch"] as const)("propagates %s failures", async step => {
  const w = await fixture(), fault = new Error("port unavailable");
  const calls = { reserve: w.orderPayments.reserve, mapping: w.priceRefs.find, dispatch: w.payments.createIntent };
  calls[step].mockRejectedValueOnce(fault); await expect(w.run()).rejects.toBe(fault);
  expect(w.orderPayments.bind).not.toHaveBeenCalled(); expect(w.orders.markPaid).not.toHaveBeenCalled();
});
