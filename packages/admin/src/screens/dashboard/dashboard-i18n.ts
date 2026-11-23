import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary } from '@jini-ai/core/text';
import { DASHBOARD_LOCALES_A } from "./dashboard-i18n.locales-a.js";
import { DASHBOARD_LOCALES_B } from "./dashboard-i18n.locales-b.js";
import { DASHBOARD_LOCALES_C } from "./dashboard-i18n.locales-c.js";
import { DASHBOARD_LOCALES_D } from "./dashboard-i18n.locales-d.js";
import { DASHBOARD_LOCALES_E } from "./dashboard-i18n.locales-e.js";
import { DASHBOARD_LOCALES_F } from "./dashboard-i18n.locales-f.js";
/**
 * @file Dictionary for `Dashboard.tsx` — the admin landing screen's own chrome (header, stat card
 * labels, activity/appearance panels), plus the Publish Content dialog's copy, which is the
 * Dashboard's dialog wherever the host mounts it. `t()` falls back to a common dictionary via
 * `createDictionaryTranslator`.
 *
 * Also covers `rules.ts`'s `postsStatMeta`/`pagesStatMeta`/`commentsStatMeta` stat-card meta lines
 * ("{count} published", "{count} draft"/"{count} drafts", "nothing to review"/"awaiting
 * moderation") — these used to render hardcoded English regardless of locale (a browser sweep,
 * 2026-09-22, caught it); the three functions now take a `Translate` and interpolate `{count}`.
 *
 * Product copy stays the host's: a host whose common dictionary carries product-named entries
 * builds its own translator with {@link createDashboardTranslator} instead of using `t` below.
 */

/** All 21 locales, in the original order; locale keys are disjoint, so the spread order is the old literal order. */
export const DASHBOARD_DICT: Record<string, Record<string, string>> = {
  ...DASHBOARD_LOCALES_A, ...DASHBOARD_LOCALES_B, ...DASHBOARD_LOCALES_C,
  ...DASHBOARD_LOCALES_D, ...DASHBOARD_LOCALES_E, ...DASHBOARD_LOCALES_F,
};

/**
 * `DASHBOARD_DICT[locale]?.[key] ?? commonDictionary[locale]?.[key] ?? key` — a shared word this
 * dict doesn't carry for a locale still renders translated instead of falling straight to English.
 * @example const translateDashboard = createDashboardTranslator({ commonDictionary: HOST_COMMON_I18N });
 */
export function createDashboardTranslator({ commonDictionary }: { commonDictionary: LocaleDictionary }, _optional = {}): DictionaryTranslator {
  return createDictionaryTranslator({ featureDictionary: DASHBOARD_DICT }, { commonDictionary });
}

/** The product-neutral translator over the admin's common dictionary. Exported so
 *  `use-dashboard.hooks.ts` (which has no JSX and resolves its own error strings against `locale`)
 *  can call it directly instead of duplicating the lookup. */
export const t = createDashboardTranslator({ commonDictionary: ADMIN_COMMON_I18N });
