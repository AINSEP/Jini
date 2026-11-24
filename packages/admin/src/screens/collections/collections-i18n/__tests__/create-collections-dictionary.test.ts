import { describe, expect, it } from "vitest";
import { createCollectionsDictionary } from "../create-collections-dictionary.js";

// Hard-coded from the host's single-file `collections-i18n.ts` as it was BEFORE it was split (evaluated, with every
// overlay merged in): the split must not drop or add a key in any locale. Mutation: drop one slice from the
// factory's `overlays` (or its `base`) and both the per-locale counts and that slice's sentinel go red.
const EXPECTED_KEYS_PER_LOCALE: Record<string, number> = {
  es: 70,
  id: 60,
  de: 60,
  "zh-CN": 60,
  "zh-TW": 60,
  "pt-BR": 60,
  ru: 60,
  fa: 60,
  ar: 60,
  ja: 60,
  ko: 60,
  pl: 60,
  hu: 60,
  fr: 60,
  uk: 60,
  tr: 60,
  th: 60,
  it: 60,
  hi: 70,
  ur: 70,
  bn: 70,
};

// One `es` entry per slice, so a slice that goes missing is named by the failing row.
const SENTINELS: ReadonlyArray<readonly [slice: string, key: string, es: string]> = [
    ["collections-list", "Collections", "Colecciones"],
    ["collections-dialogs", "Field", "Campo"],
    ["collections-entries", "All \"{label}\" entries in this collection.", "Todas las entradas de \"{label}\" en esta colección."],
    ["collections-hooks", "failed to load entries", "no se pudieron cargar las entradas"],
    ["collections-audit-embed", "Loading entries…", "Cargando entradas…"],
];

describe("createCollectionsDictionary", () => {
  const commonDictionary = { es: { "Zzz shared word": "Palabra compartida" } };
  const keysPerLocale = (dictionary: Record<string, Record<string, string>>) =>
    Object.fromEntries(Object.entries(dictionary).map(([locale, entries]) => [locale, Object.keys(entries).length]));

  it("composes every slice: same key count per locale as the single-file dictionary", () => {
    expect(keysPerLocale(createCollectionsDictionary({ commonDictionary }).dictionary)).toEqual(EXPECTED_KEYS_PER_LOCALE);
  });

  it.each(SENTINELS)("carries the %s slice (es: %s)", (_slice, key, es) => {
    expect(createCollectionsDictionary({ commonDictionary }).dictionary.es?.[key]).toBe(es);
  });

  it("translates a feature key, falls back to the common dictionary, then to the key itself", () => {
    const { t } = createCollectionsDictionary({ commonDictionary });
    expect(t({ locale: "es", key: "Collections" })).toBe("Colecciones");
    expect(t({ locale: "es", key: "Zzz shared word" })).toBe("Palabra compartida");
    expect(t({ locale: "es", key: "Zzz unknown" })).toBe("Zzz unknown");
  });

  it("returns the lifecycle failure messages next to the dictionary, per locale", () => {
    const { lifecycleFailureMessage, entryLifecycleFailureMessage } = createCollectionsDictionary({ commonDictionary });
    expect(lifecycleFailureMessage({ locale: "es", op: "deprecate", label: "Recetas" })).toBe('No se pudo marcar como obsoleto "Recetas"');
    expect(lifecycleFailureMessage({ locale: "fr", op: "tombstone", label: "Recettes" })).toBe('Impossible de supprimer définitivement « Recettes »');
    expect(entryLifecycleFailureMessage({ locale: "es", op: "publish" })).toBe("No se pudo publicar la entrada");
    expect(entryLifecycleFailureMessage({ locale: "fr", op: "unpublish" })).toBe("Échec de la dépublication de l'entrée");
  });

  it("composes the host's product entries last, so they win and extend", () => {
    const { dictionary } = createCollectionsDictionary({
      commonDictionary,
      productEntries: { es: { "Collections": "Texto del producto", "Zzz product": "Producto" } },
    });
    expect(dictionary.es?.["Collections"]).toBe("Texto del producto");
    expect(dictionary.es?.["Zzz product"]).toBe("Producto");
    expect(Object.keys(dictionary.es ?? {})).toHaveLength(70 + 1);
  });
});
