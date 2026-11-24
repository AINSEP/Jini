// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { actionsForRedirectLabel, createdLabel, deleteRedirectBody, failedItemLabel, importResultSummary, importRulesLabel, t } from "../redirects-i18n.js";

/** The ⓘ is the host kit's InfoTip; this kit renders it as the button the host's tip exposes. */
function render(ui: ReactElement) {
  return renderWithAdminKit(ui, { kit: fakeAdminKit({ components: { InfoTip: (p) => <button type="button" aria-label={p.label} /> } }) });
}

// Author Checklist F1.1/F4.3/F6.2: different created/failed numbers and literal
// translated/fallback output; no self-derived oracle or mocked subject.
it("binds the redirects dictionary and preserves untranslated labels", () => {
  expect(t({ locale: "es", key: "Bulk import" })).toBe("Importación masiva");
  expect(t({ locale: "es", key: "exact" })).toBe("exacta");
  expect(t({ locale: "es", key: "prefix" })).toBe("prefijo");
  expect(t({ locale: "es", key: "wildcard" })).toBe("comodín");
  expect(t({ locale: "unlisted-locale", key: "Bulk import" })).toBe("Bulk import");
  expect(t({ locale: "es", key: "unknown future redirect label" })).toBe("unknown future redirect label");
});

it.each([
  ["es", "17 creadas, 3 fallidas.", "Creada", "Elemento 9 (DUPLICATE)", 'Acciones para la regla de redirección desde "/old/<script>"'],
  ["unlisted-locale", "17 created, 3 failed.", "Created", "Item 9 (DUPLICATE)", 'Actions for redirect rule from "/old/<script>"'],
])("keeps counts, item codes and redirect identities in %s", (locale, summary, created, failed, actions) => {
  // Reject: swap created/failed interpolation or discard fromPattern.
  expect(importResultSummary({ locale: locale, created: 17, failed: 3 })).toBe(summary);
  expect(createdLabel({ locale: locale })).toBe(created);
  expect(failedItemLabel({ locale: locale, index: 9, code: "DUPLICATE" })).toBe(failed);
  expect(actionsForRedirectLabel({ locale: locale, fromPattern: "/old/<script>" })).toBe(actions);
});

it.each([
  ["es", "Pega un arreglo JSON de reglas, hasta 500.", "Campos: matchType, fromPattern, toTarget, statusCode. Opcionales: override, priority.", '¿Eliminar la regla de redirección desde "/old/<script>"?'],
  ["unlisted-locale", "Paste a JSON array of rules, up to 500.", "Fields: matchType, fromPattern, toTarget, statusCode. Optional: override, priority.", 'Delete the redirect rule from "/old/<script>"?'],
])("renders the one-line import hint with its fields tip, and treats the redirect pattern as text for %s", (locale, hint, fields, deletion) => {
  // Reject: inline the rule shape back into the hint, or render the pattern as HTML.
  const { container } = render(<>
    <label htmlFor="json">{importRulesLabel({ locale: locale }, { _shapeCode: <code>SHAPE</code> })}</label>
    <textarea id="json" />
    {deleteRedirectBody({ locale: locale, fromPattern: "/old/<script>" })}
  </>);
  const label = container.querySelector("label")!;
  expect(label.firstChild?.textContent).toBe(hint);
  expect(label.querySelector("code")).toBeNull();
  const tip = screen.getByRole("button", { name: fields });
  // A tap on the ⓘ must not also activate the label (focusing the textarea closes the tip).
  expect(fireEvent.click(tip)).toBe(false);
  expect(document.activeElement).not.toBe(container.querySelector("textarea"));
  expect(container.querySelector("p")?.textContent).toBe(deletion);
  expect(container.querySelector("script")).toBeNull();
});

it("translates Jini's wildcard-capacity notice and keeps the English source as the fallback", () => {
  // Reject: drop the overlay (the notice falls back to English in every locale).
  const notice = "Only the first 500 active wildcard redirects are used. Turn off or merge some.";
  expect(t({ locale: "es", key: notice })).toBe("Solo se usan las primeras 500 redirecciones comodín activas. Desactiva o combina algunas.");
  expect(t({ locale: "zh-TW", key: notice })).toBe("僅使用前 500 條啟用的萬用字元重新導向。請停用或合併部分重新導向。");
  expect(t({ locale: "unlisted-locale", key: notice })).toBe(notice);
});

// The dictionary is split across locale modules (file-size limit); every locale must still resolve.
const LOCALES = ["es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko", "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn"];
it.each(LOCALES)("translates the screen copy and its overlays in %s", (locale) => {
  // Reject: drop a locale module from the merge (that locale falls back to English).
  for (const key of ["Delete redirect rule?", "Loading redirects…", "wildcard", "Only the first 500 active wildcard redirects are used. Turn off or merge some."]) {
    expect(t({ locale, key }), key).not.toBe(key);
  }
});
