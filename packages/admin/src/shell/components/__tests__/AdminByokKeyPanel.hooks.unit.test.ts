import { describe, expect, it } from "vitest";
import { createAdminByokKeyPanelTranslator } from "../AdminByokKeyPanel.hooks.js";

describe("createAdminByokKeyPanelTranslator", () => {
  it("binds the translator to the locale it was created for", () => {
    const tEs = createAdminByokKeyPanelTranslator({ locale: "es" });
    const tEn = createAdminByokKeyPanelTranslator({ locale: "en" });
    expect(tEs({ key: "Preview" })).toBe("Vista previa");
    expect(tEs({ key: "Move up" })).toBe("Subir");
    expect(tEn({ key: "Preview" })).toBe("Preview");
  });

  it("renders the English source string for a key the dictionary does not carry", () => {
    const tEs = createAdminByokKeyPanelTranslator({ locale: "es" });
    expect(tEs({ key: "A sentence no dictionary carries" })).toBe("A sentence no dictionary carries");
  });
});
