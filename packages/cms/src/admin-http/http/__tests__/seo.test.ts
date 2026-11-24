import { describe, expect, it } from "vitest";
import type {
  AdminSeoAnalysisDto, AdminSeoEntryAnalysisEnvelope, AdminSeoEntryMetaEnvelope, AdminSeoIssueDto, AdminSeoMetaDto, AdminSeoOpenGraphDto,
  AdminSeoRobotsRuleDto, AdminSeoSettingsDto, AdminSeoTwitterCardDto,
} from "@jini-ai/core/contracts/site/cms-seo";

import type { OpenGraph, RobotsDirective, RobotsRule, SeoAnalysis, SeoIssue, SeoMeta, SeoSettings, TwitterCard } from "../../../seo/types.js";
import type { seoGetEntryAnalyzeRoute } from "../../routes/seo/get-entry-analyze.js";
import type { seoGetEntryRoute } from "../../routes/seo/get-entry.js";
import type { seoPutEntryRoute } from "../../routes/seo/put-entry.js";
import { seoEntryIdParam } from "../../routes/seo/shared.js";

/**
 * @file rv1123e K1 migration: the SEO settings and sitemap wire DTOs are declared once in neutral Core
 * (the admin client consumes them). The per-entry bodies (`{ data: SeoMeta }`, `{ data: SeoAnalysis }`)
 * first stayed CMS-typed, since `SeoMeta` is the whole SEO resolution model; rv1123i moved their
 * resolved shapes to Core too, because the client was mirroring them by hand and had drifted.
 */
/** Mutual assignability, checked by the compiler: `true` only when each side accepts the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** The response body a route spec declares (its second type argument). */
type ResponseOf<R> = R extends { handle: (...args: never[]) => infer Ret } ? (Extract<Awaited<Ret>, { ok: true }> extends { value: infer V } ? V : never) : never;

describe("seo wire DTOs", () => {
  it("reads the entry id through an object argument", () => {
    expect(seoEntryIdParam({ params: {} })).toBe("");
    expect(seoEntryIdParam({ params: { entryId: "e1" } })).toBe("e1");
  });

  it("keeps Core's restated settings shapes identical to the SEO types they mirror", () => {
    // Core cannot import CMS, so it restates these shapes; a drift on either side fails `tsc` here.
    const parity: [Same<SeoSettings, AdminSeoSettingsDto>, Same<RobotsRule, AdminSeoRobotsRuleDto>, Same<RobotsDirective, AdminSeoSettingsDto["defaultRobots"]>] = [true, true, true];
    expect(parity).toEqual([true, true, true]);
  });

  it("keeps Core's restated per-entry shapes identical to the SEO resolution types they mirror", () => {
    const parity: [
      Same<SeoMeta, AdminSeoMetaDto>, Same<OpenGraph, AdminSeoOpenGraphDto>, Same<TwitterCard, AdminSeoTwitterCardDto>,
      Same<SeoIssue, AdminSeoIssueDto>, Same<SeoAnalysis, AdminSeoAnalysisDto>,
    ] = [true, true, true, true, true];
    expect(parity).toEqual([true, true, true, true, true]);
  });

  it("has the per-entry route specs answer the Core envelopes, not a CMS-owned shape", () => {
    const answers: [
      Same<ResponseOf<typeof seoGetEntryRoute>, AdminSeoEntryMetaEnvelope>,
      Same<ResponseOf<typeof seoPutEntryRoute>, AdminSeoEntryMetaEnvelope>,
      Same<ResponseOf<typeof seoGetEntryAnalyzeRoute>, AdminSeoEntryAnalysisEnvelope>,
    ] = [true, true, true];
    expect(answers).toEqual([true, true, true]);
  });
});
