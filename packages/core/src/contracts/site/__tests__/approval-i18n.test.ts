import { expect, it } from "vitest";
import { APPROVAL_COPY, approvalText } from "../approval-i18n.js";

it("uses localized schema labels, English fallback and the original unknown key", () => {
  expect(approvalText({ locale: "es", key: "Target folder" })).toBe("Carpeta de destino");
  expect(approvalText({ locale: "missing", key: "Target folder" })).toBe("Target folder");
  expect(approvalText({ locale: "es", key: "unlisted label" })).toBe("unlisted label");
  expect(approvalText({ locale: "es", key: "Confirm" })).toBe("Confirmar");
  expect(approvalText({ locale: "es", key: "Publish" })).toBe("Publicar");
  expect(approvalText({ locale: "es", key: "Resume routine" })).toBe("Reanudar rutina");
  expect(approvalText({ locale: "constructor", key: "Confirm" })).toBe("Confirm");
});

it("falls back to English independently for chrome, an action, and a routine", () => {
  const locale = "xx";
  expect(approvalText({ locale, key: "Confirm" })).toBe("Confirm");
  expect(approvalText({ locale, key: "{action}?" })).toBe("{action}?");
  expect(approvalText({ locale, key: "Pause routine" })).toBe("Pause routine");
  expect(approvalText({ locale: "es", key: "Confirm" })).toBe("Confirmar");
  expect(approvalText({ locale: "es", key: "{action}?" })).toBe("¿{action}?");
  expect(approvalText({ locale: "es", key: "Pause routine" })).toBe("Pausar rutina");
});

it("provides each English chrome slot and keeps the action interpolator intact in every supported locale", () => {
  expect(APPROVAL_COPY.en).toStrictEqual(["Confirm action?", "Confirm", "Cancel", "Tool", "Input"]);
  for (const [locale, copy] of Object.entries(APPROVAL_COPY)) {
    expect(copy, locale).toHaveLength(APPROVAL_COPY.en.length);
    for (const [index, key] of APPROVAL_COPY.en.entries()) {
      expect(copy[index], locale).toMatch(/\S/u);
      expect(approvalText({ locale, key }), locale).toBe(copy[index]);
    }
    expect(approvalText({ locale, key: "{action}?" }).match(/\{[^}]+\}/gu), locale).toEqual(["{action}"]);
  }
});
