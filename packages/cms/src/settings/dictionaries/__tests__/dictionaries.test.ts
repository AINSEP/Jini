import { describe, expect, it } from "vitest";
import { SETTINGS_DIALOG_DICTIONARIES, translateSettingsDialog } from "../index.js";

/**
 * One parity test regardless of how many locales `SETTINGS_DIALOG_DICTIONARIES` grows to — per-
 * locale test cases must NOT be added here as new languages ship (matching the convention this
 * dictionary was relocated from, `@jini-ai/ui`'s own `dictionaries.test.tsx`). Adding e.g. French
 * means adding `settings-dialog.fr.ts` plus one property in `dictionaries/index.ts`; this file
 * keeps verifying structure generically across every locale actually present.
 */
describe("cms settings-dialog dictionaries: cross-locale key parity", () => {
  const locales = Object.keys(SETTINGS_DIALOG_DICTIONARIES);

  it("has more than one locale", () => {
    expect(locales.length).toBeGreaterThan(1);
  });

  it("ship the exact same key set across every locale", () => {
    const [firstLocale, ...restLocales] = locales;
    if (!firstLocale) throw new Error("SETTINGS_DIALOG_DICTIONARIES is empty");
    const referenceKeys = Object.keys(SETTINGS_DIALOG_DICTIONARIES[firstLocale]!).sort();
    for (const locale of restLocales) {
      const dict = SETTINGS_DIALOG_DICTIONARIES[locale]!;
      const keys = Object.keys(dict).sort();
      expect(keys, `${locale} key set should match ${firstLocale}`).toEqual(referenceKeys);
    }
  });

  it("has a non-empty translation for every key in every locale", () => {
    for (const locale of locales) {
      const dict = SETTINGS_DIALOG_DICTIONARIES[locale]!;
      for (const [key, value] of Object.entries(dict)) {
        expect(value.length, `${locale} value for ${JSON.stringify(key)} should not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it("has exactly the 24 relocated chrome keys (guards against a partial or bloated dictionary)", () => {
    const [firstLocale] = locales;
    if (!firstLocale) throw new Error("SETTINGS_DIALOG_DICTIONARIES is empty");
    expect(Object.keys(SETTINGS_DIALOG_DICTIONARIES[firstLocale]!).length).toBe(24);
  });
});

describe("translateSettingsDialog", () => {
  it("returns the real translation for a known key in a known locale", () => {
    expect(translateSettingsDialog("es", "Skills")).toBe(SETTINGS_DIALOG_DICTIONARIES.es!["Skills"]);
    expect(translateSettingsDialog("es", "Skills")).not.toBe("Skills");
  });

  it("falls back to the raw key for an unknown locale", () => {
    expect(translateSettingsDialog("xx-not-a-locale", "Skills")).toBe("Skills");
  });

  it("falls back to the raw key for a key missing from every dictionary", () => {
    expect(translateSettingsDialog("es", "this.key.does.not.exist.anywhere")).toBe(
      "this.key.does.not.exist.anywhere",
    );
  });

  it("returns the raw key for English (no en dictionary is shipped, by design)", () => {
    expect(translateSettingsDialog("en", "Skills")).toBe("Skills");
  });
});
