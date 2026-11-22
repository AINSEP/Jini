import { describe, expect, it } from "vitest";

import { ADMIN_COMMON_I18N as COMMON_I18N } from "../../../core/i18n-common.js";
import { COLLECTIONS_DICT, t } from "../collections-i18n.js";

/**
 * @file `COLLECTIONS_DICT` cross-locale coverage — same idiom and same two deliberate differences
 * from the Trash version as `widgets/__tests__/widgets-i18n.unit.test.ts` (read that file's
 * header: `collections-i18n.ts` also exports a bare `DICT[locale]?.[key] ?? key` translator with
 * no `COMMON_I18N` fallback).
 *
 * Added 2026-09-20 during review of f78e034e8 ("Publish saves current edits first, and refuses to
 * save an invalid json field"): that fix added one key to all 21 locale blocks by hand, with no
 * test enforcing it.
 */
describe("COLLECTIONS_DICT: cross-locale key parity", () => {
  const locales = Object.keys(COLLECTIONS_DICT);

  it("covers the same 21 locales the rest of this app's feature dictionaries ship", () => {
    const EXPECTED_LOCALES = [
      "ar", "bn", "de", "es", "fa", "fr", "hi", "hu", "id", "it",
      "ja", "ko", "pl", "pt-BR", "ru", "th", "tr", "uk", "ur", "zh-CN", "zh-TW",
    ];
    expect(locales.slice().sort()).toEqual(EXPECTED_LOCALES.slice().sort());
  });

  /** Same measured state, same rule, same pending fallback fix as
   *  `widgets/__tests__/widgets-i18n.unit.test.ts`'s own version of this assertion — read its
   *  comment. The `es` block here is likewise a superset whose extra keys are all `COMMON_I18N`
   *  strings ("Cancel", "Save", "Status", …). */
  it("every partially-present key is one COMMON_I18N carries in all 21 locales (the pending fallback fix's scope)", () => {
    const allKeys = new Set(locales.flatMap((locale) => Object.keys(COLLECTIONS_DICT[locale]!)));
    const unrescuable: string[] = [];
    for (const key of allKeys) {
      const missingIn = locales.filter((locale) => COLLECTIONS_DICT[locale]![key] === undefined);
      if (missingIn.length === 0) continue;
      if (locales.every((locale) => COMMON_I18N[locale]?.[key] !== undefined)) continue;
      unrescuable.push(`${JSON.stringify(key)} missing in ${missingIn.join(",")}`);
    }
    expect(unrescuable).toEqual([]);
  });

  it("has a non-empty translation for every key in every locale", () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(COLLECTIONS_DICT[locale]!)) {
        expect(value.length, `${locale} value for ${JSON.stringify(key)} should not be empty`).toBeGreaterThan(0);
        // "Collections" is French too; these Spanish entries are literal lifecycle op codes.
        if (locale === "fr" && key === "Collections") continue;
        if (locale === "es" && ["deprecate", "reactivate", "tombstone"].includes(key)) continue;
        expect(value, `${locale} must translate ${JSON.stringify(key)}`).not.toBe(key);
      }
    }
  });

  // The save-blocked message M2 (f78e034e8) added — `useCollectionEntryEditor` renders it whenever
  // a `json`-kind field holds unparseable text, so a locale missing it shows English instead.
  it("carries the invalid-JSON save refusal in every locale", () => {
    for (const locale of locales) {
      expect(COLLECTIONS_DICT[locale]!["Fix the invalid JSON before saving."], `${locale} is missing it`).toBeTruthy();
    }
  });
});

/**
 * Regression for basic words (Save, Cancel, …) rendering English in 20 of 21 locales (S-I18N
 * fallback fix). `COLLECTIONS_DICT.de` carries neither "Save" nor "Cancel" — both are
 * `COMMON_I18N` keys in all 21 locales, so `t` must fall through to `COMMON_I18N` instead of
 * returning the raw English key.
 */
describe("COLLECTIONS_DICT: t() falls back to COMMON_I18N", () => {
  it("translates 'Save' in German even though COLLECTIONS_DICT.de never carries it", () => {
    expect(COLLECTIONS_DICT.de!.Save).toBeUndefined();
    expect(t({ locale: "de", key: "Save" })).toBe(COMMON_I18N.de!.Save);
  });

  it("translates 'Cancel' in German even though COLLECTIONS_DICT.de never carries it", () => {
    expect(COLLECTIONS_DICT.de!.Cancel).toBeUndefined();
    expect(t({ locale: "de", key: "Cancel" })).toBe(COMMON_I18N.de!.Cancel);
  });
});
