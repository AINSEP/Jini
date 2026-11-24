/**
 * @file The admin `seo` settings and sitemap wire DTOs (ADR-029): the JSON bodies the SEO settings
 * and sitemap-regenerate admin routes answer with and an admin client reads. Declared here, once, so
 * the CMS route specs and any client mirror read the same shapes without the client depending on CMS.
 *
 * Core cannot import CMS, so `SeoSettings`/`RobotsRule` are restated structurally here. CMS's
 * `admin-http/http/__tests__/seo.test.ts` pins them in both directions; keep the two sides identical.
 *
 * The per-entry bodies (`{ data: SeoMeta }`, `{ data: SeoAnalysis }`) were first left out: `SeoMeta`
 * is a large CMS resolution type (Open Graph, Twitter card, JSON-LD, robots, field sources), and
 * restating it looked like duplicating the SEO model rather than a wire shape. They are here now
 * (rv1123i) because an admin client mirrored them by hand anyway, and that mirror had already
 * drifted (it lacked the image provenance fields). Only the resolved, answered shapes are restated;
 * the stored override bag and its patch stay CMS-owned, and the same parity test pins these too.
 */

import type { JsonObject } from "../../primitives/json.js";

/** One `robots.txt` group (CMS `RobotsRule`). */
export interface AdminSeoRobotsRuleDto {
  userAgent: string;
  allow?: string[] | undefined;
  disallow?: string[] | undefined;
}

/** The resolved, workspace-scoped SEO settings (CMS `SeoSettings`). No `baseUrl` field exists (INV-07). */
export interface AdminSeoSettingsDto {
  /** e.g. `"%s — My Site"`; `%s` is the per-page title. */
  titleTemplate: string;
  defaultDescription?: string | undefined;
  defaultOgImage?: string | undefined;
  twitterSite?: string | undefined;
  defaultRobots: { noindex: boolean; nofollow: boolean };
  sitemapEnabled: boolean;
  robotsRules: AdminSeoRobotsRuleDto[];
}

/** The settings body (GET and PUT answer the settings as stored). */
export interface AdminSeoSettingsEnvelope { data: AdminSeoSettingsDto }

/** The sitemap-regenerate body (answered with 202: the rebuild was accepted). */
export interface AdminSeoSitemapRegenerateEnvelope { data: { accepted: true } }

/** Twitter/X card kind (CMS `TwitterCardKind`). */
export type AdminSeoTwitterCardKind = "summary" | "summary_large_image";

/** Open Graph object type, v1 subset (CMS `OpenGraphType`). */
export type AdminSeoOpenGraphType = "website" | "article" | "profile";

/** The resolved Open Graph block of an entry's meta (CMS `OpenGraph`). */
export interface AdminSeoOpenGraphDto {
  title: string;
  description?: string | undefined;
  type: AdminSeoOpenGraphType;
  url: string;
  image?: string | undefined;
  /** Original selected source for admin diagnostics, before any share-card resize. */
  imageRef?: string | undefined;
  /** Effective image provenance: explicit SEO override, entry content (featured image), or site default. */
  imageSource?: "override" | "content" | "default" | undefined;
  /** Set only when the entry stores its own image override, so an admin can tell an override that
   *  happens to equal the site default from an image merely inherited from it. */
  imageOverridden?: true | undefined;
  /** Known output metadata from the selected named transform, omitted for external URLs. */
  imageWidth?: number | undefined;
  imageHeight?: number | undefined;
  imageType?: string | undefined;
  siteName?: string | undefined;
}

/** The resolved Twitter/X card block of an entry's meta (CMS `TwitterCard`). */
export interface AdminSeoTwitterCardDto {
  card: AdminSeoTwitterCardKind;
  title: string;
  description?: string | undefined;
  image?: string | undefined;
  /** Original selected source for admin diagnostics, before any share-card resize. */
  imageRef?: string | undefined;
  site?: string | undefined;
}

/**
 * An entry's fully-resolved effective meta (CMS `SeoMeta`): author overrides layered over site
 * defaults layered over values derived from the entry. GET and PUT of an entry both answer this
 * resolved shape, never the raw override bag.
 */
export interface AdminSeoMetaDto {
  title: string;
  description?: string | undefined;
  canonical: string;
  robots: { noindex: boolean; nofollow: boolean };
  openGraph: AdminSeoOpenGraphDto;
  twitter: AdminSeoTwitterCardDto;
  /** schema.org JSON-LD object graphs. */
  jsonLd: JsonObject[];
}

/** How serious one analysis finding is (CMS `SeoIssueSeverity`). */
export type AdminSeoIssueSeverity = "error" | "warning" | "info";

/** One analysis finding (CMS `SeoIssue`). */
export interface AdminSeoIssueDto {
  code: string;
  severity: AdminSeoIssueSeverity;
  message: string;
  /** Which resolved field the issue is about (e.g. `title`, `description`). */
  field?: keyof AdminSeoMetaDto & string | undefined;
}

/** An entry's SEO score and findings over its resolved meta (CMS `SeoAnalysis`). */
export interface AdminSeoAnalysisDto {
  entryId: string;
  score: number;
  issues: AdminSeoIssueDto[];
  resolved: AdminSeoMetaDto;
}

/** The per-entry meta body: the entry's effective meta under `data` (GET and PUT of an entry answer it). */
export interface AdminSeoEntryMetaEnvelope { data: AdminSeoMetaDto }

/** The per-entry analysis body. */
export interface AdminSeoEntryAnalysisEnvelope { data: AdminSeoAnalysisDto }
