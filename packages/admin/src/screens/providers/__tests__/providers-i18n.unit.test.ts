import { expect, it } from "vitest";
import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";
import { createProvidersDictionary } from "../providers-i18n.js";

it("keeps a complete nonblank Integrations dictionary and binds restart copy for every locale", () => {
  const productName = "Acme $& Console";
  const { t } = createProvidersDictionary({ commonDictionary: ADMIN_COMMON_I18N, productName });
  const restart = `Saved — restart ${productName} to connect`;
  const pending = `Changes apply when ${productName} restarts`;
  const keys = Object.keys(t.dictionary.es!).sort();
  expect(keys).toEqual(expect.arrayContaining(["Integrations", "Always allow", "Revoke", restart, pending]));
  expect(Object.keys(t.dictionary).sort()).toEqual(Object.keys(ADMIN_COMMON_I18N).sort());
  for (const [locale, entries] of Object.entries(t.dictionary)) {
    expect(Object.keys(entries).sort(), locale).toEqual(keys);
    for (const key of keys) {
      const value = entries[key]!;
      expect(value.trim(), `${locale}: ${key}`).toMatch(/\S/);
      expect(value.match(/\{\w+\}/g) ?? [], `${locale}: ${key}`).toEqual([]);
    }
    expect(t({ locale, key: restart }), locale).toContain(productName);
    expect(t({ locale, key: pending }), locale).toContain(productName);
  }
  expect(t({ locale: "es", key: restart })).toBe("Guardado — reinicia Acme $& Console para conectar");
  expect(t({ locale: "es", key: pending })).toBe("Los cambios se aplican al reiniciar Acme $& Console");
});

it("prefers provider copy over common copy and falls back to the host and source text on misses", () => {
  const { t } = createProvidersDictionary({ commonDictionary: { es: { Revoke: "common revoke", Save: "host save" } }, productName: "Acme" });
  expect(t({ locale: "es", key: "Revoke" })).toBe("Revocar");
  expect(t({ locale: "es", key: "Save" })).toBe("host save");
  expect(t({ locale: "unknown", key: "Always allow" })).toBe("Always allow");
});
