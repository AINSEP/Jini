import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import type { StorageKernel } from "@jini-ai/db/kernel";
import { CommerceProductSlugConflictError } from "../errors.js";
import {
  commerceOrderRepoFor,
  commercePriceRepoFor,
  commerceProductImageRepoFor,
  commerceProductRepoFor,
  commerceWebhookEventRepoFor,
} from "../repo.js";
import type { CommerceOrderItemRecord, CommerceOrderRecord, CommercePriceRecord, CommerceProductImageRecord, CommerceProductRecord } from "../types.js";

/**
 * @file The catalog SQL repos (`repo.ts`) against a real in-memory SQLite kernel. The package
 * borrows the host's schema and never creates it, so the DDL below mirrors `database.ts`'s table
 * contract (plus the two UNIQUE backstops the repo header names).
 */

const DDL = `
CREATE TABLE commerce_products (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL,
  status TEXT NOT NULL, description TEXT, grants_member_tier_id TEXT, specs_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL,
  CONSTRAINT commerce_products_workspace_slug_unique UNIQUE (workspace_id, slug));
CREATE TABLE commerce_product_images (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, product_id TEXT NOT NULL, media_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE commerce_prices (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, product_id TEXT NOT NULL, unit_amount_cents INTEGER NOT NULL,
  compare_at_amount_cents INTEGER, currency TEXT NOT NULL, billing_interval TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, version INTEGER NOT NULL);
CREATE TABLE commerce_orders (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, member_id TEXT NOT NULL, status TEXT NOT NULL, currency TEXT NOT NULL,
  total_amount_cents INTEGER NOT NULL, provider TEXT NOT NULL, provider_customer_ref TEXT, provider_payment_ref TEXT, provider_event_at TEXT,
  placed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL);
CREATE TABLE commerce_order_items (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES commerce_orders(id), price_id TEXT NOT NULL,
  product_id TEXT NOT NULL, description TEXT NOT NULL, unit_amount_cents INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, currency TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE commerce_webhook_events (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, provider TEXT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL,
  event_occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT, last_error TEXT,
  UNIQUE (provider, event_id));
`;

let db: Database.Database;
let kernel: StorageKernel<unknown>;
afterEach(() => kernel?.close());

function open(): StorageKernel<unknown> {
  kernel = openMemorySqliteKernel<unknown>({
    open: (filePath, options) => {
      db = new Database(filePath, options);
      db.exec(DDL);
      return db;
    },
  });
  return kernel;
}

const T0 = "2026-10-01T00:00:00.000Z";
const USD = (minorUnits: number) => ({ minorUnits, currency: "USD" });

function product(over: Partial<CommerceProductRecord> = {}): CommerceProductRecord {
  return { id: "p1", workspaceId: "ws1", name: "Shirt", slug: "shirt", kind: "one_time", status: "active", createdAt: T0, updatedAt: T0, version: 1, ...over };
}
function order(over: Partial<CommerceOrderRecord> = {}): CommerceOrderRecord {
  return { id: "o1", workspaceId: "ws1", memberId: "m1", status: "pending", totalAmount: USD(2_500), provider: "stripe", placedAt: T0, createdAt: T0, updatedAt: T0, version: 1, ...over };
}
function item(over: Partial<CommerceOrderItemRecord> = {}): CommerceOrderItemRecord {
  return { id: "i1", workspaceId: "ws1", orderId: "o1", priceId: "pr1", productId: "p1", description: "Shirt", unitAmount: USD(1_250), quantity: 2, createdAt: T0, ...over };
}

describe("SqlCommerceProductRepo", () => {
  test("save → findById / findBySlug round-trip every field, scoped by workspace", async () => {
    const repo = commerceProductRepoFor({ kernel: open() });
    const full = product({ description: "Soft", grantsMemberTierId: "tier-1", specs: [{ label: "Material", value: "Cotton" }, { label: "Fit", value: "Slim" }] });
    await repo.save(full);
    expect(await repo.findById({ workspaceId: "ws1", id: "p1" })).toEqual(full);
    expect(await repo.findBySlug({ workspaceId: "ws1", slug: "shirt" })).toEqual(full);
    expect(await repo.findById({ workspaceId: "ws2", id: "p1" })).toBeNull();
    expect(await repo.findBySlug({ workspaceId: "ws2", slug: "shirt" })).toBeNull();
    expect(await repo.findById({ workspaceId: "ws1", id: "nope" })).toBeNull();
  });

  test("save upserts on id (same slug kept by the same product is not a conflict)", async () => {
    const repo = commerceProductRepoFor({ kernel: open() });
    await repo.save(product());
    await repo.save(product({ name: "Shirt v2", version: 2, updatedAt: "2026-10-02T00:00:00.000Z" }));
    expect(await repo.findById({ workspaceId: "ws1", id: "p1" })).toMatchObject({ name: "Shirt v2", version: 2, slug: "shirt" });
    expect(db.prepare("SELECT count(*) AS n FROM commerce_products").get()).toEqual({ n: 1 });
  });

  test("a slug held by ANOTHER product in the workspace throws CommerceProductSlugConflictError and writes nothing", async () => {
    const repo = commerceProductRepoFor({ kernel: open() });
    await repo.save(product());
    const attempt = repo.save(product({ id: "p2", name: "Other" }));
    await expect(attempt).rejects.toBeInstanceOf(CommerceProductSlugConflictError);
    await expect(attempt).rejects.toMatchObject({ slug: "shirt", message: "a product with slug 'shirt' already exists" });
    expect(await repo.findById({ workspaceId: "ws1", id: "p2" })).toBeNull();
  });

  test("the same slug in a different workspace is allowed", async () => {
    const repo = commerceProductRepoFor({ kernel: open() });
    await repo.save(product());
    await repo.save(product({ id: "p2", workspaceId: "ws2" }));
    expect(await repo.findBySlug({ workspaceId: "ws2", slug: "shirt" })).toMatchObject({ id: "p2" });
  });

  test("listActive: active only, this workspace only, name-ordered, limit capped at 100", async () => {
    const repo = commerceProductRepoFor({ kernel: open() });
    await repo.save(product({ id: "c", slug: "c", name: "Cap" }));
    await repo.save(product({ id: "a", slug: "a", name: "Apron" }));
    await repo.save(product({ id: "z", slug: "z", name: "Archived", status: "archived" }));
    await repo.save(product({ id: "b", slug: "b", name: "Bag" }));
    await repo.save(product({ id: "x", slug: "x", name: "Alien", workspaceId: "ws2" }));
    expect((await repo.listActive({ workspaceId: "ws1" })).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect((await repo.listActive({ workspaceId: "ws1", limit: 2 })).map((p) => p.id)).toEqual(["a", "b"]);
    for (let i = 0; i < 105; i++) await repo.save(product({ id: `bulk-${i}`, slug: `bulk-${i}`, name: `N${String(i).padStart(3, "0")}` }));
    expect(await repo.listActive({ workspaceId: "ws1", limit: 500 })).toHaveLength(100);
    expect(await repo.listActive({ workspaceId: "ws1" })).toHaveLength(100);
  });
});

describe("SqlCommerceProductImageRepo", () => {
  test("listByProduct orders by position then id, scoped by workspace and product; save upserts", async () => {
    const repo = commerceProductImageRepoFor({ kernel: open() });
    const img = (id: string, position: number, over: Partial<CommerceProductImageRecord> = {}): CommerceProductImageRecord =>
      ({ id, workspaceId: "ws1", productId: "p1", mediaId: `media-${id}`, position, createdAt: T0, ...over });
    await repo.save(img("c", 2));
    await repo.save(img("b", 1));
    await repo.save(img("a", 1));
    await repo.save(img("other-product", 0, { productId: "p2" }));
    await repo.save(img("other-ws", 0, { workspaceId: "ws2" }));
    expect((await repo.listByProduct({ workspaceId: "ws1", productId: "p1" })).map((i) => i.id)).toEqual(["a", "b", "c"]);
    await repo.save(img("c", 0, { mediaId: "media-new" }));
    const listed = await repo.listByProduct({ workspaceId: "ws1", productId: "p1" });
    expect(listed[0]).toEqual(img("c", 0, { mediaId: "media-new" }));
    expect(listed).toHaveLength(3);
  });
});

describe("SqlCommercePriceRepo", () => {
  test("save → findById round-trips money and optional fields; listByProduct is scoped; save upserts", async () => {
    const repo = commercePriceRepoFor({ kernel: open() });
    const price: CommercePriceRecord = { id: "pr1", workspaceId: "ws1", productId: "p1", unitAmount: USD(1_250), compareAtAmount: USD(2_000), billingInterval: "month", status: "active", createdAt: T0, version: 1 };
    const plain: CommercePriceRecord = { id: "pr2", workspaceId: "ws1", productId: "p1", unitAmount: USD(0), status: "archived", createdAt: T0, version: 1 };
    await repo.save(price);
    await repo.save(plain);
    await repo.save({ ...plain, id: "pr3", productId: "p2" });
    await repo.save({ ...plain, id: "pr4", workspaceId: "ws2" });
    expect(await repo.findById({ workspaceId: "ws1", id: "pr1" })).toEqual(price);
    expect(await repo.findById({ workspaceId: "ws1", id: "pr2" })).toEqual(plain);
    expect(await repo.findById({ workspaceId: "ws2", id: "pr1" })).toBeNull();
    expect((await repo.listByProduct({ workspaceId: "ws1", productId: "p1" })).map((p) => p.id).sort()).toEqual(["pr1", "pr2"]);
    await repo.save({ ...price, unitAmount: USD(999), version: 2 });
    expect(await repo.findById({ workspaceId: "ws1", id: "pr1" })).toMatchObject({ unitAmount: USD(999), version: 2 });
  });
});

describe("SqlCommerceOrderRepo", () => {
  test("placeOrder writes header + items; findById/listItems are workspace-scoped", async () => {
    const repo = commerceOrderRepoFor({ kernel: open() });
    const o = order({ providerCustomerRef: "cus_1", providerPaymentRef: "pi_1" });
    const items = [item(), item({ id: "i2", priceId: "pr2", description: "Cap", unitAmount: USD(0), quantity: 1 })];
    await repo.placeOrder({ order: o, items });
    expect(await repo.findById({ workspaceId: "ws1", id: "o1" })).toEqual(o);
    expect(await repo.findById({ workspaceId: "ws2", id: "o1" })).toBeNull();
    expect((await repo.listItems({ workspaceId: "ws1", orderId: "o1" })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(items);
    expect(await repo.listItems({ workspaceId: "ws2", orderId: "o1" })).toEqual([]);
  });

  test("an order with no items writes only the header", async () => {
    const repo = commerceOrderRepoFor({ kernel: open() });
    await repo.placeOrder({ order: order(), items: [] });
    expect(await repo.findById({ workspaceId: "ws1", id: "o1" })).toMatchObject({ id: "o1" });
    expect(await repo.listItems({ workspaceId: "ws1", orderId: "o1" })).toEqual([]);
  });

  test("placeOrder is all-or-nothing: a failing item insert leaves no header behind", async () => {
    const repo = commerceOrderRepoFor({ kernel: open() });
    // Duplicate item ids violate the primary key on the second row.
    await expect(repo.placeOrder({ order: order(), items: [item(), item()] })).rejects.toThrow();
    expect(await repo.findById({ workspaceId: "ws1", id: "o1" })).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM commerce_order_items").get()).toEqual({ n: 0 });
  });
});

describe("SqlCommerceWebhookEventRepo.applyProviderEvent", () => {
  const event = (id: string, eventId: string) => ({
    id, workspaceId: "ws1", provider: "stripe", eventId, eventType: "payment.succeeded", eventOccurredAt: T0, payload: "{}", status: "received" as const, receivedAt: T0,
  });
  const projection = (status: "paid" | "failed", providerEventAt: string) => ({ status, providerEventAt, updatedAt: "2026-10-05T00:00:00.000Z" });
  const inbox = (id: string) => db.prepare("SELECT status, processed_at FROM commerce_webhook_events WHERE id = ?").get(id);
  const orderRow = () => db.prepare("SELECT status, provider_event_at, version FROM commerce_orders WHERE id = 'o1'").get();

  async function setup() {
    const k = open();
    await commerceOrderRepoFor({ kernel: k }).placeOrder({ order: order(), items: [] });
    return commerceWebhookEventRepoFor({ kernel: k });
  }

  test("first event applies: order status/cursor/version updated, inbox row 'applied' with processedAt", async () => {
    const repo = await setup();
    expect(await repo.applyProviderEvent({ event: event("e1", "evt_1"), orderId: "o1", projection: projection("paid", "2026-10-02T00:00:00Z"), processedAt: "P1" })).toBe("applied");
    expect(orderRow()).toEqual({ status: "paid", provider_event_at: "2026-10-02T00:00:00Z", version: 2 });
    expect(inbox("e1")).toEqual({ status: "applied", processed_at: "P1" });
  });

  test("the same provider event id again is a duplicate and changes nothing", async () => {
    const repo = await setup();
    await repo.applyProviderEvent({ event: event("e1", "evt_1"), orderId: "o1", projection: projection("paid", "2026-10-02T00:00:00Z"), processedAt: "P1" });
    expect(await repo.applyProviderEvent({ event: event("e2", "evt_1"), orderId: "o1", projection: projection("failed", "2026-10-09T00:00:00Z"), processedAt: "P2" })).toBe("duplicate");
    expect(orderRow()).toEqual({ status: "paid", provider_event_at: "2026-10-02T00:00:00Z", version: 2 });
    expect(inbox("e2")).toBeUndefined();
  });

  test("an older event is stale (inbox 'ignored'); an equal timestamp is also stale; a newer one applies", async () => {
    const repo = await setup();
    await repo.applyProviderEvent({ event: event("e1", "evt_1"), orderId: "o1", projection: projection("paid", "2026-10-02T00:00:00Z"), processedAt: "P1" });
    expect(await repo.applyProviderEvent({ event: event("e2", "evt_2"), orderId: "o1", projection: projection("failed", "2026-10-01T00:00:00Z"), processedAt: "P2" })).toBe("stale");
    expect(inbox("e2")).toEqual({ status: "ignored", processed_at: "P2" });
    expect(await repo.applyProviderEvent({ event: event("e3", "evt_3"), orderId: "o1", projection: projection("failed", "2026-10-02T00:00:00Z"), processedAt: "P3" })).toBe("stale");
    expect(orderRow()).toMatchObject({ status: "paid", version: 2 });
    expect(await repo.applyProviderEvent({ event: event("e4", "evt_4"), orderId: "o1", projection: projection("failed", "2026-10-03T00:00:00Z"), processedAt: "P4" })).toBe("applied");
    expect(orderRow()).toEqual({ status: "failed", provider_event_at: "2026-10-03T00:00:00Z", version: 3 });
  });

  test("an event for an order in another workspace never touches it (stale)", async () => {
    const repo = await setup();
    const foreign = { ...event("e1", "evt_1"), workspaceId: "ws2" };
    expect(await repo.applyProviderEvent({ event: foreign, orderId: "o1", projection: projection("paid", "2026-10-02T00:00:00Z"), processedAt: "P1" })).toBe("stale");
    expect(orderRow()).toEqual({ status: "pending", provider_event_at: null, version: 1 });
  });
});
