import { expect, it } from "vitest";
import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";
import { createSkillInstallConfirmationTranslator } from "../SkillInstallConfirmation.hooks.js";
import { t } from "../skills-i18n.js";

it("looks up confirmation keys, then page keys, then the shared common words, then falls back to English", () => {
  // Confirmation copy wins over the page dictionary; page copy is merged underneath it.
  expect(t({ locale: "es", key: "Dismiss" })).toBe("Descartar");
  expect(t({ locale: "es", key: "Skills" })).toBe("Habilidades");
  // "Cancel" has no skills entry: it must come from the common dictionary, not stay English.
  const cancel = ADMIN_COMMON_I18N.es?.Cancel;
  expect(cancel).toBeTypeOf("string");
  expect(cancel).not.toBe("Cancel");
  expect(t({ locale: "es", key: "Cancel" })).toBe(cancel);
  expect(t({ locale: "es", key: "No such skills key" })).toBe("No such skills key");
  expect(t({ locale: "en", key: "Dismiss" })).toBe("Dismiss");
});

it("binds the install-confirmation translator to its locale", () => {
  expect(createSkillInstallConfirmationTranslator({ locale: "fr" })("Confirm install")).toBe("Confirmer l'installation");
  expect(createSkillInstallConfirmationTranslator({ locale: "en" })("Confirm install")).toBe("Confirm install");
});
