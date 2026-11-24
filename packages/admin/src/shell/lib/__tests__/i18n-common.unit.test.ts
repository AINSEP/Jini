import { expect, test } from "vitest";

import { createCommonDictionary } from "../i18n-common.js";

const baseDictionary = { en: { Save: "Save", Cancel: "Cancel" }, es: { Save: "Guardar", Cancel: "Cancelar" }, de: { Save: "Speichern", Cancel: "Abbrechen" } };

test("host entries are merged over the base per locale", () => {
  const merged = createCommonDictionary({ baseDictionary, hostEntries: { es: { Hello: "Hola" }, de: { Hello: "Hallo" } } });
  expect(merged.es).toEqual({ Save: "Guardar", Cancel: "Cancelar", Hello: "Hola" });
  expect(merged.de).toEqual({ Save: "Speichern", Cancel: "Abbrechen", Hello: "Hallo" });
});

test("a host entry wins a key collision with the base", () => {
  const merged = createCommonDictionary({ baseDictionary, hostEntries: { es: { Save: "Salvar" } } });
  expect(merged.es?.Save).toBe("Salvar");
  expect(merged.es?.Cancel).toBe("Cancelar");
});

test("the host's locale rows decide which locales exist and in what order", () => {
  const merged = createCommonDictionary({ baseDictionary, hostEntries: { de: {}, es: {} } });
  expect(Object.keys(merged)).toEqual(["de", "es"]);
});

test("a host locale missing from the base throws instead of silently showing the fallback", () => {
  expect(() => createCommonDictionary({ baseDictionary, hostEntries: { fr: { Hello: "Bonjour" } } })).toThrow("fr");
});

test("the base dictionary is not mutated", () => {
  createCommonDictionary({ baseDictionary, hostEntries: { es: { Hello: "Hola" } } });
  expect(baseDictionary.es).toEqual({ Save: "Guardar", Cancel: "Cancelar" });
});
