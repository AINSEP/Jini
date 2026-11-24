import { expect, it } from "vitest";
import { memoryPanelDictionaries } from "../settings-memory-i18n.js";

it("builds an isolated active-locale dictionary with translated panel and common labels", () => {
  // Author Checklist F1.1/F4.2/F6.2/F7.5: representative bridge contract, not a
  // completeness claim. Reject: return an en namespace, or bypass feature translation.
  const de = memoryPanelDictionaries({ locale: "de" });
  expect(Object.keys(de)).toEqual(["de"]);
  const deBlock = de["de"] ?? {};
  expect(deBlock["No saved memories yet"]).toBe("Noch keine gespeicherten Erinnerungen");
  expect(deBlock["Saved facts, preferences, and project context available to future chats."]).toBe("Gespeicherte Fakten, Vorlieben und Projektkontext, die künftigen Chats zur Verfügung stehen.");
  expect(deBlock["Refresh"]).toBe("Aktualisieren");
  deBlock["No saved memories yet"] = "overwritten by consumer";
  expect(memoryPanelDictionaries({ locale: "de" })["de"]?.["No saved memories yet"]).toBe("Noch keine gespeicherten Erinnerungen");
});

it("keeps the requested namespace and English fallback for an unsupported locale", () => {
  // Reject: hard-code locale de, or remove fallback keys from the provider dictionary.
  const dictionaries = memoryPanelDictionaries({ locale: "unlisted-locale" });
  expect(Object.keys(dictionaries)).toEqual(["unlisted-locale"]);
  expect(dictionaries["unlisted-locale"]?.["No saved memories yet"]).toBe("No saved memories yet");
  expect(dictionaries["unlisted-locale"]?.["Refresh"]).toBe("Refresh");
});
