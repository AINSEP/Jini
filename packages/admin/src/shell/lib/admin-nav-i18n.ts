/**
 * @file Spanish translation for the main admin sidebar — group headings, item labels, and the
 * "Soon" badge — the gap the user flagged twice: `SettingsUi.tsx`'s `I18nProvider` only ever
 * covered the Settings dialog's own tab content, never this persistent nav that's outside it.
 *
 * Deliberately NOT built on `@jini-ai/ui`'s `I18nProvider`/`useT()` mechanism used in
 * `SettingsUi.tsx`: `App.tsx`'s `navGroups` come from `getNav()` → `ADMIN_PANELS`
 * (`panels.tsx`), a plain module-level constant evaluated once at import time, not inside a
 * component render — there is no React tree position to read a context value from at that point.
 * So this translates the already-built `AdminNavGroup[]` output at the point `App.tsx` hands it to
 * `<Sidebar.Nav>`, via a plain lookup function, same "resolve outside React context" shape
 * `SettingsUi.tsx`'s own `const t = (key) => ...` helper already uses and for the same reason.
 *
 * Scope: nav only. Every admin PAGE's own content (headings, buttons, empty states — e.g.
 * `Media.tsx`'s "Upload and manage image and video assets…") is a separate, much larger
 * translation surface, not covered here.
 */
import type { AdminNavGroup } from "../../core/index.js";

import { ADMIN_NAV_ES_ID_DE } from "./admin-nav-i18n/nav-es-id-de.js";
import { ADMIN_NAV_ZH_CN_ZH_TW_PT_BR } from "./admin-nav-i18n/nav-zh-cn-zh-tw-pt-br.js";
import { ADMIN_NAV_RU_FA_AR } from "./admin-nav-i18n/nav-ru-fa-ar.js";
import { ADMIN_NAV_JA_KO_PL } from "./admin-nav-i18n/nav-ja-ko-pl.js";
import { ADMIN_NAV_HU_FR_UK } from "./admin-nav-i18n/nav-hu-fr-uk.js";
import { ADMIN_NAV_TR_TH_IT } from "./admin-nav-i18n/nav-tr-th-it.js";
import { ADMIN_NAV_HI_UR_BN } from "./admin-nav-i18n/nav-hi-ur-bn.js";

/** Per-locale nav labels. Built from the per-locale-group modules beside this file. */
export const ADMIN_NAV_DICT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ...ADMIN_NAV_ES_ID_DE,
  ...ADMIN_NAV_ZH_CN_ZH_TW_PT_BR,
  ...ADMIN_NAV_RU_FA_AR,
  ...ADMIN_NAV_JA_KO_PL,
  ...ADMIN_NAV_HU_FR_UK,
  ...ADMIN_NAV_TR_TH_IT,
  ...ADMIN_NAV_HI_UR_BN,
};

/** The host's label translator, built from {@link ADMIN_NAV_DICT} with its dictionary translator
 *  (core `createDictionaryTranslator`, with the common dictionary as fallback). Same two-step
 *  fallback every other `t()` uses: translated value, else the English source string itself — never
 *  a raw dictionary-miss placeholder. The host binds it at module scope and passes it in. */
export type AdminNavLabelTranslator = (required: { locale: string; key: string }) => string;

/** Applies the injected `translate` to every group heading and item label in `getNav()`'s output.
 *  Pure — returns new arrays/objects, doesn't mutate the (possibly cached) input.
 *  No `if (locale !== "es")` early return here: the translator already falls back to the
 *  raw label for any locale/key it doesn't have, so this must run for every locale to pick up the
 *  other 16 languages — an early return here was the same shape bug fixed everywhere else in this
 *  app, just missed on this file's second function. */
export function translateAdminNavGroups(
  { locale, groups, translate }: { locale: string; groups: readonly AdminNavGroup[]; translate: AdminNavLabelTranslator },
  _options = {},
): AdminNavGroup[] {
  return groups.map((group) => ({
    ...group,
    ...(group.label ? { label: translate({ locale: locale, key: group.label }) } : {}),
    items: group.items.map((item) => ({
      ...item,
      label: translate({ locale: locale, key: item.label }),
    })),
  }));
}
