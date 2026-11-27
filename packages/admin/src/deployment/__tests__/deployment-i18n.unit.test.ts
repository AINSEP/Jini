import { describe, expect, it } from "vitest";

import { auditTranslationEntries } from "../deployment-i18n/deployment-audit.js";
import { candidateGapTranslationEntries } from "../deployment-i18n/deployment-candidate-gap.js";
import {
  createDeploymentTranslator,
  dockerfileLineCountLabel,
  deploymentOverviewLoadErrorMessage,
  dockerfileLoadErrorMessage,
  dockerfileSaveErrorMessage,
  exportLoadErrorMessage,
  exportTriggerErrorMessage,
  exportPollErrorMessage,
  publishLoadErrorMessage,
  publishPreviewErrorMessage,
  publishTriggerErrorMessage,
  publishPollErrorMessage,
  publishCredentialsLoadErrorMessage,
  publishCredentialSaveErrorMessage,
  publishCredentialVerifyErrorMessage,
  publishCredentialSelectErrorMessage,
} from "../deployment-i18n.js";

/** No host entries: this package's own dictionary alone (a host layers its product-naming strings on top). */
const t = createDeploymentTranslator({ hostDictionary: {} });

/**
 * @file Coverage for deployment-i18n.tsx's thirteen `{error}`-carrying message functions' own
 * `TEMPLATE[locale] ?? TEMPLATE.en` fallback. Every existing caller across this feature's hooks
 * renders through `useAdminLocale()`, which resolves to a real, dictionary-covered locale in every
 * test fixture here (usually `"en"` itself) — none has ever called one of these with a locale absent
 * from its own template map, so the fallback arm (the one path that matters if a new locale is added
 * to the flat `DEPLOYMENT_DICT` above these but a translator hasn't reached these long-tail
 * templates yet) was unexercised for all thirteen. Table-driven since the shape is identical across
 * all thirteen — this is a mechanical fallback check, not scenario logic worth writing out by hand.
 */

const UNSUPPORTED_LOCALE = "xx";

const CASES: Array<{ name: string; fn: (required: { locale: string; error: string }) => string; en: string }> = [
  { name: "deploymentOverviewLoadErrorMessage", fn: deploymentOverviewLoadErrorMessage, en: "Could not load deployment status ({error})." },
  { name: "dockerfileLoadErrorMessage", fn: dockerfileLoadErrorMessage, en: "Could not load the Dockerfile ({error})." },
  { name: "dockerfileSaveErrorMessage", fn: dockerfileSaveErrorMessage, en: "Could not save the Dockerfile ({error})." },
  { name: "exportLoadErrorMessage", fn: exportLoadErrorMessage, en: "Could not load the export status ({error})." },
  { name: "exportTriggerErrorMessage", fn: exportTriggerErrorMessage, en: "Could not start the export ({error})." },
  {
    name: "exportPollErrorMessage",
    fn: exportPollErrorMessage,
    en: "Lost track of this export's status and stopped checking ({error}). It may still be running — try again in a moment.",
  },
  { name: "publishLoadErrorMessage", fn: publishLoadErrorMessage, en: "Could not load the publish status ({error})." },
  { name: "publishPreviewErrorMessage", fn: publishPreviewErrorMessage, en: "Could not check this target ({error})." },
  { name: "publishTriggerErrorMessage", fn: publishTriggerErrorMessage, en: "Could not start the publish ({error})." },
  {
    name: "publishPollErrorMessage",
    fn: publishPollErrorMessage,
    en: "Lost track of this publish's status and stopped checking ({error}). It may still be running — try again in a moment.",
  },
  { name: "publishCredentialsLoadErrorMessage", fn: publishCredentialsLoadErrorMessage, en: "Could not load publish credentials ({error})." },
  { name: "publishCredentialSaveErrorMessage", fn: publishCredentialSaveErrorMessage, en: "Could not save this token ({error})." },
  { name: "publishCredentialVerifyErrorMessage", fn: publishCredentialVerifyErrorMessage, en: "Could not verify this token ({error})." },
  {
    name: "publishCredentialSelectErrorMessage",
    fn: publishCredentialSelectErrorMessage,
    en: "Could not switch the publishing token ({error}). Publishing still uses the one shown.",
  },
];

describe("deployment-i18n error-message templates — unsupported-locale fallback", () => {
  it.each(CASES)("$name falls back to the English template for an unsupported locale", ({ fn, en }) => {
    expect(fn({ locale: UNSUPPORTED_LOCALE, error: "disk full" })).toBe(en.replace("{error}", "disk full"));
  });

  it.each(CASES)("$name still renders the requested locale when it IS covered (en itself)", ({ fn, en }) => {
    expect(fn({ locale: "en", error: "disk full" })).toBe(en.replace("{error}", "disk full"));
  });
});

const SPANISH_TEMPLATES: Array<{ fn: (required: { locale: string; error: string }) => string; template: string }> = [
  { fn: deploymentOverviewLoadErrorMessage, template: "No se pudo cargar el estado del despliegue ({error})." },
  { fn: dockerfileLoadErrorMessage, template: "No se pudo cargar el Dockerfile ({error})." },
  { fn: dockerfileSaveErrorMessage, template: "No se pudo guardar el Dockerfile ({error})." },
  { fn: exportLoadErrorMessage, template: "No se pudo cargar el estado de la exportación ({error})." },
  { fn: exportTriggerErrorMessage, template: "No se pudo iniciar la exportación ({error})." },
  { fn: publishLoadErrorMessage, template: "No se pudo cargar el estado de la publicación ({error})." },
  { fn: publishPreviewErrorMessage, template: "No se pudo comprobar este destino ({error})." },
  { fn: publishTriggerErrorMessage, template: "No se pudo iniciar la publicación ({error})." },
];

describe("deployment-i18n error-message templates — covered non-English locale", () => {
  it.each(SPANISH_TEMPLATES)("renders $template in Spanish and interpolates the error", ({ fn, template }) => {
    const message = fn({ locale: "es", error: "disk full" });
    expect(message).toBe(template.replace("{error}", "disk full"));
    expect(message).not.toBe(fn({ locale: "en", error: "disk full" }));
    expect(message).toContain("disk full");
  });
});

const ADMIN_LOCALES = ["es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko", "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn"];

describe("deployment-i18n — Static Site credential row and publish step", () => {
  const plain = [
    "Leave blank to keep the current token.",
    "Create a token",
    "Connect",
    "Replace token",
    "token stored, encrypted",
    "Preview",
    "Publish",
    "Configured",
    "Not configured",
    "Verify",
    "Which saved token publishes",
    "Getting it online",
  ];
  const templates: Record<string, string> = {
    "{host} connected": "{host}",
    "saved {time}": "{time}",
    "connected as {account}": "{account}",
  };

  it.each(ADMIN_LOCALES)("%s translates every string the Static Site tab shows", (locale) => {
    for (const key of plain) {
      const value = t({ locale: locale, key: key });
      expect(value, `${locale}: ${key}`).not.toBe(key);
      expect(value.trim(), `${locale}: ${key}`).not.toBe("");
    }
  });

  it.each(ADMIN_LOCALES)("%s keeps each summary template's placeholder, so the host, time and account land where its grammar puts them", (locale) => {
    for (const [key, token] of Object.entries(templates)) {
      const value = t({ locale: locale, key: key });
      expect(value, `${locale}: ${key}`).not.toBe(key);
      expect(value, `${locale}: ${key}`).toContain(token);
    }
  });

  it("the connected line says 'as' once: '{host} connected' carries no 'as'", () => {
    expect(t({ locale: "es", key: "{host} connected" })).toBe("{host} conectado");
    expect(t({ locale: "es", key: "connected as {account}" })).toBe("conectado como {account}");
  });

  it("drops the generic project-name copy: every host names its own field or has none", () => {
    expect(t({ locale: "es", key: "The host finds or creates a project with this name on every publish." })).toBe(
      "The host finds or creates a project with this name on every publish."
    );
  });
});

describe("index-aligned translation rows", () => {
  // Each locale row is a list in the English keys' order; a row with a missing or extra entry would
  // shift every later string onto the wrong control, so it is refused at module load instead.
  it.each([
    ["audit", auditTranslationEntries, /^Deployment audit translation has 1 entries; expected \d+\.$/],
    ["candidate-gap", candidateGapTranslationEntries, /^Deployment candidate translation has 1 entries; expected \d+\.$/],
  ] as const)("rejects a %s row whose length does not match the keys", (_name, build, message) => {
    expect(() => build({ entries: ["only one"] })).toThrow(message);
  });

  it.each([
    ["audit", auditTranslationEntries],
    ["candidate-gap", candidateGapTranslationEntries],
  ] as const)("maps a complete %s row onto the English keys in order", (_name, build) => {
    // The key count is private to the module; the refusal message states it.
    const refusal = (() => {
      try {
        build({ entries: [] });
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    const size = Number(/expected (\d+)\./.exec(refusal)?.[1]);
    expect(size).toBeGreaterThan(0);
    const table = build({ entries: Array.from({ length: size }, (_, index) => `t${index}`) });
    expect(Object.values(table)).toEqual(Array.from({ length: size }, (_, index) => `t${index}`));
  });
});

it("substitutes the number of lines after the host's translator chooses the word order", () => {
  const translate = (key: string) => key === "{count} lines" ? "Zeilen: {count}" : key;
  expect(dockerfileLineCountLabel({ translate, count: 27 })).toBe("Zeilen: 27");
  expect(dockerfileLineCountLabel({ translate: (key) => key, count: 0 })).toBe("0 lines");
});
