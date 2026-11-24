import { describe, expect, it } from "vitest";
import { createCommentsDictionary } from "../create-comments-dictionary.js";

// Hard-coded from the host's single-file `comments-i18n.ts` as it was BEFORE it was split (evaluated, with
// every overlay merged in): the split must not drop or add a key in any locale.
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 35,
  id: 35,
  de: 35,
  "zh-CN": 35,
  "zh-TW": 35,
  "pt-BR": 35,
  ru: 35,
  fa: 35,
  ar: 35,
  ja: 35,
  ko: 35,
  pl: 35,
  hu: 35,
  fr: 35,
  uk: 35,
  tr: 35,
  th: 35,
  it: 35,
  hi: 35,
  ur: 35,
  bn: 35,
};

describe("createCommentsDictionary", () => {
  const commonDictionary = { es: { "Zzz shared word": "Palabra compartida" } };
  const keysPerLocale = (dictionary: Record<string, Record<string, string>>) =>
    Object.fromEntries(Object.entries(dictionary).map(([locale, entries]) => [locale, Object.keys(entries).length]));

  it("composes every slice: same key count per locale as the single-file dictionary", () => {
    expect(keysPerLocale(createCommentsDictionary({ commonDictionary }).dictionary)).toEqual(EXPECTED_KEYS_PER_LOCALE);
  });

  it("translates a feature key, falls back to the common dictionary, then to the key itself", () => {
    const { t } = createCommentsDictionary({ commonDictionary });
    expect(t({ locale: "es", key: "Approve" })).toBe("Aprobar");
    expect(t({ locale: "es", key: "Zzz shared word" })).toBe("Palabra compartida");
    expect(t({ locale: "es", key: "Zzz unknown" })).toBe("Zzz unknown");
  });

  it("composes the host's product entries last, so they win and extend", () => {
    const { dictionary } = createCommentsDictionary({
      commonDictionary,
      productEntries: { es: { "Approve": "Texto del producto", "Zzz product": "Producto" } },
    });
    expect(dictionary.es?.["Approve"]).toBe("Texto del producto");
    expect(dictionary.es?.["Zzz product"]).toBe("Producto");
    expect(Object.keys(dictionary.es ?? {})).toHaveLength(35 + 1);
  });
});
