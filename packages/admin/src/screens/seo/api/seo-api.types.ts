import type {
  AdminSeoAnalysisDto, AdminSeoIssueDto, AdminSeoIssueSeverity, AdminSeoMetaDto, AdminSeoOpenGraphDto, AdminSeoOpenGraphType,
  AdminSeoRobotsRuleDto, AdminSeoSettingsDto, AdminSeoTwitterCardDto, AdminSeoTwitterCardKind,
} from "@jini-ai/core/contracts/site/cms-seo";

/** The site-level settings body (SPEC-008) — the server's wire shape, declared once in Jini Core
 *  (`@jini-ai/core/contracts/site/cms-seo`, rv1123e K1), so the client no longer restates it. */
export type RobotsRule = AdminSeoRobotsRuleDto;

export type SeoSettings = AdminSeoSettingsDto;

/**
 * The shape `setSeoSettings` accepts — `Partial<SeoSettings>` with the three nullable-on-write
 * scalars widened to also allow `null`.
 *
 * Same vocabulary as {@link SeoEntryOverridesPatch}: `null` CLEARS the site default (the server's
 * `SEO_DEFINITIONS` register these three as `nullable: true` and `buildScalarWrites` normalizes
 * `null` to its `""` absent-sentinel, which `getSeoSettings` reads back as `undefined`), while an
 * omitted key means "leave unchanged" — `setSeoSettings` is a merge, and `buildScalarWrites` skips
 * every `undefined` key outright. `SeoSettings` itself stays un-widened because it is also the
 * RESPONSE shape, where these three are only ever `string | undefined`.
 */
export type SeoSettingsPatch = Partial<Omit<SeoSettings, "defaultDescription" | "defaultOgImage" | "twitterSite">> & {
  defaultDescription?: string | null;
  defaultOgImage?: string | null;
  twitterSite?: string | null;
};

/**
 * Per-entry SEO (SPEC-008). The resolved bodies the server answers — `getSeoEntry`/`putSeoEntry`'s
 * meta and the analysis — are declared once in Jini Core (`@jini-ai/core/contracts/site/cms-seo`,
 * rv1123i K1) and pinned there against the SEO model, so the client no longer mirrors them by hand
 * (the hand mirror had already lost the image provenance fields). Only the editor-side override
 * bag and its patch below stay local.
 */
export type SeoOpenGraphType = AdminSeoOpenGraphType;
export type SeoTwitterCardKind = AdminSeoTwitterCardKind;

export type SeoOpenGraph = AdminSeoOpenGraphDto;

export type SeoTwitterCard = AdminSeoTwitterCardDto;

export type SeoEntryMeta = AdminSeoMetaDto;

/**
 * Mirrors `Jini packages/cms/src/seo/types.ts`'s `SeoExtFields` — the per-entry override
 * fields themselves. (The old comment here said "Mirrors `src/seo/types.ts`'s `SeoExtFields` — the
 * partial override bag `putSeoEntry` accepts", which had been wrong on both halves since
 * `eb10f5de`: the path moved, and the shape the route accepts is `SeoExtFieldsPatch`, not
 * `SeoExtFields`. See {@link SeoEntryOverridesPatch} below.)
 */
export interface SeoEntryOverrides {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  nofollow?: boolean;
  schemaType?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: SeoOpenGraphType;
  twitterCard?: SeoTwitterCardKind;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
}

/**
 * Mirrors that same file's `SeoExtFieldsPatch` — the bag `putSeoEntry` actually accepts, which
 * widens every field to also allow `null`.
 *
 * `null` means REMOVE this override, so resolution falls back through the site default to the
 * derived value; `undefined` (an omitted key) still means "leave unchanged". This distinction is
 * the whole point of the type: `setEntrySeoOverrides` (`write-service.ts`) stores `""` as a
 * genuine override, and `getEntryMeta` (`Jini packages/cms/src/seo/seo.ts`) resolves overrides with `??`, so an
 * override of `""` BEATS the site default and pins the entry to a blank. Before this widening the
 * admin could only ever send `""`, which is how a post reached `{"description":""}` with no way
 * back from the UI.
 */
export type SeoEntryOverridesPatch = { [K in keyof SeoEntryOverrides]?: SeoEntryOverrides[K] | null };

export type SeoIssueSeverity = AdminSeoIssueSeverity;

export type SeoIssue = AdminSeoIssueDto;

export type SeoEntryAnalysis = AdminSeoAnalysisDto;
