import { describe, expect, it } from "vitest";

import { createSourceControlTranslator, sourceControlCredentialSaveErrorMessage, sourceControlCredentialsLoadErrorMessage } from "../source-control-i18n.js";

/** No host entries: this package's own dictionary alone (a host layers its product-naming strings on top). */
const t = createSourceControlTranslator({ hostDictionary: {} });

// Author Checklist / F4.1/F6.2: literal copy, locale fallback and non-default error detail.
describe("Source Control dictionary assembly and error copy", () => {
  it("combines base provider copy with the Access Tokens link translations", () => {
    // Mutation: drop ACCESS_TOKEN_LINK_TRANSLATIONS from the assembly.
    expect(t({ locale: "de", key: "Replace token" })).toBe("Token ersetzen");
    expect(t({ locale: "de", key: "Create access token" })).toBe("Zugriffstoken erstellen");
    expect(t({ locale: "fr", key: "Create access token" })).toBe("Créer un jeton d’accès");
    expect(t({ locale: "xx", key: "Create access token" })).toBe("Create access token");
    expect(t({ locale: "de", key: "extension copy" })).toBe("extension copy");
  });

  it("lays host entries over the package dictionary per locale and ignores uncovered locales", () => {
    // Mutation: drop `...hostDictionary[locale]` from the factory's per-locale merge.
    const hosted = createSourceControlTranslator({ hostDictionary: { de: { "Host copy": "Host-Text", "Replace token": "Host ersetzt" }, xx: { "Host copy": "nie" } } });
    expect(hosted({ locale: "de", key: "Host copy" })).toBe("Host-Text");
    expect(hosted({ locale: "de", key: "Replace token" })).toBe("Host ersetzt");
    expect(hosted({ locale: "de", key: "Create access token" })).toBe("Zugriffstoken erstellen");
    expect(hosted({ locale: "xx", key: "Host copy" })).toBe("Host copy");
  });

  it("falls back to the injected common dictionary, then the English key", () => {
    const withCommon = createSourceControlTranslator({ hostDictionary: {} }, { commonDictionary: { de: { "Shared word": "Gemeinsames Wort", Save: "Common-Speichern" } } });
    expect(withCommon({ locale: "de", key: "Shared word" })).toBe("Gemeinsames Wort");
    expect(withCommon({ locale: "de", key: "Save" })).toBe("Speichern");
    expect(withCommon({ locale: "es", key: "Shared word" })).toBe("Shared word");
  });

  it.each(["en", "de", "xx"])("interpolates load and save failures with English fallback in %s", (locale) => {
    // Mutation: replace {error} with a constant, or use the load template for save failures.
    expect(sourceControlCredentialsLoadErrorMessage({ locale: locale, error: "403: denied <Atlas>" })).toBe("Could not load source control connections (403: denied <Atlas>).");
    expect(sourceControlCredentialSaveErrorMessage({ locale: locale, error: "token missing for Boreal" })).toBe("Could not save this connection (token missing for Boreal).");
  });
});
