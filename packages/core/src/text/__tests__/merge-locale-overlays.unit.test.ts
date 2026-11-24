import { describe, expect, it } from "vitest";
import { mergeLocaleOverlays } from "../merge-locale-overlays.js";

describe("mergeLocaleOverlays", () => {
  it("folds each overlay's entries into the matching base locale, later overlays winning a collision", () => {
    const merged = mergeLocaleOverlays(
      { base: { es: { Save: "Guardar", Owner: "base" } } },
      { overlays: [
        { es: { Owner: "Propietario" } },
        { es: { Delete: "Eliminar", Owner: "Dueño" } },
      ] },
    );
    expect(merged).toEqual({ es: { Save: "Guardar", Owner: "Dueño", Delete: "Eliminar" } });
  });

  it("keeps a base locale an overlay does not cover, with only its own entries", () => {
    const merged = mergeLocaleOverlays({ base: { es: { Save: "Guardar" }, fr: { Save: "Enregistrer" } } }, { overlays: [{ es: { Add: "Agregar" } }] });
    expect(merged.fr).toEqual({ Save: "Enregistrer" });
    expect(merged.es).toEqual({ Save: "Guardar", Add: "Agregar" });
  });

  it("ignores overlay-only locales and never mutates its inputs", () => {
    const base = { es: { Save: "Guardar" } };
    const overlay = { es: { Add: "Agregar" }, de: { Add: "Hinzufügen" } };
    const merged = mergeLocaleOverlays({ base }, { overlays: [overlay] });
    expect(Object.keys(merged)).toEqual(["es"]);
    expect(base).toEqual({ es: { Save: "Guardar" } });
    expect(overlay.es).toEqual({ Add: "Agregar" });
    expect(merged.es).not.toBe(base.es);
  });

  it("returns a copy of the base when no overlays are given", () => {
    const base = { es: { Save: "Guardar" } };
    expect(mergeLocaleOverlays({ base })).toEqual(base);
  });
});
