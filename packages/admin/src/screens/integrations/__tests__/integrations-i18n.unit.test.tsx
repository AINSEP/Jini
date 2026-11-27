// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { INTEGRATIONS_DICT_ES_TO_KO } from "../i18n/integrations-dict-es-to-ko.js";
import { INTEGRATIONS_DICT_PL_TO_BN } from "../i18n/integrations-dict-pl-to-bn.js";
import { actionsForWebhookLabel, createIntegrationsDictionary, deleteWebhookBody } from "../integrations-i18n.js";

const earlyLocales = ["ar", "de", "es", "fa", "id", "ja", "ko", "pt-BR", "ru", "zh-CN", "zh-TW"];
const lateLocales = ["bn", "fr", "hi", "hu", "it", "pl", "th", "tr", "uk", "ur"];
const translations = { ...INTEGRATIONS_DICT_ES_TO_KO, ...INTEGRATIONS_DICT_PL_TO_BN };
const tokens = (copy: string) => copy.match(/\{\w+\}/g)?.sort() ?? [];

afterEach(cleanup);

it("keeps all supported locales in their respective dictionary packs", () => {
  expect(Object.keys(INTEGRATIONS_DICT_ES_TO_KO).sort()).toEqual(earlyLocales);
  expect(Object.keys(INTEGRATIONS_DICT_PL_TO_BN).sort()).toEqual(lateLocales);
});

it.each([...earlyLocales, ...lateLocales])("keeps complete, non-blank source-key parity with placeholders intact for %s", (locale) => {
  // English copy is encoded as the keys, not as a separate en dictionary. The union catches a
  // deletion in any single locale, independently of which locale happened to define a key first.
  const sourceKeys = [...new Set(Object.values(translations).flatMap(Object.keys))].sort();
  expect(sourceKeys).toEqual(expect.arrayContaining(["Add webhook", "Delivery log", "Loading integrations…"]));
  const dictionary = translations[locale];
  if (!dictionary) throw new Error(`Missing translations for ${locale}`);
  expect(Object.keys(dictionary).sort()).toEqual(sourceKeys);
  for (const [key, value] of Object.entries(dictionary)) {
    expect(value.trim(), `${locale}: ${key}`).not.toBe("");
    expect(tokens(value), `${locale}: ${key}`).toEqual(tokens(key));
  }
});

it("prefers feature copy from either pack, uses host copy on a miss and leaves unknown keys in English", () => {
  const { t } = createIntegrationsDictionary({
    commonDictionary: { es: { Pause: "Host translation must not win", Save: "Guardar cambios" } },
  });
  expect(t({ locale: "es", key: "Pause" })).toBe("Pausar");
  expect(t({ locale: "fr", key: "Pause" })).toBe("Suspendre");
  expect(t({ locale: "es", key: "Save" })).toBe("Guardar cambios");
  expect(t({ locale: "en", key: "Add webhook" })).toBe("Add webhook");
  expect(t({ locale: "xx", key: "Delivery log" })).toBe("Delivery log");
});

it("interpolates the exact webhook label in localized and English fallback accessible names", () => {
  const label = "Billing & {label} <West>";
  expect(actionsForWebhookLabel({ locale: "es", label })).toBe('Acciones para el webhook "Billing & {label} <West>"');
  expect(actionsForWebhookLabel({ locale: "fr", label })).toBe("Actions pour le webhook « Billing & {label} <West> »");
  expect(actionsForWebhookLabel({ locale: "unknown", label })).toBe('Actions for webhook "Billing & {label} <West>"');
  for (const locale of [...earlyLocales, ...lateLocales]) {
    const copy = actionsForWebhookLabel({ locale, label: "North-17" });
    expect(copy.split("North-17"), locale).toHaveLength(2);
    expect(copy, locale).not.toContain("{label}");
    expect(copy, locale).not.toBe('Actions for webhook "North-17"');
  }
});

it("renders the named webhook as literal text in localized and English fallback delete confirmations", () => {
  const label = '<img src="billing.png"> & team';
  const { container, rerender } = render(deleteWebhookBody({ locale: "fr", label }));
  expect(screen.getByText(/Supprimer le webhook/).textContent)
    .toBe('Supprimer le webhook « <img src="billing.png"> & team » ? Cette action est irréversible.');
  expect(container.querySelector("img")).toBeNull();
  rerender(deleteWebhookBody({ locale: "unknown", label }));
  expect(screen.getByText(/Delete webhook/).textContent)
    .toBe('Delete webhook "<img src="billing.png"> & team"? This cannot be undone.');
  expect(container.querySelector("img")).toBeNull();

  for (const locale of [...earlyLocales, ...lateLocales]) {
    rerender(deleteWebhookBody({ locale, label: "North-17" }));
    const message = screen.getByText(/North-17/).textContent ?? "";
    expect(message.split("North-17"), locale).toHaveLength(2);
    expect(message, locale).not.toBe("North-17");
    expect(message, locale).not.toBe('Delete webhook "North-17"? This cannot be undone.');
  }
});
