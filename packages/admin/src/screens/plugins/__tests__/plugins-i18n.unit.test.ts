import { describe, expect, it } from "vitest";
import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";
import { createPluginsDictionary, PLUGINS_DICT_TEMPLATE } from "../plugins-i18n.js";

const SLOT = "{productName}";
const NAMED = "Zorbex";
const { t: translate } = createPluginsDictionary({ commonDictionary: ADMIN_COMMON_I18N, productName: NAMED });
const t = translate;

describe("createPluginsDictionary: plugin copy and common fallback", () => {
  it("binds plugin actions and package-viewer copy to the requested locale", () => {
    // F4.3 regression target: bind an empty dictionary, or swap Enable and Disable entries.
    expect(t({ locale: "es", key: "Enable" })).toBe("Activar");
    expect(t({ locale: "es", key: "Disable" })).toBe("Desactivar");
    expect(t({ locale: "es", key: "Move to trash" })).toBe("Mover a la papelera");
    expect(t({ locale: "es", key: "Inspect package files" })).toBe("Inspeccionar los archivos del paquete");
    expect(t({ locale: "bn", key: "Wrap: off" })).toBe("র‍্যাপ: বন্ধ");
  });

  it("inherits common copy and uses English keys for absent translations", () => {
    // Regression target: return undefined on a miss, or omit the common-copy fallback.
    expect(t({ locale: "es", key: "Save" })).toBe("Guardar");
    expect(t({ locale: "en", key: "Inspect package files" })).toBe("Inspect package files");
    expect(t({ locale: "unknown", key: "Inspect package files" })).toBe("Inspect package files");
    expect(t({ locale: "es", key: "new plugin message" })).toBe("new plugin message");
  });
});

describe("createPluginsDictionary: the host's product name", () => {
  const slotEntries = Object.entries(PLUGINS_DICT_TEMPLATE).flatMap(([locale, entries]) =>
    Object.entries(entries).filter(([key, value]) => key.includes(SLOT) || value.includes(SLOT)).map(([key, value]) => ({ locale, key, value })));

  it("the data names the product in every locale, so the sweep below is not vacuous", () => {
    expect(slotEntries.length).toBeGreaterThan(300);
    expect(new Set(slotEntries.map((e) => e.locale))).toEqual(new Set(Object.keys(PLUGINS_DICT_TEMPLATE)));
  });

  it("renders the injected name wherever the copy names the product, in every locale", () => {
    // Mutation `plugins-dictionary-hardcodes-product`: a dictionary that keeps one fixed brand name,
    // or leaves the slot unfilled, fails here for every entry.
    for (const { locale, key, value } of slotEntries) {
      const filledKey = key.split(SLOT).join(NAMED);
      const rendered = translate({ locale, key: filledKey });
      expect(rendered).toBe(value.split(SLOT).join(NAMED));
      expect(rendered).not.toContain(SLOT);
      if (value.includes(SLOT)) expect(rendered).toContain(NAMED);
    }
  });

  it("a different name changes the sentence and the key it is looked up by", () => {
    const { t: other } = createPluginsDictionary({ commonDictionary: ADMIN_COMMON_I18N, productName: "Quux" });
    expect(translate({ locale: "es", key: `Not for this ${NAMED} version` })).toBe(`No es para esta versión de ${NAMED}`);
    expect(other({ locale: "es", key: "Not for this Quux version" })).toBe("No es para esta versión de Quux");
    // The first host's key is only a source string for the second, so it falls through untranslated.
    expect(other({ locale: "es", key: `Not for this ${NAMED} version` })).toBe(`Not for this ${NAMED} version`);
  });

  it("leaves the other placeholders for the caller to fill", () => {
    expect(t({ locale: "es", key: "{name} settings" })).toBe("Ajustes de {name}");
  });

  it("does not treat a name containing replacement patterns as one", () => {
    const { t: odd } = createPluginsDictionary({ commonDictionary: {}, productName: "A$&B$1" });
    expect(odd({ locale: "es", key: "Not for this A$&B$1 version" })).toBe("No es para esta versión de A$&B$1");
  });
});
