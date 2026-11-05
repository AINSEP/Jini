import type { StorageKernel } from "@jini-ai/db/kernel";
import { sql } from "kysely";
import type { CommerceKernel } from "./database.js";
import { toPriceRecord, toProductRecord } from "./repo.rows.js";
import { toSiteProducts, type StorefrontSiteProduct } from "./storefront.js";

/** The catalog deliberately exposes only one bounded page of purchasable one-time products. */
export const STOREFRONT_PRODUCT_LIMIT = 24;

/**
 * Borrow the host's catalog to render one bounded storefront page. The host guards activation
 * and prepares its schema; this adapter never opens a connection or reads legacy product rows.
 * @complexity Two reads per nonempty page, at most 24 product and 24 price rows returned.
 * Database ranking work depends on the selected products' active prices; no per-product I/O.
 */
export function commerceStorefrontFor<DB>(
  { kernel, workspaceId }: { kernel: StorageKernel<DB>; workspaceId: string },
  _optional: Record<string, never> = {},
): { listProducts(required?: Record<string, never>, optional?: Record<string, never>): Promise<StorefrontSiteProduct[]> } {
  const catalog = kernel as unknown as CommerceKernel;
  return { listProducts: async (_required = {}, _options = {}) => {
    const products = await catalog.run(db => db.selectFrom("commerce_products").selectAll()
      .where("workspace_id", "=", workspaceId).where("status", "=", "active")
      .orderBy("name", "asc").orderBy("id", "asc").limit(STOREFRONT_PRODUCT_LIMIT).execute());
    if (products.length === 0) return [];
    // Rank inside the database: even a product with many historical prices returns just one row.
    const prices = await catalog.run(db => db.selectFrom(db.selectFrom("commerce_prices").selectAll()
      .select(sql<number>`row_number() over (partition by product_id order by unit_amount_cents asc, id asc)`.as("price_rank"))
      .where("workspace_id", "=", workspaceId).where("product_id", "in", products.map(product => product.id))
      .where("status", "=", "active").where("billing_interval", "is", null).as("ranked_prices"))
      .selectAll().where("price_rank", "=", 1).limit(STOREFRONT_PRODUCT_LIMIT).execute());
    const byProduct = new Map(prices.map(row => [row.product_id, toPriceRecord(row)]));
    return toSiteProducts({ items: products.map(row => ({ product: toProductRecord(row), prices: byProduct.has(row.id) ? [byProduct.get(row.id)!] : [] })) });
  } };
}
