import { describe, expect, it } from "vitest";

import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { PAGES_DICT, t } from "../pages-i18n.js";

/**
 * @file `PAGES_DICT` cross-locale coverage — same idiom as
 * `taxonomy/__tests__/taxonomy-i18n.unit.test.ts` (read that file's header) and
 * `posts/__tests__/posts-i18n.unit.test.ts` (its sibling dictionary — `pages-i18n.ts`'s own header
 * says `pageRowMenuItems` reuses `posts-i18n.ts`'s exact vocabulary): `pages-i18n.ts` exported no
 * module-level `t` at all before this fix — `rules.ts`'s `pageRowMenuItems` and
 * `use-pages.hooks.ts` each built their own no-fallback `PAGES_DICT[locale]?.[key] ?? key` closure
 * inline.
 *
 * Added 2026-09-21 alongside the S-I18N fallback fix extension to the rest of the admin app.
 */
describe("PAGES_DICT: cross-locale key parity", () => {
  const locales = Object.keys(PAGES_DICT);

  it("covers the same 21 locales the rest of this app's feature dictionaries ship", () => {
    const EXPECTED_LOCALES = [
      "ar", "bn", "de", "es", "fa", "fr", "hi", "hu", "id", "it",
      "ja", "ko", "pl", "pt-BR", "ru", "th", "tr", "uk", "ur", "zh-CN", "zh-TW",
    ];
    expect(locales.slice().sort()).toEqual(EXPECTED_LOCALES.slice().sort());
  });

  it("every partially-present key is one ADMIN_COMMON_I18N carries in all 21 locales", () => {
    const allKeys = new Set(locales.flatMap((locale) => Object.keys(PAGES_DICT[locale])));
    const unrescuable: string[] = [];
    for (const key of allKeys) {
      const missingIn = locales.filter((locale) => PAGES_DICT[locale][key] === undefined);
      if (missingIn.length === 0) continue;
      if (locales.every((locale) => ADMIN_COMMON_I18N[locale]?.[key] !== undefined)) continue;
      unrescuable.push(`${JSON.stringify(key)} missing in ${missingIn.join(",")}`);
    }
    expect(unrescuable).toEqual([]);
  });

  // "Move" is deliberately empty in the six object-before-verb locales (ja, ko, tr, hi, ur, bn) —
  // same documented reason as posts-i18n.ts's own header and its parity test: the confirm dialog
  // composes `{t("Move")} "{title}" {t("to trash? …")}`, and in these languages the verb is already
  // embedded in the trailing fragment right after the quoted title.
  const DELIBERATELY_EMPTY: Record<string, string[]> = {
    Move: ["ja", "ko", "tr", "hi", "ur", "bn"],
  };
  it("has a non-empty translation for every key in every locale, except documented deliberate exceptions", () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(PAGES_DICT[locale])) {
        if (DELIBERATELY_EMPTY[key]?.includes(locale)) continue;
        expect(value.length, `${locale} value for ${JSON.stringify(key)} should not be empty`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Regression for basic words (Cancel, Delete permanently, …) rendering English in every locale
 * (S-I18N fallback fix). `PAGES_DICT.de` carries neither "Cancel" nor "Delete permanently" — both
 * are `ADMIN_COMMON_I18N` keys in all 21 locales, so `t` must fall through to `ADMIN_COMMON_I18N` instead of
 * returning the raw English key.
 */
describe("PAGES_DICT: t() falls back to ADMIN_COMMON_I18N", () => {
  it("translates 'Cancel' in German even though PAGES_DICT.de never carries it", () => {
    expect(PAGES_DICT.de.Cancel).toBeUndefined();
    expect(t({ locale: "de", key: "Cancel" })).toBe(ADMIN_COMMON_I18N.de.Cancel);
  });

  it("translates 'Delete permanently' in German even though PAGES_DICT.de never carries it", () => {
    expect(PAGES_DICT.de["Delete permanently"]).toBeUndefined();
    expect(t({ locale: "de", key: "Delete permanently" })).toBe(ADMIN_COMMON_I18N.de["Delete permanently"]);
  });
});
