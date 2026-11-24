import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { providerBackendNote, t } from "../authentication-i18n.js";
import { createAuthenticationTranslator } from "../Authentication.hooks.js";

const ES_NOTE = "Aún no está conectado a un backend de autenticación de proveedor. Estos campos obligatorios se muestran para planificar la configuración; Acme no puede guardar credenciales ni habilitar el inicio de sesión con {provider} desde esta pantalla hoy.";
const EN_NOTE = "Not connected to a provider authentication backend yet. These required fields are shown for setup planning; Acme cannot save credentials or enable {provider} sign-in from this screen today.";
const HOME_KEY = "{product} currently signs administrators in with a local username and password. A provider authentication backend, secure provider-credential storage contract, callback handling, and token lifecycle are not implemented yet.";

// Author Checklist F4.3/F6.2/F7.5: real interpolation, non-default locales/providers,
// independent literal notes, no mock, persistence, timer or shared mutable state.
describe("provider backend note", () => {
  // Dropping interpolation, using English unconditionally, or reusing the previous provider fails.
  it("interpolates a provider into the Spanish note on each call", () => {
    expect(providerBackendNote({ locale: "es", provider: "Google", product: "Acme" })).toBe(ES_NOTE.replace("{provider}", "Google"));
    expect(providerBackendNote({ locale: "es", provider: "LinkedIn", product: "Acme" })).toBe(ES_NOTE.replace("{provider}", "LinkedIn"));
  });

  it.each(["en", "unsupported-locale", ""])("uses the English template for locale %j", (locale) => {
    expect(providerBackendNote({ locale, provider: "Facebook", product: "Acme" })).toBe(EN_NOTE.replace("{provider}", "Facebook"));
  });

  // BUG: inherited object properties are not locale templates. The same unknown-locale fallback
  // must work for these names rather than passing a function/object to template.replace (F4.4).
  it.each(["constructor", "toString", "__proto__"])("falls back safely for inherited locale name %s", (locale) => {
    expect(providerBackendNote({ locale, provider: "Google", product: "Acme" })).toBe(EN_NOTE.replace("{provider}", "Google"));
  });

  it("resolves field copy and preserves unlisted provider-specific text", () => {
    expect(t({ locale: "es", key: "Client secret" })).toBe("Secreto de cliente");
    expect(t({ locale: "es", key: "required" })).toBe("obligatorio");
    expect(t({ locale: "unsupported-locale", key: "Required credentials" })).toBe("Required credentials");
    expect(t({ locale: "es", key: "Unlisted setup hint" })).toBe("Unlisted setup hint");
  });
});

// K3: the product name is host copy. It arrives through the existing args objects and lands where
// the host's own name used to be hard-coded, in every locale.
describe("host product name", () => {
  it("fills the product into the home-panel copy for English and a translated locale", () => {
    expect(createAuthenticationTranslator({ locale: "en", productName: "Acme" })(HOME_KEY)).toBe(HOME_KEY.replace("{product}", "Acme"));
    const es = createAuthenticationTranslator({ locale: "es", productName: "Acme" })(HOME_KEY);
    expect(es).toMatch(/^Acme /);
    expect(es).not.toContain("{product}");
  });

  it("fills the product into every locale's backend note", () => {
    for (const locale of ["en", "es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko", "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn"]) {
      const note = providerBackendNote({ locale, provider: "Google", product: "Acme" });
      expect(note, locale).toContain("Acme");
      expect(note, locale).not.toContain("{product}");
    }
  });

  it("keeps no product literal in this feature's source", () => {
    const root = join(__dirname, "..");
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? (name === "__tests__" ? [] : files(path)) : [path];
    });
    for (const file of files(root)) expect(readFileSync(file, "utf8"), file).not.toMatch(/Tovu/);
  });
});
