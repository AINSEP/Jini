import { describe, expect, it } from "vitest";
import { createFormsDictionary } from "../create-forms-dictionary.js";

// Hard-coded from the host's single-file `forms-i18n.ts` as it was BEFORE it was split (evaluated, with
// every overlay merged in): the split must not drop or add a key in any locale.
// +3 per locale: the form editor reload notice, its button and its confirmation (version-aware refresh).
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 155,
  id: 146,
  de: 146,
  "zh-CN": 146,
  "zh-TW": 146,
  "pt-BR": 146,
  ru: 146,
  fa: 146,
  ar: 146,
  ja: 146,
  ko: 146,
  pl: 146,
  hu: 146,
  fr: 146,
  uk: 146,
  tr: 146,
  th: 146,
  it: 146,
  hi: 155,
  ur: 155,
  bn: 155,
};

describe("createFormsDictionary", () => {
  const commonDictionary = { es: { "Zzz shared word": "Palabra compartida" } };
  const keysPerLocale = (dictionary: Record<string, Record<string, string>>) =>
    Object.fromEntries(Object.entries(dictionary).map(([locale, entries]) => [locale, Object.keys(entries).length]));

  it("composes every slice: same key count per locale as the single-file dictionary", () => {
    expect(keysPerLocale(createFormsDictionary({ commonDictionary }).dictionary)).toEqual(EXPECTED_KEYS_PER_LOCALE);
  });

  it("translates a feature key, falls back to the common dictionary, then to the key itself", () => {
    const { t } = createFormsDictionary({ commonDictionary });
    expect(t({ locale: "es", key: "Unknown field" })).toBe("Campo desconocido");
    expect(t({ locale: "es", key: "Zzz shared word" })).toBe("Palabra compartida");
    expect(t({ locale: "es", key: "Zzz unknown" })).toBe("Zzz unknown");
  });

  it("composes the host's product entries last, so they win and extend", () => {
    const { dictionary } = createFormsDictionary({
      commonDictionary,
      productEntries: { es: { "Unknown field": "Texto del producto", "Zzz product": "Producto" } },
    });
    expect(dictionary.es?.["Unknown field"]).toBe("Texto del producto");
    expect(dictionary.es?.["Zzz product"]).toBe("Producto");
    expect(Object.keys(dictionary.es ?? {})).toHaveLength(155 + 1);
  });
});
