import { describe, expect, it } from "vitest";

import { ADMIN_COMMON_I18N } from "../../../../core/i18n-common.js";
import { ASSISTANT_DOCK_DICT, createChatI18nAdapter, t } from "../assistant-dock-i18n.js";

/**
 * @file The dock dictionaries were split into per-locale-group modules and the product-naming
 * entries moved out to the host. These tests pin that the split kept every neutral locale and key in
 * its original order, and that the host's injected copy (product overlay, settings-dialog copy) is
 * what fills the gaps — nothing is hard-wired here.
 */

const LOCALES = ["es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko", "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn"];
const NO_HOST = { hostDictionary: {} };
const SETTINGS = { settingsDialogKeys: ["Secret hidden"], settingsDialogDictionaries: { es: { "Secret hidden": "Secreto oculto", "Other": "Otro" } } };

describe("ASSISTANT_DOCK_DICT after the locale-group split", () => {
  it("keeps all 21 locales in the original order, each with the same neutral key set", () => {
    expect(Object.keys(ASSISTANT_DOCK_DICT)).toEqual(LOCALES);
    const esKeys = Object.keys(ASSISTANT_DOCK_DICT.es!).sort();
    expect(esKeys).toHaveLength(42);
    for (const locale of LOCALES) expect(Object.keys(ASSISTANT_DOCK_DICT[locale]!).sort()).toEqual(esKeys);
  });

  it("keeps spot values from the first, middle and last group byte-for-byte", () => {
    expect(ASSISTANT_DOCK_DICT.es!["More settings…"]).toBe("Más ajustes…");
    expect(ASSISTANT_DOCK_DICT.de!["Starting assistant…"]).toBe("Assistent wird gestartet…");
    expect(ASSISTANT_DOCK_DICT.ru!["More settings…"]).toBe("Другие настройки…");
    expect(ASSISTANT_DOCK_DICT.bn!["Prefer subagents"]).toBe("সাবএজেন্টকে অগ্রাধিকার দিন");
  });
});

describe("t", () => {
  it("resolves the dock's own copy, then the common dictionary, then the key itself", () => {
    expect(t({ locale: "es", key: "Reply length", ...NO_HOST })).toBe("Longitud de respuesta");
    expect(ASSISTANT_DOCK_DICT.de!.Cancel).toBeUndefined();
    expect(t({ locale: "de", key: "Cancel", ...NO_HOST })).toBe(ADMIN_COMMON_I18N.de!.Cancel);
    expect(t({ locale: "en", key: "Reply length", ...NO_HOST })).toBe("Reply length");
  });

  it("reads the host's copy first and ignores inherited names in it", () => {
    const hostDictionary = { es: { "Host title": "Título del anfitrión", "Reply length": "Largo" } };
    expect(t({ locale: "es", key: "Host title", hostDictionary })).toBe("Título del anfitrión");
    expect(t({ locale: "es", key: "Reply length", hostDictionary })).toBe("Largo");
    expect(t({ locale: "fr", key: "Host title", hostDictionary })).toBe("Host title");
    expect(t({ locale: "es", key: "constructor", hostDictionary })).toBe("constructor");
  });
});

describe("createChatI18nAdapter", () => {
  it("translates and interpolates its own dictionary, passing unknown keys through", () => {
    const adapter = createChatI18nAdapter({ locale: "es", ...NO_HOST, ...SETTINGS });
    expect(adapter.locale).toBe("es");
    expect(adapter.t("Choose a folder")).toBe("Elegir una carpeta");
    expect(adapter.t("Folders ({count})", { count: 3 })).toBe("Carpetas (3)");
    expect(adapter.t("Not a key {x}", {})).toBe("Not a key {x}");
  });

  it("uses the injected settings-dialog copy only for the keys the host names", () => {
    const adapter = createChatI18nAdapter({ locale: "es", ...NO_HOST, ...SETTINGS });
    expect(adapter.t("Secret hidden")).toBe("Secreto oculto");
    expect(adapter.t("Other")).toBe("Other");
    expect(createChatI18nAdapter({ locale: "de", ...NO_HOST, ...SETTINGS }).t("Secret hidden")).toBe("Secret hidden");
  });

  it("reads the host's copy before its own dictionary", () => {
    const hostDictionary = { es: { "Host notice": "Aviso del anfitrión", "Choose a folder": "Carpeta" } };
    const adapter = createChatI18nAdapter({ locale: "es", hostDictionary, ...SETTINGS });
    expect(adapter.t("Host notice")).toBe("Aviso del anfitrión");
    expect(adapter.t("Choose a folder")).toBe("Carpeta");
  });
});
