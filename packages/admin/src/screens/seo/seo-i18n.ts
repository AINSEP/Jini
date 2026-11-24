import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { createDictionaryTranslator } from '@jini-ai/core/text';
import { SEO_LOCALES_A } from "./seo-i18n.locales-a.js";
import { SEO_LOCALES_B } from "./seo-i18n.locales-b.js";
import { SEO_LOCALES_C } from "./seo-i18n.locales-c.js";
import { SEO_LOCALES_D } from "./seo-i18n.locales-d.js";
/**
 * @file Spanish translation for the SEO & Metadata screen (`/admin/seo`) — the site-wide defaults
 * form, the sitemap action, and the per-entry override panel + analyzer.
 *
 * "SEO" itself is left untranslated in both locales — the acronym is used as-is in Spanish digital
 * marketing/developer usage, matching the brief's "keep the English term if that's what a
 * Spanish-speaking operator would actually expect to see" guidance.
 *
 * Scope note: `agentHandle(...)`'s `label` fields throughout `Jini packages/admin/src/seo/react/pages/SeoPage.tsx` are NOT translated — per
 * `@jini-ai/agentic`'s own source, they compile to `data-agent-label`, internal agent-tooling
 * metadata explicitly documented as "Never live text," not user-visible or screen-reader content.
 */


/** All 21 locales, in the original order; locale keys are disjoint, so the spread order is the old literal order. */
const SEO_DICT: Record<string, Record<string, string>> = { ...SEO_LOCALES_A, ...SEO_LOCALES_B, ...SEO_LOCALES_C, ...SEO_LOCALES_D };

/** Same two-step fallback every other `t()` in this app uses: translated value, else the English
 *  source string itself — never a raw dictionary-miss placeholder. */
export const t = createDictionaryTranslator({ featureDictionary: SEO_DICT }, { commonDictionary: ADMIN_COMMON_I18N });
