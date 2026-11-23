import { describe, expect, it } from "vitest";
import { t } from "../analytics-i18n.js";

// Author Checklist F3.4/F4.3/F6.2: identity translator fakes in Analytics tests cannot
// catch a dropped dictionary binding. These execute the real public translation surface.
describe("analytics screen translations", () => {
  it.each([
    ["Analytics", "Analítica"],
    ["The most recent pageviews and events captured on this site.", "Las vistas de página y eventos más recientes capturados en este sitio."],
    ["Each visit is listed on its own row, newest first. This is not a summary — there are no totals, trends, or breakdowns to compare traffic over time yet.", "Cada visita aparece en su propia fila, de la más reciente a la más antigua. Esto no es un resumen: todavía no hay totales, tendencias ni desgloses para comparar el tráfico a lo largo del tiempo."],
    ["No hits recorded yet.", "Aún no se han registrado visitas."],
    ["Once the site beacon starts sending traffic, recent hits will appear here.", "Una vez que el beacon del sitio empiece a enviar tráfico, las visitas recientes aparecerán aquí."],
    ["Path", "Ruta"],
    ["Referrer", "Referente"],
    ["(direct)", "(directo)"],
    ["Device / Browser", "Dispositivo / Navegador"],
    ["event:", "evento:"],
    ["Time", "Hora"],
    ["Loading recent hits…", "Cargando visitas recientes…"],
    ["Cookie Consent", "Consentimiento de cookies"],
  ])("translates Spanish analytics copy %s", (key, expected) => {
    expect(t({ locale: "es", key: key })).toBe(expected);
  });

  it("uses the locale on every call and retains the fallback chain", () => {
    expect(t({ locale: "de", key: "No hits recorded yet." })).toBe("Noch keine Treffer erfasst.");
    expect(t({ locale: "es", key: "No hits recorded yet." })).toBe("Aún no se han registrado visitas.");
    expect(t({ locale: "es", key: "Cancel" })).toBe("Cancelar");
    expect(t({ locale: "en", key: "Loading recent hits…" })).toBe("Loading recent hits…");
    expect(t({ locale: "unknown-locale", key: "Path" })).toBe("Path");
    expect(t({ locale: "es", key: "Unlisted analytics error" })).toBe("Unlisted analytics error");
  });
});
