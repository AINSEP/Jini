import { expect, it } from "vitest";
import { t } from "../settings-i18n.js";

it("translates settings load and save states and preserves the error banner fragments", () => {
  // Author Checklist F1.1/F2.4/F4.1/F6.2: literal Spanish oracle, real bound
  // dictionary. Reject an empty dictionary or binding the capabilities dictionary.
  expect(t({ locale: "es", key: "Loading settings…" })).toBe("Cargando configuración…");
  expect(t({ locale: "es", key: "Could not load saved settings (" }) + "HTTP 503" + t({ locale: "es", key: "). Showing defaults — edits will still save." })).toBe(
    "No se pudo cargar la configuración guardada (HTTP 503). Se muestran los valores predeterminados; las ediciones se seguirán guardando.",
  );
  expect(t({ locale: "es", key: "Saving…" })).toBe("Guardando…");
  expect(t({ locale: "es", key: "Saved" })).toBe("Guardado");
  expect(t({ locale: "es", key: "Skills" })).toBe("Habilidades");
  expect(t({ locale: "es", key: "Info" })).toBe("Información");
  expect(t({ locale: "unlisted-locale", key: "Loading settings…" })).toBe("Loading settings…");
  expect(t({ locale: "es", key: "future settings label" })).toBe("future settings label");
});
