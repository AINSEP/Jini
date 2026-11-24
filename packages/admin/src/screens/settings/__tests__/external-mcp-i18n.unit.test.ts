import { describe, expect, it } from "vitest";
import { interpolate } from "@jini-ai/core/text";

import { t } from "../external-mcp-i18n.js";

const PRODUCT_KEYS = Object.keys(t.dictionary["es"] ?? {}).filter((key) => key.includes("{productName}"));

describe("external-MCP dictionary: product name as host copy", () => {
  it("names the product only through the {productName} token, in the five keys that need it", () => {
    expect(PRODUCT_KEYS).toHaveLength(5);
  });

  it("keeps the token in every locale's translation of those keys, so the host's vars fill it", () => {
    const locales = Object.keys(t.dictionary);
    expect(locales).toHaveLength(21);
    for (const locale of locales) {
      for (const key of PRODUCT_KEYS) {
        const translated = t({ locale, key });
        expect(translated, `${locale}: ${key}`).not.toBe(key);
        expect(translated, `${locale}: ${key}`).toContain("{productName}");
      }
    }
  });

  it("renders the host's product name once interpolated, in English (the key) and a translation", () => {
    const key = "The server marks this tool as destructive. {productName} does not enable destructive external tools.";
    expect(interpolate({ template: t({ locale: "en", key }), vars: { productName: "Acme" } })).toBe("The server marks this tool as destructive. Acme does not enable destructive external tools.");
    expect(interpolate({ template: t({ locale: "fr", key }), vars: { productName: "Acme" } })).toContain("Acme");
  });
});
