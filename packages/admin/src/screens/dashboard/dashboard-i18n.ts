import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary } from '@jini-ai/core/text';
import { DASHBOARD_LOCALES_A } from "./dashboard-i18n.locales-a.js";
import { DASHBOARD_LOCALES_B } from "./dashboard-i18n.locales-b.js";
import { DASHBOARD_LOCALES_C } from "./dashboard-i18n.locales-c.js";
import { DASHBOARD_LOCALES_D } from "./dashboard-i18n.locales-d.js";
import { DASHBOARD_LOCALES_E } from "./dashboard-i18n.locales-e.js";
import { DASHBOARD_LOCALES_F } from "./dashboard-i18n.locales-f.js";
/**
 * @file Spanish dictionary for `Dashboard.tsx` — the admin landing screen's own chrome (header,
 * stat card labels, activity/appearance panels). `t()` falls back to `COMMON_I18N` via
 * `createDictionaryTranslator`, same as `trash-i18n.ts`.
 *
 * Also covers `rules.ts`'s `postsStatMeta`/`pagesStatMeta`/`commentsStatMeta` stat-card meta lines
 * ("{count} published", "{count} draft"/"{count} drafts", "nothing to review"/"awaiting
 * moderation") — these used to render hardcoded English regardless of locale (a browser sweep,
 * 2026-09-22, caught it); the three functions now take a `Translate` and interpolate `{count}` the
 * same way `pages/rules.ts`'s column-sort labels do.
 * Now: the dictionary also carries the Publish Content dialog's copy (the Dashboard's dialog
 * wherever the host mounts it), the fallback is a common dictionary, and product copy stays the
 * host's: a host whose common dictionary carries product-named entries builds its own translator
 * with {@link createDashboardTranslator} instead of using `t` below.
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

/** `DASHBOARD_DICT[locale]?.[key] ?? COMMON_I18N[locale]?.[key] ?? key` via
 *  `createDictionaryTranslator` (same fallback `trash-i18n.ts` uses) — a shared word this dict
 *  doesn't carry for a locale still renders translated instead of falling straight to English.
 *  Exported so `use-dashboard.hooks.ts` (which has no JSX and builds its own `t` closure the way
 *  `Dashboard.tsx` does) can call it directly instead of duplicating the lookup.
 * Now: `t` is the product-neutral translator over the admin's common dictionary
 * (`ADMIN_COMMON_I18N`); the fallback chain itself is {@link createDashboardTranslator}'s.
 */
export const t = createDashboardTranslator({ commonDictionary: ADMIN_COMMON_I18N });
