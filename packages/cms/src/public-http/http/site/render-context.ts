import type { PublicPostRecord as PostRecord } from "../../../posts/post.js";
import type { ResolveHtmlPageEmbedsResult } from "../../../widgets/html/index.js";
import type { WidgetRenderIR } from "../../../widgets/index.js";
import type { AssignedTermView } from "../../../taxonomy/index.js";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";

/**
 * A product line from the sample Tier-3 `store` plugin (`p_store__products`), shaped structurally
 * rather than imported from `features/plugins/store` — same decoupling convention `RouteDeps.store`
 * already uses, so the core render engine never depends on a specific plugin's module.
 */
export interface SiteProduct {
  id: string;
  /** Readable-slugs S7 (2026-09-23): the product's own unique slug — `productEntryList` below
   *  links by this, not `id`, and `routes/site/products.ts`'s product-detail route resolves either
   *  (id first, then slug), same fallback contract as posts/pages/menus. */
  slug: string;
  title: string;
  /** Integer minor units of currency. */
  price: number;
  /** Exact catalog price selected for the purchase request. */
  priceId?: string;
  /**
   * `undefined` for a product source with no inventory tracking (Commerce, as of 2026-08-12 —
   * `Jini packages/commerce/src/catalog/storefront.ts`'s own doc names this explicitly rather than fabricating a
   * count). The sample store plugin always sets a real, decremented number. `buildTemplateRenderData`
   * passes this through unchanged; a template that reads `product.stock` sees Liquid's ordinary
   * nil/falsy behavior for the untracked case, not a lie about availability.
   */
  stock?: number;
  /** Integer minor units. `undefined` = not on sale — degrades to no strikethrough price shown, matching
   * `fashion-modern/templates/products.liquid`'s own documented fallback. */
  compareAtPrice?: number;
  /**
   * ISO-4217 (e.g. `"USD"`) when known. `undefined` for a product source with no
   * currency concept (the sample store plugin). Safe to pass through as-is: `product.liquid`'s
   * currency badge and `products.liquid` both read it WITHOUT Liquid's `| raw` filter, so
   * `outputEscape: "escape"` (`liquid-worker.ts`) HTML-escapes it same as any other plain field.
   */
  currency?: string;
  /**
   * Display-only spec pairs (e.g. `{label: "Material", value: "Combed cotton"}`), in author-chosen
   * order. `undefined` = none set. Structurally mirrors `CommerceProductSpec`
   * (`Jini packages/commerce/src/catalog/types.ts`) WITHOUT importing it — same decoupling `storefront.ts`'s own
   * doc establishes for the whole `SiteProduct` shape. Safe to pass through unescaped-template-side
   * for the same reason as `currency` above (no `| raw` filter on either field in the template).
   *
   * Deliberately NOT joined by a `description` field here — see `Jini packages/commerce/src/catalog/storefront.ts`'s
   * file header for why: `product.liquid` reads `product.description` via `| raw` (unescaped,
   * trusting pre-sanitized HTML the same way `post.content` is), and no Commerce-sourced string
   * reaching this type today has ever been through a sanitizer. Adding the field to `SiteProduct`
   * would silently invite a future caller to wire it straight into that trust boundary.
   */
  specs?: { label: string; value: string }[];
}

/** Everything a template + its components need to render one page. */
export interface SiteRenderContext {
  siteTitle: string;
  route: "home" | "post" | "products" | "product";
  /** Published posts (home index; also the entry-list source). */
  posts: PostRecord[];
  /** Home only: the entry list shows `posts` 12 at a time from `after`, with a See more link. */
  listing?: { pagePath: string; after: number };
  /** The single post being viewed (post route). */
  post?: PostRecord;
  /** Products from the sample store plugin (products route). Empty when the store isn't wired
   * (memory mode) or the theme's route doesn't need them — never undefined, same "omitted ⇒ safe
   * default" convention as `widgetRegions` below. */
  products: SiteProduct[];
  /** The single product being viewed (product route). */
  product?: SiteProduct;
  /**
   * Active theme display name, for the footer badge. `null` when the operator has deliberately
   * turned the theme OFF (state 3 of the optional-theme feature) — distinct from a theme whose
   * name happens to be empty, and the signal {@link siteFooter}/{@link richSiteFooter} read to
   * suppress the badge entirely rather than emit `theme: ` with nothing after it.
   */
  themeName: string | null;
  /**
   * SPEC-043/ADR-047 W-004 — `resolvePageWidgets`'s per-region resolved widget IR, keyed by region
   * key. Empty object when the theme declares no regions or nothing resolved were passed in
   * (every render that doesn't opt into widgets, including every pre-existing test/caller of
   * `renderSite`, gets an empty object here — not a breaking change).
   */
  widgetRegions: Record<string, readonly WidgetRenderIR[]>;
  /** SPEC-043/ADR-047 REQ-21 — resolved inline `widgetEmbed` IR, keyed by `placementId`. */
  widgetInlineResolved: ReadonlyMap<string, WidgetRenderIR>;
  /**
   * ADR-027 §4 — the latest registered version of each transform NAME referenced by this render,
   * keyed by `transformName` (see {@link EMPTY_MEDIA_TRANSFORM_VERSIONS}'s doc for why this is
   * name-keyed rather than per-asset). Populated by the route caller from the same
   * `transform_registry` the public `/m/` route itself resolves against — `renderDocNode`'s `image`
   * case degrades to the placeholder for any name absent here, so an empty map (every pre-existing
   * caller/test of `renderSite`) is a non-breaking, fully backward-compatible default.
   */
  mediaTransformVersions: ReadonlyMap<string, number>;
  /**
   * SPEC-047 Slice 2 — an `"html"`-format Page's resolved `data-embed-type`
   * targets (`resolver-service.ts`'s `resolveHtmlPageEmbeds`), consumed by {@link renderPostBody}.
   * `undefined` for every render this feature doesn't touch (a `"doc"` post/home route, or any
   * pre-existing caller/test of `renderSite`) — `renderHtmlPageBody` treats that identically to "no
   * embeds resolved", degrading every placeholder to the REQ-28 marker rather than crashing.
   */
  pageHtmlEmbeds?: ResolveHtmlPageEmbedsResult;
  /**
   * Quick-and-dirty public-render sizing fix (owner-directed skip-the-ADR fix, 2026-08-05): each
   * resolved image ref's `MediaRecord.width`/`height`/`cssClass` override, keyed by `assetId` —
   * mirrors `mediaTransformVersions`'s own "small resolved lookup map, populated once per render by
   * the route caller" shape (see that field's doc), but keyed by ASSET id rather than transform
   * name since these are per-asset values, not per-transform-name ones. Populated by
   * `resolveMediaAssetMetadataForRender` (`routes/site/pages.ts`). An assetId absent from this map
   * (never uploaded, deleted, or simply a render/test that never threads this through) degrades to
   * "no override" — the `image` case omits `width`/`height`/`class` entirely rather than emitting a
   * malformed or zeroed attribute, same non-breaking-default convention every other resolved map on
   * this context follows.
   */
  mediaAssetMetadata: ReadonlyMap<string, MediaAssetRenderMeta>;
  /**
   * Taxonomy render-surface gap fix (2026-09-02, `renderViaTemplate`; extended here 2026-09-03 to
   * the declarative/templated/handlebars tiers) — `post`'s assigned category/tag terms
   * (`EntryTermReadPort.listForContent`'s own output), consumed by {@link renderPostBody}. Empty
   * (every pre-existing caller/test of `renderSite`, and any render whose `post` has nothing
   * assigned) renders byte-identical to before this field existed — see
   * {@link renderAssignedTermsBlock}'s own doc.
   */
  assignedTerms: readonly AssignedTermView[];
  /**
   * Bug D follow-up (2026-10-22) — the site's IANA zone (`core.site.timezone`, resolved by the route
   * caller). The calendar day `dateShort`/`.entry-meta` show and the zone Liquid's `| date:` filter
   * formats in. Absent (every caller/test that never threads it) renders UTC, the pre-fix behavior.
   */
  timeZone?: string;
}
