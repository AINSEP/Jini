import { describe, expect, it } from "vitest";
import {
  copyKeysResultText, createSecurityDictionary, sharedKeyReplaceWarning,
  siteKeyGenerateErrorMessage, siteKeyLoadErrorMessage, siteKeyRevealErrorMessage,
} from "../security-i18n.js";

/** The 22 locales the admin ships (en plus the 21 feature-dictionary locales). */
const LOCALES = ["en", "es", "de", "fr", "it", "pt-BR", "pl", "hu", "tr", "ru", "uk", "id", "ar", "fa", "hi", "bn", "ur", "ja", "ko", "th", "zh-CN", "zh-TW"] as const;
const COMMON = { es: { Cancel: "Cancelar" } };
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
const echo = (key: string): string => key;

describe("createSecurityDictionary", () => {
  it("binds the host product name into keys and values, so the call site looks up the bound English string", () => {
    const { t } = createSecurityDictionary({ commonDictionary: COMMON, productName: "Acme" });
    expect(t({ locale: "es", key: "Start {site} once in Acme to upgrade it, then copy." }))
      .toBe("Inicia {site} una vez en Acme para actualizarlo y luego copia.");
    expect(t({ locale: "de", key: "Start {site} once in Acme to upgrade it, then copy." }))
      .toBe("Starte {site} einmal in Acme, um es zu aktualisieren, und kopiere dann.");
  });

  it("falls back to the host common dictionary, then to the English key", () => {
    const { t } = createSecurityDictionary({ commonDictionary: COMMON, productName: "Acme" });
    expect(t({ locale: "es", key: "Cancel" })).toBe("Cancelar");
    expect(t({ locale: "es", key: "Not a security string" })).toBe("Not a security string");
  });

  it("keeps every translation's placeholders to its key's (only a singular {count} may be spelled out) and leaves no unbound product name", () => {
    const { t } = createSecurityDictionary({ commonDictionary: {}, productName: "Acme" });
    const locales = Object.keys(t.dictionary);
    expect(locales).toEqual(expect.arrayContaining([...LOCALES]));
    const mismatches: string[] = [];
    for (const [locale, block] of Object.entries(t.dictionary)) {
      for (const [key, value] of Object.entries(block)) {
        if (value.trim() === "") mismatches.push(`${locale}: empty value for ${key}`);
        if (key.includes("{productName}") || value.includes("{productName}")) mismatches.push(`${locale}: unbound name in ${key}`);
        // A translation may never invent a placeholder (it would render as raw braces) and may never drop
        // one — except `{count}` in a singular-form key, where e.g. Arabic says "one token" instead of "1 token".
        const keyNames = placeholders(key);
        const invented = placeholders(value).filter((name) => !keyNames.includes(name));
        const dropped = keyNames.filter((name) => name !== "count" && !placeholders(value).includes(name));
        if (invented.length > 0 || dropped.length > 0) mismatches.push(`${locale}: ${key} -> ${value}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("translates every key of the English source in every shipped locale", () => {
    const { t } = createSecurityDictionary({ commonDictionary: {}, productName: "Acme" });
    const englishKeys = Object.keys(t.dictionary.en!);
    expect(englishKeys.length).toBeGreaterThan(0);
    const missing = LOCALES.flatMap((locale) => englishKeys.filter((key) => !Object.hasOwn(t.dictionary[locale]!, key)).map((key) => `${locale}: ${key}`));
    expect(missing).toEqual([]);
  });

  it("builds the copy-keys upgrade instruction from one translated template with the site and product name filled in", () => {
    const { t, copyKeysUpgradeMessage } = createSecurityDictionary({ commonDictionary: {}, productName: "Acme" });
    expect(copyKeysUpgradeMessage({ site: "Blog", t: echo })).toBe("Start Blog once in Acme to upgrade it, then copy.");
    expect(copyKeysUpgradeMessage({ site: "Blog", t: (key) => t({ locale: "es", key }) }))
      .toBe("Inicia Blog una vez en Acme para actualizarlo y luego copia.");
  });

  it("names the credential and the product in the Remove dialog title", () => {
    const { removeDialogTitle } = createSecurityDictionary({ commonDictionary: {}, productName: "Acme" });
    expect(removeDialogTitle({ locale: "en", name: "Deploy bot" })).toBe('Remove "Deploy bot" from Acme?');
    expect(removeDialogTitle({ locale: "fr", name: "Deploy bot" })).toBe('Remove "Deploy bot" from Acme?');
  });

  it("keeps what the token is for and who revokes it as two separate names in the Remove body", () => {
    const { removeDialogBody } = createSecurityDictionary({ commonDictionary: {}, productName: "Acme" });
    expect(removeDialogBody({ locale: "en", credentialLabel: "GitHub Pages", vendor: "GitHub" })).toBe(
      "This deletes Acme's saved copy of this GitHub Pages token. It does NOT revoke the token on GitHub — it stays valid there until you revoke it yourself.",
    );
  });

  it("gives the external MCP store its own fully translated, unrecoverable-delete wording", () => {
    const { otherCredentialRemoveDialogBody } = createSecurityDictionary({ commonDictionary: {}, productName: "Acme" });
    const store = { id: "external-mcp", purposeLabel: "MCP servers" };
    const english = otherCredentialRemoveDialogBody({ locale: "en", store });
    expect(english).toBe("This deletes the server and its saved credentials. It can't be undone — you'd have to set it up again, and sign in again if it uses OAuth.");
    expect(otherCredentialRemoveDialogBody({ locale: "de", store })).toBe(
      "Dadurch werden der Server und seine gespeicherten Zugangsdaten gelöscht. Das lässt sich nicht rückgängig machen – Sie müssten ihn neu einrichten und sich erneut anmelden, falls er OAuth verwendet.",
    );
    const untranslated = LOCALES.filter((locale) => locale !== "en" && otherCredentialRemoveDialogBody({ locale, store }) === english);
    expect(untranslated).toEqual([]);
  });

  it("uses the store's purpose label for both names of the shared Remove body on every other store", () => {
    const { otherCredentialRemoveDialogBody } = createSecurityDictionary({ commonDictionary: {}, productName: "Acme" });
    expect(otherCredentialRemoveDialogBody({ locale: "en", store: { id: "media-providers", purposeLabel: "Image generation" } })).toBe(
      "This deletes Acme's saved copy of this Image generation token. It does NOT revoke the token on Image generation — it stays valid there until you revoke it yourself.",
    );
  });
});

describe("sharedKeyReplaceWarning", () => {
  it("is silent when no other site uses the key", () => {
    expect(sharedKeyReplaceWarning({ t: echo })).toBeNull();
    expect(sharedKeyReplaceWarning({ usedBy: [], t: echo })).toBeNull();
    expect(sharedKeyReplaceWarning({ usedBy: ["this"], usedByThisSite: true, t: echo })).toBeNull();
  });

  it("warns with the singular sentence when exactly one other site uses the key", () => {
    expect(sharedKeyReplaceWarning({ usedBy: ["this", "blog"], usedByThisSite: true, t: echo })).toBe("Used by 1 other site; it will use the new token too.");
    expect(sharedKeyReplaceWarning({ usedBy: ["blog"], usedByThisSite: false, t: echo })).toBe("Used by 1 other site; it will use the new token too.");
  });

  it("counts the other sites, excluding this one, in the plural sentence", () => {
    expect(sharedKeyReplaceWarning({ usedBy: ["this", "blog", "shop", "docs"], usedByThisSite: true, t: echo }))
      .toBe("Used by 3 other sites; they will use the new token too.");
    expect(sharedKeyReplaceWarning({ usedBy: ["blog", "shop"], t: (key) => `[${key}]` }))
      .toBe("[Used by 2 other sites; they will use the new token too.]");
  });
});

describe("copyKeysResultText", () => {
  it("shows the server's four-character hint only when it is exactly four characters", () => {
    expect(copyKeysResultText({ result: { kind: "k", id: "a", status: "copied", last4: "wxyz" }, t: echo })).toBe("copied ✓ …wxyz");
    expect(copyKeysResultText({ result: { kind: "k", id: "a", status: "copied", last4: "wxyz9" }, t: echo })).toBe("copied ✓");
    expect(copyKeysResultText({ result: { kind: "k", id: "a", status: "copied" }, t: echo })).toBe("copied ✓");
  });

  it.each([
    ["target-exists", "skipped (already there)"],
    ["conflict", "Changed during copy; try again."],
    ["source-missing", "Key no longer available; reopen to refresh."],
    ["requires-mcp-configuration", "Requires its MCP server configuration."],
    ["kind-not-copyable", "This kind cannot be copied."],
    ["source-needs-upgrade", "Finish the source upgrade first."],
    ["context", "Incompatible credential context."],
    ["invalid-meta", "Invalid credential metadata."],
    ["invalid-record", "Invalid credential record."],
  ])("renders fixed copy for the %s reason", (reasonCode, text) => {
    expect(copyKeysResultText({ result: { kind: "k", id: "a", status: "skipped", reasonCode }, t: echo })).toBe(text);
  });

  it("never renders an unknown or missing reason code, only the generic failure", () => {
    expect(copyKeysResultText({ result: { kind: "k", id: "a", status: "failed", reasonCode: "<b>raw server text</b>" }, t: echo })).toBe("Copying keys failed. Try again.");
    expect(copyKeysResultText({ result: { kind: "k", id: "a", status: "failed" }, t: echo })).toBe("Copying keys failed. Try again.");
  });
});

describe("site key error banners", () => {
  it.each([
    ["load", siteKeyLoadErrorMessage, "Couldn't load the site key's status: boom", "No se pudo cargar el estado de la clave del sitio: boom"],
    ["generate", siteKeyGenerateErrorMessage, "Couldn't generate a site key: boom", "No se pudo generar una clave del sitio: boom"],
    ["reveal", siteKeyRevealErrorMessage, "Couldn't reveal the site key: boom", "No se pudo revelar la clave del sitio: boom"],
  ] as const)("fills the %s error into a translated template in every shipped locale", (_name, message, english, spanish) => {
    expect(message({ locale: "en", error: "boom" })).toBe(english);
    expect(message({ locale: "es", error: "boom" })).toBe(spanish);
    expect(message({ locale: "xx", error: "boom" })).toBe(english);
    const bad = LOCALES.filter((locale) => {
      const text = message({ locale, error: "boom" });
      return !text.includes("boom") || (locale !== "en" && text === english);
    });
    expect(bad).toEqual([]);
  });
});
