import { describe, expect, it } from "vitest";
import { createMediaDictionary } from "../create-media-dictionary.js";

// Hard-coded from the host's single-file `media-i18n.ts` as it was BEFORE it was split (evaluated, with every
// overlay merged in): the split must not drop or add a key in any locale. Mutation: drop one slice from the
// factory's `overlays` (or its `base`) and both the per-locale counts and that slice's sentinel go red.
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 100,
  id: 100,
  de: 100,
  "zh-CN": 100,
  "zh-TW": 100,
  "pt-BR": 100,
  ru: 100,
  fa: 100,
  ar: 100,
  ja: 100,
  ko: 100,
  pl: 100,
  hu: 100,
  fr: 100,
  uk: 100,
  tr: 100,
  th: 100,
  it: 100,
  hi: 100,
  ur: 100,
  bn: 100,
};

// One `es` entry per slice, so a slice that goes missing is named by the failing row.
const SENTINELS: ReadonlyArray<readonly [slice: string, key: string, es: string]> = [
    ["media-library", "Media", "Medios"],
    ["media-toolbar", "Edit \"{title}\"", "Editar \"{title}\""],
    ["media-edit-panel", "Title", "Título"],
    ["media-html-attributes", "HTML attributes (optional)", "Atributos HTML (opcional)"],
    ["media-dialogs", "Delete permanently?", "¿Eliminar permanentemente?"],
    ["media-hooks", "failed to load media", "no se pudo cargar el contenido multimedia"],
    ["media-addons", "Close", "Cerrar"],
];

describe("createMediaDictionary", () => {
  const commonDictionary = { es: { "Zzz shared word": "Palabra compartida" } };
  const keysPerLocale = (dictionary: Record<string, Record<string, string>>) =>
    Object.fromEntries(Object.entries(dictionary).map(([locale, entries]) => [locale, Object.keys(entries).length]));

  it("composes every slice: same key count per locale as the single-file dictionary", () => {
    expect(keysPerLocale(createMediaDictionary({ commonDictionary }).dictionary)).toEqual(EXPECTED_KEYS_PER_LOCALE);
  });

  it.each(SENTINELS)("carries the %s slice (es: %s)", (_slice, key, es) => {
    expect(createMediaDictionary({ commonDictionary }).dictionary.es?.[key]).toBe(es);
  });

  it("translates a feature key, falls back to the common dictionary, then to the key itself", () => {
    const { t } = createMediaDictionary({ commonDictionary });
    expect(t({ locale: "es", key: "Media" })).toBe("Medios");
    expect(t({ locale: "es", key: "Zzz shared word" })).toBe("Palabra compartida");
    expect(t({ locale: "es", key: "Zzz unknown" })).toBe("Zzz unknown");
  });

  it("composes the host's product entries last, so they win and extend", () => {
    const { dictionary } = createMediaDictionary({
      commonDictionary,
      productEntries: { es: { "Media": "Texto del producto", "Zzz product": "Producto" } },
    });
    expect(dictionary.es?.["Media"]).toBe("Texto del producto");
    expect(dictionary.es?.["Zzz product"]).toBe("Producto");
    expect(Object.keys(dictionary.es ?? {})).toHaveLength(100 + 1);
  });
});
