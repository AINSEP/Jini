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

  // REGRESSION: fails if the removed Composio key is restored in any locale.
  it("has exactly 23 chrome keys after removing the retired account-provider description", () => {
    const [firstLocale] = locales;
    if (!firstLocale) throw new Error("SETTINGS_DIALOG_DICTIONARIES is empty");
    expect(Object.keys(SETTINGS_DIALOG_DICTIONARIES[firstLocale]!).length).toBe(23);
    for (const locale of locales) {
      expect(Object.keys(SETTINGS_DIALOG_DICTIONARIES[locale]!)).not.toContain("Third-party accounts and APIs via Composio.");
    }
  });

  // PARITY
  it("retains all five other potentially orphaned descriptions in every locale", () => {
    const retainedKeys = [
      "Add MCP tools from external services.",
      "API keys for image, video, and audio generation.",
      "Custom skills your assistant can invoke mid-task.",
      "No MCP config store to connect to yet.",
      "Connect an MCP client. Showing sample output — not yet wired to a live server.",
    ];
    for (const locale of locales) {
      for (const key of retainedKeys) {
        expect(Object.keys(SETTINGS_DIALOG_DICTIONARIES[locale]!)).toContain(key);
      }
    }
  });
});

describe("translateSettingsDialog", () => {
  // REGRESSION: fails if the removed Composio key is restored in the Spanish dictionary.
  it("falls back to the raw key for the retired account-provider description", () => {
    const key = "Third-party accounts and APIs via Composio.";
    expect(translateSettingsDialog({ locale: "es", key })).toBe(key);
  });

  it("returns the real translation for a known key in a known locale", () => {
    expect(translateSettingsDialog({ locale: "es", key: "Skills" })).toBe(SETTINGS_DIALOG_DICTIONARIES.es!["Skills"]);
    expect(translateSettingsDialog({ locale: "es", key: "Skills" })).not.toBe("Skills");
  });

  it("falls back to the raw key for an unknown locale", () => {
    expect(translateSettingsDialog({ locale: "xx-not-a-locale", key: "Skills" })).toBe("Skills");
  });

  it("falls back to the raw key for a key missing from every dictionary", () => {
    expect(translateSettingsDialog({ locale: "es", key: "this.key.does.not.exist.anywhere" })).toBe(
      "this.key.does.not.exist.anywhere",
    );
  });

  it("returns the raw key for English (no en dictionary is shipped, by design)", () => {
    expect(translateSettingsDialog({ locale: "en", key: "Skills" })).toBe("Skills");
  });
});
