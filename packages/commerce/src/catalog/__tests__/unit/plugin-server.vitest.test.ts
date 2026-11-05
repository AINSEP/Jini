import { expect, it, vi } from "vitest";
import { createCommerceServer } from "../../plugin-server.js";
import type { CommerceOrderRecord } from "../../types.js";
import type { PayOrderDeps } from "../../pay-order.js";

const at = "2026-11-05T00:00:00.000Z";
const scope = { workspaceId: "ws", siteId: "site", providerId: "stripe", providerAccountId: "acct", mode: "test" as const };
function fixture() {
  const state = { active: false, order: null as CommerceOrderRecord | null, association: null as { paymentId: string | null } | null };
  const price = { id: "price", workspaceId: "ws", productId: "product", status: "active" as const, unitAmount: { minorUnits: 100, currency: "JPY" }, createdAt: at, version: 1 };
  const products = { findById: vi.fn(async () => ({ id: "product", workspaceId: "ws", name: "Notebook", slug: "notebook", kind: "one_time" as const, status: "active" as const, createdAt: at, updatedAt: at, version: 1 })), findBySlug: vi.fn(), listActive: vi.fn(), save: vi.fn() };
  const prices = { findById: vi.fn(async () => price), listByProduct: vi.fn(), save: vi.fn() };
  const orders = { findById: vi.fn(async () => state.order), listItems: vi.fn(async () => [{ id: "item", workspaceId: "ws", orderId: "order", priceId: "price", productId: "product", description: "Notebook", unitAmount: price.unitAmount, quantity: 1, createdAt: at }]), placeOrder: vi.fn(async ({ order }) => { state.order = order; }), markPaid: vi.fn() };
  const payment = { id: "payment", scope, status: "pending" as const, amount: price.unitAmount, captured: { minorUnits: 0, currency: "JPY" }, refunded: { minorUnits: 0, currency: "JPY" }, refundHeld: { minorUnits: 0, currency: "JPY" }, disputed: { minorUnits: 0, currency: "JPY" }, reference: "order", next: { kind: "redirect" as const, url: "https://checkout.example/session" } };
  const payments = { createIntent: vi.fn(async () => ({ ok: true as const, payment, replayed: false, risk: { verdict: "allow" as const, reasons: [], fallback: false } })), getPayment: vi.fn(async () => payment), listProviders: vi.fn(), refund: vi.fn(), capture: vi.fn(), void: vi.fn() };
  const orderPayments = { reserve: vi.fn(async () => "reserved" as const), bind: vi.fn(async ({ paymentId }) => { state.association = { paymentId }; return "bound" as const; }), findByOrder: vi.fn(async () => state.association) } as unknown as PayOrderDeps["orderPayments"];
  const clock = { nowMs: () => Date.parse(at) };
  const ensureSchema = vi.fn(async () => {}), warn = vi.fn();
  const deps = { scope, publicOrigin: "https://shop.example", isActive: () => state.active, ensureSchema, warn,
    checkoutDeps: { products, prices, orders, clock, idGen: { newId: () => "order" } },
    payOrderDeps: { prices, orders, payments, orderPayments, priceRefs: { find: vi.fn(async () => null), save: vi.fn() }, settle: { orders, orderPayments, payments, clock, alerts: { raise: vi.fn() } } } };
  const server = createCommerceServer(deps);
  const create = () => server.createOrder({ memberId: "member", priceId: "price" });
  return { state, server, create, ensureSchema, warn, payments, deps, orders };
}
it("is dormant by default, without schema writes or payment dispatch", async () => {
  const f = fixture();
  expect(await f.server.activate()).toMatchObject({ active: false, ready: false });
  await expect(f.create()).rejects.toThrow("Commerce is disabled");
  expect(f.ensureSchema).not.toHaveBeenCalled(); expect(f.payments.createIntent).not.toHaveBeenCalled();
});
it("warns and remains unavailable on activation failure; a later activation retries", async () => {
  const f = fixture(); f.state.active = true; f.ensureSchema.mockRejectedValueOnce(new Error("secret connection details"));
  expect(await f.server.activate()).toMatchObject({ ready: false, reason: "Commerce storage could not be prepared. Checkout is temporarily unavailable." });
  expect(f.warn).toHaveBeenCalledWith("Commerce storage could not be prepared. Checkout is temporarily unavailable.");
  expect(await f.server.activate()).toMatchObject({ ready: true });
});
it("requires a deployed HTTPS origin before preparing storage", async () => {
  const f = fixture(); f.state.active = true; f.deps.publicOrigin = "http://localhost:3000";
  const server = createCommerceServer(f.deps);
  expect(await server.activate()).toMatchObject({ ready: false }); expect(f.ensureSchema).not.toHaveBeenCalled();
});
it("serializes concurrent activation and creates a pending order separately from paying", async () => {
  const f = fixture(); f.state.active = true;
  await Promise.all([f.server.activate(), f.server.activate()]); expect(f.ensureSchema).toHaveBeenCalledTimes(1);
  expect(await f.create()).toMatchObject({ order: { memberId: "member", workspaceId: "ws", status: "pending", provider: "stripe" } });
  expect(f.payments.createIntent).not.toHaveBeenCalled();
  const result = await f.server.pay({ memberId: "member", orderId: "order" });
  expect(result).toMatchObject({ order: { status: "pending" }, payment: { status: "pending" }, intent: { ok: true } });
  expect(f.payments.createIntent).toHaveBeenCalledWith(expect.objectContaining({ scope, idempotencyKey: "order:order" }), expect.any(Object));
});
it.each(["foreign-member", "foreign-workspace"])("refuses %s before payment dispatch", async kind => {
  const f = fixture(); f.state.active = true; await f.create();
  if (kind === "foreign-workspace") f.state.order!.workspaceId = "other";
  await expect(f.server.pay({ memberId: kind === "foreign-member" ? "other" : "member", orderId: "order" })).rejects.toThrow("Order was not found");
  expect(f.payments.createIntent).not.toHaveBeenCalled();
});
it("return reads never mark paid, including a forged return query; reads survive disabling", async () => {
  const f = fixture(); f.state.active = true; await f.create(); f.state.active = false;
  expect(await f.server.readOrder({ memberId: "member", orderId: "order" })).toMatchObject({ order: { status: "pending" }, payment: null });
  expect(f.payments.createIntent).not.toHaveBeenCalled(); expect(f.orders.markPaid).not.toHaveBeenCalled();
  await expect(f.server.pay({ memberId: "member", orderId: "order" })).rejects.toThrow("Commerce is disabled");
});
it("repeated clicks on a paid order return ledger truth without redispatch", async () => {
  const f = fixture(); f.state.active = true; await f.create(); await f.server.pay({ memberId: "member", orderId: "order" });
  f.state.order!.status = "paid"; f.payments.createIntent.mockClear();
  expect(await f.server.pay({ memberId: "member", orderId: "order" })).toMatchObject({ order: { status: "paid" }, intent: null });
  expect(f.payments.createIntent).not.toHaveBeenCalled();
});
