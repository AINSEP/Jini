import { seoMessagesEn } from "../../../seo/index.js";
import { describe, expect, it } from "vitest";
import { t } from "../seo-i18n.js";

/**
 * @file Every Jini SEO screen string has a real translation in each of this admin's locales.
 *
 * The X/Twitter rename (2026-10-15) landed only in Jini's `messages.en`, so every other locale
 * fell back to English while the host's dictionary still held the old "Twitter title…" keys (owner,
 * 2026-10-16). A miss silently returns the English source, so this checks the dictionary itself.
 */
const LOCALES = ["es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko", "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn"];

describe("SEO dictionary parity with Jini's messages", () => {
  it.each(LOCALES)("%s translates every Jini SEO key", (locale) => {
    const untranslated = Object.keys(seoMessagesEn).filter((key) => !(key in (t.dictionary[locale] ?? {})));
    expect(untranslated).toEqual([]);
  });
});
