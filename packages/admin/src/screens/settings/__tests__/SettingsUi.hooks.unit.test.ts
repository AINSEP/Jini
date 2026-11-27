// @vitest-environment jsdom
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { KitDictionaries } from "../../../react/kit.js";
import type { SettingsUiProps } from "../SettingsUi.js";
import { createSettingsTabChange, createSettingsUiTranslators } from "../SettingsUi.hooks.js";
import { aiAgentPanelDictionaries, t as tExecution } from "../settings-execution-i18n.js";

describe("createSettingsUiTranslators (host dictionaries injected)", () => {
  const sources = (settingsLocale: string) => ({
    settingsLocale,
    dialogDictionaries: { en: { "Only dialog": "Dialog EN" }, de: { "Only dialog": "Dialog DE" } },
    translateApp: vi.fn(({ locale, key }: { locale: string; key: string }) => `app:${locale}:${key}`),
    translateCapability: vi.fn(({ locale, key }: { locale: string; key: string }) => `cap:${locale}:${key}`),
  });

  // Mutation: drop the `dialogDictionaries.en` tier or call translateApp first — red.
  it("t reads the injected dialog dictionaries (locale, then English) before the host app dictionary", () => {
    const de = createSettingsUiTranslators(sources("de"));
    expect(de.t("Only dialog")).toBe("Dialog DE");
    const fr = createSettingsUiTranslators(sources("fr"));
    expect(fr.t("Only dialog")).toBe("Dialog EN");
    expect(fr.t("Nowhere at all")).toBe("app:fr:Nowhere at all");
  });

  it("tCap goes through the injected capability dictionary; tExecution through the AI-agent one", () => {
    const { tCap, tExecution: tExec } = createSettingsUiTranslators(sources("es"));
    expect(tCap({ key: "No backend" })).toBe("cap:es:No backend");
    expect(tExec("AI agent")).toBe(tExecution({ locale: "es", key: "AI agent" }));
    expect(tExec("AI agent")).toBe("Agente de IA");
  });
});

describe("settings-execution-i18n", () => {
  it("accepts the kit's partial locale dictionaries at the settings screen boundary", () => {
    expectTypeOf<KitDictionaries>().toEqualTypeOf<SettingsUiProps["deps"]["SETTINGS_DIALOG_DICTIONARIES"]>();
    const dictionaries: KitDictionaries = { es: { Other: "Otro" } };
    expect(aiAgentPanelDictionaries({ dictionaries, locales: [{ code: "es" }] }).es).toEqual({
      Other: "Otro", "Execution mode": "Agente de IA", "AI agent": "Agente de IA",
    });
  });

  it("keeps the {productName} token in the server-scope key and translations, for the host to fill", () => {
    const key = "Detected on the {productName} server, not on your own computer.";
    expect(tExecution({ locale: "de", key })).toBe("Auf dem {productName}-Server erkannt, nicht auf Ihrem eigenen Computer.");
    expect(tExecution({ locale: "en", key })).toBe(key);
  });

  // Mutation: iterate a fixed locale list instead of `locales` — the injected "xx" overlay disappears.
  it("aiAgentPanelDictionaries overlays exactly the injected locales", () => {
    const out = aiAgentPanelDictionaries({ dictionaries: { es: { Other: "Otro" } }, locales: [{ code: "es" }, { code: "xx" }] });
    expect(out.es).toEqual({ Other: "Otro", "Execution mode": "Agente de IA", "AI agent": "Agente de IA" });
    expect(out.xx).toEqual({ "Execution mode": "AI agent", "AI agent": "AI agent" });
    expect(Object.keys(out).sort()).toEqual(["es", "xx"]);
  });
});

it("replaces rather than pushes history when Settings first becomes a tab deep link", () => {
  const state: unknown = window.history.state;
  const previous = window.location.href;
  try {
    window.history.replaceState(null, "", "/admin/settings");
    const historyLength = window.history.length;
    const change = createSettingsTabChange({});
    change("notifications");
    expect(window.location.pathname + window.location.search).toBe("/admin/settings?tab=notifications");
    change("memory");
    expect(window.location.search).toBe("?tab=memory");
    expect(window.history.length).toBe(historyLength);
  } finally {
    window.history.replaceState(state, "", previous);
  }
});
