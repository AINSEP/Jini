import { describe, expect, it } from "vitest";
import { createWidgetsDictionary } from "../create-widgets-dictionary.js";

// Hard-coded from the host's single-file `widgets-i18n.ts` as it was BEFORE it was split (evaluated, with
// every overlay merged in): the split must not drop or add a key in any locale.
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 74,
  id: 69,
  de: 69,
  "zh-CN": 69,
  "zh-TW": 69,
  "pt-BR": 69,
  ru: 69,
  fa: 69,
  ar: 69,
  ja: 69,
  ko: 69,
  pl: 69,
  hu: 69,
  fr: 69,
  uk: 69,
  tr: 69,
  th: 69,
  it: 69,
  hi: 69,
  ur: 69,
  bn: 69,
};

describe("createWidgetsDictionary", () => {
  const commonDictionary = { es: { "Zzz shared word": "Palabra compartida" } };
  const keysPerLocale = (dictionary: Record<string, Record<string, string>>) =>
    Object.fromEntries(Object.entries(dictionary).map(([locale, entries]) => [locale, Object.keys(entries).length]));

  it("composes every slice: same key count per locale as the single-file dictionary", () => {
    expect(keysPerLocale(createWidgetsDictionary({ commonDictionary }).dictionary)).toEqual(EXPECTED_KEYS_PER_LOCALE);
  });

  it("translates a feature key, falls back to the common dictionary, then to the key itself", () => {
    const { t } = createWidgetsDictionary({ commonDictionary });
    expect(t({ locale: "es", key: "Back" })).toBe("Atrás");
    expect(t({ locale: "es", key: "Zzz shared word" })).toBe("Palabra compartida");
    expect(t({ locale: "es", key: "Zzz unknown" })).toBe("Zzz unknown");
  });

  it("composes the host's product entries last, so they win and extend", () => {
    const { dictionary } = createWidgetsDictionary({
      commonDictionary,
      productEntries: { es: { "Back": "Texto del producto", "Zzz product": "Producto" } },
    });
    expect(dictionary.es?.["Back"]).toBe("Texto del producto");
    expect(dictionary.es?.["Zzz product"]).toBe("Producto");
    expect(Object.keys(dictionary.es ?? {})).toHaveLength(74 + 1);
  });
});
