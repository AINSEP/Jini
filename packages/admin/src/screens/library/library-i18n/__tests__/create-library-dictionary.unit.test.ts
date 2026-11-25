import { describe, expect, it } from "vitest";
import { createLibraryDictionary } from "../create-library-dictionary.js";

// Hard-coded from the host's single-file `library-i18n.ts` as it was BEFORE the data moved here: every locale
// carries the same 46 keys, in the host-visible locale order. Mutation: drop a locale or a key from the data
// and the count / order assertions go red.
const LOCALES = ["es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko", "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn"];

describe("createLibraryDictionary", () => {
  const common = { es: { Cancel: "Cancelar", Save: "Guardar" } };

  it("keeps the locale order and 46 keys in every locale", () => {
    const { dictionary } = createLibraryDictionary({ commonDictionary: common });
    expect(Object.keys(dictionary)).toEqual(LOCALES);
    for (const locale of LOCALES) expect(Object.keys(dictionary[locale] ?? {})).toHaveLength(46);
  });

  it("translates its own key first, then the shared words, then the raw English key", () => {
    const { t } = createLibraryDictionary({ commonDictionary: common });
    expect(t({ locale: "es", key: "Library" })).toBe("Biblioteca");
    expect(t({ locale: "es", key: "Cancel" })).toBe("Cancelar");
    expect(t({ locale: "es", key: "Not a key" })).toBe("Not a key");
  });

  it("lets a host product entry win a key collision", () => {
    const { t } = createLibraryDictionary({ commonDictionary: common, productEntries: { es: { Library: "Mi biblioteca" } } });
    expect(t({ locale: "es", key: "Library" })).toBe("Mi biblioteca");
  });
});
