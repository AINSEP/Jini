import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_ANALYSIS_DICT, CONTENT_ANALYSIS_KEYS, CONTENT_ANALYSIS_ROWS, t } from "../content-analysis-i18n.js";
import { CARD_COPY, contentAnalysisCopyKeys } from "../rules.js";

/**
 * @file `CONTENT_ANALYSIS_DICT` — every key the Content analysis card can look up, translated in every
 * locale the admin ships (same 21-locale list `posts-i18n.unit.test.ts` pins), with each template's
 * `{placeholders}` intact so `interpolate` fills them in every language.
 */

const EXPECTED_LOCALES = [
  "ar", "bn", "de", "es", "fa", "fr", "hi", "hu", "id", "it",
  "ja", "ko", "pl", "pt-BR", "ru", "th", "tr", "uk", "ur", "zh-CN", "zh-TW",
];

/** Values that are legitimately the English key in some locale: an abbreviation or a loanword. */
const SAME_AS_ENGLISH_OK = new Set(["{minutes} min", "Standard", "Single H1"]);

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe("CONTENT_ANALYSIS_DICT", () => {
  const keys = contentAnalysisCopyKeys();

  it("covers exactly the admin's 21 locales", () => {
    expect(Object.keys(CONTENT_ANALYSIS_DICT).sort()).toEqual(EXPECTED_LOCALES.slice().sort());
  });

  it("the key list is exactly the copy rules.ts can ask for", () => {
    expect([...CONTENT_ANALYSIS_KEYS].sort()).toEqual(keys.slice().sort());
  });

  it.each(EXPECTED_LOCALES)("%s's row has exactly one translation per key", (locale) => {
    expect(CONTENT_ANALYSIS_ROWS[locale]).toHaveLength(CONTENT_ANALYSIS_KEYS.length);
  });

  it.each(EXPECTED_LOCALES)("%s has every key, and only those keys", (locale) => {
    expect(Object.keys(CONTENT_ANALYSIS_DICT[locale]!).sort()).toEqual(keys.slice().sort());
  });

  it.each(EXPECTED_LOCALES)("%s translates every key (non-empty, not left in English, placeholders intact)", (locale) => {
    for (const key of keys) {
      const value = CONTENT_ANALYSIS_DICT[locale]![key]!;
      expect(value.trim().length, `${locale} ${JSON.stringify(key)}`).toBeGreaterThan(0);
      if (!SAME_AS_ENGLISH_OK.has(key)) expect(value, `${locale} ${JSON.stringify(key)} is untranslated`).not.toBe(key);
      expect(placeholders(value), `${locale} ${JSON.stringify(key)} placeholders`).toEqual(placeholders(key));
    }
  });

  it("every literal the card passes to t() is a dictionary key", () => {
    const source = readFileSync(new URL("../ContentAnalysisCard.tsx", import.meta.url), "utf8");
    const literals = [...source.matchAll(/\bt\("([^"]+)"\)/g)].map((match) => match[1]!);
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) expect(CARD_COPY as readonly string[]).toContain(literal);
  });

  it("t resolves a locale's translation and falls back to the English key", () => {
    expect(t({ locale: "es", key: "Analyze now" })).toBe(CONTENT_ANALYSIS_DICT.es!["Analyze now"]);
    expect(t({ locale: "en", key: "Analyze now" })).toBe("Analyze now");
  });
});
