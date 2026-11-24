import { describe, expect, it } from "vitest";
import { createMenusDictionary } from "../create-menus-dictionary.js";

// Hard-coded from the host's single-file `menus-i18n.ts` as it was BEFORE it was split (evaluated, with every
// overlay merged in): the split must not drop or add a key in any locale. Mutation: drop one slice from the
// factory's `overlays` (or its `base`) and both the per-locale counts and that slice's sentinel go red.
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 62,
  id: 57,
  de: 57,
  "zh-CN": 57,
  "zh-TW": 57,
  "pt-BR": 57,
  ru: 57,
  fa: 57,
  ar: 57,
  ja: 57,
  ko: 57,
  pl: 57,
  hu: 57,
  fr: 57,
  uk: 57,
  tr: 57,
  th: 57,
  it: 57,
  hi: 62,
  ur: 62,
  bn: 62,
};

// One `es` entry per slice, so a slice that goes missing is named by the failing row.
const SENTINELS: ReadonlyArray<readonly [slice: string, key: string, es: string]> = [
    ["menus-list", "Content", "Contenido"],
    ["menus-editor", "New menu", "Nuevo menú"],
    ["menus-item-fields", "Route name", "Nombre de la ruta"],
    ["menus-item-advanced", "Advanced", "Avanzado"],
    ["menus-page-link", "Page", "Página"],
];

describe("createMenusDictionary", () => {
  const commonDictionary = { es: { "Zzz shared word": "Palabra compartida" } };
  const keysPerLocale = (dictionary: Record<string, Record<string, string>>) =>
    Object.fromEntries(Object.entries(dictionary).map(([locale, entries]) => [locale, Object.keys(entries).length]));

  it("composes every slice: same key count per locale as the single-file dictionary", () => {
    expect(keysPerLocale(createMenusDictionary({ commonDictionary }).dictionary)).toEqual(EXPECTED_KEYS_PER_LOCALE);
  });

  it.each(SENTINELS)("carries the %s slice (es: %s)", (_slice, key, es) => {
    expect(createMenusDictionary({ commonDictionary }).dictionary.es?.[key]).toBe(es);
  });

  it("translates a feature key, falls back to the common dictionary, then to the key itself", () => {
    const { t } = createMenusDictionary({ commonDictionary });
    expect(t({ locale: "es", key: "Content" })).toBe("Contenido");
    expect(t({ locale: "es", key: "Zzz shared word" })).toBe("Palabra compartida");
    expect(t({ locale: "es", key: "Zzz unknown" })).toBe("Zzz unknown");
  });

  it("composes the host's product entries last, so they win and extend", () => {
    const { dictionary } = createMenusDictionary({
      commonDictionary,
      productEntries: { es: { "Content": "Texto del producto", "Zzz product": "Producto" } },
    });
    expect(dictionary.es?.["Content"]).toBe("Texto del producto");
    expect(dictionary.es?.["Zzz product"]).toBe("Producto");
    expect(Object.keys(dictionary.es ?? {})).toHaveLength(62 + 1);
  });
});
