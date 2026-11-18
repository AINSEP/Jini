import { useSeoDefaults } from "../hooks/SeoPage.hooks.js";
import type { SeoTabController } from "../hooks/SeoPage.hooks.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { useSeoCopy } from "../hooks/SeoPorts.hooks.js";
import { SeoCrawlingSection, SeoSaveActions, SeoSearchAppearanceSection, SeoSocialPreviewSection } from "./SeoDefaultsSections.js";

/**
 * The "Site defaults" tab — the site-wide `seo.*` settings form, moved here verbatim from `Seo`'s
 * own body.
 *
 * ONE addition beyond relocation: the two `.field-group`s now carry headings ("Search appearance",
 * "Crawling"). They are the grouping an operator already thinks in — every SEO tool they have used
 * separates what search/social show from whether to be indexed at all — and the form had no
 * internal hierarchy whatsoever before, just seven controls in a row. Expressing it as headings
 * INSIDE one tab rather than as more tabs is deliberate and load-bearing: see `react/hooks/SeoPage.hooks.ts`'s
 * header for why splitting this form across panels would silently blank fields on save.
 *
 * The submit handler is now one call to `buildSeoSettingsPatch` (`react/hooks/SeoPage.hooks.ts`) rather than seven
 * inline `??`/`||` field reads — same fields, same fallbacks, same payload, just not written in the
 * `.tsx`.
 */
export function SeoDefaultsTab({ controller }: { controller: SeoTabController }) {
  const t = useSeoCopy();
  const { locale, settings, saving, defaultOgImage, setDefaultOgImage } = controller;
  const { submit } = useSeoDefaults({ save: controller.save });

  return (
    <form
      className="jini-seo-panel jini-seo-panel--full"
      {...agentHandle({ handle: "seo-defaults-form" }, {
        role: "form",
        label: "Site-wide SEO defaults — title template, meta description, social image, robots",
      })}
      onSubmit={submit}
    >
      <SeoSearchAppearanceSection locale={locale} settings={settings} t={t} />

      <SeoSocialPreviewSection locale={locale} settings={settings} defaultOgImage={defaultOgImage} setDefaultOgImage={setDefaultOgImage} t={t} />

      <SeoCrawlingSection locale={locale} settings={settings} t={t} />

      <SeoSaveActions locale={locale} saving={saving} t={t} />
    </form>
  );
}
