import { describe, expect, it } from "vitest";
import { createFormsDictionary } from "../create-forms-dictionary.js";

// Hard-coded from the host's single-file `forms-i18n.ts` as it was BEFORE it was split (evaluated, with
// every overlay merged in): the split must not drop or add a key in any locale.
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 152,
  id: 143,
  de: 143,
  "zh-CN": 143,
  "zh-TW": 143,
  "pt-BR": 143,
  ru: 143,
  fa: 143,
  ar: 143,
  ja: 143,
  ko: 143,
  pl: 143,
  hu: 143,
  fr: 143,
  uk: 143,
  tr: 143,
  th: 143,
  it: 143,
  hi: 152,
  ur: 152,
  bn: 152,
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
    expect(Object.keys(dictionary.es ?? {})).toHaveLength(152 + 1);
  });
});
