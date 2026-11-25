import { expect, it, vi } from "vitest";
import { createCommerceServer, normalizedCommerceOrigin, readOwnedCommerceOrder } from "../../plugin-server.js";
import type { CommerceOrderRecord } from "../../types.js";
import type { CommerceOrderPaymentRecord } from "../../ports.js";
import type { PayOrderDeps } from "../../pay-order.js";

const at = "2026-11-05T00:00:00.000Z";
const scope = { workspaceId: "ws", siteId: "site", providerId: "stripe", providerAccountId: "acct", mode: "test" as const };
function fixture() {
  const state = { active: false, order: null as CommerceOrderRecord | null, association: null as CommerceOrderPaymentRecord | null };
  const price = { id: "price", workspaceId: "ws", productId: "product", status: "active" as const, unitAmount: { minorUnits: 100, currency: "JPY" }, createdAt: at, version: 1 };
  const products = { findById: vi.fn(async () => ({ id: "product", workspaceId: "ws", name: "Notebook", slug: "notebook", kind: "one_time" as const, status: "active" as const, createdAt: at, updatedAt: at, version: 1 })), findBySlug: vi.fn(), listActive: vi.fn(), save: vi.fn() };
  const prices = { findById: vi.fn(async () => price), listByProduct: vi.fn(), save: vi.fn() };
  const orders = { findById: vi.fn(async () => state.order), listItems: vi.fn(async () => [{ id: "item", workspaceId: "ws", orderId: "order", priceId: "price", productId: "product", description: "Notebook", unitAmount: price.unitAmount, quantity: 1, createdAt: at }]), placeOrder: vi.fn(async ({ order }) => { state.order = order; }), markPaid: vi.fn() };
  const payment = { id: "payment", scope, status: "pending" as const, amount: price.unitAmount, captured: { minorUnits: 0, currency: "JPY" }, refunded: { minorUnits: 0, currency: "JPY" }, refundHeld: { minorUnits: 0, currency: "JPY" }, disputed: { minorUnits: 0, currency: "JPY" }, reference: "order", next: { kind: "redirect" as const, url: "https://checkout.example/session" } };
  const payments = { createIntent: vi.fn(async () => ({ ok: true as const, payment, replayed: false, risk: { verdict: "allow" as const, reasons: [], fallback: false } })), getPayment: vi.fn(async () => payment), listProviders: vi.fn(), refund: vi.fn(), capture: vi.fn(), void: vi.fn() };
  const orderPayments = { reserve: vi.fn(async () => "reserved" as const), bind: vi.fn(async ({ paymentId }) => { state.association = { ...scope, orderId: "order", amount: price.unitAmount, createdAt: at, paymentId }; return "bound" as const; }), findByOrder: vi.fn(async () => state.association) } as unknown as PayOrderDeps["orderPayments"];
  const clock = { nowMs: () => Date.parse(at) };
  const ensureSchema = vi.fn(async () => {}), warn = vi.fn();
  const deps = { scope: { ...scope }, publicOrigin: "https://shop.example", isActive: () => state.active, ensureSchema, warn,
    checkoutDeps: { products, prices, orders, clock, idGen: { newId: () => "order" } },
    payOrderDeps: { prices, orders, payments, orderPayments, priceRefs: { find: vi.fn(async () => null), save: vi.fn() }, settle: { orders, orderPayments, payments, clock, alerts: { raise: vi.fn() } } } };
  const server = createCommerceServer(deps);
  const create = () => server.createOrder({ memberId: "member", priceId: "price" });
  return { state, server, create, ensureSchema, warn, payments, payment, deps, orders, prices };
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
it.each(["https://shop.example/", "https://shop.example:443"])("accepts an equivalent deployed HTTPS origin %s", async publicOrigin => {
  const f = fixture(); f.state.active = true;
  expect(await createCommerceServer({ ...f.deps, publicOrigin }).activate()).toMatchObject({ ready: true });
});
it.each([
  ["https://shop.example/", "https://shop.example"], ["https://shop.example:443", "https://shop.example"],
  ["http://shop.example", null], ["https://user:password@shop.example", null],
  ["https://shop.example/other", null], ["https://shop.example?", null], ["https://shop.example#", null], ["invalid", null],
])("normalizes only an HTTPS origin shape %s", (publicOrigin, normalized) => {
  expect(normalizedCommerceOrigin({ publicOrigin: publicOrigin! })).toBe(normalized);
});
it.each(["https://user:password@shop.example", "https://shop.example/other", "https://shop.example?orderId=forged"])("refuses unsafe origin configuration %s without storage writes", async publicOrigin => {
  const f = fixture(); f.state.active = true;
  expect(await createCommerceServer({ ...f.deps, publicOrigin }).activate()).toMatchObject({ ready: false });
  expect(f.ensureSchema).not.toHaveBeenCalled();
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
it("uses an async activation reader and binds callback configuration only to the owned order id", async () => {
  const f = fixture(); f.state.active = true;
  const depsForOrder = vi.fn(async () => f.deps.payOrderDeps);
  const server = createCommerceServer({ ...f.deps, isActive: async () => f.state.active, payOrderDeps: depsForOrder });
  f.deps.scope.providerAccountId = "changed-after-composition";
  await server.createOrder({ memberId: "member", priceId: "price" });
  await server.pay({ memberId: "member", orderId: "order" });
  expect(depsForOrder).toHaveBeenCalledWith({ orderId: "order" });
  expect(f.payments.createIntent.mock.calls[0]![0].scope).toEqual(scope);
});
it("never exposes a different merchant account's payment returned by an adapter", async () => {
  const f = fixture(); f.state.active = true; await f.create(); await f.server.pay({ memberId: "member", orderId: "order" });
  f.payments.getPayment.mockResolvedValue({ ...f.payment, scope: { ...scope, providerAccountId: "foreign" } });
  expect(await f.server.readOrder({ memberId: "member", orderId: "order" })).toMatchObject({ payment: null });
});
it("reads the original ledger scope after merchant account and mode configuration changes", async () => {
  const f = fixture(); f.state.active = true; await f.create(); await f.server.pay({ memberId: "member", orderId: "order" });
  f.payments.createIntent.mockClear(); f.payments.getPayment.mockClear();
  const changed = createCommerceServer({ ...f.deps, scope: { ...scope, providerAccountId: "replacement", mode: "live" } });
  expect(await changed.readOrder({ memberId: "member", orderId: "order" })).toMatchObject({ payment: { id: "payment", scope } });
  expect(f.payments.getPayment).toHaveBeenCalledWith({ scope, paymentId: "payment" });
  expect(f.payments.createIntent).not.toHaveBeenCalled();
});
it.each(["siteId", "workspaceId", "orderId"])("refuses a foreign persisted association %s before reading payment details", async field => {
  const f = fixture(); f.state.active = true; await f.create(); await f.server.pay({ memberId: "member", orderId: "order" });
  Object.assign(f.state.association!, { [field]: "foreign" }); f.payments.getPayment.mockClear();
  expect(await f.server.readOrder({ memberId: "member", orderId: "order" })).toMatchObject({ payment: null });
  expect(f.payments.getPayment).not.toHaveBeenCalled();
});
it("reads owned ledger truth without configuration, activation, migrations or provider operations", async () => {
  const f = fixture(); f.state.active = true; await f.create(); await f.server.pay({ memberId: "member", orderId: "order" });
  f.state.active = false; f.payments.createIntent.mockClear(); f.ensureSchema.mockClear();
  const deps = { workspaceId: "ws", siteId: "site", orders: f.orders, orderPayments: f.deps.payOrderDeps.orderPayments, payments: f.payments };
  expect(await readOwnedCommerceOrder({ deps, memberId: "member", orderId: "order" })).toMatchObject({ payment: { id: "payment" }, intent: null });
  await expect(readOwnedCommerceOrder({ deps, memberId: "foreign", orderId: "order" })).rejects.toThrow("Order was not found");
  expect(f.payments.createIntent).not.toHaveBeenCalled(); expect(f.ensureSchema).not.toHaveBeenCalled();
});
it("refuses recurring prices before creating a pending order", async () => {
  const f = fixture(); f.state.active = true;
  f.prices.findById.mockResolvedValue({ ...await f.prices.findById(), billingInterval: "month" } as never);
  await expect(f.create()).rejects.toThrow("one-time prices only"); expect(f.orders.placeOrder).not.toHaveBeenCalled();
});
// Surface parity: the server's method table and every method's response shape, recorded from the
// pre-split implementation so the route/method assembly can be reorganised without drifting.
it("exposes exactly the activate/status/createOrder/pay/readOrder methods", () => {
  expect(Object.keys(fixture().server).sort()).toEqual(["activate", "createOrder", "pay", "readOrder", "status"]);
});
it("records the status, createOrder, pay and readOrder responses", async () => {
  const f = fixture();
  expect(await f.server.status()).toEqual({ active: false, ready: false, reason: "Commerce is disabled. Existing payment settlement continues separately.", scope });
  f.state.active = true;
  expect(await f.server.status()).toEqual({ active: true, ready: false, reason: "Commerce has not been activated.", scope });
  expect(await f.server.activate()).toEqual({ active: true, ready: true, reason: null, scope });
  const created = await f.create();
  expect(Object.keys(created).sort()).toMatchInlineSnapshot(`
    [
      "items",
      "order",
    ]
  `);
  const paid = await f.server.pay({ memberId: "member", orderId: "order" });
  expect(paid).toMatchInlineSnapshot(`
    {
      "intent": {
        "ok": true,
        "payment": {
          "amount": {
            "currency": "JPY",
            "minorUnits": 100,
          },
          "captured": {
            "currency": "JPY",
            "minorUnits": 0,
          },
          "disputed": {
            "currency": "JPY",
            "minorUnits": 0,
          },
          "id": "payment",
          "next": {
            "kind": "redirect",
            "url": "https://checkout.example/session",
          },
          "reference": "order",
          "refundHeld": {
            "currency": "JPY",
            "minorUnits": 0,
          },
          "refunded": {
            "currency": "JPY",
            "minorUnits": 0,
          },
          "scope": {
            "mode": "test",
            "providerAccountId": "acct",
            "providerId": "stripe",
            "siteId": "site",
            "workspaceId": "ws",
          },
          "status": "pending",
        },
        "replayed": false,
        "risk": {
          "fallback": false,
          "reasons": [],
          "verdict": "allow",
        },
      },
      "order": {
        "createdAt": "2026-11-05T00:00:00.000Z",
        "id": "order",
        "memberId": "member",
        "placedAt": "2026-11-05T00:00:00.000Z",
        "provider": "stripe",
        "providerCustomerRef": undefined,
        "status": "pending",
        "totalAmount": {
          "currency": "JPY",
          "minorUnits": 100,
        },
        "updatedAt": "2026-11-05T00:00:00.000Z",
        "version": 1,
        "workspaceId": "ws",
      },
      "payment": {
        "amount": {
          "currency": "JPY",
          "minorUnits": 100,
        },
        "captured": {
          "currency": "JPY",
          "minorUnits": 0,
        },
        "disputed": {
          "currency": "JPY",
          "minorUnits": 0,
        },
        "id": "payment",
        "next": {
          "kind": "redirect",
          "url": "https://checkout.example/session",
        },
        "reference": "order",
        "refundHeld": {
          "currency": "JPY",
          "minorUnits": 0,
        },
        "refunded": {
          "currency": "JPY",
          "minorUnits": 0,
        },
        "scope": {
          "mode": "test",
          "providerAccountId": "acct",
          "providerId": "stripe",
          "siteId": "site",
          "workspaceId": "ws",
        },
        "status": "pending",
      },
    }
  `);
  expect(await f.server.readOrder({ memberId: "member", orderId: "order" })).toMatchInlineSnapshot(`
    {
      "intent": null,
      "order": {
        "createdAt": "2026-11-05T00:00:00.000Z",
        "id": "order",
        "memberId": "member",
        "placedAt": "2026-11-05T00:00:00.000Z",
        "provider": "stripe",
        "providerCustomerRef": undefined,
        "status": "pending",
        "totalAmount": {
          "currency": "JPY",
          "minorUnits": 100,
        },
        "updatedAt": "2026-11-05T00:00:00.000Z",
        "version": 1,
        "workspaceId": "ws",
      },
      "payment": {
        "amount": {
          "currency": "JPY",
          "minorUnits": 100,
        },
        "captured": {
          "currency": "JPY",
          "minorUnits": 0,
        },
        "disputed": {
          "currency": "JPY",
          "minorUnits": 0,
        },
        "id": "payment",
        "next": {
          "kind": "redirect",
          "url": "https://checkout.example/session",
        },
        "reference": "order",
        "refundHeld": {
          "currency": "JPY",
          "minorUnits": 0,
        },
        "refunded": {
          "currency": "JPY",
          "minorUnits": 0,
        },
        "scope": {
          "mode": "test",
          "providerAccountId": "acct",
          "providerId": "stripe",
          "siteId": "site",
          "workspaceId": "ws",
        },
        "status": "pending",
      },
    }
  `);
  expect(created).toMatchInlineSnapshot(`
    {
      "items": [
        {
          "createdAt": "2026-11-05T00:00:00.000Z",
          "description": "Notebook",
          "id": "order",
          "orderId": "order",
          "priceId": "price",
          "productId": "product",
          "quantity": 1,
          "unitAmount": {
            "currency": "JPY",
            "minorUnits": 100,
          },
          "workspaceId": "ws",
        },
      ],
      "order": {
        "createdAt": "2026-11-05T00:00:00.000Z",
        "id": "order",
        "memberId": "member",
        "placedAt": "2026-11-05T00:00:00.000Z",
        "provider": "stripe",
        "providerCustomerRef": undefined,
        "status": "pending",
        "totalAmount": {
          "currency": "JPY",
          "minorUnits": 100,
        },
        "updatedAt": "2026-11-05T00:00:00.000Z",
        "version": 1,
        "workspaceId": "ws",
      },
    }
  `);
});
it("raises CommerceUnavailableError (503 COMMERCE_UNAVAILABLE) for a disabled commerce and the sign-in validation for an anonymous order", async () => {
  const f = fixture();
  await expect(f.create()).rejects.toMatchObject({ name: "Error", code: "COMMERCE_UNAVAILABLE", status: 503, message: "Commerce is disabled. Existing payment settlement continues separately." });
  f.state.active = true;
  await expect(f.server.createOrder({ memberId: "", priceId: "price" })).rejects.toThrow("Sign in before creating an order.");
  f.prices.findById.mockResolvedValueOnce({ ...(await f.prices.findById()), billingInterval: "month" } as never);
  await expect(f.create()).rejects.toThrow("Checkout supports one-time prices only.");
  await f.create(); f.state.active = false;
  await expect(f.server.pay({ memberId: "member", orderId: "order" })).rejects.toThrow("Commerce is disabled. Existing payment settlement continues separately.");
});
