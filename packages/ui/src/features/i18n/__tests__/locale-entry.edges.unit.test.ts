import { describe, expect, it } from "vitest";
import { localeEntry } from "../template-i18n.js";
import { interpolate as universalInterpolate } from "../universal.js";

describe("localeEntry edges", () => {
  it("falls back when the table carries the locale key but no value for it", () => {
    const table: Record<string, string | undefined> = { en: "English", fr: undefined };
    expect(localeEntry({ table, locale: "fr" })).toBe("English");
  });

  it("throws a named error when neither the locale, English, nor an explicit fallback exists", () => {
    expect(() => localeEntry({ table: { es: "Hola" }, locale: "de" })).toThrow('No locale entry for "de" and no English or explicit fallback');
  });
});

describe("universal i18n entry", () => {
  it("exposes the same interpolation the template helpers implement", () => {
    expect(universalInterpolate({ template: "{n} saved", vars: { n: 2 } })).toBe("2 saved");
  });
});
