import assert from "node:assert/strict";
import test from "node:test";

import { CommerceCurrencyMismatchError } from "../../errors.js";
import {
  toOrderItemRecord,
  toOrderItemRow,
  toOrderRecord,
  toOrderRow,
  toPriceRecord,
  toPriceRow,
  toProductImageRecord,
  toProductImageRow,
  toProductRecord,
  toProductRow,
} from "../../repo.rows.js";
import type { CommerceOrderItemRecord, CommerceOrderRecord, CommercePriceRecord } from "../../types.js";

/**
 * Commerce design §6 (Money) at the persistence boundary: the host-owned `*_cents` columns keep
 * their names, every amount crosses as Money, lowercase legacy currency is normalized once here,
 * and nothing lowercase is written or returned.
 */

const AT = "2026-10-21T09:00:00.000Z";

const priceRecord: CommercePriceRecord = {
  id: "price-a", workspaceId: "ws-a", productId: "prod-a", unitAmount: { minorUnits: 2500, currency: "USD" },
  compareAtAmount: { minorUnits: 3000, currency: "USD" }, status: "active", createdAt: AT, version: 2,
};
const priceRow = {
  id: "price-a", workspace_id: "ws-a", product_id: "prod-a", unit_amount_cents: 2500, compare_at_amount_cents: 3000,
  currency: "USD", billing_interval: null, status: "active", created_at: AT, version: 2,
};

const orderRecord: CommerceOrderRecord = {
  id: "order-a", workspaceId: "ws-a", memberId: "member-a", status: "paid", totalAmount: { minorUnits: 5000, currency: "JPY" },
  provider: "regional-pay", providerCustomerRef: "cus_a", providerPaymentRef: "pay_a", providerEventAt: AT,
  placedAt: AT, createdAt: AT, updatedAt: AT, version: 3,
};
const orderRow = {
  id: "order-a", workspace_id: "ws-a", member_id: "member-a", status: "paid", currency: "JPY", total_amount_cents: 5000,
  provider: "regional-pay", provider_customer_ref: "cus_a", provider_payment_ref: "pay_a", provider_event_at: AT,
  placed_at: AT, created_at: AT, updated_at: AT, version: 3,
};

const itemRecord: CommerceOrderItemRecord = {
  id: "item-a", workspaceId: "ws-a", orderId: "order-a", priceId: "price-a", productId: "prod-a", description: "Teacup",
  unitAmount: { minorUnits: 2500, currency: "JPY" }, quantity: 2, createdAt: AT,
};
const itemRow = {
  id: "item-a", workspace_id: "ws-a", order_id: "order-a", price_id: "price-a", product_id: "prod-a", description: "Teacup",
  unit_amount_cents: 2500, quantity: 2, currency: "JPY", created_at: AT,
};

test("price, order and order-item Money round-trips through the unchanged *_cents columns", () => {
  assert.deepEqual(toPriceRow(priceRecord), priceRow);
  assert.deepEqual(toPriceRecord(priceRow), { ...priceRecord, billingInterval: undefined });
  assert.deepEqual(toOrderRow(orderRecord), orderRow);
  assert.deepEqual(toOrderRecord(orderRow), orderRecord);
  assert.deepEqual(toOrderItemRow(itemRecord), itemRow);
  assert.deepEqual(toOrderItemRecord(itemRow), itemRecord);
});

test("an order with no provider refs or event cursor writes SQL null and decodes as undefined", () => {
  const pending = { ...orderRecord, status: "pending" as const, providerCustomerRef: undefined, providerPaymentRef: undefined, providerEventAt: undefined };
  const pendingRow = { ...orderRow, status: "pending", provider_customer_ref: null, provider_payment_ref: null, provider_event_at: null };
  assert.deepEqual(toOrderRow(pending), pendingRow);
  assert.deepEqual(toOrderRecord(pendingRow), pending);
});

test("legacy lowercase rows read back UPPERCASE", () => {
  assert.deepEqual(toPriceRecord({ ...priceRow, currency: "usd" }), { ...priceRecord, billingInterval: undefined });
  assert.deepEqual(toOrderRecord({ ...orderRow, currency: "jpy" }), orderRecord);
  assert.deepEqual(toOrderItemRecord({ ...itemRow, currency: "jpy" }), itemRecord);
});

test("lowercase currency on write is normalized once, at the row boundary, and stored UPPERCASE", () => {
  const usd = { minorUnits: 2500, currency: "usd" };
  assert.deepEqual(toPriceRow({ ...priceRecord, unitAmount: usd, compareAtAmount: { minorUnits: 3000, currency: " Usd " } }), priceRow);
  assert.deepEqual(toOrderRow({ ...orderRecord, totalAmount: { minorUnits: 5000, currency: "jpy" } }), orderRow);
  assert.deepEqual(toOrderItemRow({ ...itemRecord, unitAmount: { minorUnits: 2500, currency: "jpy" } }), itemRow);
});

test("a value that is not Money is refused on write, before any row is produced", () => {
  assert.throws(() => toPriceRow({ ...priceRecord, unitAmount: { minorUnits: 2500, currency: "dollars" } }), new RangeError("currency must be an uppercase ISO-4217 alpha-3 code, got 'dollars'"));
  assert.throws(() => toPriceRow({ ...priceRecord, compareAtAmount: { minorUnits: 1.5, currency: "USD" } }), new RangeError("minorUnits must be a safe integer number of minor units"));
  assert.throws(() => toOrderRow({ ...orderRecord, totalAmount: { minorUnits: -1, currency: "JPY" } }), new RangeError("minorUnits must not be negative"));
  assert.throws(() => toOrderItemRow({ ...itemRecord, unitAmount: { minorUnits: 1, currency: "" } }), new RangeError("currency must be an uppercase ISO-4217 alpha-3 code, got ''"));
});

test("a compare-at amount in a different currency than the unit amount is refused with a typed error", () => {
  // The row has one currency column; silently storing EUR minor units under USD would misprice it.
  assert.throws(() => toPriceRow({ ...priceRecord, compareAtAmount: { minorUnits: 3000, currency: "eur" } }), (error: unknown) => {
    assert.ok(error instanceof CommerceCurrencyMismatchError);
    assert.equal(error.expected, "USD");
    assert.equal(error.actual, "EUR");
    return true;
  });
});

test("a stored row whose currency is not an alpha-3 code fails loudly on read instead of returning non-Money", () => {
  assert.throws(() => toPriceRecord({ ...priceRow, currency: "us$" }), new RangeError("currency must be an uppercase ISO-4217 alpha-3 code, got 'us$'"));
});

test("product and product-image rows map every column; NULL columns decode as undefined and specs round-trip as compact JSON", () => {
  const specs = [{ label: "Material", value: "Linen" }];
  const product = {
    id: "prod-a", workspaceId: "ws-a", name: "Notebook", slug: "notebook", kind: "membership" as const, status: "active" as const,
    description: "Plain", grantsMemberTierId: "tier-a", specs, createdAt: AT, updatedAt: AT, version: 4,
  };
  const productRow = {
    id: "prod-a", workspace_id: "ws-a", name: "Notebook", slug: "notebook", kind: "membership", status: "active",
    description: "Plain", grants_member_tier_id: "tier-a", specs_json: '[{"label":"Material","value":"Linen"}]', created_at: AT, updated_at: AT, version: 4,
  };
  assert.deepEqual(toProductRow(product), productRow);
  assert.deepEqual(toProductRecord(productRow), product);
  const bare = { ...product, description: undefined, grantsMemberTierId: undefined, specs: undefined };
  const bareRow = { ...productRow, description: null, grants_member_tier_id: null, specs_json: null };
  assert.deepEqual(toProductRow(bare), bareRow);
  assert.deepEqual(toProductRecord(bareRow), bare);

  const image = { id: "img-a", workspaceId: "ws-a", productId: "prod-a", mediaId: "media-a", position: 2, createdAt: AT };
  const imageRow = { id: "img-a", workspace_id: "ws-a", product_id: "prod-a", media_id: "media-a", position: 2, created_at: AT };
  assert.deepEqual(toProductImageRow(image), imageRow);
  assert.deepEqual(toProductImageRecord(imageRow), image);
});
