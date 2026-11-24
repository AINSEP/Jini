import { describe, expect, it } from "vitest";

import { ADMIN_COMMON_I18N as COMMON_I18N } from "../../../core/i18n-common.js";
import { EMAIL_DICT, t } from "../email-i18n.js";
import { EMAIL_TAB_LOCALES, EMAIL_TAB_ROWS } from "../email-tabs-i18n.js";

/** @file `EMAIL_DICT` parity: the same 21 locales, the same keys in each, no empties, no COMMON repeats. */
describe("EMAIL_DICT", () => {
  const locales = Object.keys(EMAIL_DICT);

  it("translates the missing-key and unsaved-navigation instructions in all 21 locales", () => {
    for (const locale of locales) {
      for (const key of ["Add this provider's key first.", "You have unsaved changes. Leave without saving?"]) {
        expect(EMAIL_DICT[locale]?.[key], `${locale}: ${key}`).toBeTruthy();
        expect(t({ locale, key })).not.toBe(key);
      }
    }
  });

  it("covers the same 21 locales as every other feature dictionary", () => {
    expect([...locales].sort()).toEqual(["ar", "bn", "de", "es", "fa", "fr", "hi", "hu", "id", "it", "ja", "ko", "pl", "pt-BR", "ru", "th", "tr", "uk", "ur", "zh-CN", "zh-TW"].sort());
  });

  it("ships the same non-empty keys in every locale and repeats nothing COMMON_I18N carries", () => {
    const reference = Object.keys(EMAIL_DICT.es!).sort();
    for (const locale of locales) {
      expect(Object.keys(EMAIL_DICT[locale]!).sort(), locale).toEqual(reference);
      for (const [key, value] of Object.entries(EMAIL_DICT[locale]!)) {
        expect(value.length, `${locale} ${key}`).toBeGreaterThan(0);
        expect(COMMON_I18N[locale]?.[key], `${locale} repeats COMMON ${key}`).toBeUndefined();
      }
    }
  });

  it("includes every wired-tab row in every locale with its placeholders intact", () => {
    expect([...EMAIL_TAB_LOCALES].sort()).toEqual([...locales].sort());
    expect(new Set(EMAIL_TAB_ROWS.map(([key]) => key)).size).toBe(EMAIL_TAB_ROWS.length);
    for (const [key, values] of EMAIL_TAB_ROWS) {
      expect(values).toHaveLength(21);
      const tokens = [...key.matchAll(/\{\{?\w+\}?\}/g)].map(([token]) => token).sort();
      for (const [index, locale] of EMAIL_TAB_LOCALES.entries()) {
        const translated = t({ locale, key });
        expect(translated, `${locale}: ${key}`).toBe(values[index]);
        expect(translated.trim(), `${locale}: ${key}`).not.toBe("");
        expect([...translated.matchAll(/\{\{?\w+\}?\}/g)].map(([token]) => token).sort(), `${locale}: ${key}`).toEqual(tokens);
      }
    }
  });

  it("removes the old placeholder copy in all locales", () => {
    const obsolete = [
      "Coming next", "Switching providers and saving keys here.", "Editing the sender name and address here.",
      "The records your domain needs, with a live check.", "Send a test message and see the provider's answer.",
      "Whether sign-in links, confirmations and form notifications can send.",
      "HTML email templates you or the assistant edit like Pages, with a live preview.",
      "Recent sends, failures, bounces and blocked addresses.", "Some mail cannot be sent. See Provider and Sender below.",
      "Installed providers", "No sender warnings reported.",
    ];
    for (const locale of locales) {
      for (const key of obsolete) expect(EMAIL_DICT[locale]?.[key], `${locale}: ${key}`).toBeUndefined();
    }
  });
});
