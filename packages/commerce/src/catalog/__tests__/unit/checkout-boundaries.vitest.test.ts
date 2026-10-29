import { describe, expect, test } from "vitest";
import {
  checkout, MAX_CHECKOUT_QUANTITY, orderTotal, CommerceCheckoutValidationError,
  CommerceCurrencyMismatchError, CommercePriceNotFoundError, CommerceProductNotFoundError,
} from "../../../index.js";
import type { CheckoutDeps, CheckoutInput, CommercePriceRecord, CommerceProductRecord } from "../../../index.js";

const AT = "2026-10-21T09:00:00.000Z";
const input: CheckoutInput = { workspaceId: "ws-a", memberId: "member-a", priceId: "price-a", provider: "regional-pay" };
const product: CommerceProductRecord = { id: "prod-a", workspaceId: "ws-a", name: "Notebook", slug: "notebook",
  kind: "one_time", status: "active", createdAt: AT, updatedAt: AT, version: 1 };
const price: CommercePriceRecord = { id: "price-a", workspaceId: "ws-a", productId: "prod-a",
  unitAmount: { minorUnits: 2701, currency: "KWD" }, status: "active", createdAt: AT, version: 1 };

function ports(rows: { product?: CommerceProductRecord | null; price?: CommercePriceRecord | null } = {}) {
  const reads: unknown[] = [];
  const writes: Parameters<CheckoutDeps["orders"]["placeOrder"]>[0][] = [];
  const p = rows.product === undefined ? product : rows.product;
  const r = rows.price === undefined ? price : rows.price;
  let ids = 0;
  const deps: CheckoutDeps = {
    products: {
      findById: async key => { reads.push(key); return p?.id === key.id && p.workspaceId === key.workspaceId ? p : null; },
      findBySlug: async () => null, listActive: async () => [], save: async () => {},
    },
    prices: {
      findById: async key => { reads.push(key); return r?.id === key.id && r.workspaceId === key.workspaceId ? r : null; },
      listByProduct: async () => [], save: async () => {},
    },
    orders: { findById: async () => null, listItems: async () => [], placeOrder: async value => { writes.push(value); } },
    clock: { nowMs: () => Date.parse(AT) }, idGen: { newId: () => `id-${++ids}` },
  };
  return { deps, reads, writes };
}

describe("checkout validation and exact totals", () => {
  test.each([[undefined, 2701], [1, 2701], [99, 267399], [100, 270100]] as const)("quantity %s creates a pending order with exact minor units and fixed timestamps", async (quantity, total) => {
    const w = ports();
    const result = await checkout({ deps: w.deps, input: { ...input, quantity, providerCustomerRef: "cus-a" } });
    expect(MAX_CHECKOUT_QUANTITY).toBe(100);
    expect(result.order).toEqual({ id: "id-1", workspaceId: "ws-a", memberId: "member-a", status: "pending",
      totalAmount: { minorUnits: total, currency: "KWD" }, provider: "regional-pay", providerCustomerRef: "cus-a",
      placedAt: AT, createdAt: AT, updatedAt: AT, version: 1 });
    expect(result.items).toEqual([{ id: "id-2", workspaceId: "ws-a", orderId: "id-1", priceId: "price-a", productId: "prod-a",
      description: "Notebook", unitAmount: { minorUnits: 2701, currency: "KWD" }, quantity: quantity ?? 1, createdAt: AT }]);
    expect(w.reads).toEqual([{ workspaceId: "ws-a", id: "price-a" }, { workspaceId: "ws-a", id: "prod-a" }]);
    expect(w.writes).toEqual([result]);
  });

  test.each([-1, 0, 0.5, 101, NaN, Infinity])("quantity %s is rejected before any repository read or write", async quantity => {
    const w = ports();
    await expect(checkout({ deps: w.deps, input: { ...input, quantity } })).rejects.toMatchObject({
      constructor: CommerceCheckoutValidationError, message: "quantity must be an integer between 1 and 100",
      fieldErrors: [{ field: "quantity", reason: "must be an integer between 1 and 100" }],
    });
    expect(w.reads).toEqual([]);
    expect(w.writes).toEqual([]);
  });

  test.each([null, { ...price, status: "archived" as const }, { ...price, workspaceId: "ws-b" }])(
    "a missing, archived or foreign price cannot be checked out", async row => {
      const w = ports({ price: row });
      await expect(checkout({ deps: w.deps, input })).rejects.toEqual(new CommercePriceNotFoundError("price 'price-a' was not found"));
      expect(w.reads).toEqual([{ workspaceId: "ws-a", id: "price-a" }]);
      expect(w.writes).toEqual([]);
    });

  test.each([null, { ...product, status: "archived" as const }, { ...product, workspaceId: "ws-b" }])(
    "a missing, archived or foreign product cannot be checked out", async row => {
      const w = ports({ product: row });
      await expect(checkout({ deps: w.deps, input })).rejects.toEqual(new CommerceProductNotFoundError("product 'prod-a' was not found"));
      expect(w.writes).toEqual([]);
    });

  test("unsafe multiplication cannot persist a rounded order", async () => {
    const w = ports({ price: { ...price, unitAmount: { minorUnits: Number.MAX_SAFE_INTEGER, currency: "KWD" } } });
    await expect(checkout({ deps: w.deps, input: { ...input, quantity: 2 } })).rejects.toMatchObject({
      constructor: CommerceCheckoutValidationError, message: "line total exceeds the safe integer range",
      fieldErrors: [{ field: "quantity", reason: "line total exceeds the safe integer range" }],
    });
    expect(w.writes).toEqual([]);
  });

  test("free items are valid catalog purchases and absent customer refs remain absent", async () => {
    const w = ports({ price: { ...price, unitAmount: { minorUnits: 0, currency: "JPY" } } });
    const result = await checkout({ deps: w.deps, input });
    expect(result.order.totalAmount).toEqual({ minorUnits: 0, currency: "JPY" });
    expect(result.order.providerCustomerRef).toBeUndefined();
    expect(result.items[0]?.unitAmount).toEqual({ minorUnits: 0, currency: "JPY" });
    expect(w.writes).toEqual([result]);
  });

  test("a failing repository propagates its error instead of returning a successful checkout", async () => {
    const w = ports();
    const fault = new Error("write unavailable");
    w.deps.orders.placeOrder = async () => { throw fault; };
    await expect(checkout({ deps: w.deps, input })).rejects.toBe(fault);
    expect(w.writes).toEqual([]);
  });
});

describe("public orderTotal", () => {
  test("normalizes currency and sums three lines without rounding or input mutation", () => {
    const lines = [
      { unitAmount: { minorUnits: 2701, currency: " kwd " }, quantity: 3 },
      { unitAmount: { minorUnits: 0, currency: "KWD" }, quantity: 100 },
      { unitAmount: { minorUnits: 1, currency: "KWD" }, quantity: 2 },
    ] as const;
    expect(orderTotal({ lines })).toEqual({ minorUnits: 8105, currency: "KWD" });
    expect(lines[0]).toEqual({ unitAmount: { minorUnits: 2701, currency: " kwd " }, quantity: 3 });
    expect(orderTotal({ lines: [{ unitAmount: { minorUnits: Number.MAX_SAFE_INTEGER, currency: "JPY" }, quantity: 1 }] }))
      .toEqual({ minorUnits: Number.MAX_SAFE_INTEGER, currency: "JPY" });
  });

  test.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("line quantity %s is refused with a typed error", quantity => {
    expect(() => orderTotal({ lines: [{ unitAmount: { minorUnits: 1, currency: "USD" }, quantity }] })).toThrow(
      expect.objectContaining({ constructor: CommerceCheckoutValidationError, message: "quantity must be a positive integer",
        fieldErrors: [{ field: "quantity", reason: "quantity must be a positive integer" }] }));
  });

  test.each([
    [{ minorUnits: -1, currency: "USD" }, "minorUnits must not be negative"],
    [{ minorUnits: 1.5, currency: "USD" }, "minorUnits must be a safe integer number of minor units"],
    [{ minorUnits: 1, currency: "US$" }, "currency must be an uppercase ISO-4217 alpha-3 code, got 'US$'"],
  ] as const)("invalid unit amount %j is surfaced as checkout validation", (unitAmount, reason) => {
    expect(() => orderTotal({ lines: [{ unitAmount, quantity: 1 }] })).toThrow(expect.objectContaining({
      constructor: CommerceCheckoutValidationError, message: `invalid unit amount: ${reason}`, fieldErrors: [{ field: "unitAmount", reason }],
    }));
  });

  test("a mixed currency is refused with both currency codes", () => {
    expect(() => orderTotal({ lines: [
      { unitAmount: { minorUnits: 100, currency: "USD" }, quantity: 1 },
      { unitAmount: { minorUnits: 100, currency: "KES" }, quantity: 1 },
    ] })).toThrow(expect.objectContaining({ constructor: CommerceCurrencyMismatchError,
      message: "currency mismatch: expected USD, got KES", expected: "USD", actual: "KES" }));
  });

  test("safe individual lines cannot overflow the order total", () => {
    expect(() => orderTotal({ lines: [
      { unitAmount: { minorUnits: Number.MAX_SAFE_INTEGER, currency: "USD" }, quantity: 1 },
      { unitAmount: { minorUnits: 1, currency: "USD" }, quantity: 1 },
    ] })).toThrow(expect.objectContaining({ constructor: CommerceCheckoutValidationError,
      message: "order total exceeds the safe integer range",
      fieldErrors: [{ field: "quantity", reason: "order total exceeds the safe integer range" }] }));
  });
});
