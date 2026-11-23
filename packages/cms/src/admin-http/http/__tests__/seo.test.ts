import { describe, expect, it } from "vitest";
import type { AdminSeoRobotsRuleDto, AdminSeoSettingsDto } from "@jini-ai/core/contracts/site/cms-seo";

import type { RobotsDirective, RobotsRule, SeoSettings } from "../../../seo/types.js";
import { seoEntryIdParam } from "../../routes/seo/shared.js";

/**
 * @file rv1123e K1 migration: the SEO settings and sitemap wire DTOs are declared once in neutral Core
 * (the admin client consumes them). The per-entry bodies (`{ data: SeoMeta }`, `{ data: SeoAnalysis }`)
 * stay CMS-typed: `SeoMeta` is the whole SEO resolution model, not a wire shape Core should restate.
 */
/** Mutual assignability, checked by the compiler: `true` only when each side accepts the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

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
});
