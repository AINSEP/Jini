import type { CommercePriceRecord, CommerceProductRecord, CommerceProductSpec } from "./types.js";

/**
 * @file `storefront.ts` — maps Commerce catalog records into the public site render pipeline's
 * product shape (2026-08-12: "wire products into template render data").
 *
 * Purpose:
 * The render pipeline's `SiteProduct` (`src/server/http/site/render.ts`) is deliberately shaped
 * structurally rather than imported from a specific data source's module — its own doc says so
 * explicitly, for the sample store plugin, so the core render engine never depends on any one
 * plugin/feature's types. This module keeps that same decoupling in the other direction:
 * `features/commerce` does not import `SiteProduct` or anything from `server/http/site` — it
 * returns a plain object structurally compatible with it, and the route layer
 * (`server/routes/site/products.ts`) is what bridges the two, exactly as `SiteProduct`'s own doc
 * already establishes as the pattern.
 *
 * Deliberately NOT included in this mapping this pass, named explicitly rather than silently
 * dropped:
 *  - `images` — a real product image needs the ADR-027 transform-registry pipeline
 *    (`mediaTransformVersions`, `renderImageTag`) to produce a safe, validated `/m/...` URL; a
 *    shortcut construction here would bypass that validation. The templates already degrade
 *    gracefully to a placeholder card when `images` is absent (see `fashion-modern/templates/
 *    products.liquid`'s own header comment), so omitting it is a safe, honest default, not a
 *    silent gap.
 *  - `stock` — Commerce has no inventory-tracking table yet (only the unrelated sample `store`
 *    plugin does, via `p_store__products.stock` with a real OCC-guarded decrement). Fabricating a
 *    number here would violate the standing "never present unproven capability as working" rule
 *    (this feature's own context packet, C5). `SiteProduct.stock` is widened to optional so a
 *    Commerce-sourced product can honestly omit it rather than claim a specific count.
 *  - `description` — a SECURITY omission, not a data-availability one: `CommerceProductRecord
 *    .description` is a plain `text()` column with no HTML-sanitization contract (no admin UI even
 *    writes it yet — `db/schema.sqlite.ts`'s `commerceProducts.description` doc names no format at all).
 *    `product.liquid` renders `product.description` via Liquid's `| raw` filter — the SAME trust
 *    contract `post.content` uses, but `post.content` earns that trust by walking a controlled
 *    TipTap doc-JSON AST (`renderDocNode`) that only ever emits an allowlisted set of tags; a plain
 *    string column has no equivalent guarantee. Wiring this field through unescaped the moment any
 *    admin (or seed script) puts `<script>`-shaped text in a product description would be a live
 *    XSS hole, not a hypothetical one. Revisit only alongside either (a) a sanitizer at the write
 *    path, or (b) switching the template to escaped (non-`| raw`) output.
 *
 * Included this pass, both safe because `product.liquid`/`products.liquid` render them WITHOUT
 * `| raw` (LiquidJS's `outputEscape: "escape"` default applies — see `liquid-worker.ts` — so any
 * hostile content in either is HTML-escaped, not executed):
 *  - `specs` — passed straight through from `CommerceProductRecord.specs`; already structured
 *    `{label, value}` display data, not a data-availability or safety gap.
 *  - `currency` — passed straight through from `CommercePriceRecord.currency`, lowercase ISO-4217
 *    (e.g. `"usd"`), matching Stripe's own convention (see `types.ts`'s doc on that field). The
 *    design's currency badge was mocked uppercase; `priceFormatted`'s own `$`-prefix is also
 *    hardcoded regardless of this value (see `render.ts`'s `formatCents` doc) — both are cosmetic
 *    mismatches for a future currency-formatting pass, not blockers for wiring the raw value.
 */

/** The public-render-facing shape this module produces — structurally compatible with
 * `SiteProduct` (`server/http/site/render.ts`), not imported from it. See file header. */
export interface StorefrontSiteProduct {
  id: string;
  /** Readable-slugs S7 (2026-09-23): the product's own unique slug — `render.ts`'s
   *  `productEntryList` links a storefront card by this, not `id`, same rule posts/pages/menus
   *  already follow. */
  slug: string;
  title: string;
  /** Cents. */
  price: number;
  /** Cents. `undefined` = not on sale. */
  compareAtPrice?: (number) | undefined;
  /** Lowercase ISO-4217 (e.g. `"usd"`), straight from the chosen price's own `currency`. */
  currency: string;
  /** Display-only spec pairs, in author-chosen order. `undefined` = none set. See file header for
   * why this is safe to pass through unescaped-template-side but `description` is not. */
  specs?: (CommerceProductSpec[]) | undefined;
}

/**
 * Chooses which of a product's prices to display on a storefront card, when more than one exists.
 * Prefers a one-time price over a recurring one (a shop grid shows what buying it once costs, not
 * a subscription rate) and, among ties, the cheapest — matching the intuitive "what's the price"
 * a shopper expects rather than an arbitrary insertion-order pick.
 *
 * @returns `null` if `prices` contains no `status: "active"` entry — the caller's job is to skip
 *   the product entirely in that case, not display a priceless card.
 * @complexity Time: O(n) in `prices.length`. Space: O(n) for the filtered pool.
 */
export function pickDisplayPrice({ prices }: { prices: readonly CommercePriceRecord[] }, _optional: Record<string, never> = {}): CommercePriceRecord | null {
  const active = prices.filter((p) => p.status === "active");
  if (active.length === 0) return null;
  const oneTime = active.filter((p) => p.billingInterval === undefined);
  const pool = oneTime.length > 0 ? oneTime : active;
  return pool.reduce((cheapest, p) => (p.unitAmountCents < cheapest.unitAmountCents ? p : cheapest));
}

/**
 * Maps one product + its already-chosen display price into the storefront render shape.
 *
 * @complexity Time/space: O(1).
 */
export function toSiteProduct(input: {
  product: CommerceProductRecord;
  price: CommercePriceRecord;
}, _optional: Record<string, never> = {}): StorefrontSiteProduct {
  return {
    id: input.product.id,
    slug: input.product.slug,
    title: input.product.name,
    price: input.price.unitAmountCents,
    compareAtPrice: input.price.compareAtAmountCents,
    currency: input.price.currency,
    specs: input.product.specs,
  };
}

/**
 * Maps a product list into storefront render shapes, silently skipping any product with no
 * `status: "active"` price to display (not an error — an admin can legitimately publish a product
 * before pricing it) rather than crashing the whole page render over one incomplete row.
 *
 * @complexity Time: O(p) where p = `items.length` (each `pickDisplayPrice` call is O(prices for
 * that product), already summed by the caller's own query pattern). Space: O(p).
 */
export function toSiteProducts(
  { items }: { items: readonly { product: CommerceProductRecord; prices: readonly CommercePriceRecord[] }[] },
  _optional: Record<string, never> = {}
): StorefrontSiteProduct[] {
  const out: StorefrontSiteProduct[] = [];
  for (const { product, prices } of items) {
    const price = pickDisplayPrice({ prices: prices });
    if (price) out.push(toSiteProduct({ product, price }));
  }
  return out;
}
