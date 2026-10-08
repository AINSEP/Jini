/**
 * @file SPIKE — the sample Tier-3 store plugin (C) + checkout.
 *
 * The simplest real plugin that owns tables: it DECLARES `p_store__products` and `p_store__orders`
 * (which core creates through the never-brick dataModule seam, B), seeds products, and exposes a
 * read API + a checkout the site route (D) renders. Tier-3 = trusted/first-party/local (ADR-024):
 * full access, honestly labeled, never in the public marketplace. Exploratory spike beyond
 * ADR-023 §12's v1 disposition.
 *
 * §7/§8 note: reads here are `SELECT`s scoped to the plugin namespace (ADR-023 §8); writes go
 * direct for the spike (a real build routes writes through the typed core repository, §7). Every
 * statement runs on the storage kernel (`kernel.run`), so the same code serves SQLite and Postgres.
 */
import type { StorageKernel } from "@jini-ai/db/kernel";

export interface Product {
  id: string;
  /** Readable-slugs S7 (2026-09-23): same value as `id` for this sample plugin — its ids are
   *  already short, readable, non-UUID strings, and there is no separate `slug` DB column to add
   *  one from. Real Commerce products have their own real, author-set slug (`features/commerce
   *  /types.ts`); this is just the demo store's stand-in for the same shape. */
  slug: string;
  title: string;
  price: number; // cents
  stock: number;
  version: number;
}

export type CheckoutResult =
  | { ok: true; orderId: string; remainingStock: number; retries: number }
  | { ok: false; reason: "not-found" | "out-of-stock" | "conflict" | "invalid-quantity"; retries: number };

export interface StoreApi {
  listProducts(required?: Record<string, never>, optional?: Record<string, never>): Promise<Product[]>;
  /** Buy `qty` of a product: an OCC-guarded stock decrement plus an order row. */
  checkout(required: { productId: string; qty: number }, optional?: Record<string, never>): Promise<CheckoutResult>;
}

export const STORE_PLUGIN_ID = "store";
const PRODUCTS = `p_${STORE_PLUGIN_ID}__products` as const;
const ORDERS = `p_${STORE_PLUGIN_ID}__orders` as const;

/** The store's two tables, as Kysely sees them. A type alias: `withTables` needs its index signature. */
type StoreTables = {
  [PRODUCTS]: { id: string; title: string; price: number; stock: number; version: number };
  [ORDERS]: { id: string; product_id: string; qty: number; total: number; at: number };
};


export const SEED_PRODUCTS: Product[] = [
  { id: "prod-teacup", slug: "prod-teacup", title: "Hand-thrown Teacup", price: 2800, stock: 5, version: 0 },
  { id: "prod-notebook", slug: "prod-notebook", title: "Linen Notebook", price: 1600, stock: 5, version: 0 },
  { id: "prod-candle", slug: "prod-candle", title: "Beeswax Candle", price: 1200, stock: 5, version: 0 },
];

/**
 * Declare the store's tables through core (snapshot→DDL), seed once, and return the store API.
 *
 * `db` is the site's storage kernel (or a SQLite connection, bridged to its kernel); `dbPath` names
 * the SQLite file behind it, for the declaration's snapshot.
 */
export async function activateStore(
  required: { kernel: StorageKernel<unknown>; prepareStorage: () => Promise<void> },
  _optional: Record<string, never> = {}
): Promise<StoreApi> {
  const kernel = required.kernel;
  // Storage declaration and its recovery guarantees belong to the injected host.
  await required.prepareStorage();

  // Seed once: the count and the inserts share one transaction under a lock, so two boots racing
  // on Postgres cannot both see an empty table.
  await kernel.transaction(async () => {
    await kernel.lockKey(`${PRODUCTS}:seed`);
    const { n } = await kernel.run((k) =>
      k.withTables<StoreTables>().selectFrom(PRODUCTS).select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow()
    );
    if (Number(n) > 0) return;
    const rows = SEED_PRODUCTS.map(({ id, title, price, stock, version }) => ({ id, title, price, stock, version }));
    await kernel.run((k) => k.withTables<StoreTables>().insertInto(PRODUCTS).values(rows).execute());
  });

  type Attempt = { done: true; result: CheckoutResult } | { done: false };

  /** One checkout attempt: read, then the OCC-guarded decrement and the order row, as ONE transaction. */
  function attemptCheckout(productId: string, qty: number, retries: number): Promise<Attempt> {
    return kernel.transaction(async (): Promise<Attempt> => {
      await kernel.lockKey(`${PRODUCTS}:${productId}`);
      const product = await kernel.run((k) =>
        k.withTables<StoreTables>().selectFrom(PRODUCTS).select(["price", "stock", "version"]).where("id", "=", productId).executeTakeFirst()
      );
      if (!product) return { done: true, result: { ok: false, reason: "not-found", retries } };
      if (product.stock < qty) return { done: true, result: { ok: false, reason: "out-of-stock", retries } };

      // The stock decrement and the order insert are TWO writes. They are atomic here ONLY because
      // this spike store holds the kernel directly. A real Tier-3 plugin behind the frozen async ABI
      // (ADR-024 §3) CANNOT hold a transaction across the seam — which is exactly why core must own
      // an atomic multi-write primitive (see the cowork ABI finding → ADR-026).
      const dec = await kernel.run((k) =>
        k
          .withTables<StoreTables>()
          .updateTable(PRODUCTS)
          .set((eb) => ({ stock: eb("stock", "-", qty), version: eb("version", "+", 1) }))
          .where("id", "=", productId)
          .where("version", "=", product.version)
          .executeTakeFirst()
      );
      if (Number(dec.numUpdatedRows) === 0) return { done: false }; // OCC conflict — the row moved under us; retry
      const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await kernel.run((k) =>
        k
          .withTables<StoreTables>()
          .insertInto(ORDERS)
          .values({ id: orderId, product_id: productId, qty, total: product.price * qty, at: Date.now() })
          .execute()
      );
      return { done: true, result: { ok: true, orderId, remainingStock: product.stock - qty, retries } };
    });
  }

  async function checkout({ productId, qty }: { productId: string; qty: number }, _optional: Record<string, never> = {}): Promise<CheckoutResult> {
    if (!Number.isSafeInteger(qty) || qty <= 0) return { ok: false, reason: "invalid-quantity", retries: 0 };
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const outcome = await attemptCheckout(productId, qty, attempt);
      if (outcome.done) return outcome.result;
    }
    return { ok: false, reason: "conflict", retries: maxAttempts };
  }

  return {
    async listProducts(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): Promise<Product[]> {
      const rows = await kernel.run((k) =>
        k.withTables<StoreTables>().selectFrom(PRODUCTS).select(["id", "title", "price", "stock", "version"]).orderBy("title").execute()
      );
      // No DB column for `slug` — see the `Product` interface's own doc for why `id` stands in.
      return rows.map((row) => ({ ...row, slug: row.id }));
    },
    checkout,
  };
}

