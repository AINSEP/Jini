/**
 * @file The admin `seo` settings and sitemap wire DTOs (ADR-029): the JSON bodies the SEO settings
 * and sitemap-regenerate admin routes answer with and an admin client reads. Declared here, once, so
 * the CMS route specs and any client mirror read the same shapes without the client depending on CMS.
 *
 * Core cannot import CMS, so `SeoSettings`/`RobotsRule` are restated structurally here. CMS's
 * `admin-http/http/__tests__/seo.test.ts` pins them in both directions; keep the two sides identical.
 *
 * Deliberately NOT here (yet): the per-entry bodies (`{ data: SeoMeta }`, `{ data: SeoAnalysis }`).
 * `SeoMeta` is a large CMS resolution type (Open Graph, Twitter card, JSON-LD, robots, field
 * sources); restating it wholesale in Core would duplicate the SEO model rather than a wire shape.
 */

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
