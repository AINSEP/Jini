import { describe, expect, it } from "vitest";
import { createTrashDictionary } from "../create-trash-dictionary.js";

// Hard-coded from the host's single-file dictionary as it was BEFORE it was split (neutral rows only; the one
// row that names the product is composed back in through `productEntries`): the split must not drop or add a
// key in any locale, and the slices must keep the host-visible locale order. Mutation: drop one slice from the
// factory's `base` and the missing locales (and their counts) go red.
const ORIGINAL_NEUTRAL_KEYS = 51;
// Keys added after the split, on purpose (bug d2: the header states the retention window). Each is
// asserted present in every locale below, so the count can only grow by a key that actually landed.
const ADDED_SINCE_SPLIT = ["Items moved to Trash now are permanently deleted after {days} days. Items trashed earlier keep the date shown on their row."];
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = Object.fromEntries(
  ["es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko", "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn"].map((locale) => [locale, ORIGINAL_NEUTRAL_KEYS + ADDED_SINCE_SPLIT.length])
);

describe("createTrashDictionary", () => {
  const common = { es: { Cancel: "Cancelar" } };

  it("carries every locale in the original order, with the original neutral key count", () => {
    const { dictionary } = createTrashDictionary({ commonDictionary: common });
    expect(Object.keys(dictionary)).toEqual(Object.keys(EXPECTED_KEYS_PER_LOCALE));
    for (const [locale, count] of Object.entries(EXPECTED_KEYS_PER_LOCALE)) {
      expect(Object.keys(dictionary[locale] ?? {}).length, locale).toBe(count);
      for (const key of ADDED_SINCE_SPLIT) expect(dictionary[locale]?.[key], `${locale}: ${key}`).toMatch(/\{days\}/);
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
