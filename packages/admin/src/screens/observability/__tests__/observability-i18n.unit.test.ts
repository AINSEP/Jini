import { expect, it } from "vitest";
import { t } from "../observability-i18n.js";

// F4.3: translated strings differ from English; these are examples, not a completeness claim.
it("binds the observability dictionary for enabled, disabled and failed status", () => {
  // Regression target: bind an empty dictionary, or route every lookup to English.
  expect(t({ locale: "es", key: "OpenTelemetry is ON — traces are being recorded." })).toBe("OpenTelemetry está ACTIVADO — se están registrando trazas.");
  expect(t({ locale: "es", key: "OpenTelemetry is OFF (the default) — nothing is being recorded." })).toBe("OpenTelemetry está DESACTIVADO (el valor predeterminado) — no se está registrando nada.");
  expect(t({ locale: "es", key: "failed to load observability status" })).toBe("no se pudo cargar el estado de observabilidad");
  expect(t({ locale: "de", key: "Checking current status…" })).toBe("Aktueller Status wird geprüft…");
});

it("inherits common copy and falls back to the source key for unknown locales and keys", () => {
  // Regression target: return undefined on a miss, or omit the common-copy fallback.
  expect(t({ locale: "es", key: "Save" })).toBe("Guardar");
  expect(t({ locale: "en", key: "Observability Overview" })).toBe("Observability Overview");
  expect(t({ locale: "unknown", key: "Observability Overview" })).toBe("Observability Overview");
  expect(t({ locale: "es", key: "new observability message" })).toBe("new observability message");
});

it("translates the Recent errors row controls", () => {
  // Regression target: add the Copy/Copied keys to English only, leaving other locales on the English fallback.
  expect(t({ locale: "es", key: "Copy" })).toBe("Copiar");
  expect(t({ locale: "de", key: "Copied" })).toBe("Kopiert");
  expect(t({ locale: "ja", key: "First seen" })).toBe("初回発生");
});


it("translates metric receipts in every supported observability locale", () => {
  for (const locale of ["es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko", "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn"]) {
    expect(t({ locale, key: "metric" })).not.toBe("metric");
  }
  expect(t({ locale: "en", key: "metric" })).toBe("metric");
  expect(t({ locale: "es", key: "metric" })).toBe("métrica");
  expect(t({ locale: "ja", key: "metric" })).toBe("メトリクス");
});
