import type { StorageKernel } from "@jini-ai/db/kernel";
import { sql } from "kysely";
import type { CommerceKernel } from "./database.js";
import { toPriceRecord, toProductRecord } from "./repo.rows.js";
import { toSiteProduct, toSiteProducts, type StorefrontSiteProduct } from "./storefront.js";

/** The catalog deliberately exposes only one bounded page of purchasable one-time products. */
export const STOREFRONT_PRODUCT_LIMIT = 24;

/**
 * Borrow the host's catalog to render one bounded storefront page. The host guards activation
 * and prepares its schema; this adapter never opens a connection or reads legacy product rows.
 * @complexity Two reads per nonempty page, at most 24 product and 24 price rows returned.
 * Database ranking work depends on the selected products' active prices; no per-product I/O.
 * Detail lookup joins one scoped product to its selected price in one database read.
 */
export function commerceStorefrontFor<DB>(
  { kernel, workspaceId }: { kernel: StorageKernel<DB>; workspaceId: string },
  _optional: Record<string, never> = {},
): {
  listProducts(required?: Record<string, never>, optional?: Record<string, never>): Promise<StorefrontSiteProduct[]>;
  findProduct(required: { idOrSlug: string }, optional?: Record<string, never>): Promise<StorefrontSiteProduct | null>;
} {
  const catalog = kernel as unknown as CommerceKernel;
  return { listProducts: async (_required = {}, _options = {}) => {
    const products = await catalog.run(db => db.selectFrom("commerce_products").selectAll()
      .where("workspace_id", "=", workspaceId).where("status", "=", "active")
      .where(eb => eb.exists(eb.selectFrom('commerce_prices').select('id')
        .where('commerce_prices.workspace_id', '=', workspaceId).whereRef('commerce_prices.product_id', '=', 'commerce_products.id')
        .where('commerce_prices.status', '=', 'active').where('commerce_prices.billing_interval', 'is', null)))
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
  },
  // One point query outside the grid: an id match wins over another product's identical slug.
  findProduct: async ({ idOrSlug }) => {
    const row = await catalog.run(db => db.selectFrom('commerce_products')
      .innerJoin('commerce_prices as price', join => join
        .onRef('price.product_id', '=', 'commerce_products.id').onRef('price.workspace_id', '=', 'commerce_products.workspace_id')
        .on('price.id', '=', sql<string>`(SELECT id FROM commerce_prices selected_price
          WHERE selected_price.workspace_id = ${workspaceId} AND selected_price.product_id = commerce_products.id
            AND selected_price.status = 'active' AND selected_price.billing_interval IS NULL
          ORDER BY selected_price.unit_amount_cents ASC, selected_price.id ASC LIMIT 1)`))
      .selectAll('commerce_products').select(['price.id as price_id', 'price.unit_amount_cents', 'price.compare_at_amount_cents',
        'price.currency', 'price.billing_interval', 'price.status as price_status', 'price.created_at as price_created_at', 'price.version as price_version'])
      .where('commerce_products.workspace_id', '=', workspaceId).where('commerce_products.status', '=', 'active')
      .where(eb => eb.or([eb('commerce_products.id', '=', idOrSlug), eb('commerce_products.slug', '=', idOrSlug)]))
      .orderBy(sql`CASE WHEN commerce_products.id = ${idOrSlug} THEN 0 ELSE 1 END`).limit(1).executeTakeFirst());
    if (!row) return null;
    return toSiteProduct({ product: toProductRecord(row), price: toPriceRecord({ ...row,
      id: row.price_id, product_id: row.id, status: row.price_status, created_at: row.price_created_at, version: row.price_version }) });
  } };
}
