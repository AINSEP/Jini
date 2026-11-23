import { describe, expect, it } from "vitest";

import { ADMIN_COMMON_I18N as COMMON_I18N } from "../../../core/i18n-common.js";
import { createDashboardTranslator, DASHBOARD_DICT, t } from "../dashboard-i18n.js";

/**
 * @file `DASHBOARD_DICT` cross-locale coverage: `dashboard-i18n.ts` exported a bare
 * `DICT[locale]?.[key] ?? key` translator with no common-dictionary fallback before this fix.
 * `COMMON_I18N` below is the admin's product-neutral `ADMIN_COMMON_I18N`.
 *
 * Scope note (per the S-I18N fallback dispatch): this is ONLY the fallback-mechanism switch.
 * `rules.ts`'s `postsStatMeta`/`pagesStatMeta`/`commentsStatMeta` stat-card meta lines stay English
 * on purpose — see this dictionary's own header — and are untouched by this fix.
 *
 * Added 2026-09-21 alongside the S-I18N fallback fix extension to the rest of the admin app.
 */
describe("DASHBOARD_DICT: cross-locale key parity", () => {
  const locales = Object.keys(DASHBOARD_DICT);

  it("covers the same 21 locales the rest of this app's feature dictionaries ship", () => {
    const EXPECTED_LOCALES = [
      "ar", "bn", "de", "es", "fa", "fr", "hi", "hu", "id", "it",
      "ja", "ko", "pl", "pt-BR", "ru", "th", "tr", "uk", "ur", "zh-CN", "zh-TW",
    ];
    expect(locales.slice().sort()).toEqual(EXPECTED_LOCALES.slice().sort());
  });

  it("every partially-present key is one COMMON_I18N carries in all 21 locales", () => {
    const allKeys = new Set(locales.flatMap((locale) => Object.keys(DASHBOARD_DICT[locale] ?? {})));
    const unrescuable: string[] = [];
    for (const key of allKeys) {
      const missingIn = locales.filter((locale) => DASHBOARD_DICT[locale]?.[key] === undefined);
      if (missingIn.length === 0) continue;
      if (locales.every((locale) => COMMON_I18N[locale]?.[key] !== undefined)) continue;
      unrescuable.push(`${JSON.stringify(key)} missing in ${missingIn.join(",")}`);
    }
    expect(unrescuable).toEqual([]);
  });

  it("has a non-empty translation for every key in every locale", () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(DASHBOARD_DICT[locale] ?? {})) {
        expect(value.length, `${locale} value for ${JSON.stringify(key)} should not be empty`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Regression for basic words (Save, Cancel, …) rendering English in 20 of 21 locales (S-I18N
 * fallback fix). `DASHBOARD_DICT.de` carries neither "Save" nor "Cancel" — both are `COMMON_I18N`
 * keys in all 21 locales, so `t` must fall through to `COMMON_I18N` instead of returning the raw
 * English key.
 */
describe("DASHBOARD_DICT: t() falls back to COMMON_I18N", () => {
  it("translates 'Save' in German even though DASHBOARD_DICT.de never carries it", () => {
    expect(DASHBOARD_DICT.de?.Save).toBeUndefined();
    expect(t({ locale: "de", key: "Save" })).toBe(COMMON_I18N.de?.Save);
  });

  it("translates 'Cancel' in German even though DASHBOARD_DICT.de never carries it", () => {
    expect(DASHBOARD_DICT.de?.Cancel).toBeUndefined();
    expect(t({ locale: "de", key: "Cancel" })).toBe(COMMON_I18N.de?.Cancel);
  });
});

describe("the Publish dialog's column names are translated in every locale", () => {
  it("translates 'Item' everywhere, and no longer carries the developer word 'Entity'", () => {
    for (const locale of Object.keys(DASHBOARD_DICT)) {
      // Present in every locale (Indonesian and Portuguese really do say "Item").
      expect(COMMON_I18N[locale]?.Item, locale).toBeTruthy();
      expect(COMMON_I18N[locale]?.Entity, locale).toBeUndefined();
      expect(t({ locale: locale, key: "Item" }), locale).toBe(COMMON_I18N[locale]?.Item);
    }
  });

  it("translates the fold row's 'already up to date' in every locale", () => {
    for (const locale of Object.keys(DASHBOARD_DICT)) {
      expect(DASHBOARD_DICT[locale]?.["already up to date"], locale).toBeTruthy();
      expect(DASHBOARD_DICT[locale]?.["already up to date"], locale).not.toBe("already up to date");
    }
  });
});

describe("createDashboardTranslator: the host's common dictionary", () => {
  it("falls back to the injected common dictionary, so a host's product-named entry translates", () => {
    const hostKey = "is on an older build of the product.";
    const translate = createDashboardTranslator({ commonDictionary: { es: { ...COMMON_I18N.es, [hostKey]: "host-es" } } });
    expect(t({ locale: "es", key: hostKey })).toBe(hostKey);
    expect(translate({ locale: "es", key: hostKey })).toBe("host-es");
    expect(translate({ locale: "es", key: "Dashboard" })).toBe(DASHBOARD_DICT.es?.Dashboard);
  });
});
