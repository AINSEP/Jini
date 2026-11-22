import { describe, expect, it } from "vitest";

import { ADMIN_COMMON_I18N as COMMON_I18N } from "../../../core/i18n-common.js";
import { TAXONOMY_DICT, t } from "../taxonomy-i18n.js";

/**
 * @file `TAXONOMY_DICT` cross-locale coverage — same idiom as
 * `widgets/__tests__/widgets-i18n.unit.test.ts` (read that file's header): `taxonomy-i18n.ts`
 * exported a bare `DICT[locale]?.[key] ?? key` translator with no `COMMON_I18N` fallback before
 * this fix, so a shared key had to be carried locally, and a missing key rendered the literal
 * English string.
 *
 * Added 2026-09-21 alongside the S-I18N fallback fix for widgets/forms/collections — the
 * `plan-content2.md` sibling defect flagged the same shape here, and this file did not exist yet.
 */
describe("TAXONOMY_DICT: cross-locale key parity", () => {
  const locales = Object.keys(TAXONOMY_DICT);

  it("covers the same 21 locales the rest of this app's feature dictionaries ship", () => {
    const EXPECTED_LOCALES = [
      "ar", "bn", "de", "es", "fa", "fr", "hi", "hu", "id", "it",
      "ja", "ko", "pl", "pt-BR", "ru", "th", "tr", "uk", "ur", "zh-CN", "zh-TW",
    ];
    expect(locales.slice().sort()).toEqual(EXPECTED_LOCALES.slice().sort());
  });

  /** Same measured state, same rule as `widgets/__tests__/widgets-i18n.unit.test.ts`'s own version
   *  of this assertion — read its comment. The `es` block here is likewise a superset whose extra
   *  keys are all `COMMON_I18N` strings ("Cancel", "Save", "Status", …). */
  it("every partially-present key is one COMMON_I18N carries in all 21 locales", () => {
    const allKeys = new Set(locales.flatMap((locale) => Object.keys(TAXONOMY_DICT[locale]!)));
    const unrescuable: string[] = [];
    for (const key of allKeys) {
      const missingIn = locales.filter((locale) => TAXONOMY_DICT[locale]![key] === undefined);
      if (missingIn.length === 0) continue;
      if (locales.every((locale) => COMMON_I18N[locale]?.[key] !== undefined)) continue;
      unrescuable.push(`${JSON.stringify(key)} missing in ${missingIn.join(",")}`);
    }
    expect(unrescuable).toEqual([]);
  });

  it("has a non-empty translation for every key in every locale", () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(TAXONOMY_DICT[locale]!)) {
        expect(value.length, `${locale} value for ${JSON.stringify(key)} should not be empty`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Regression for basic words (Save, Cancel, …) rendering English in 20 of 21 locales (S-I18N
 * fallback fix). `TAXONOMY_DICT.de` carries neither "Save" nor "Cancel" — both are `COMMON_I18N`
 * keys in all 21 locales, so `t` must fall through to `COMMON_I18N` instead of returning the raw
 * English key.
 */
describe("TAXONOMY_DICT: t() falls back to COMMON_I18N", () => {
  it("translates 'Save' in German even though TAXONOMY_DICT.de never carries it", () => {
    expect(TAXONOMY_DICT.de!.Save).toBeUndefined();
    expect(t({ locale: "de", key: "Save" })).toBe(COMMON_I18N.de!.Save);
  });

  it("translates 'Cancel' in German even though TAXONOMY_DICT.de never carries it", () => {
    expect(TAXONOMY_DICT.de!.Cancel).toBeUndefined();
    expect(t({ locale: "de", key: "Cancel" })).toBe(COMMON_I18N.de!.Cancel);
  });
});

/** The Categories & Tags box (`TermPicker.tsx`) is mounted by the post, page and entry editors;
 *  every string it renders reads through this dictionary, so each must resolve in all 21 locales. */
describe("TAXONOMY_DICT: the shared Categories & Tags box", () => {
  const TERM_PICKER_KEYS = [
    "Categories & Tags",
    "No terms yet.",
    "Saving…",
    "Loading categories & tags…",
    "Tick the categories and tags that apply, then save.",
    "Save categories & tags",
    "Categories & tags saved.",
    "Failed to save categories & tags",
    "Failed to load categories & tags",
    "+ Add term",
    "Term name",
    "Type a name, then press Enter",
    "Add term",
    "Failed to create term",
  ];

  it("translates every string it renders in every locale", () => {
    const untranslated: string[] = [];
    for (const locale of Object.keys(TAXONOMY_DICT)) {
      for (const key of TERM_PICKER_KEYS) {
        if (t({ locale: locale, key: key }) === key) untranslated.push(`${locale}: ${key}`);
      }
    }
    expect(untranslated).toEqual([]);
  });
});
