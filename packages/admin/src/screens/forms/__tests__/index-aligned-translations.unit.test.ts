import { describe, expect, it } from "vitest";

import { indexAlignedTranslations } from "../index-aligned-translations.js";
import { FORMS_LEAVE_GUARD_I18N, FORMS_LEAVE_GUARD_KEYS, FORMS_LEAVE_GUARD_TRANSLATIONS } from "../forms-leave-guard-i18n.js";

/** @file The index-aligned list → `{ locale: { key: translation } }` builder the forms dictionaries share. */
describe("indexAlignedTranslations", () => {
  it("pairs each key with the same-position translation, per locale", () => {
    expect(indexAlignedTranslations({ keys: ["Save", "Cancel"], translations: { es: ["Guardar", "Cancelar"], de: ["Speichern", "Abbrechen"] } })).toEqual({
      es: { Save: "Guardar", Cancel: "Cancelar" },
      de: { Save: "Speichern", Cancel: "Abbrechen" },
    });
  });

  it("falls back to the English key where a locale's list is short", () => {
    expect(indexAlignedTranslations({ keys: ["Save", "Cancel"], translations: { fr: ["Enregistrer"] } })).toEqual({
      fr: { Save: "Enregistrer", Cancel: "Cancel" },
    });
  });

  it("builds the shipped leave-guard table exactly from its lists", () => {
    expect(FORMS_LEAVE_GUARD_I18N.es?.[FORMS_LEAVE_GUARD_KEYS[0]!]).toBe(FORMS_LEAVE_GUARD_TRANSLATIONS.es?.[0]);
    expect(Object.keys(FORMS_LEAVE_GUARD_I18N).sort()).toEqual(Object.keys(FORMS_LEAVE_GUARD_TRANSLATIONS).sort());
  });
});
