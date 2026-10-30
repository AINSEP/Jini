import Database from "better-sqlite3";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { sql } from "kysely";
import { afterEach, describe, expect, test } from "vitest";

import { checkout, CommerceProductSlugConflictError } from "../../../index.js";
import type { CommerceDatabase } from "../../database.js";
import {
  commerceOrderRepoFor, commercePriceRepoFor, commerceProductImageRepoFor,
  commerceProductRepoFor, commerceWebhookEventRepoFor, SqlCommerceWebhookEventRepo,
} from "../../repo.js";
import type { CommerceOrderItemRecord, CommerceOrderRecord, CommercePriceRecord, CommerceProductRecord } from "../../types.js";

const AT = "2026-10-21T09:00:00.000Z";
const LATER = "2026-10-22T09:00:00.000Z";
const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map(fn => fn())); });

function product(overrides: Partial<CommerceProductRecord> = {}): CommerceProductRecord {
  return { id: "prod-a", workspaceId: "ws-a", name: "Notebook", slug: "notebook", kind: "one_time", status: "active", createdAt: AT, updatedAt: AT, version: 1, ...overrides };
}
function price(overrides: Partial<CommercePriceRecord> = {}): CommercePriceRecord {
  return { id: "price-a", workspaceId: "ws-a", productId: "prod-a", unitAmount: { minorUnits: 2701, currency: "USD" }, status: "active", createdAt: AT, version: 1, ...overrides };
}
function order(overrides: Partial<CommerceOrderRecord> = {}): CommerceOrderRecord {
  return { id: "order-a", workspaceId: "ws-a", memberId: "member-a", status: "pending", totalAmount: { minorUnits: 5402, currency: "USD" }, provider: "regional-pay", placedAt: AT, createdAt: AT, updatedAt: AT, version: 1, ...overrides };
}
function item(overrides: Partial<CommerceOrderItemRecord> = {}): CommerceOrderItemRecord {
  return { id: "item-a", workspaceId: "ws-a", orderId: "order-a", priceId: "price-a", productId: "prod-a", description: "Notebook", unitAmount: { minorUnits: 2701, currency: "USD" }, quantity: 2, createdAt: AT, ...overrides };
}

async function world() {
  // The catalog borrows a host-owned schema; the payments migration owns different tables.
  // Use the same in-memory SQLite kernel path as payments/ledger's existing integration tests.
  const kernel = openMemorySqliteKernel<CommerceDatabase>({ open: (path, options) => new Database(path, options) });
  close.push(() => kernel.close());
  const statements = [
    `CREATE TABLE commerce_order_payments (
      workspace_id TEXT NOT NULL, order_id TEXT NOT NULL, site_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('test','live')), amount_minor BIGINT NOT NULL, currency TEXT NOT NULL, payment_id TEXT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (workspace_id, order_id), UNIQUE (workspace_id, mode, payment_id))`,
    `CREATE TABLE commerce_price_provider_refs (
      workspace_id TEXT NOT NULL, price_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('test','live')), provider_price_ref TEXT NOT NULL CHECK (length(provider_price_ref) > 0),
      created_at TEXT NOT NULL, PRIMARY KEY (workspace_id, price_id, provider_id, provider_account_id, mode))`,
    `CREATE TABLE commerce_products (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL,
      name TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
      description TEXT, grants_member_tier_id TEXT, specs_json TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, version INTEGER NOT NULL, UNIQUE(workspace_id, slug))`,
    `CREATE TABLE commerce_prices (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL,
      product_id TEXT NOT NULL, unit_amount_cents INTEGER NOT NULL, compare_at_amount_cents INTEGER,
      currency TEXT NOT NULL, billing_interval TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
      version INTEGER NOT NULL)`,
    `CREATE TABLE commerce_product_images (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL,
      product_id TEXT NOT NULL, media_id TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE commerce_orders (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL,
      member_id TEXT NOT NULL, status TEXT NOT NULL, currency TEXT NOT NULL, total_amount_cents INTEGER NOT NULL,
      provider TEXT NOT NULL, provider_customer_ref TEXT, provider_payment_ref TEXT, provider_event_at TEXT,
      placed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL)`,
    `CREATE TABLE commerce_order_items (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL,
      order_id TEXT NOT NULL REFERENCES commerce_orders(id), price_id TEXT NOT NULL, product_id TEXT NOT NULL,
      description TEXT NOT NULL, unit_amount_cents INTEGER NOT NULL, quantity INTEGER NOT NULL,
      currency TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE commerce_webhook_events (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL, event_occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL, status TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT,
      last_error TEXT, UNIQUE(provider, event_id))`,
  ];
  for (const statement of statements) await kernel.run(db => sql.raw(statement).execute(db));
  return { kernel, products: commerceProductRepoFor({ kernel }), prices: commercePriceRepoFor({ kernel }),
    images: commerceProductImageRepoFor({ kernel }), orders: commerceOrderRepoFor({ kernel }),
    events: commerceWebhookEventRepoFor({ kernel }) };
}

describe("catalog repositories on a borrowed SQLite kernel", () => {
  test("product reads are workspace scoped and an upsert retains every optional field", async () => {
    const w = await world();
    expect(await w.products.findById({ workspaceId: "ws-a", id: "prod-a" })).toBeNull();
    expect(await w.products.findBySlug({ workspaceId: "ws-a", slug: "notebook" })).toBeNull();
    await w.products.save(product());
    expect(await w.products.findById({ workspaceId: "ws-b", id: "prod-a" })).toBeNull();
    expect(await w.products.findBySlug({ workspaceId: "ws-b", slug: "notebook" })).toBeNull();
    const updated = product({ name: "Linen Notebook", description: "Plain text", grantsMemberTierId: "tier-a",
      specs: [{ label: "Material", value: "Linen" }], updatedAt: LATER, version: 2 });
    await w.products.save(updated);
    expect(await w.products.findById({ workspaceId: "ws-a", id: "prod-a" })).toEqual(updated);
    expect(await w.products.findBySlug({ workspaceId: "ws-a", slug: "notebook" })).toEqual(updated);
  });

  test("a duplicate slug rejects both inserts and updates without changing the existing products", async () => {
    const w = await world();
    await w.products.save(product());
    await w.products.save(product({ id: "prod-b", slug: "other", name: "Other" }));
    for (const id of ["new-product", "prod-b"]) {
      await expect(w.products.save(product({ id }))).rejects.toMatchObject({
        constructor: CommerceProductSlugConflictError, message: "a product with slug 'notebook' already exists", slug: "notebook",
      });
    }
    expect(await w.products.findById({ workspaceId: "ws-a", id: "new-product" })).toBeNull();
    expect((await w.products.findById({ workspaceId: "ws-a", id: "prod-b" }))?.slug).toBe("other");
    // The same slug in a different workspace is allowed.
    await w.products.save(product({ id: "prod-c", workspaceId: "ws-b" }));
    expect((await w.products.findBySlug({ workspaceId: "ws-b", slug: "notebook" }))?.id).toBe("prod-c");
    expect((await w.products.findBySlug({ workspaceId: "ws-a", slug: "notebook" }))?.id).toBe("prod-a");
  });

  test("active products are sorted by name, bounded by the requested limit and capped at 100", async () => {
    const w = await world();
    expect(await w.products.listActive({ workspaceId: "ws-a" })).toEqual([]);
    for (let n = 102; n >= 0; n--) {
      await w.products.save(product({ id: `p-${n}`, slug: `p-${n}`, name: `Item ${String(n).padStart(3, "0")}` }));
    }
    await w.products.save(product({ id: "archived", slug: "archived", name: "AAA", status: "archived" }));
    await w.products.save(product({ id: "foreign", slug: "foreign", name: "AAA", workspaceId: "ws-b" }));
    expect((await w.products.listActive({ workspaceId: "ws-a", limit: 3 })).map(p => p.id)).toEqual(["p-0", "p-1", "p-2"]);
    expect(await w.products.listActive({ workspaceId: "ws-a", limit: 0 })).toEqual([]);
    const expected = Array.from({ length: 100 }, (_, n) => `p-${n}`);
    expect((await w.products.listActive({ workspaceId: "ws-a" })).map(p => p.id)).toEqual(expected);
    expect((await w.products.listActive({ workspaceId: "ws-a", limit: 101 })).map(p => p.id)).toEqual(expected);
    expect((await w.products.listActive({ workspaceId: "ws-a", limit: 99 })).map(p => p.id)).toEqual(expected.slice(0, 99));
    expect((await w.products.listActive({ workspaceId: "ws-a", limit: 100 })).map(p => p.id)).toEqual(expected);
  });

  test("gallery ordering uses position then id, and excludes other products and workspaces", async () => {
    const w = await world();
    const image = { id: "img-c", workspaceId: "ws-a", productId: "prod-a", mediaId: "media-c", position: 2, createdAt: AT };
    for (const row of [image, { ...image, id: "img-b", mediaId: "media-b", position: 1 },
      { ...image, id: "img-a", mediaId: "media-a", position: 1 },
      { ...image, id: "other-product", productId: "prod-b", position: 0 },
      { ...image, id: "other-workspace", workspaceId: "ws-b", position: 0 }]) await w.images.save(row);
    expect((await w.images.listByProduct({ workspaceId: "ws-a", productId: "prod-a" })).map(row => [row.id, row.mediaId, row.position]))
      .toEqual([["img-a", "media-a", 1], ["img-b", "media-b", 1], ["img-c", "media-c", 2]]);
    const updated = { ...image, mediaId: "replacement", position: 0 };
    await w.images.save(updated);
    expect(await w.images.listByProduct({ workspaceId: "ws-a", productId: "prod-a" })).toEqual([
      updated, { ...image, id: "img-a", mediaId: "media-a", position: 1 }, { ...image, id: "img-b", mediaId: "media-b", position: 1 },
    ]);
    expect(await w.images.listByProduct({ workspaceId: "ws-a", productId: "missing" })).toEqual([]);
  });

  test("price upserts normalize Money, retain recurring and sale amounts, and isolate workspace and product reads", async () => {
    const w = await world();
    expect(await w.prices.findById({ workspaceId: "ws-a", id: "price-a" })).toBeNull();
    await w.prices.save(price());
    await w.prices.save(price({ id: "price-other", productId: "prod-b" }));
    await w.prices.save(price({ id: "price-foreign", workspaceId: "ws-b" }));
    expect(await w.prices.findById({ workspaceId: "ws-b", id: "price-a" })).toBeNull();
    const updated = price({ unitAmount: { minorUnits: 0, currency: " kwd " },
      compareAtAmount: { minorUnits: 7001, currency: "KWD" }, billingInterval: "year", status: "archived", version: 2 });
    await w.prices.save(updated);
    const expected = { ...updated, unitAmount: { minorUnits: 0, currency: "KWD" } };
    expect(await w.prices.findById({ workspaceId: "ws-a", id: "price-a" })).toEqual(expected);
    expect(await w.prices.listByProduct({ workspaceId: "ws-a", productId: "prod-a" })).toEqual([expected]);
    expect(await w.prices.listByProduct({ workspaceId: "ws-a", productId: "missing" })).toEqual([]);
  });

  test("checkout persists exact order and item snapshots that survive later catalog updates", async () => {
    const w = await world();
    await w.products.save(product());
    await w.prices.save(price());
    let id = 0;
    const result = await checkout({ deps: { ...w, clock: { nowMs: () => Date.parse(AT) }, idGen: { newId: () => `new-${++id}` } },
      input: { workspaceId: "ws-a", memberId: "member-a", priceId: "price-a", provider: "regional-pay", providerCustomerRef: "cus-a", quantity: 3 } });
    expect(result.order).toEqual(order({ id: "new-1", totalAmount: { minorUnits: 8103, currency: "USD" }, providerCustomerRef: "cus-a" }));
    expect(result.items).toEqual([item({ id: "new-2", orderId: "new-1", quantity: 3 })]);
    await w.products.save(product({ name: "Renamed" }));
    await w.prices.save(price({ unitAmount: { minorUnits: 9999, currency: "USD" } }));
    expect(await w.orders.findById({ workspaceId: "ws-a", id: "new-1" })).toEqual({
      ...result.order, providerPaymentRef: undefined, providerEventAt: undefined,
    });
    expect(await w.orders.listItems({ workspaceId: "ws-a", orderId: "new-1" })).toEqual(result.items);
    expect(await w.orders.findById({ workspaceId: "ws-b", id: "new-1" })).toBeNull();
    expect(await w.orders.listItems({ workspaceId: "ws-b", orderId: "new-1" })).toEqual([]);
    expect(await w.orders.findById({ workspaceId: "ws-a", id: "missing" })).toBeNull();
    expect(await w.orders.listItems({ workspaceId: "ws-a", orderId: "missing" })).toEqual([]);
  });

  test("an empty order is stored, while failure in a line-item insert rolls the entire new order back", async () => {
    const w = await world();
    await w.orders.placeOrder({ order: order(), items: [] });
    expect((await w.orders.findById({ workspaceId: "ws-a", id: "order-a" }))?.totalAmount).toEqual({ minorUnits: 5402, currency: "USD" });
    expect(await w.orders.listItems({ workspaceId: "ws-a", orderId: "order-a" })).toEqual([]);
    await expect(w.orders.placeOrder({ order: order({ id: "rolled-back" }), items: [
      item({ orderId: "rolled-back" }), item({ orderId: "rolled-back" }),
    ] })).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" });
    expect(await w.orders.findById({ workspaceId: "ws-a", id: "rolled-back" })).toBeNull();
    expect(await w.orders.listItems({ workspaceId: "ws-a", orderId: "rolled-back" })).toEqual([]);
    await w.orders.placeOrder({ order: order({ id: "rolled-back" }), items: [item({ orderId: "rolled-back" })] });
    expect(await w.orders.listItems({ workspaceId: "ws-a", orderId: "rolled-back" })).toEqual([item({ orderId: "rolled-back" })]);
  });

  test("provider events atomically apply once, ignore older or equal timestamps and accept a newer event", async () => {
    const w = await world();
    await w.orders.placeOrder({ order: order(), items: [] });
    const event = { id: "inbox-1", workspaceId: "ws-a", provider: "regional-pay", eventId: "evt-1", eventType: "charge.succeeded",
      eventOccurredAt: AT, payload: '{"amount":5402}', status: "received" as const, receivedAt: LATER };
    const projection = { status: "paid" as const, providerEventAt: AT, updatedAt: LATER };
    expect(await w.events.applyProviderEvent({ event, orderId: "order-a", projection, processedAt: LATER })).toBe("applied");
    const paid = { ...order(), status: "paid", providerCustomerRef: undefined, providerPaymentRef: undefined,
      providerEventAt: AT, updatedAt: LATER, version: 2 };
    expect(await w.orders.findById({ workspaceId: "ws-a", id: "order-a" })).toEqual(paid);
    expect(await w.events.applyProviderEvent({ event: { ...event, id: "different-inbox-id" }, orderId: "order-a",
      projection: { ...projection, status: "failed", providerEventAt: LATER }, processedAt: LATER })).toBe("duplicate");
    for (const [id, timestamp] of [["older", "2026-10-20T09:00:00.000Z"], ["equal", AT]]) {
      expect(await w.events.applyProviderEvent({ event: { ...event, id, eventId: id, eventOccurredAt: timestamp! }, orderId: "order-a",
        projection: { ...projection, status: "failed", providerEventAt: timestamp! }, processedAt: LATER })).toBe("stale");
    }
    expect(await w.orders.findById({ workspaceId: "ws-a", id: "order-a" })).toEqual(paid);
    expect(await w.events.applyProviderEvent({ event: { ...event, id: "newer", eventId: "evt-new", eventOccurredAt: LATER }, orderId: "order-a",
      projection: { status: "canceled", providerEventAt: LATER, updatedAt: LATER }, processedAt: LATER })).toBe("applied");
    expect(await w.orders.findById({ workspaceId: "ws-a", id: "order-a" })).toEqual({ ...paid, status: "canceled", providerEventAt: LATER, version: 3 });
    const rows = await w.kernel.run(db => db.selectFrom("commerce_webhook_events").selectAll().orderBy("id").execute());
    expect(rows.map(row => [row.id, row.status, row.processed_at])).toEqual([
      ["equal", "ignored", LATER], ["inbox-1", "applied", LATER], ["newer", "applied", LATER], ["older", "ignored", LATER],
    ]);
    expect(rows.find(row => row.id === "inbox-1")).toEqual({ id: "inbox-1", workspace_id: "ws-a", provider: "regional-pay",
      event_id: "evt-1", event_type: "charge.succeeded", event_occurred_at: AT, payload_json: '{"amount":5402}',
      status: "applied", received_at: LATER, processed_at: LATER, last_error: null });
  });

  test("an event for another workspace or a missing order is recorded as ignored without changing the order", async () => {
    const w = await world();
    await w.orders.placeOrder({ order: order(), items: [] });
    for (const [id, workspaceId, orderId] of [["foreign", "ws-b", "order-a"], ["missing", "ws-a", "absent"]]) {
      expect(await w.events.applyProviderEvent({ event: { id: id!, workspaceId: workspaceId!, provider: "regional-pay", eventId: id!,
        eventType: "charge.failed", eventOccurredAt: AT, payload: "{}", status: "received", receivedAt: AT },
        orderId: orderId!, projection: { status: "failed", providerEventAt: AT, updatedAt: LATER }, processedAt: LATER })).toBe("stale");
    }
    expect(await w.orders.findById({ workspaceId: "ws-a", id: "order-a" })).toEqual({ ...order(),
      providerCustomerRef: undefined, providerPaymentRef: undefined, providerEventAt: undefined });
    expect(await w.kernel.run(db => db.selectFrom("commerce_webhook_events").select(["id", "status"]).orderBy("id").execute()))
      .toEqual([{ id: "foreign", status: "ignored" }, { id: "missing", status: "ignored" }]);
  });

  test("failure to finalize the inbox rolls back both the projection and replay guard so the provider can retry", async () => {
    const w = await world();
    await w.orders.placeOrder({ order: order(), items: [] });
    await w.kernel.run(db => sql.raw(`CREATE TRIGGER reject_finalize BEFORE UPDATE ON commerce_webhook_events
      BEGIN SELECT RAISE(ABORT, 'inbox unavailable'); END`).execute(db));
    const input = { event: { id: "retry", workspaceId: "ws-a", provider: "regional-pay", eventId: "evt-retry",
      eventType: "charge.succeeded", eventOccurredAt: AT, payload: "{}", status: "received" as const, receivedAt: AT },
      orderId: "order-a", projection: { status: "paid" as const, providerEventAt: AT, updatedAt: LATER }, processedAt: LATER };
    await expect(w.events.applyProviderEvent(input)).rejects.toThrow("inbox unavailable");
    expect((await w.orders.findById({ workspaceId: "ws-a", id: "order-a" }))?.status).toBe("pending");
    expect((await w.orders.findById({ workspaceId: "ws-a", id: "order-a" }))?.version).toBe(1);
    expect(await w.kernel.run(db => db.selectFrom("commerce_webhook_events").selectAll().execute())).toEqual([]);
    await w.kernel.run(db => sql.raw("DROP TRIGGER reject_finalize").execute(db));
    expect(await w.events.applyProviderEvent(input)).toBe("applied");
    expect((await w.orders.findById({ workspaceId: "ws-a", id: "order-a" }))?.status).toBe("paid");
    expect((await w.orders.findById({ workspaceId: "ws-a", id: "order-a" }))?.version).toBe(2);
  });
});

describe("webhook event repo against a driver that omits the affected-row count", () => {
  test("a missing numInsertedOrUpdatedRows counts as zero rows, so the event is reported duplicate and nothing else runs", async () => {
    const runs: string[] = [];
    const kernel = {
      transaction: async <T,>(fn: () => Promise<T>) => fn(),
      run: async () => { runs.push("run"); return {}; },
    };
    const repo = new SqlCommerceWebhookEventRepo({ kernel: kernel as never });
    const event = { id: "inbox-1", workspaceId: "ws-a", provider: "regional-pay", eventId: "evt-1", eventType: "charge.succeeded",
      eventOccurredAt: AT, payload: "{}", status: "received" as const, receivedAt: LATER };
    const projection = { status: "paid" as const, providerEventAt: AT, updatedAt: LATER };
    expect(await repo.applyProviderEvent({ event, orderId: "order-a", projection, processedAt: LATER })).toBe("duplicate");
    expect(runs).toEqual(["run"]);
  });
});
