import { describe, expect, it } from "vitest";
import { createTrashDictionary } from "../create-trash-dictionary.js";

// Hard-coded from the host's single-file dictionary as it was BEFORE it was split (neutral rows only; the one
// row that names the product is composed back in through `productEntries`): the split must not drop or add a
// key in any locale, and the slices must keep the host-visible locale order. Mutation: drop one slice from the
// factory's `base` and the missing locales (and their counts) go red.
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 51,
  id: 51,
  de: 51,
  "zh-CN": 51,
  "zh-TW": 51,
  "pt-BR": 51,
  ru: 51,
  fa: 51,
  ar: 51,
  ja: 51,
  ko: 51,
  pl: 51,
  hu: 51,
  fr: 51,
  uk: 51,
  tr: 51,
  th: 51,
  it: 51,
  hi: 51,
  ur: 51,
  bn: 51
};

describe("createTrashDictionary", () => {
  const common = { es: { Cancel: "Cancelar" } };

  it("carries every locale in the original order, with the original neutral key count", () => {
    const { dictionary } = createTrashDictionary({ commonDictionary: common });
    expect(Object.keys(dictionary)).toEqual(Object.keys(EXPECTED_KEYS_PER_LOCALE));
    for (const [locale, count] of Object.entries(EXPECTED_KEYS_PER_LOCALE)) {
      expect(Object.keys(dictionary[locale] ?? {}).length, locale).toBe(count);
    }
  });

  it("translates a feature key, falls back to the common dictionary, then to the English key", () => {
    const { t } = createTrashDictionary({ commonDictionary: common });
    expect(t({ locale: "es", key: "Restore" })).toBe("Restaurar");
    expect(t({ locale: "es", key: "Cancel" })).toBe("Cancelar");
    expect(t({ locale: "es", key: "No such copy" })).toBe("No such copy");
  });

  it("composes the host's product entries last so they win and extend a locale", () => {
    const productEntries = { es: { Restore: "Recuperar", "Host copy": "Copia del anfitrion" } };
    const { dictionary, t } = createTrashDictionary({ commonDictionary: common, productEntries });
    expect(t({ locale: "es", key: "Restore" })).toBe("Recuperar");
    expect(t({ locale: "es", key: "Host copy" })).toBe("Copia del anfitrion");
    expect(Object.keys(dictionary.id ?? {}).length).toBe(EXPECTED_KEYS_PER_LOCALE.id);
  });

  it("ships no product-identity copy", () => {
    const { dictionary } = createTrashDictionary({ commonDictionary: common });
    expect(JSON.stringify(dictionary)).not.toMatch(/tovu/i);
  });
});
