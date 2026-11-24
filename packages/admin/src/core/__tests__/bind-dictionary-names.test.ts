import { describe, expect, it } from "vitest";

import { bindDictionaryNames } from "../bind-dictionary-names.js";

describe("bindDictionaryNames", () => {
  it("binds named tokens in both keys and values, in every locale", () => {
    const bound = bindDictionaryNames({
      dictionary: { es: { "{productName} is a CMS": "{productName} es un CMS" }, de: { "Hi {productName}": "Hallo {productName}" } },
      names: { productName: "Acme" },
    });
    expect(bound).toEqual({ es: { "Acme is a CMS": "Acme es un CMS" }, de: { "Hi Acme": "Hallo Acme" } });
  });

  it("binds every occurrence and several different names", () => {
    const bound = bindDictionaryNames({
      dictionary: { en: { "{a} and {b}": "{a}, {a} and {b}" } },
      names: { a: "X", b: "Y" },
    });
    expect(bound).toEqual({ en: { "X and Y": "X, X and Y" } });
  });

  it("leaves tokens the caller did not name for the dictionary's own interpolation", () => {
    const bound = bindDictionaryNames({ dictionary: { es: { "{count} of {productName}": "{count} de {productName}" } }, names: { productName: "Acme" } });
    expect(bound).toEqual({ es: { "{count} of Acme": "{count} de Acme" } });
  });
});
