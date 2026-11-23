import { describe, expect, it } from "vitest";

import { createMembersTranslator, MEMBERS_DICT } from "../members-i18n.js";

/**
 * @file `MEMBERS_DICT` locale coverage and `createMembersTranslator`'s lookup order: the host's own
 * copy (the `description`/`emptyDescription` it passes to `Members`) first, then this package's
 * dictionary, then the host's common dictionary, then the English key itself.
 */
const LOCALES = [
  "ar", "bn", "de", "es", "fa", "fr", "hi", "hu", "id", "it",
  "ja", "ko", "pl", "pt-BR", "ru", "th", "tr", "uk", "ur", "zh-CN", "zh-TW",
];

describe("MEMBERS_DICT", () => {
  it("covers the 21 admin locales", () => {
    expect(Object.keys(MEMBERS_DICT).sort()).toEqual(LOCALES.slice().sort());
  });

  it("carries the same keys, each non-empty, in every locale", () => {
    const keys = Object.keys(MEMBERS_DICT.es ?? {}).sort();
    for (const locale of LOCALES) {
      const entries = MEMBERS_DICT[locale] ?? {};
      expect(Object.keys(entries).sort()).toEqual(keys);
      for (const value of Object.values(entries)) expect(value.length).toBeGreaterThan(0);
    }
  });

  it("carries no host copy (description/empty-state text belongs to the host)", () => {
    expect(MEMBERS_DICT.es?.["Registered site visitors will show up here."]).toBeUndefined();
  });
});

describe("createMembersTranslator", () => {
  const translate = createMembersTranslator(
    { commonDictionary: { es: { Save: "Guardar", Members: "common-should-lose" } } },
    { hostCopy: { es: { "Host description.": "Descripción del host." }, xx: { "Host description.": "xx-host" } } },
  );

  it("resolves the package's own keys", () => {
    expect(translate({ locale: "es", key: "Members" })).toBe("Miembros");
    expect(translate({ locale: "es", key: "You do not have permission to do that." })).toBe("No tienes permiso para hacer eso.");
  });

  it("resolves the host's copy, including a locale the package does not ship", () => {
    expect(translate({ locale: "es", key: "Host description." })).toBe("Descripción del host.");
    expect(translate({ locale: "xx", key: "Host description." })).toBe("xx-host");
    expect(translate({ locale: "es", key: "Members" })).toBe("Miembros");
  });

  it("falls back to the common dictionary, then to the English key", () => {
    expect(translate({ locale: "es", key: "Save" })).toBe("Guardar");
    expect(translate({ locale: "fr", key: "Nothing here" })).toBe("Nothing here");
  });

  it("works without host copy", () => {
    const plain = createMembersTranslator({ commonDictionary: {} });
    expect(plain({ locale: "de", key: "Host description." })).toBe("Host description.");
    expect(plain({ locale: "de", key: "Members" })).toBe(MEMBERS_DICT.de?.Members);
  });
});
