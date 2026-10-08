/**
 * @file SEO core type definitions (SPEC-008, ADR-PIPE-008).
 *
 * Types ONLY — no feature logic. Fills in the ADR-032 design-only stub with
 * the shapes ADR-PIPE-008 actually commits to. Deviations from the original
 * stub (state.spec.md §5 + ADR-PIPE-008 Context, all disclosed there):
 *  - No `baseUrl`/`seo.base_url` anywhere (INV-07 — single-origin-authority;
 *    every absolute URL comes from `routing.urlFor`'s `canonicalUrl`).
 *  - `RobotsPolicy` stays computed-only (`sitemapUrls` is never persisted);
 *    only `robotsRules: RobotsRule[]` is stored.
 *  - `SeoPermission`'s 5-string vocabulary is replaced by the single string
 *    `"admin.seo.manage"`, used directly at call sites (no type needed).
 *  - `SeoFieldDecl`/`SeoExpressionIndexDecl` (ADR-022 generic-entries-model
 *    registration vocabulary) are dropped — this feature stores overrides on
 *    the bespoke `posts.seo_ext_json` column (state.spec.md §0), not a
 *    generic ext-bag with a content-type field registry.
 *  - `HeadElement`/`HeadElementKey`/`PageHeadContext`/`PageHeadEntryRef` live
 *    canonically in `src/server/http/site/page-head.ts` (ADR-PIPE-008
 *    Decision §2 — the render seam is core-owned, not SEO-owned); as of
 *    2026-08-20 (RouteDeps-narrowing pass 3) this file holds a structural
 *    DUPLICATE of them, not a re-export — see the block comment just above
 *    their declarations below for why.
 */
import type { ISODateTime, JsonObject, UUID } from "@jini-ai/core/primitives";


/**
 * Structural duplicate of `server/http/site/page-head.ts`'s `HeadElement`/`HeadElementKey`/
 * `JsonLd`/`PageHeadContext`/`PageHeadEntryRef`/`PageHeadHook` — NOT a re-export, as of the
 * 2026-08-20 RouteDeps-narrowing pass 3 (`check:architecture`'s `backEdgesIntoServer` metric counts
 * a type-only `export type {...} from ".../server/..."` re-export as a real graph edge, same as any
 * other import — the `--ts-pre-compilation-deps` resolution `route-manifest.ts`'s own header already
 * documents for this exact shape of edge).
 *
 * OWNERSHIP IS UNCHANGED: `page-head.ts` still owns these types canonically. That is a settled,
 * deliberate decision — ADR-PIPE-008 Decision §2 explicitly considered and REJECTED keeping this
 * seam inside `src/seo/` ("Wrong ownership — a future non-SEO contributor [the feeds plugin, ADR-032
 * §4] would have to import the SEO module... couples the render layer to a feature module. Not
 * selected — ADR-032 itself frames this as the theme layer's seam, not SEO's."). Do not "fix" this
 * duplicate by turning it back into an import, and do not move these types into this file's own
 * canonical ownership — both would reopen that rejected alternative.
 *
 * `seo/page-head-contributor.ts` never calls `registerPageHeadContributor` itself (only
 * `server/app.ts` does, at boot) — it only builds a `PageHeadHook`-shaped VALUE, so nothing here
 * needs the nominal identity of the real types, only their structure.
 *
 * Drift safety net — verified empirically with two DIFFERENT perturbations, not asserted from one
 * (a claim this shape has been wrong before in this codebase). Both were applied to this file, typo
 * checked with `npx tsc -p tsconfig.json --noEmit`, and reverted:
 *
 * 1. Dropped `canonicalUrl` from this file's `PageHeadContext` (a field `page-head-contributor.ts`'s
 *    `handle` body actually reads). Failed immediately, INSIDE `seo/`, before ever reaching the
 *    wiring call: `page-head-contributor.ts(34,55): error TS2339: Property 'canonicalUrl' does not
 *    exist on type 'PageHeadContext'.` — an even earlier tripwire than the wiring call, for any
 *    drift that touches a field this file's own contributor actually uses.
 * 2. Changed `PageHeadEntryRef.ext`'s type here from `Record<string, unknown>` to `string` — a field
 *    NOTHING in `page-head-contributor.ts` reads, chosen specifically to test whether the wiring call
 *    is a genuinely independent backstop rather than redundant with case 1. It fired exactly there:
 *    `server/app.ts(796,5): error TS2345: Argument of type '...PageHeadHook' [seo/types.ts] is not
 *    assignable to parameter of type '...PageHeadHook' [server/http/site/page-head.ts]... Types of
 *    property 'ext' are incompatible. Type 'Record<string, unknown>' is not assignable to type
 *    'string'.` — at `registerPageHeadContributor(createSeoPageHeadHook(...))`, line 796.
 *
 * So the real guarantee is TWO-LAYERED: a drift in a field this contributor reads fails fast, inside
 * `seo/`, at the point of use; a drift in a field it does NOT read still fails, loudly, at the
 * `server/app.ts` wiring call — there is no incompatible-drift shape that both layers miss silently.
 */

/** JSON-LD is a plain JSON object graph (schema.org) — duplicate of `page-head.ts`'s `JsonLd`. */
export type JsonLd = JsonObject;

interface HeadElementBase {
  /** behavior.spec.md §2.1's fixed priority bands and dedup comparator — see `page-head.ts`'s own
   *  `HeadElementBase` doc for the full rule; unchanged here. */
  readonly priority: number;
}

/** Duplicate of `page-head.ts`'s `HeadElement` — see this file's own header for why. */
export type HeadElement =
  | (HeadElementBase & { readonly kind: "title"; readonly text: string })
  | (HeadElementBase & { readonly kind: "meta"; readonly name: string; readonly content: string })
  | (HeadElementBase & { readonly kind: "og"; readonly property: string; readonly content: string })
  | (HeadElementBase & {
      readonly kind: "link";
      readonly rel: string;
      readonly href: string;
      readonly hreflang?: string | undefined;
      /** MIME type, e.g. `application/rss+xml` on a feed's `rel="alternate"`. Part of the dedup key. */
      readonly type?: string | undefined;
      readonly title?: string | undefined;
    })
  | (HeadElementBase & { readonly kind: "jsonld"; readonly data: JsonLd });

/** Stable dedup key for a HeadElement — duplicate of `page-head.ts`'s `HeadElementKey`. */
export type HeadElementKey = string;

/** Duplicate of `page-head.ts`'s `PageHeadEntryRef` — see this file's own header for why. */
export interface PageHeadEntryRef {
  id: UUID;
  type: string;
  slug: string;
  title: string;
  status: string;
  publishedAt?: ISODateTime | undefined;
  updatedAt: ISODateTime;
  ext: Record<string, unknown>;
  excerpt?: string | undefined;
  ancestors?: ReadonlyArray<{ title: string | undefined; url: string }>;
}

/** Duplicate of `page-head.ts`'s `PageHeadContext` — see this file's own header for why. */
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

/** Duplicate of `page-head.ts`'s `PageHeadHook` — see this file's own header for why. */
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
 * or an absolute URL — never a frozen `/m/` URL directly (ADR-027 §4: internal
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
  siteName?: string | undefined;
}

export interface TwitterCard {
  card: TwitterCardKind;
  title: string;
  description?: string | undefined;
  image?: string | undefined;
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
