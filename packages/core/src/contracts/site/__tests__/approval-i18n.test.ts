import { expect, it } from "vitest";
import { approvalText } from "../approval-i18n.js";

it("uses localized schema labels, English fallback and the original unknown key", () => {
  expect(approvalText({ locale: "es", key: "Target folder" })).toBe("Carpeta de destino");
  expect(approvalText({ locale: "missing", key: "Target folder" })).toBe("Target folder");
  expect(approvalText({ locale: "es", key: "unlisted label" })).toBe("unlisted label");
  expect(approvalText({ locale: "es", key: "Confirm" })).toBe("Confirmar");
  expect(approvalText({ locale: "es", key: "Publish" })).toBe("Publicar");
  expect(approvalText({ locale: "es", key: "Resume routine" })).toBe("Reanudar rutina");
  expect(approvalText({ locale: "constructor", key: "Confirm" })).toBe("Confirm");
});
