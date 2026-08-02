/**
 * @file `AdminSeoPort` — per-entry SEO meta overrides layered over workspace-level defaults, plus
 * the resolved output an editor/analyzer/renderer all consume, and a sitemap regeneration trigger.
 *
 * `entryId` throughout this port is an opaque host content-item id — this port does not know or
 * care whether it names a post, a page, or anything else; the host resolves it against whatever
 * object of its own owns SEO meta. No content-type vocabulary lives here.
 *
 * ## `putSeoEntry` resolves to the full effective meta, not an echo of your patch
 *
 * The reference implementation's route writes the raw override patch, then re-reads and returns
 * the fully resolved `AdminSeoMeta` (override ▸ site default ▸ derived-from-content, per field) rather than
 * the patch itself or the raw override bag. Concretely: patching only `title` can still change
 * `openGraph.title` in the response, because an unset `ogTitle` override falls back to the
 * (now-different) resolved `title`. Do not diff the response against the patch you sent to detect
 * "what changed" — every field in the response reflects the full resolution, not just your edit.
 *
 * ## `regenerateSeoSitemap` is a fire-and-accept trigger, not a trackable job
 *
 * The reference implementation's route answers `202 Accepted` synchronously and hands back nothing but an
 * acknowledgement — no job id, no status endpoint, no completion event on this contract. Mirrors
 * `analytics.ts`'s stance on staying exactly as thin as the reference implementation: a host that
 * needs progress/queueing semantics around regeneration needs a different, dedicated contract, not
 * options bolted onto this method over time.
 *
 * ## Open vs. closed unions in this port (and the idiom used across this slice)
 *
 * `SeoOpenGraphType`/`SeoTwitterCardKind` are literal web standards (OpenGraph's `og:type`,
 * Twitter/X's card kinds) — CLOSED, because there is no host-specific value space to widen; every
 * implementer speaks the same vocabulary. `SeoIssueSeverity` is the reference implementation's own
 * analysis-engine taxonomy (today just `error`/`warning`/`info`), not a standard, and a host's analyzer may grade
 * findings more finely — OPEN, via the `T | (string & {})` widening idiom (preserves autocomplete
 * on the known values while still accepting an arbitrary host-defined string). No widening idiom
 * was established elsewhere in this port set before this slice; this file introduces it, and
 * `redirects.ts`/`menus.ts`/`forms.ts` follow the same idiom for their own reference-implementation-
 * specific unions rather than inventing their own.
 */

/** OpenGraph object type (`og:type`) — closed, see file header. */
export type SeoOpenGraphType = "website" | "article" | "profile";

/** Twitter/X card kind — closed, see file header. */
export type SeoTwitterCardKind = "summary" | "summary_large_image";

/** Severity of one `AdminSeoIssue` — open, see file header. */
export type SeoIssueSeverity = "error" | "warning" | "info" | (string & {});

/**
 * The author-authored override bag for one entry. Every field is OPTIONAL — omitting a field
 * means "derive from site defaults / the content itself," not "clear it"; `putSeoEntry` merge-
 * patches this bag onto whatever was previously stored; there is no way to unset a single
 * previously-set field back to "derive" short of the host's own reset affordance (the reference
 * implementation has none either).
 */
export interface AdminSeoOverrides {
  readonly title?: string;
  readonly description?: string;
  /** Accepted cross-domain as-is; a host may reject unsafe schemes (`javascript:`, `data:`, ...)
   *  server-side rather than this port validating client-side. */
  readonly canonical?: string;
  readonly noindex?: boolean;
  readonly nofollow?: boolean;
  /** schema.org `@type` override (else derived from content type). */
  readonly schemaType?: string;
  readonly ogTitle?: string;
  readonly ogDescription?: string;
  /** A media ref or absolute URL; resolved to a renderable URL in `AdminSeoMeta.openGraph.image`. */
  readonly ogImage?: string;
  readonly ogType?: SeoOpenGraphType;
  readonly twitterCard?: SeoTwitterCardKind;
  readonly twitterTitle?: string;
  readonly twitterDescription?: string;
  readonly twitterImage?: string;
}

export interface AdminSeoOpenGraph {
  readonly title: string;
  readonly description?: string;
  readonly type: SeoOpenGraphType;
  readonly url: string;
  /** Already resolved to a renderable URL — never a media ref. */
  readonly image?: string;
  readonly siteName?: string;
}

export interface AdminSeoTwitterCard {
  readonly card: SeoTwitterCardKind;
  readonly title: string;
  readonly description?: string;
  readonly image?: string;
  readonly site?: string;
}

export interface AdminSeoRobotsDirective {
  readonly noindex: boolean;
  readonly nofollow: boolean;
}

/** The fully-resolved effective meta for one entry — what `getSeoEntry`/`putSeoEntry` return and
 *  what `AdminSeoAnalysis.resolved` embeds. Never partial: every override/default/derivation
 *  decision is already made. */
export interface AdminSeoMeta {
  readonly title: string;
  readonly description?: string;
  readonly canonical: string;
  readonly robots: AdminSeoRobotsDirective;
  readonly openGraph: AdminSeoOpenGraph;
  readonly twitter: AdminSeoTwitterCard;
  /** schema.org JSON-LD graph objects (`@context`/`@type`/...). Opaque to this port beyond being
   *  plain JSON objects. */
  readonly jsonLd: readonly Record<string, unknown>[];
}

export interface AdminSeoIssue {
  readonly code: string;
  readonly severity: SeoIssueSeverity;
  readonly message: string;
  /** One of `AdminSeoMeta`'s top-level field names, when the issue is about a specific resolved
   *  field (e.g. `"title"`, `"description"`). Absent for a whole-entry issue. */
  readonly field?: string;
}

export interface AdminSeoAnalysis {
  readonly entryId: string;
  readonly score: number;
  readonly issues: readonly AdminSeoIssue[];
  readonly resolved: AdminSeoMeta;
}

export interface AdminSeoRobotsRule {
  readonly userAgent: string;
  readonly allow?: readonly string[];
  readonly disallow?: readonly string[];
}

/** Workspace-level SEO defaults every entry's resolution falls back to. */
export interface AdminSeoSettings {
  /** e.g. `"%s — My Site"`; `%s` is substituted with the per-entry title. */
  readonly titleTemplate: string;
  readonly defaultDescription?: string;
  readonly defaultOgImage?: string;
  readonly twitterSite?: string;
  readonly defaultRobots: AdminSeoRobotsDirective;
  readonly sitemapEnabled: boolean;
  readonly robotsRules: readonly AdminSeoRobotsRule[];
}

export interface AdminSeoPort {
  getSeoEntry(entryId: string): Promise<AdminSeoMeta>;
  /** Merge-patches the override bag and returns the newly-resolved meta — see file header. */
  putSeoEntry(entryId: string, patch: AdminSeoOverrides): Promise<AdminSeoMeta>;
  analyzeSeoEntry(entryId: string): Promise<AdminSeoAnalysis>;
  getSeoSettings(): Promise<AdminSeoSettings>;
  putSeoSettings(patch: Partial<AdminSeoSettings>): Promise<AdminSeoSettings>;
  /** Fire-and-accept trigger, not a trackable job — see file header. */
  regenerateSeoSitemap(): Promise<{ accepted: boolean }>;
}
