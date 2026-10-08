import { describe, expect, it } from "vitest";
import { interpolate, localeEntry } from "../template-i18n.js";

const TEMPLATE: Record<string, string> = { en: "Could not load: {error}", es: "No se pudo cargar: {error}" };

describe("localeEntry", () => {
  it("returns the requested locale's own entry", () => {
    expect(localeEntry({ table: TEMPLATE, locale: "es" })).toBe("No se pudo cargar: {error}");
  });

  it("falls back to English for a locale the table does not carry", () => {
    expect(localeEntry({ table: TEMPLATE, locale: "xx" })).toBe("Could not load: {error}");
  });

  it("uses the caller's fallback instead of English when one is given", () => {
    const overlay: Record<string, Record<string, string>> = { es: { Save: "Guardar" } };
    expect(localeEntry({ table: overlay, locale: "xx" }, { fallback: {} })).toEqual({});
  });

  // BUG: a plain `table[locale]` read resolves these to Object.prototype members, so the caller got a
  // function (or Object.prototype itself) instead of copy and `interpolate` threw on it.
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "falls back to English for the inherited locale name %s",
    (locale) => {
      expect(localeEntry({ table: TEMPLATE, locale })).toBe("Could not load: {error}");
      expect(interpolate({ template: localeEntry({ table: TEMPLATE, locale }), vars: { error: "boom" } })).toBe("Could not load: boom");
    },
  );
});
