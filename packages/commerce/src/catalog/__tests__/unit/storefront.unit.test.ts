import assert from "node:assert/strict";
import test from "node:test";

import { pickDisplayPrice, toSiteProduct, toSiteProducts } from "../../storefront.js";
import type { CommercePriceRecord, CommerceProductRecord } from "../../types.js";

const NOW = "2026-08-12T00:00:00.000Z";

function product(overrides: Partial<CommerceProductRecord> = {}): CommerceProductRecord {
  return {
    id: "product-1",
    workspaceId: "ws-1",
    name: "Classic Boxy Tee",
    slug: "classic-boxy-tee",
    kind: "one_time",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function price(overrides: Partial<CommercePriceRecord> = {}): CommercePriceRecord {
  return {
    id: "price-1",
    workspaceId: "ws-1",
    productId: "product-1",
    unitAmountCents: 3500,
    currency: "usd",
    status: "active",
    createdAt: NOW,
    version: 1,
    ...overrides,
  };
}

test("pickDisplayPrice: returns null when no price is active", () => {
  assert.equal(pickDisplayPrice({ prices: [price({ status: "archived" })] }), null);
  assert.equal(pickDisplayPrice({ prices: [] }), null);
});

test("pickDisplayPrice: prefers a one-time price over a recurring one", () => {
  const monthly = price({ id: "price-monthly", unitAmountCents: 1000, billingInterval: "month" });
  const oneTime = price({ id: "price-one-time", unitAmountCents: 3500 });
  assert.equal(pickDisplayPrice({ prices: [monthly, oneTime] })?.id, "price-one-time");
});

test("pickDisplayPrice: among ties, picks the cheapest", () => {
  const cheap = price({ id: "cheap", unitAmountCents: 1000 });
  const expensive = price({ id: "expensive", unitAmountCents: 5000 });
  assert.equal(pickDisplayPrice({ prices: [expensive, cheap] })?.id, "cheap");
});

test("pickDisplayPrice: an archived price is never picked even if it's cheaper", () => {
  const archived = price({ id: "archived", unitAmountCents: 1, status: "archived" });
  const active = price({ id: "active", unitAmountCents: 5000, status: "active" });
  assert.equal(pickDisplayPrice({ prices: [archived, active] })?.id, "active");
});

test("toSiteProduct: maps name -> title, unitAmountCents -> price, compareAtAmountCents -> compareAtPrice, currency -> currency", () => {
  const result = toSiteProduct({
    product: product({ name: "Classic Boxy Tee" }),
    price: price({ unitAmountCents: 3500, compareAtAmountCents: 4500, currency: "usd" }),
  });
  assert.deepEqual(result, {
    id: "product-1",
    slug: "classic-boxy-tee",
    title: "Classic Boxy Tee",
    price: 3500,
    compareAtPrice: 4500,
    currency: "usd",
    specs: undefined,
  });
});

test("toSiteProduct: specs pass through unchanged, in author-chosen order -- safe because product.liquid renders spec.label/spec.value escaped (no `| raw`), unlike description", () => {
  const specs = [{ label: "Material", value: "Combed cotton" }, { label: "Care", value: "Machine wash cold" }];
  const result = toSiteProduct({ product: product({ specs }), price: price() });
  assert.deepEqual(result.specs, specs);
});

test("toSiteProduct: specs is undefined, not an empty array, when the product has none", () => {
  const result = toSiteProduct({ product: product({ specs: undefined }), price: price() });
  assert.equal(result.specs, undefined);
});

test("toSiteProduct: compareAtPrice is undefined, not present-but-null, when not on sale", () => {
  const result = toSiteProduct({ product: product(), price: price({ compareAtAmountCents: undefined }) });
  assert.equal(result.compareAtPrice, undefined);
});

test("toSiteProducts: a product with no active price is skipped, not thrown or rendered priceless", () => {
  const priced = product({ id: "priced", name: "Priced" });
  const unpriced = product({ id: "unpriced", name: "Unpriced" });
  const result = toSiteProducts({ items: [
    { product: priced, prices: [price({ productId: "priced" })] },
    { product: unpriced, prices: [] },
  ] });
  assert.deepEqual(
    result.map((p) => p.id),
    ["priced"]
  );
});

test("toSiteProducts: images/stock are absent from the mapped shape (not fabricated -- see file header)", () => {
  const [result] = toSiteProducts({ items: [{ product: product(), prices: [price()] }] });
  assert.equal("images" in result, false);
  assert.equal("stock" in result, false);
});

test("toSiteProducts: description is absent from the mapped shape even when the source product has one -- product.liquid renders description via `| raw` (unescaped), and Commerce's description column has no HTML-sanitization contract (see file header); wiring it through here would be a live XSS hole the moment any text containing markup reaches it", () => {
  const [result] = toSiteProducts({ items: [
    { product: product({ description: "<script>alert(1)</script>" }), prices: [price()] },
  ] });
  assert.equal("description" in result, false);
});

test("recurring-only products use the cheapest active price across billing intervals", () => {
  const annual = price({ id: "annual", billingInterval: "year", unitAmountCents: 9000 });
  const monthly = price({ id: "monthly", billingInterval: "month", unitAmountCents: 1200 });
  const archived = price({ id: "archived-monthly", billingInterval: "month", unitAmountCents: 100, status: "archived" });
  assert.deepEqual(pickDisplayPrice({ prices: [annual, archived, monthly] }), monthly);
  assert.deepEqual(toSiteProducts({ items: [{ product: product({ kind: "membership" }), prices: [annual, archived, monthly] }] }), [{
    id: "product-1", slug: "classic-boxy-tee", title: "Classic Boxy Tee", price: 1200,
    currency: "usd", compareAtPrice: undefined, specs: undefined,
  }]);
});
