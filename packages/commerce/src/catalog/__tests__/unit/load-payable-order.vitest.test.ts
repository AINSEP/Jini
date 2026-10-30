import { expect, it, vi } from "vitest";
import { loadPayableOrder, type LoadPayableOrderDeps } from "../../load-payable-order.js";
import { CommerceCheckoutValidationError, CommerceOrderNotFoundError, CommercePriceNotFoundError } from "../../errors.js";
import type { CommerceOrderItemRecord, CommerceOrderRecord, CommercePriceRecord } from "../../types.js";

const at = "2026-10-29T00:00:00.000Z";
const scope = { workspaceId: "ws", siteId: "site", providerId: "regional-pay", providerAccountId: "account", mode: "test" as const };
const input = { workspaceId: "ws", orderId: "order", scope };
const unused = async () => { throw new Error("load must never write"); };
function world() {
  const state = {
    order: { id: "order", workspaceId: "ws", memberId: "member", status: "pending", totalAmount: { minorUnits: 369, currency: "USD" },
      provider: scope.providerId, placedAt: at, createdAt: at, updatedAt: at, version: 1 } as CommerceOrderRecord | null,
    items: [{ id: "item", workspaceId: "ws", orderId: "order", priceId: "price", productId: "product", description: "Notebook",
      unitAmount: { minorUnits: 123, currency: "USD" }, quantity: 3, createdAt: at }] as CommerceOrderItemRecord[],
    price: { id: "price", workspaceId: "ws", productId: "product", unitAmount: { minorUnits: 999, currency: "USD" },
      status: "active", createdAt: at, version: 2 } as CommercePriceRecord | null,
  };
  const orders = { findById: vi.fn(async () => state.order), listItems: vi.fn(async () => state.items), markPaid: unused, placeOrder: unused };
  const prices = { findById: vi.fn(async () => state.price), listByProduct: unused, save: unused };
  const deps: LoadPayableOrderDeps = { orders, prices };
  return { state, orders, prices, deps, run: () => loadPayableOrder({ deps, input }) };
}
it("loads one payable snapshot without repricing it or mutating records", async () => {
  const w = world(), before = structuredClone(w.state);
  expect(await loadPayableOrder({ deps: w.deps, input }, {})).toEqual({ order: before.order, item: before.items[0], price: before.price });
  expect(w.state).toEqual(before);
  expect(w.orders.findById).toHaveBeenCalledWith({ workspaceId: "ws", id: "order" });
  expect(w.orders.listItems).toHaveBeenCalledWith({ workspaceId: "ws", orderId: "order" });
  expect(w.prices.findById).toHaveBeenCalledWith({ workspaceId: "ws", id: "price" });
});
it("raises the typed missing-order error before reading items or prices", async () => {
  const w = world(); w.state.order = null;
  await expect(w.run()).rejects.toBeInstanceOf(CommerceOrderNotFoundError);
  expect(w.orders.listItems).not.toHaveBeenCalled(); expect(w.prices.findById).not.toHaveBeenCalled();
});
it.each(["paid", "failed", "canceled"] as const)("refuses %s orders before further reads", async status => {
  const w = world(); w.state.order!.status = status;
  await expect(w.run()).rejects.toBeInstanceOf(CommerceCheckoutValidationError);
  expect(w.orders.listItems).not.toHaveBeenCalled(); expect(w.prices.findById).not.toHaveBeenCalled();
});
it.each([{ workspaceId: "other" }, { provider: "other" }])("refuses foreign order ownership", async change => {
  const w = world(); Object.assign(w.state.order!, change);
  await expect(w.run()).rejects.toBeInstanceOf(CommerceCheckoutValidationError); expect(w.orders.listItems).not.toHaveBeenCalled();
});
it("refuses a workspace that differs from the requested payment scope", async () => {
  const w = world();
  await expect(loadPayableOrder({ deps: w.deps, input: { ...input, scope: { ...scope, workspaceId: "other" } } })).rejects.toBeInstanceOf(CommerceCheckoutValidationError);
  expect(w.orders.listItems).not.toHaveBeenCalled();
});
it.each([0, 2])("refuses %s items before any price lookup", async count => {
  const w = world(); w.state.items = Array.from({ length: count }, () => w.state.items[0]!);
  await expect(w.run()).rejects.toBeInstanceOf(CommerceCheckoutValidationError); expect(w.prices.findById).not.toHaveBeenCalled();
});
it("raises the typed missing-price error", async () => {
  const w = world(); w.state.price = null; await expect(w.run()).rejects.toBeInstanceOf(CommercePriceNotFoundError);
});
it.each(["month", "year"] as const)("refuses recurring %s prices", async billingInterval => {
  const w = world(); w.state.price!.billingInterval = billingInterval;
  await expect(w.run()).rejects.toBeInstanceOf(CommerceCheckoutValidationError);
});
it.each([{ minorUnits: 368, currency: "USD" }, { minorUnits: 369, currency: "EUR" }])("refuses a total inconsistent with its snapshot", async total => {
  const w = world(); w.state.order!.totalAmount = total; await expect(w.run()).rejects.toBeInstanceOf(CommerceCheckoutValidationError);
});
it.each(["order", "items", "price"] as const)("propagates %s read failures", async step => {
  const w = world(), fault = new Error("storage unavailable");
  const calls = { order: w.orders.findById, items: w.orders.listItems, price: w.prices.findById };
  calls[step].mockRejectedValueOnce(fault); await expect(w.run()).rejects.toBe(fault);
});
