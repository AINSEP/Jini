import assert from "node:assert/strict";
import test from "node:test";

import { moneyProblem } from "../../../money/money.js";
import { checkout, MAX_CHECKOUT_QUANTITY, orderTotal } from "../../checkout.js";
import type { CheckoutDeps } from "../../checkout.js";
import {
  CommerceCheckoutValidationError,
  CommerceCurrencyMismatchError,
  CommercePriceNotFoundError,
  CommerceProductNotFoundError,
} from "../../errors.js";
import type { CommerceOrderItemRecord, CommerceOrderRecord, CommercePriceRecord, CommerceProductRecord } from "../../types.js";

const NOW = "2026-10-21T12:00:00.000Z";

function product(overrides: Partial<CommerceProductRecord> = {}): CommerceProductRecord {
  return { id: "prod-1", workspaceId: "ws-1", name: "Linen Notebook", slug: "linen-notebook", kind: "one_time", status: "active", createdAt: NOW, updatedAt: NOW, version: 1, ...overrides };
}

function price(overrides: Partial<CommercePriceRecord> = {}): CommercePriceRecord {
  return { id: "price-1", workspaceId: "ws-1", productId: "prod-1", unitAmount: { minorUnits: 1600, currency: "USD" }, status: "active", createdAt: NOW, version: 1, ...overrides };
}

/** In-memory ports; `placed` records what `placeOrder` received so a test can prove nothing was written. */
function harness({ priceRow = price(), productRow = product() }: { priceRow?: CommercePriceRecord | null; productRow?: CommerceProductRecord | null } = {}) {
  const placed: Array<{ order: CommerceOrderRecord; items: readonly CommerceOrderItemRecord[] }> = [];
  let next = 0;
  const deps: CheckoutDeps = {
    products: { findById: async ({ id }) => (productRow && productRow.id === id ? productRow : null), findBySlug: async () => null, listActive: async () => [], save: async () => {} },
    prices: { findById: async ({ id }) => (priceRow && priceRow.id === id ? priceRow : null), listByProduct: async () => [], save: async () => {} },
    orders: { markPaid: async () => { throw new Error("checkout must not settle"); }, findById: async () => null, listItems: async () => [], placeOrder: async (input) => { placed.push(input); } },
    clock: { nowMs: () => Date.parse(NOW) },
    idGen: { newId: () => `id-${++next}` },
  };
  return { deps, placed };
}

const input = { workspaceId: "ws-1", memberId: "member-1", priceId: "price-1", provider: "regional-pay" };

test("checkout: snapshots the price as Money into a pending order whose total passes the payments kernel's moneyProblem", async () => {
  const { deps, placed } = harness();
  const result = await checkout({ deps, input: { ...input, quantity: 3, providerCustomerRef: "cus_9" } });
  assert.deepEqual(result.order, {
    id: "id-1", workspaceId: "ws-1", memberId: "member-1", status: "pending", totalAmount: { minorUnits: 4800, currency: "USD" },
    provider: "regional-pay", providerCustomerRef: "cus_9", placedAt: NOW, createdAt: NOW, updatedAt: NOW, version: 1,
  });
  assert.deepEqual(result.items, [{
    id: "id-2", workspaceId: "ws-1", orderId: "id-1", priceId: "price-1", productId: "prod-1", description: "Linen Notebook",
    unitAmount: { minorUnits: 1600, currency: "USD" }, quantity: 3, createdAt: NOW,
  }]);
  // Design gap (Gemini b): before Money, a catalog order carried "usd" and failed this exact check.
  assert.equal(moneyProblem({ money: result.order.totalAmount }), null);
  assert.equal(moneyProblem({ money: result.items[0]!.unitAmount }), null);
  assert.deepEqual(placed, [{ order: result.order, items: result.items }]);
});

test("checkout: quantity defaults to 1", async () => {
  const { deps } = harness();
  const result = await checkout({ deps, input });
  assert.deepEqual(result.order.totalAmount, { minorUnits: 1600, currency: "USD" });
  assert.equal(result.items[0]!.quantity, 1);
});

test("checkout: refuses a quantity that is not an integer in 1..MAX_CHECKOUT_QUANTITY, writing nothing", async () => {
  for (const quantity of [0, MAX_CHECKOUT_QUANTITY + 1, 1.5]) {
    const { deps, placed } = harness();
    await assert.rejects(checkout({ deps, input: { ...input, quantity } }), (error: unknown) => {
      assert.ok(error instanceof CommerceCheckoutValidationError);
      assert.deepEqual(error.fieldErrors, [{ field: "quantity", reason: `must be an integer between 1 and ${MAX_CHECKOUT_QUANTITY}` }]);
      return true;
    });
    assert.deepEqual(placed, []);
  }
  const { deps } = harness();
  assert.equal((await checkout({ deps, input: { ...input, quantity: MAX_CHECKOUT_QUANTITY } })).items[0]!.quantity, MAX_CHECKOUT_QUANTITY);
});

test("checkout: a missing or archived price is not found", async () => {
  for (const priceRow of [null, price({ status: "archived" })]) {
    const { deps, placed } = harness({ priceRow });
    await assert.rejects(checkout({ deps, input }), new CommercePriceNotFoundError("price 'price-1' was not found"));
    assert.deepEqual(placed, []);
  }
});

test("checkout: a missing or archived product is not found", async () => {
  for (const productRow of [null, product({ status: "archived" })]) {
    const { deps, placed } = harness({ productRow });
    await assert.rejects(checkout({ deps, input }), new CommerceProductNotFoundError("product 'prod-1' was not found"));
    assert.deepEqual(placed, []);
  }
});

test("checkout: a line total past the safe-integer range is refused, never rounded", async () => {
  const { deps, placed } = harness({ priceRow: price({ unitAmount: { minorUnits: Number.MAX_SAFE_INTEGER, currency: "USD" } }) });
  await assert.rejects(checkout({ deps, input: { ...input, quantity: 2 } }), (error: unknown) => {
    assert.ok(error instanceof CommerceCheckoutValidationError);
    assert.equal(error.message, "line total exceeds the safe integer range");
    assert.deepEqual(error.fieldErrors, [{ field: "quantity", reason: "line total exceeds the safe integer range" }]);
    return true;
  });
  assert.deepEqual(placed, []);
});

test("orderTotal: sums same-currency lines with exact integer arithmetic", () => {
  assert.deepEqual(orderTotal({ lines: [
    { unitAmount: { minorUnits: 1999, currency: "EUR" }, quantity: 2 },
    { unitAmount: { minorUnits: 1, currency: "EUR" }, quantity: 3 },
  ] }), { minorUnits: 4001, currency: "EUR" });
});

test("orderTotal: mixed currencies are refused with a typed error, never summed", () => {
  assert.throws(() => orderTotal({ lines: [
    { unitAmount: { minorUnits: 1000, currency: "USD" }, quantity: 1 },
    { unitAmount: { minorUnits: 1000, currency: "KES" }, quantity: 1 },
  ] }), (error: unknown) => {
    assert.ok(error instanceof CommerceCurrencyMismatchError);
    assert.equal(error.expected, "USD");
    assert.equal(error.actual, "KES");
    assert.equal(error.message, "currency mismatch: expected USD, got KES");
    return true;
  });
});

test("orderTotal: a sum past the safe-integer range is refused with the typed validation error", () => {
  const half = 2 ** 52;
  assert.throws(() => orderTotal({ lines: [
    { unitAmount: { minorUnits: half, currency: "USD" }, quantity: 1 },
    { unitAmount: { minorUnits: half, currency: "USD" }, quantity: 1 },
  ] }), (error: unknown) => {
    assert.ok(error instanceof CommerceCheckoutValidationError);
    assert.equal(error.message, "order total exceeds the safe integer range");
    assert.deepEqual(error.fieldErrors, [{ field: "quantity", reason: "order total exceeds the safe integer range" }]);
    return true;
  });
});

test("orderTotal: validates each line itself (public API) — quantity positive integer, unit amount normalized Money", () => {
  const usd = (minorUnits: number, currency = "USD") => ({ unitAmount: { minorUnits, currency }, quantity: 1 });
  for (const quantity of [-3, 0, 0.5, Number.NaN]) {
    assert.throws(() => orderTotal({ lines: [{ ...usd(100), quantity }] }), (e: Error & { fieldErrors?: { field: string }[] }) =>
      e.message === "quantity must be a positive integer" && e.fieldErrors?.[0]?.field === "quantity");
  }
  assert.throws(() => orderTotal({ lines: [usd(-50)] }), (e: Error & { fieldErrors?: { field: string }[] }) =>
    /^invalid unit amount: minorUnits must not be negative/.test(e.message) && e.fieldErrors?.[0]?.field === "unitAmount");
  assert.deepEqual(orderTotal({ lines: [usd(100, "usd"), usd(50)] }), { minorUnits: 150, currency: "USD" });
  assert.deepEqual(orderTotal({ lines: [usd(0)] }), { minorUnits: 0, currency: "USD" });
});
