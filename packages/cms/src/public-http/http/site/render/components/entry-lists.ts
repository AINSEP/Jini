import type { SiteRenderContext } from "../../render-context.js";
import type { JsonObject } from "@jini-ai/core/primitives";
import { LISTING_BATCH_DEFAULT, renderListingMore, listingBatchPath, wrapListingItems } from "../../../../../listing/index.js";
import { featuredImageView, formatProductMoney, type FeaturedImageView } from "../template-render-data.js";
import { escapeHtml } from "@jini-ai/core/text";
import { shortDate } from "../post-body.js";
import { postDisplayDateIso } from "@jini-ai/core/scheduled-publish";

/** The host's money formatter (the catalog's own), injected so this module stays commerce-free. */
type FormatMoney = (required: { money: { minorUnits: number; currency: string } }) => string;
/** The host's cover `<img>` renderer: it owns the theme's image markup and sizing classes. */
type RenderCoverImageTag = (required: { image: FeaturedImageView }, optional?: { loading?: "lazy" }) => string;

function entryListItem(
  { ctx, post, index, renderCoverImageTag }: { ctx: SiteRenderContext; post: SiteRenderContext["posts"][number]; index: number; renderCoverImageTag: RenderCoverImageTag },
  _optional = {},
): string {
  const folio = String(index + 1).padStart(2, "0");
  const cover = featuredImageView({ ctx, post });
  const image = cover ? renderCoverImageTag({ image: cover }, { loading: "lazy" }) : "";
  return `<li class="entry"><a class="entry-link" href="/${escapeHtml({ text: post.slug })}">${image}<span class="entry-index">№ ${folio}</span><h2 class="entry-title">${escapeHtml({ text: post.title })}</h2><p class="entry-meta">${escapeHtml({ text: shortDate({ iso: postDisplayDateIso(post), timeZone: ctx.timeZone }) })}</p></a></li>`;
}

export function entryList(
  { ctx, props, renderCoverImageTag, emptyPostsText }: { ctx: SiteRenderContext; props: JsonObject; renderCoverImageTag: RenderCoverImageTag; emptyPostsText: string },
  _optional = {},
): string {
  const layout = typeof props.layout === "string" ? props.layout : "index";
  // Home pages its already-visible posts as see-more listing 1; numbering continues from `after`.
  const after = ctx.listing?.after ?? 0;
  const shown = ctx.listing === undefined ? ctx.posts : ctx.posts.slice(after, after + LISTING_BATCH_DEFAULT);
  const items = shown.map((post, i) => entryListItem({ ctx, post, index: after + i, renderCoverImageTag })).join("");
  const body = items || `<li class="entry entry--empty"><p>${escapeHtml({ text: emptyPostsText })}</p></li>`;
  if (ctx.listing === undefined || items === "") {
    return `<section class="entry-list entry-list--${escapeHtml({ text: layout })}"><div class="wrap"><ol class="entries">${body}</ol></div></section>`;
  }
  const next = after + shown.length;
  const more = next < ctx.posts.length ? renderListingMore({ key: 1, href: listingBatchPath({ pagePath: ctx.listing.pagePath, key: 1, after: next }) }) : "";
  return `<section class="entry-list entry-list--${escapeHtml({ text: layout })}"><div class="wrap"><ol class="entries" data-jini-listing="1">${wrapListingItems({ key: 1, items })}</ol>${more}</div></section>`;
}

/**
 * Products-route counterpart to `entryList` above, used by `fallbackBody()` for any theme with no
 * dedicated `products` template (declarative tier's own `resolveTemplateId`, or a static/templated
 * theme that never declared one). Mirrors `entryList`'s markup shape (`entry`/`entry-title`/
 * `entry-meta` classes, same empty-state convention) rather than inventing a second vocabulary, so
 * a theme author styling one gets the other for free.
 *
 * 2026-08-12 fix: before this, `fallbackBody()` routed the `"products"` route through `entryList`
 * itself, which reads only `ctx.posts` — so a theme with no `products` template (the seeded default
 * `"basic"` among them) rendered an empty post list for `/products` regardless of how many real
 * products the caller passed in. See this file's test suite for the regression this closes.
 *
 * @complexity Time: O(p) in `ctx.products.length`. Space: O(p) for the joined markup.
 */
export function productEntryList(
  { ctx, formatMoney, emptyProductsText }: { ctx: SiteRenderContext; formatMoney: FormatMoney; emptyProductsText: string },
  _optional = {},
): string {
  const items = ctx.products
    .map((product, i) => {
      const folio = String(i + 1).padStart(2, "0");
      const price = escapeHtml({ text: formatProductMoney({ amount: product.price, currency: product.currency, formatMoney }) });
      // `|| product.id`: defensive, not the normal path — every real `SiteProduct` source
      // (`storefront.ts`'s `toSiteProduct`, `Jini packages/commerce/src/store/store-plugin.ts`'s `listProducts`) always sets a real
      // `slug`. Falls back rather than crashing `escapeHtml` on a caller/test double built against
      // an older, slug-less `SiteProduct` shape.
      return `<li class="entry"><a class="entry-link" href="/products/${escapeHtml({ text: product.slug || product.id })}"><span class="entry-index">№ ${folio}</span><h2 class="entry-title">${escapeHtml({ text: product.title })}</h2><p class="entry-meta">${price}</p></a></li>`;
    })
    .join("");
  const body = items || `<li class="entry entry--empty"><p>${escapeHtml({ text: emptyProductsText })}</p></li>`;
  return `<section class="entry-list entry-list--products"><div class="wrap"><ol class="entries">${body}</ol></div></section>`;
}

/**
 * Product-detail-route counterpart to `entryContent` above, same "no dedicated template" fallback
 * use and same 2026-08-12 fix reasoning as `productEntryList` — `entryContent` reads only
 * `ctx.post`, so it rendered an empty `<article>` for the `"product"` route no matter what
 * `ctx.product` held.
 *
 * @complexity O(1).
 */
export function productEntryContent({ ctx, formatMoney }: { ctx: SiteRenderContext; formatMoney: FormatMoney }, _optional = {}): string {
  if (!ctx.product) return "";
  const price = escapeHtml({ text: formatProductMoney({ amount: ctx.product.price, currency: ctx.product.currency, formatMoney }) });
  return `<div class="wrap"><a class="back" href="/products">← ${escapeHtml({ text: ctx.siteTitle })}</a><article class="entry"><h1 class="entry-title">${escapeHtml({ text: ctx.product.title })}</h1><p class="entry-meta">${price}</p></article></div>`;
}
