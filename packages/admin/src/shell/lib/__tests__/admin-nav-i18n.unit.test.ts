import { describe, expect, it } from "vitest";
import type { AdminNavGroup } from "../../../core/index.js";
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";
import { ADMIN_NAV_DICT, translateAdminNavGroups } from "../admin-nav-i18n.js";

/** The host binding, built the way a host composes it (dictionary translator + common fallback). */
const translateAdminNavLabel = createDictionaryTranslator({ featureDictionary: ADMIN_NAV_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

// Author Checklist / F4.1/F4.3: exact translations from external language fixtures,
// frozen non-default input, stable IDs/links retained, no subject mocks.
describe("admin navigation translation", () => {
  it("translates a non-Spanish group and its items without mutating or discarding navigation metadata", () => {
    // Mutation: early-return for locale !== 'es', or omit ...item.
    const items = Object.freeze([
      Object.freeze({ id: "pages", label: "Pages", href: "/pages", soon: false }),
      Object.freeze({ id: "extension", label: "Atlas extension", href: "/atlas", soon: true, soonPreviewable: true, icon: '<path d="M2 2h8v8H2z" />' }),
    ]);
    const content = Object.freeze({ label: "Content", items });
    const groups = Object.freeze([
      content,
      Object.freeze({ items: Object.freeze([]) }),
      Object.freeze({ label: "", items: Object.freeze([]) }),
    ]) satisfies readonly AdminNavGroup[];
    const translated = translateAdminNavGroups({ locale: "de", groups, translate: translateAdminNavLabel });
    expect(translated).toEqual([
      { label: "Inhalt", items: [
        { id: "pages", label: "Seiten", href: "/pages", soon: false },
        { id: "extension", label: "Atlas extension", href: "/atlas", soon: true, soonPreviewable: true, icon: '<path d="M2 2h8v8H2z" />' },
      ] },
      { label: undefined, items: [] },
      { label: "", items: [] },
    ]);
    expect(content.label).toBe("Content");
    expect(items.find((item) => item.id === "pages")?.label).toBe("Pages");
  });

  it("returns independent English navigation for unknown locales and preserves an empty navigation", () => {
    // F4.5/F6.5: returning [] hides navigation; returning groups aliases the
    // caller's cached input. Verify independence through a later input edit.
    const input = [{ label: "Content", items: [{ id: "pages", label: "Pages", href: "/pages" }] }];
    const translated = translateAdminNavGroups({ locale: "xx", groups: input, translate: translateAdminNavLabel });
    expect(translated).toEqual([{ label: "Content", items: [{ id: "pages", label: "Pages", href: "/pages" }] }]);
    input[0]!.label = "Renamed group";
    input[0]!.items[0]!.label = "Renamed page";
    expect(translated).toEqual([{ label: "Content", items: [{ id: "pages", label: "Pages", href: "/pages" }] }]);
    expect(translateAdminNavGroups({ locale: "de", groups: [], translate: translateAdminNavLabel })).toEqual([]);
    expect(translateAdminNavLabel({ locale: "de", key: "Settings" })).toBe("Einstellungen");
    expect(translateAdminNavLabel({ locale: "xx", key: "Settings" })).toBe("Settings");
    expect(translateAdminNavLabel({ locale: "de", key: "Atlas extension" })).toBe("Atlas extension");
  });
});

it("keeps all 21 locales in their original order after the split", () => {
  expect(Object.keys(ADMIN_NAV_DICT)).toEqual([
    "es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko",
    "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn",
  ]);
});

// Why: the Routines panel's nav label is keyed by its English text, so a locale missing the key
// would silently show English in a translated sidebar. Every locale must carry its own wording.
it("translates the Routines nav label in every locale, never falling back to the English key", () => {
  const untranslated = Object.keys(ADMIN_NAV_DICT).filter((locale) => {
    const label = translateAdminNavLabel({ locale, key: "Routines" });
    return label === "Routines" || label.trim() === "";
  });
  expect(untranslated).toEqual([]);
  expect(translateAdminNavLabel({ locale: "de", key: "Routines" })).toBe("Routinen");
  expect(translateAdminNavLabel({ locale: "xx", key: "Routines" })).toBe("Routines");
});
