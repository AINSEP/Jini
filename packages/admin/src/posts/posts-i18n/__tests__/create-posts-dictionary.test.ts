import { describe, expect, it } from "vitest";
import { createPostsDictionary } from "../create-posts-dictionary.js";

// Hard-coded from the host's single-file `posts-i18n.ts` as it was BEFORE it was split (evaluated: the main
// table, every later overlay and `EDITOR_FAILURE_DICT` merged in): the split must not drop or add a key in any
// locale. Mutation: drop one slice from the factory's `overlays` (or its `base`) and both the per-locale counts
// and that slice's sentinel go red.
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 156,
  id: 156,
  de: 156,
  "zh-CN": 156,
  "zh-TW": 156,
  "pt-BR": 156,
  ru: 156,
  fa: 156,
  ar: 156,
  ja: 156,
  ko: 156,
  pl: 156,
  hu: 156,
  fr: 156,
  uk: 156,
  tr: 156,
  th: 156,
  it: 156,
  hi: 156,
  ur: 156,
  bn: 156,
};

// One `es` entry per slice (the last is the shared `EDITOR_FAILURE_DICT`), so a slice that goes missing is
// named by the failing row.
const SENTINELS: ReadonlyArray<readonly [slice: string, key: string, es: string]> = [
  ["posts-list", "Content", "Contenido"],
  ["posts-list-sort", "Not sorted by updated date. Activate to sort newest first.", "No ordenado por fecha de actualización. Actívalo para ordenar de más reciente a más antiguo."],
  ["posts-trash-dialog", "Move to trash?", "¿Mover a la papelera?"],
  ["posts-editor-header", "Back", "Atrás"],
  ["posts-save-feedback", "Saved · version {version}", "Guardado · versión {version}"],
  ["posts-errors", "failed to load post", "No se pudo cargar la entrada"],
  ["posts-settings-dialog", "Post settings", "Ajustes de la entrada"],
  ["posts-toolbar-marks", "Bold", "Negrita"],
  ["posts-toolbar-blocks", "Heading 1", "Encabezado 1"],
  ["posts-toolbar-style", "Text color", "Color del texto"],
  ["posts-url-dialog", "Insert image by URL", "Insertar imagen mediante URL"],
  ["posts-slug-collision", "Which page wins at this URL", "Qué página prevalece en esta URL"],
  ["posts-template-preview", "Template", "Plantilla"],
  ["editor-failure-i18n", "Could not add {name}. Nothing was inserted. Cause: {cause}", "No se pudo añadir {name}. No se insertó nada. Causa: {cause}"],
];

describe("createPostsDictionary", () => {
  const commonDictionary = { es: { "Zzz shared word": "Palabra compartida" } };
  const keysPerLocale = (dictionary: Record<string, Record<string, string>>) =>
    Object.fromEntries(Object.entries(dictionary).map(([locale, entries]) => [locale, Object.keys(entries).length]));

  it("composes every slice: same key count per locale as the single-file dictionary", () => {
    expect(keysPerLocale(createPostsDictionary({ commonDictionary }).dictionary)).toEqual(EXPECTED_KEYS_PER_LOCALE);
  });

  it.each(SENTINELS)("carries the %s slice (es: %s)", (_slice, key, es) => {
    expect(createPostsDictionary({ commonDictionary }).dictionary.es?.[key]).toBe(es);
  });

  it("translates a feature key, falls back to the common dictionary, then to the key itself", () => {
    const { t } = createPostsDictionary({ commonDictionary });
    expect(t({ locale: "es", key: "Content" })).toBe("Contenido");
    expect(t({ locale: "es", key: "Zzz shared word" })).toBe("Palabra compartida");
    expect(t({ locale: "es", key: "Zzz unknown" })).toBe("Zzz unknown");
  });

  it("composes the host's product entries last, so they win and extend", () => {
    const { dictionary } = createPostsDictionary({
      commonDictionary,
      productEntries: { es: { "Content": "Texto del producto", "Zzz product": "Producto" } },
    });
    expect(dictionary.es?.["Content"]).toBe("Texto del producto");
    expect(dictionary.es?.["Zzz product"]).toBe("Producto");
    expect(Object.keys(dictionary.es ?? {})).toHaveLength(156 + 1);
  });
});
