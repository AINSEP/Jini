import { describe, expect, it } from "vitest";
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";
import { WEBMCP_DICT, WEBMCP_KEYS } from "../webmcp-i18n.js";

/** The host binding, built the way a host composes it (dictionary translator + common fallback). */
const t = createDictionaryTranslator({ featureDictionary: WEBMCP_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

/** The admin locales this dictionary has always shipped (the host's language picker order). */
const LOCALES = ["en", "es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko", "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn"];

describe("browser-agent (WebMCP) settings dictionary", () => {
  it("supplies every key and the Confirm label in every locale, and nothing else", () => {
    // Mutation: drop a locale row, or the `Confirm:` spread, and this goes red.
    expect(Object.keys(WEBMCP_DICT).sort()).toEqual([...LOCALES].sort());
    for (const locale of LOCALES) {
      expect(Object.keys(WEBMCP_DICT[locale] ?? {}).sort(), locale).toEqual([...WEBMCP_KEYS, "Confirm"].sort());
      for (const key of [...WEBMCP_KEYS, "Confirm"]) expect(WEBMCP_DICT[locale]?.[key], `${locale}: ${key}`).toBeTruthy();
    }
  });

  it("maps each key to its own locale's value by position, with English as the source keys", () => {
    // Mutation: shift the index in the key/value zip (values[index + 1]) and the Spanish label goes wrong.
    expect(t({ locale: "en", key: WEBMCP_KEYS[0] })).toBe("Browser-agent access (WebMCP)");
    expect(t({ locale: "es", key: "Browser-agent access (WebMCP)" })).toBe("Acceso del agente del navegador (WebMCP)");
    expect(t({ locale: "es", key: "Allow the browser agent to perform this admin action?" })).toBe(
      "¿Permitir que el agente del navegador realice esta acción de administración?",
    );
    expect(t({ locale: "de", key: "Confirm" })).toBe("Bestätigen");
    expect(t({ locale: "ja", key: "Confirm" })).toBe("確認");
  });

  it("leaves unknown keys to the host's common fallback and then the readable source key", () => {
    expect(t({ locale: "fr", key: "Not a webmcp key" })).toBe("Not a webmcp key");
  });
});
