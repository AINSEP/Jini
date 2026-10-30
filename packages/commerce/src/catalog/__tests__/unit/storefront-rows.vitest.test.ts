import { describe, expect, test } from "vitest";
import { CommerceCurrencyMismatchError, pickDisplayPrice, toSiteProduct, toSiteProducts } from "../../../index.js";
import type { CommerceOrderItemRecord, CommerceOrderRecord, CommercePriceRecord, CommerceProductRecord } from "../../../index.js";
import { toOrderItemRecord, toOrderItemRow, toOrderRecord, toOrderRow, toPriceRecord, toPriceRow,
  toProductImageRecord, toProductImageRow, toProductRecord, toProductRow, toWebhookEventRow } from "../../repo.rows.js";

const AT = "2026-10-21T09:00:00.000Z";
const product: CommerceProductRecord = { id: "product-a", workspaceId: "ws-a", name: "Notebook", slug: "linen-notebook",
  kind: "one_time", status: "active", createdAt: AT, updatedAt: AT, version: 2 };
const price: CommercePriceRecord = { id: "price-a", workspaceId: "ws-a", productId: "product-a", unitAmount: { minorUnits: 2701, currency: "KWD" },
  status: "active", createdAt: AT, version: 3 };

describe("storefront price selection", () => {
  test("no active prices produces no card", () => {
    expect(pickDisplayPrice({ prices: [] })).toBeNull();
    expect(pickDisplayPrice({ prices: [{ ...price, status: "archived" }] })).toBeNull();
    expect(toSiteProducts({ items: [{ product, prices: [] }, { product, prices: [{ ...price, status: "archived" }] }] })).toEqual([]);
  });

  test("one-time prices outrank recurring prices, the lowest active price wins and equal prices retain input order", () => {
    const prices: CommercePriceRecord[] = [
      { ...price, id: "monthly", billingInterval: "month", unitAmount: { minorUnits: 1, currency: "KWD" } },
      { ...price, id: "expensive", unitAmount: { minorUnits: 5000, currency: "KWD" } },
      { ...price, id: "cheap" }, { ...price, id: "equal" },
      { ...price, id: "archived", status: "archived", unitAmount: { minorUnits: 0, currency: "KWD" } },
    ];
    expect(pickDisplayPrice({ prices })?.id).toBe("cheap");
    expect(prices.map(p => p.id)).toEqual(["monthly", "expensive", "cheap", "equal", "archived"]);
    expect(pickDisplayPrice({ prices: [prices[3]!, prices[2]!, prices[1]!] })?.id).toBe("equal");
  });

  test("recurring-only catalogs choose the lowest active amount across month and year", () => {
    expect(pickDisplayPrice({ prices: [
      { ...price, id: "year", billingInterval: "year", unitAmount: { minorUnits: 9000, currency: "KWD" } },
      { ...price, id: "month", billingInterval: "month" },
      { ...price, id: "archived", billingInterval: "month", status: "archived", unitAmount: { minorUnits: 1, currency: "KWD" } },
    ] })?.id).toBe("month");
  });

  test("public cards retain slug, currency and specs while omitting unsafe descriptions and invented stock or images", () => {
    const specs = [{ label: "Material", value: "<b>Linen</b>" }, { label: "Size", value: "A5" }];
    const source = { ...product, description: "<script>alert(1)</script>", specs };
    expect(toSiteProduct({ product: source, price: { ...price, compareAtAmount: { minorUnits: 3701, currency: "KWD" } } })).toEqual({
      id: "product-a", slug: "linen-notebook", title: "Notebook", price: 2701, compareAtPrice: 3701, currency: "KWD", specs,
    });
    expect(toSiteProducts({ items: [
      { product: { ...source, id: "unpriced" }, prices: [] }, { product: source, prices: [price] },
      { product: { ...product, id: "free", slug: "free" }, prices: [{ ...price, unitAmount: { minorUnits: 0, currency: "JPY" } }] },
    ] })).toEqual([
      { id: "product-a", slug: "linen-notebook", title: "Notebook", price: 2701, compareAtPrice: undefined, currency: "KWD", specs },
      { id: "free", slug: "free", title: "Notebook", price: 0, compareAtPrice: undefined, currency: "JPY", specs: undefined },
    ]);
  });
});

describe("catalog persistence mappings", () => {
  test("product mappings preserve populated values and distinguish empty strings and specs from absent fields", () => {
    const row = { id: "product-a", workspace_id: "ws-a", name: "Notebook", slug: "linen-notebook", kind: "one_time", status: "active",
      description: "", grants_member_tier_id: "tier-a", specs_json: "[]", created_at: AT, updated_at: AT, version: 2 };
    const record = { ...product, description: "", grantsMemberTierId: "tier-a", specs: [] };
    expect(toProductRow(record)).toEqual(row);
    expect(toProductRecord(row)).toEqual(record);
    expect(toProductRow(product)).toEqual({ ...row, description: null, grants_member_tier_id: null, specs_json: null });
    expect(toProductRecord({ ...row, description: null, grants_member_tier_id: null, specs_json: null })).toEqual({
      ...product, description: undefined, grantsMemberTierId: undefined, specs: undefined,
    });
    const specs = [{ label: "Material", value: "Linen" }];
    expect(toProductRow({ ...product, specs }).specs_json).toBe('[{"label":"Material","value":"Linen"}]');
    expect(toProductRecord({ ...row, specs_json: '[{"label":"Material","value":"Linen"}]' }).specs).toEqual(specs);
    expect(() => toProductRecord({ ...row, specs_json: "{" })).toThrow(SyntaxError);
  });

  test("image mappings preserve all identity and gallery ordering columns", () => {
    const row = { id: "image-a", workspace_id: "ws-a", product_id: "product-a", media_id: "media-a", position: 7, created_at: AT };
    const record = { id: "image-a", workspaceId: "ws-a", productId: "product-a", mediaId: "media-a", position: 7, createdAt: AT };
    expect(toProductImageRow(record)).toEqual(row);
    expect(toProductImageRecord(row)).toEqual(record);
  });

  test.each([undefined, 0, 3701])("price mappings normalize currency and preserve compare-at amount %s", compareAt => {
    const record = { ...price, unitAmount: { minorUnits: 0, currency: " kwd " }, billingInterval: "year" as const,
      compareAtAmount: compareAt === undefined ? undefined : { minorUnits: compareAt, currency: "kwd" } };
    const row = { id: "price-a", workspace_id: "ws-a", product_id: "product-a", unit_amount_cents: 0,
      compare_at_amount_cents: compareAt ?? null, currency: "KWD", billing_interval: "year", status: "active", created_at: AT, version: 3 };
    expect(toPriceRow(record)).toEqual(row);
    expect(toPriceRecord({ ...row, currency: "kwd" })).toEqual({ ...record, unitAmount: { minorUnits: 0, currency: "KWD" },
      compareAtAmount: compareAt === undefined ? undefined : { minorUnits: compareAt, currency: "KWD" } });
    expect(toPriceRow({ ...price }).billing_interval).toBeNull();
    expect(toPriceRecord({ ...row, billing_interval: null }).billingInterval).toBeUndefined();
  });

  test("a price cannot persist compare-at minor units under a different currency", () => {
    expect(() => toPriceRow({ ...price, compareAtAmount: { minorUnits: 3701, currency: "USD" } })).toThrow(
      expect.objectContaining({ constructor: CommerceCurrencyMismatchError, expected: "KWD", actual: "USD", message: "currency mismatch: expected KWD, got USD" }));
  });

  test("order mappings preserve provider references and cursor, and convert absent optionals to SQL null", () => {
    const record: CommerceOrderRecord = { id: "order-a", workspaceId: "ws-a", memberId: "member-a", status: "paid",
      totalAmount: { minorUnits: 5402, currency: "kwd" }, provider: "regional", providerCustomerRef: "cus-a", providerPaymentRef: "pay-a",
      providerEventAt: AT, placedAt: AT, createdAt: AT, updatedAt: "2026-10-22T09:00:00.000Z", version: 4 };
    const row = { id: "order-a", workspace_id: "ws-a", member_id: "member-a", status: "paid", total_amount_cents: 5402, currency: "KWD",
      provider: "regional", provider_customer_ref: "cus-a", provider_payment_ref: "pay-a", provider_event_at: AT, placed_at: AT, created_at: AT,
      updated_at: "2026-10-22T09:00:00.000Z", version: 4 };
    expect(toOrderRow(record)).toEqual(row);
    expect(toOrderRecord({ ...row, currency: "kwd" })).toEqual({ ...record, totalAmount: { minorUnits: 5402, currency: "KWD" } });
    expect(toOrderRow({ ...record, providerCustomerRef: undefined, providerPaymentRef: undefined, providerEventAt: undefined })).toEqual({
      ...row, provider_customer_ref: null, provider_payment_ref: null, provider_event_at: null,
    });
    expect(toOrderRecord({ ...row, provider_customer_ref: null, provider_payment_ref: null, provider_event_at: null })).toEqual({
      ...record, totalAmount: { minorUnits: 5402, currency: "KWD" }, providerCustomerRef: undefined, providerPaymentRef: undefined, providerEventAt: undefined,
    });
  });

  test("line-item mappings preserve snapshotted price and quantity independently of the current catalog", () => {
    const record: CommerceOrderItemRecord = { id: "item-a", workspaceId: "ws-a", orderId: "order-a", priceId: "price-a", productId: "product-a",
      description: "Linen Notebook", unitAmount: { minorUnits: 2701, currency: "kwd" }, quantity: 3, createdAt: AT };
    const row = { id: "item-a", workspace_id: "ws-a", order_id: "order-a", price_id: "price-a", product_id: "product-a",
      description: "Linen Notebook", unit_amount_cents: 2701, currency: "KWD", quantity: 3, created_at: AT };
    expect(toOrderItemRow(record)).toEqual(row);
    expect(toOrderItemRecord({ ...row, currency: "kwd" })).toEqual({ ...record, unitAmount: { minorUnits: 2701, currency: "KWD" } });
  });

  test("webhook row mapping preserves raw payload and distinct provider and receipt times", () => {
    expect(toWebhookEventRow({ id: "inbox-a", workspaceId: "ws-a", provider: "regional", eventId: "evt-a", eventType: "charge.failed",
      eventOccurredAt: AT, payload: '{ "minorUnits": 2701 }', status: "received", receivedAt: "2026-10-22T09:00:00.000Z" })).toEqual({
      id: "inbox-a", workspace_id: "ws-a", provider: "regional", event_id: "evt-a", event_type: "charge.failed", event_occurred_at: AT,
      payload_json: '{ "minorUnits": 2701 }', status: "received", received_at: "2026-10-22T09:00:00.000Z",
    });
  });
});
