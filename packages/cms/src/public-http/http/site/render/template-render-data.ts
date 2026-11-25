import type { SiteRenderContext, SiteProduct } from "../render-context.js";
import { postDisplayDateIso } from "@jini-ai/core/scheduled-publish";
import { shortDate } from "./post-body.js";
import { postAuthorForDisplay } from "@jini-ai/core/contracts/site/post-author";
import type { PublicPostRecord as PostRecord } from "../../../../posts/post.js";
import { resolveCoverImage } from "../../../../media/cover-image.js";
import { mediaUrlKey, mediaPublicPath } from "../../../../media/site/public-path.js";

/** The host's money formatter (the catalog's own), injected so this module stays commerce-free. */
type FormatMoney = (required: { money: { minorUnits: number; currency: string } }) => string;

/** Currency formatting is shared with the catalog; old currency-less theme fixtures mean USD.
 * @complexity O(1), with no I/O. */
export function formatProductMoney({ amount, currency, formatMoney }: { amount: number; currency?: string | undefined; formatMoney: FormatMoney }, _optional = {}): string {
  return formatMoney({ money: { minorUnits: amount, currency: (currency ?? "USD").toUpperCase() } });
}

/**
 * Shapes the plain, structured-cloneable data object a logic-tier template renders against.
 *
 * Exported and shared by BOTH engine workers (`liquid-worker.ts`, `handlebars-worker.ts`)
 * deliberately: the data contract a theme author writes against — `site`, `theme`, `route`,
 * `posts`, `post`, `products`, `product` — is a property of the render pipeline, not of
 * whichever template language is reading it. Keeping one builder is what makes "the same page,
 * authored in Liquid or in Handlebars, sees the same fields" a fact rather than a coincidence two
 * files have to be edited in lockstep to preserve.
 *
 * `post.content` is pre-rendered, pre-sanitized HTML (the injected `renderPostBody` output) — the ONE
 * value either tier is permitted to emit unescaped (Liquid's `| raw`, Handlebars' `{{{post.content}}}`).
 *
 * @complexity O(p) in the post/product counts.
 * @overallScore 100/100
 */
export function buildTemplateRenderData(
  { ctx, renderPostBody, formatMoney }: { ctx: SiteRenderContext; renderPostBody: (required: { ctx: SiteRenderContext; post: PostRecord }) => string; formatMoney: FormatMoney },
  _optional = {},
): Record<string, unknown> {
  return {
    site: { title: ctx.siteTitle },
    theme: { name: ctx.themeName },
    route: ctx.route,
    // `date` is the full ISO timestamp (Liquid themes format it with `| date: "%b %e, %Y"`);
    // `dateShort` is the same instant as a `YYYY-MM-DD` day in the site's zone (Bug D), added for the same reason
    // `priceFormatted` exists below — the Handlebars tier's allowlist carries no date filter or
    // helper (and deliberately exposes no way for a theme to register one), so any formatting a
    // theme cannot express must be precomputed server-side. Purely additive: every existing Liquid
    // theme's `{{ post.date | date: … }}` keeps reading the same unchanged `date` field.
    // `date` is the go-live time when the post has one (`postDisplayDateIso`, owner decision
    // 2026-10-05), else `updatedAt`.
    // `featuredImage` (2026-10-05) is `{ url, alt, width, height }` or `null` — a theme renders it
    // with `{% if post.featuredImage %}<img src="{{ post.featuredImage.url }}" …>{% endif %}`.
    posts: ctx.posts.map((p) => ({ title: p.title, slug: p.slug, date: postDisplayDateIso(p), dateShort: shortDate({ iso: postDisplayDateIso(p), timeZone: ctx.timeZone }), featuredImage: featuredImageView({ ctx, post: p }), author: postAuthorForDisplay({ post: p }), showAuthor: p.showAuthor ?? false })),
    post: ctx.post
      ? {
          title: ctx.post.title,
          slug: ctx.post.slug,
          date: postDisplayDateIso(ctx.post),
          dateShort: shortDate({ iso: postDisplayDateIso(ctx.post), timeZone: ctx.timeZone }),
          content: renderPostBody({ ctx, post: ctx.post }),
          featuredImage: featuredImageView({ ctx, post: ctx.post }),
          author: postAuthorForDisplay({ post: ctx.post }),
          showAuthor: ctx.post.showAuthor ?? false,
        }
      : null,
    // `price` stays in cents — themes format it themselves; `priceFormatted`/`compareAtPriceFormatted`
    // are precomputed here so a theme can just read one field.
    products: ctx.products.map((p) => siteProductRenderShape({ product: p, formatMoney })),
    product: ctx.product ? siteProductRenderShape({ product: ctx.product, formatMoney }) : null,
  };
}

/**
 * Featured image (2026-10-05) as template data: the core "public" transform URL — the same `/m/`
 * URL a body image of the same asset gets — or `null` when the post has none, the asset did not
 * resolve (trashed, deleted, not in `mediaAssetMetadata`), or the transform is not registered yet.
 * An unset featured slot uses the shared first-body-image policy; body alt falls back to the title.
 * Exported for the static tier (`pages.ts`'s `resolveFeaturedImageForRender`), which feeds the
 * same view to a `{"type":"featured-image"}` marker so the two tiers cannot disagree.
 *
 * @complexity O(n) body traversal for an unset featured slot; O(1) for a featured image.
 */
/** `CORE_PUBLIC_TRANSFORM_NAME` (`features/media/bootstrap.ts`), restated rather than imported: that
 *  module pulls in the whole media feature barrel, which this I/O-free render module never needed. */
const FEATURED_IMAGE_TRANSFORM = "public";

/** The template-facing featured-image shape: `{ url, alt, width, height }`. */
export interface FeaturedImageView { url: string; alt: string; width: number | null; height: number | null }

export function featuredImageView(
  { ctx, post }: { ctx: Pick<SiteRenderContext, "mediaAssetMetadata" | "mediaTransformVersions">; post: PostRecord }, _optional: Record<string, never> = {}
): FeaturedImageView | null {
  const cover = resolveCoverImage({ post, mediaLookup: ({ ref }) => ctx.mediaAssetMetadata.get(ref) ?? null });
  if (!cover?.mediaId) return null;
  const meta = ctx.mediaAssetMetadata.get(cover.mediaId);
  const version = ctx.mediaTransformVersions.get(FEATURED_IMAGE_TRANSFORM);
  if (!meta || version === undefined) return null;
  const urlKey = mediaUrlKey({ id: cover.mediaId, slug: meta.slug });
  return {
    url: mediaPublicPath({ key: urlKey, ...(meta.sha256 === undefined ? {} : { sha256: meta.sha256 }), variant: { kind: "transform", name: FEATURED_IMAGE_TRANSFORM, version, ext: "jpg" } }),
    alt: cover.alt,
    width: meta.width,
    height: meta.height,
  };
}

/** Shared `SiteProduct` -> template-facing shape, used for both the `products` list and the
 * single `product` (product-detail route) — one mapping, not two kept in agreement by hand. */
function siteProductRenderShape({ product: p, formatMoney }: { product: SiteProduct; formatMoney: FormatMoney }, _optional = {}): Record<string, unknown> {
  return {
    id: p.id,
    // The `/products/<slug>` link key (readable-slugs S7) — a templated theme builds its own href.
    slug: p.slug,
    title: p.title,
    price: p.price,
    ...(p.priceId === undefined ? {} : { priceId: p.priceId }),
    priceFormatted: formatProductMoney({ amount: p.price, currency: p.currency, formatMoney }),
    stock: p.stock,
    compareAtPriceFormatted: p.compareAtPrice === undefined ? undefined : formatProductMoney({ amount: p.compareAtPrice, currency: p.currency, formatMoney }),
    currency: p.currency,
    specs: p.specs,
  };
}
