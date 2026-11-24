import { describe, expect, it } from "vitest";
import { createTaxonomyDictionary } from "../create-taxonomy-dictionary.js";

// Hard-coded from the host's single-file `taxonomy-i18n.ts` as it was BEFORE it was split (evaluated, with
// every overlay merged in): the split must not drop or add a key in any locale.
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 63,
  id: 59,
  de: 59,
  "zh-CN": 59,
  "zh-TW": 59,
  "pt-BR": 59,
  ru: 59,
  fa: 59,
  ar: 59,
  ja: 59,
  ko: 59,
  pl: 59,
  hu: 59,
  fr: 59,
  uk: 59,
  tr: 59,
  th: 59,
  it: 59,
  hi: 59,
  ur: 59,
  bn: 59,
};

describe("createTaxonomyDictionary", () => {
  const commonDictionary = { es: { "Zzz shared word": "Palabra compartida" } };
  const keysPerLocale = (dictionary: Record<string, Record<string, string>>) =>
    Object.fromEntries(Object.entries(dictionary).map(([locale, entries]) => [locale, Object.keys(entries).length]));

  it("composes every slice: same key count per locale as the single-file dictionary", () => {
    expect(keysPerLocale(createTaxonomyDictionary({ commonDictionary }).dictionary)).toEqual(EXPECTED_KEYS_PER_LOCALE);
  });

  it("translates a feature key, falls back to the common dictionary, then to the key itself", () => {
    const { t } = createTaxonomyDictionary({ commonDictionary });
    expect(t({ locale: "es", key: "No taxonomies yet" })).toBe("Todavía no hay taxonomías");
    expect(t({ locale: "es", key: "Zzz shared word" })).toBe("Palabra compartida");
    expect(t({ locale: "es", key: "Zzz unknown" })).toBe("Zzz unknown");
  });

  it("composes the host's product entries last, so they win and extend", () => {
    const { dictionary } = createTaxonomyDictionary({
      commonDictionary,
      productEntries: { es: { "No taxonomies yet": "Texto del producto", "Zzz product": "Producto" } },
    });
    expect(dictionary.es?.["No taxonomies yet"]).toBe("Texto del producto");
    expect(dictionary.es?.["Zzz product"]).toBe("Producto");
    expect(Object.keys(dictionary.es ?? {})).toHaveLength(63 + 1);
  });
});
