import { describe, expect, it } from "vitest";
import type { AdminNavGroup } from "../../../core/index.js";
import { translateAdminNavGroups, translateAdminNavLabel } from "../admin-nav-i18n.js";

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
    const translated = translateAdminNavGroups({ locale: "de", groups });
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
    const translated = translateAdminNavGroups({ locale: "xx", groups: input });
    expect(translated).toEqual([{ label: "Content", items: [{ id: "pages", label: "Pages", href: "/pages" }] }]);
    input[0]!.label = "Renamed group";
    input[0]!.items[0]!.label = "Renamed page";
    expect(translated).toEqual([{ label: "Content", items: [{ id: "pages", label: "Pages", href: "/pages" }] }]);
    expect(translateAdminNavGroups({ locale: "de", groups: [] })).toEqual([]);
    expect(translateAdminNavLabel({ locale: "de", key: "Settings" })).toBe("Einstellungen");
    expect(translateAdminNavLabel({ locale: "xx", key: "Settings" })).toBe("Settings");
    expect(translateAdminNavLabel({ locale: "de", key: "Atlas extension" })).toBe("Atlas extension");
  });
});
