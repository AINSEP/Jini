/**
 * @file SEO core type definitions.
 *
 * Types ONLY — no feature logic. Fills in the original design-only stub with
 * the shapes the original plan actually commits to. Deviations from the original
 * stub (state.spec.md §5 + ADR-PIPE-008 Context, all disclosed there):
 *  - No `baseUrl`/`seo.base_url` anywhere (INV-07 — single-origin-authority;
 *    every absolute URL comes from `routing.urlFor`'s `canonicalUrl`).
 *  - `RobotsPolicy` stays computed-only (`sitemapUrls` is never persisted);
 *    only `robotsRules: RobotsRule[]` is stored.
 *  - `SeoPermission`'s 5-string vocabulary is replaced by the single string
 *    `"admin.seo.manage"`, used directly at call sites (no type needed).
 *  - `SeoFieldDecl`/`SeoExpressionIndexDecl` (generic-entries-model
 *    registration vocabulary) are dropped — this feature stores overrides on
 *    the bespoke `posts.seo_ext_json` column (state.spec.md §0), not a
 *    generic ext-bag with a content-type field registry.
 *  - The shared page-head contract below serves CMS presentation contributors and
 *    SEO; the fold and serializer live in `presentation/page-head.ts`.
 */
import type { ISODateTime, JsonObject, UUID } from "@jini-ai/core/primitives";


/** JSON-LD is a plain JSON object graph (schema.org). */
export type JsonLd = JsonObject;

interface HeadElementBase {
  /**
   * behavior.spec.md §2.1's fixed priority bands (title=100, meta-desc=110,
   * canonical=120, robots=130, og=140-149, twitter=150-159 (as `kind:"meta"`
   * with a `twitter:*` name), jsonld=900). Also the §5.2/§6.1 dedup
   * last-writer-wins comparator: among two colliding `HeadElementKey`s, the
   * numerically highest `priority` wins.
   */
  readonly priority: number;
}

/**
 * One `<head>` contribution as a canonical render-IR node — serializable
 * descriptors, never raw HTML strings (INV-03). Deduped by `HeadElementKey`
 * (behavior.spec.md §5.1). Twitter card tags are `kind:"meta"` with a
 * `name` like `"twitter:card"` — no separate "twitter" kind exists.
 */
export type HeadElement =
  | (HeadElementBase & { readonly kind: "title"; readonly text: string })
  | (HeadElementBase & { readonly kind: "meta"; readonly name: string; readonly content: string })
  | (HeadElementBase & { readonly kind: "og"; readonly property: string; readonly content: string })
  | (HeadElementBase & {
      readonly kind: "link";
      readonly rel: string;
      readonly href: string;
      /** Language of an alternate resource. Part of the dedup key. */
      readonly hreflang?: string | undefined;
      /** MIME type, e.g. `application/rss+xml` on a feed's `rel="alternate"`. Part of the dedup key. */
      readonly type?: string | undefined;
      readonly title?: string | undefined;
    })
  | (HeadElementBase & { readonly kind: "jsonld"; readonly data: JsonLd });

/** Stable dedup key for a HeadElement (behavior.spec.md §5.1). */
export type HeadElementKey = string;

/**
 * A serializable snapshot of the entry being rendered. NOT a live `PostRecord`
 * — the host extracts this at the render seam and hands it to contributors by value.
 */
export interface PageHeadEntryRef {
  id: UUID;
  type: string;
  slug: string;
  title: string;
  status: string;
  publishedAt?: ISODateTime | undefined;
  updatedAt: ISODateTime;
  /** The already-extracted, validated `seo_ext_json` bag (serialized, not live). */
  ext: Record<string, unknown>;
  /** Plain-text excerpt derived from `bodyJson` by the host (for auto-descriptions). */
  excerpt?: string | undefined;
  /** Ancestor chain (root-first) for `BreadcrumbList` JSON-LD, when applicable. */
  ancestors?: ReadonlyArray<{ title: string | undefined; url: string }>;
}

/** Everything a `page.head` contributor needs, by value. */
export interface PageHeadContext {
  workspaceId: UUID;
  route: string;
  contentType?: string | undefined;
  entry?: PageHeadEntryRef | undefined;
  canonicalUrl: string;
  siteTitle: string;
  locale?: string | undefined;
  themeTier?: string | undefined;
}

/**
 * A `page.head` contributor: async-only, explicit priority (contributor-level
 * ordering — see the element-level `priority` above for the fine-grained
 * dedup/ordering rule within/between contributors' own output).
 */
export interface PageHeadHook {
  readonly priority: number;
  handle(ctx: PageHeadContext): Promise<HeadElement[]>;
}

// ---------------------------------------------------------------------------
// 1. Stored per-entry meta — the validated `posts.seo_ext_json` bag
// ---------------------------------------------------------------------------

/** Twitter card kind (Twitter/X card meta). */
export type TwitterCardKind = "summary" | "summary_large_image";

/** OpenGraph object type (v1 subset). */
export type OpenGraphType = "website" | "article" | "profile";

/**
 * The author-authored override bag persisted at `posts.seo_ext_json`. Every
 * field is OPTIONAL — absence means "derive from the entry + site defaults".
 * Unregistered keys are rejected at the write chokepoint (`write-service.ts`);
 * this interface is the registered, validated shape.
 *
 * `ogImage`/`twitterImage` hold a media *ref* (`"{assetId}:{transformName}"`)
 * or an absolute URL — never a frozen `/m/` URL directly (internal
 * content stores refs, not URLs) — resolved to a URL at read time by `media.ts`.
 */
export interface SeoExtFields {
  /** Meta title override; falls back to `entry.title` run through the template. */
  title?: string | undefined;
  /** Meta description override; falls back to site default / excerpt. */
  description?: string | undefined;
  /** Canonical URL override (absolute); falls back to the routing-resolved URL. */
  canonical?: string | undefined;
  /** Exclude from indexing (emits `robots: noindex` + drops from the sitemap). */
  noindex?: boolean | undefined;
  /** Emit `robots: nofollow`. */
  nofollow?: boolean | undefined;
  /** JSON-LD schema.org @type override (else derived from content type). */
  schemaType?: string | undefined;
  /** OpenGraph overrides. */
  ogTitle?: string | undefined;
  ogDescription?: string | undefined;
  ogImage?: string | undefined;
  ogType?: OpenGraphType | undefined;
  /** Twitter/X card overrides. */
  twitterCard?: TwitterCardKind | undefined;
  twitterTitle?: string | undefined;
  twitterDescription?: string | undefined;
  twitterImage?: string | undefined;
}

/**
 * The shape `setEntrySeoOverrides` (`write-service.ts`) accepts as its `patch`. Widens every
 * `SeoExtFields` field to also allow `null`, meaning "remove this key" — the override is cleared
 * back to absent so resolution (`seo.ts`) falls through to the site default / derived value, the
 * same "pass null to clear" vocabulary `SeoSettings`' own nullable fields
 * (`defaultDescription`/`defaultOgImage`/`twitterSite`, see `settings.ts`) already use. `undefined`
 * (an omitted key) still means "leave unchanged" — only an explicit `null` clears.
 *
 * Clearing EVERY currently-set key in one patch (e.g. `{ description: null, title: null, ... }`)
 * is how the entry's `seoExtJson` is expressible back to its true original `NULL` state, not just
 * an empty bag — `setEntrySeoOverrides` collapses a merge result with zero remaining keys to `null`
 * rather than persisting `"{}"` (see that function's own doc comment).
 */
export type SeoExtFieldsPatch = { [K in keyof SeoExtFields]?: SeoExtFields[K] | null };

// ---------------------------------------------------------------------------
// 2. Resolved per-entry meta — what the render + admin preview + analyze consume
// ---------------------------------------------------------------------------

export interface OpenGraph {
  title: string;
  description?: string | undefined;
  type: OpenGraphType;
  url: string;
  image?: string | undefined;
  /** Original selected source for admin diagnostics, before any share-card resize. */
  imageRef?: string | undefined;
  /** Effective image provenance: explicit SEO override, entry content (featured image), or site default. */
  imageSource?: 'override' | 'content' | 'default' | undefined;
  /** Set only when the entry stores its own image override, so the admin can tell an override that
   *  happens to equal the site default from an image merely inherited from it. */
  imageOverridden?: true | undefined;
  /** Known output metadata from the selected named transform, omitted for external URLs. */
  imageWidth?: number | undefined;
  imageHeight?: number | undefined;
  imageType?: string | undefined;
  siteName?: string | undefined;
}

export interface TwitterCard {
  card: TwitterCardKind;
  title: string;
  description?: string | undefined;
  image?: string | undefined;
  /** Original selected source for admin diagnostics, before any share-card resize. */
  imageRef?: string | undefined;
  site?: string | undefined;
}

export interface RobotsDirective {
  noindex: boolean;
  nofollow: boolean;
}

/** JSON-LD is a plain JSON object graph (schema.org). */
export type JsonLdObject = JsonObject;

/**
 * The fully-resolved effective meta for one page: author overrides layered
 * over site defaults layered over derived-from-entry (behavior.spec.md §1.1).
 * This is the single source `getEntryMeta`/`analyzeEntry`/the head contributor
 * all read (one evaluator, no back door — INV-09).
 */
export interface SeoMeta {
  title: string;
  description?: string | undefined;
  canonical: string;
  robots: RobotsDirective;
  openGraph: OpenGraph;
  twitter: TwitterCard;
  jsonLd: JsonLdObject[];
}

// ---------------------------------------------------------------------------
// 3. Sitemap + robots (declarative, cache-backed outputs)
// ---------------------------------------------------------------------------

export type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export interface SitemapEntry {
  loc: string;
  lastmod?: string | undefined;
  changefreq?: ChangeFreq | undefined;
  /** 0.0–1.0. */
  priority?: number | undefined;
}

/** Context handed to the (v1 empty) `seo.sitemap.collect` hook. */
export interface SitemapCollectContext {
  workspaceId: string;
  baseUrl: string;
}

export interface RobotsRule {
  userAgent: string;
  allow?: string[] | undefined;
  disallow?: string[] | undefined;
}

/** Computed at `buildRobots()` read time — never persisted as one shape (state.spec.md §5 item 4). */
export interface RobotsPolicy {
  rules: RobotsRule[];
  /** Absolute sitemap URLs advertised in robots.txt (`[]` when `sitemapEnabled` is false). */
  sitemapUrls: string[];
}

// ---------------------------------------------------------------------------
// 4. Site-level settings — resolved from the `site.seo.*` ledger definitions
// ---------------------------------------------------------------------------

/**
 * Registered `site.seo.*` ledger keys (ADR-PIPE-008 Decision §3's mapping
 * table — 8 registered keys backing 7 `SeoSettings` fields, since
 * `defaultRobots` decomposes into 2 booleans; see `settings.ts`'s file header
 * for the disclosed "7 vs 8" tasks.md wording note).
 */
export type SeoSettingKey =
  | "title_template"
  | "default_description"
  | "default_og_image"
  | "twitter_site"
  | "default_robots_noindex"
  | "default_robots_nofollow"
  | "sitemap_enabled"
  | "robots_rules";

/** The resolved, workspace-scoped SEO settings. No `baseUrl` field exists (INV-07). */
export interface SeoSettings {
  /** e.g. `"%s — My Site"`; `%s` is the per-page title. */
  titleTemplate: string;
  defaultDescription?: string | undefined;
  defaultOgImage?: string | undefined;
  twitterSite?: string | undefined;
  defaultRobots: RobotsDirective;
  sitemapEnabled: boolean;
  robotsRules: RobotsRule[];
}

// ---------------------------------------------------------------------------
// 5. Analysis output
// ---------------------------------------------------------------------------

export type SeoIssueSeverity = "error" | "warning" | "info";

export interface SeoIssue {
  code: string;
  severity: SeoIssueSeverity;
  message: string;
  /** Which resolved field the issue is about (e.g. `title`, `description`). */
  field?: keyof SeoMeta & string | undefined;
}

export interface SeoAnalysis {
  entryId: string;
  score: number;
  issues: SeoIssue[];
  resolved: SeoMeta;
}
