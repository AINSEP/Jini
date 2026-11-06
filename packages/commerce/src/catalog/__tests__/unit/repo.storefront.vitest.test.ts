import Database from "better-sqlite3";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { sql } from "kysely";
import { afterEach, expect, it } from "vitest";
import { commerceStorefrontFor } from "../../repo.storefront.js";
import type { CommerceDatabase } from "../../database.js";

const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map(fn => fn())); });
async function world() {
  let reads = 0;
  const kernel = openMemorySqliteKernel<CommerceDatabase>({ open: (path, options) => new Database(path, options) });
  close.push(() => kernel.close());
  await kernel.run(db => sql`CREATE TABLE commerce_products (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, slug TEXT, kind TEXT, status TEXT, description TEXT, grants_member_tier_id TEXT, specs_json TEXT, created_at TEXT, updated_at TEXT, version INTEGER)`.execute(db));
  await kernel.run(db => sql`CREATE TABLE commerce_prices (id TEXT PRIMARY KEY, workspace_id TEXT, product_id TEXT, unit_amount_cents INTEGER, compare_at_amount_cents INTEGER, currency TEXT, billing_interval TEXT, status TEXT, created_at TEXT, version INTEGER)`.execute(db));
  const counted = { ...kernel, run: (...args: Parameters<typeof kernel.run>) => { reads++; return kernel.run(...args); } } as typeof kernel;
  return { kernel, catalog: commerceStorefrontFor({ kernel: counted, workspaceId: "site" }), reads: () => reads };
}
async function add(w: Awaited<ReturnType<typeof world>>, { id, workspace = "site", status = "active" }: { id: string; workspace?: string; status?: string }) {
  await w.kernel.run(db => db.insertInto("commerce_products").values({ id, workspace_id: workspace, name: id, slug: id, kind: "one_time", status, description: "<script>unsafe</script>", grants_member_tier_id: null, specs_json: null, created_at: "now", updated_at: "now", version: 1 }).execute());
  await w.kernel.run(db => db.insertInto("commerce_prices").values({ id: `${id}-price`, workspace_id: workspace, product_id: id, unit_amount_cents: 2000, compare_at_amount_cents: null, currency: "JPY", billing_interval: null, status: "active", created_at: "now", version: 1 }).execute());
}
it("uses at most two reads, caps products at 24, and isolates the workspace", async () => {
  const w = await world();
  for (let i = 0; i < 30; i++) await add(w, { id: `product-${String(i).padStart(2, "0")}` });
  await add(w, { id: "foreign", workspace: "other" });
  await add(w, { id: "archived", status: "archived" });
  const products = await w.catalog.listProducts({}, {});
  expect(products).toHaveLength(24);
  expect(w.reads()).toBe(2);
  expect(products[0]).toMatchObject({ id: "product-00", priceId: "product-00-price", price: 2000, currency: "JPY" });
  expect(products.some(product => ["foreign", "archived"].includes(product.id))).toBe(false);
  expect(products[0]).not.toHaveProperty("description");
});
it("chooses one cheapest active one-time price per product with deterministic ties and no foreign prices", async () => {
  const w = await world(); await add(w, { id: "product" });
  await w.kernel.run(db => db.insertInto("commerce_prices").values([
    { id: "a", workspace_id: "site", product_id: "product", unit_amount_cents: 1000, compare_at_amount_cents: null, currency: "USD", billing_interval: null, status: "active", created_at: "now", version: 1 },
    { id: "b", workspace_id: "site", product_id: "product", unit_amount_cents: 1000, compare_at_amount_cents: null, currency: "USD", billing_interval: null, status: "active", created_at: "now", version: 1 },
    { id: "recurring", workspace_id: "site", product_id: "product", unit_amount_cents: 1, compare_at_amount_cents: null, currency: "USD", billing_interval: "month", status: "active", created_at: "now", version: 1 },
    { id: "foreign", workspace_id: "other", product_id: "product", unit_amount_cents: 1, compare_at_amount_cents: null, currency: "USD", billing_interval: null, status: "active", created_at: "now", version: 1 },
  ]).execute());
  expect(await w.catalog.listProducts()).toMatchObject([{ id: "product", priceId: "a", price: 1000 }]);
});
it("an empty catalog does not issue a price query; recurring-only products are omitted", async () => {
  const w = await world(); expect(await w.catalog.listProducts()).toEqual([]); expect(w.reads()).toBe(1);
  await add(w, { id: "product" });
  await w.kernel.run(db => db.updateTable("commerce_prices").set({ billing_interval: "month" }).execute());
  expect(await w.catalog.listProducts()).toEqual([]);
});

it('point lookup reaches priced products beyond the grid by id or slug in one read', async () => {
  const w = await world();
  for (let i = 0; i < 30; i++) await add(w, { id: `product-${String(i).padStart(2, '0')}` });
  await w.kernel.run(db => db.updateTable('commerce_products').set({ slug: 'last-product' }).where('id', '=', 'product-29').execute());
  expect(await w.catalog.listProducts()).toHaveLength(24);
  const before = w.reads();
  expect(await w.catalog.findProduct({ idOrSlug: 'product-29' })).toMatchObject({ id: 'product-29', priceId: 'product-29-price' });
  expect(w.reads() - before).toBe(1);
  expect(await w.catalog.findProduct({ idOrSlug: 'last-product' })).toMatchObject({ id: 'product-29' });
  expect(await w.catalog.findProduct({ idOrSlug: 'missing' })).toBeNull();
});

it('priceless products do not consume the 24 priced product slots', async () => {
  const w = await world();
  for (let i = 0; i < 30; i++) await add(w, { id: `product-${String(i).padStart(2, '0')}` });
  await w.kernel.run(db => db.updateTable('commerce_prices').set({ status: 'archived' }).where('product_id', 'in', ['product-00', 'product-01', 'product-02', 'product-03', 'product-04']).execute());
  const products = await w.catalog.listProducts();
  expect(products).toHaveLength(24);
  expect(products[0]?.id).toBe('product-05');
  expect(await w.catalog.findProduct({ idOrSlug: 'product-00' })).toBeNull();
});

it('point lookup is workspace scoped, active only, and resolves id before a conflicting slug', async () => {
  const w = await world();
  await add(w, { id: 'identity' }); await add(w, { id: 'slug-owner' });
  await add(w, { id: 'foreign', workspace: 'other' }); await add(w, { id: 'archived', status: 'archived' });
  await w.kernel.run(db => db.updateTable('commerce_products').set({ slug: 'identity' }).where('id', '=', 'slug-owner').execute());
  expect(await w.catalog.findProduct({ idOrSlug: 'identity' })).toMatchObject({ id: 'identity' });
  expect(await w.catalog.findProduct({ idOrSlug: 'foreign' })).toBeNull();
  expect(await w.catalog.findProduct({ idOrSlug: 'archived' })).toBeNull();
});
