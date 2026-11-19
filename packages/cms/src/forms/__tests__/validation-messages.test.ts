import assert from "node:assert/strict";
import { test } from "vitest";
import { formDocumentLocale, formValidationMessages, type FormValidationCopy } from "../validation-messages.js";

const EN: FormValidationCopy = ["Please enter {label}.", "Please select {label}.", "Please shorten {label}.", "Please check {label}.", "this field", "Please keep {label} to {max} characters or fewer."];
const FR: FormValidationCopy = ["Veuillez renseigner {label}.", "Veuillez sélectionner {label}.", "Veuillez raccourcir {label}.", "Veuillez vérifier {label}.", "ce champ", "Veuillez raccourcir {label} à {max} caractères maximum."];
const normalizeLabel = ({ label }: { label: string }) => label.toLowerCase() === "email" ? "your email" : /^Your\s/.test(label) ? "your" + label.slice(4) : label;
const resolveCopy = ({ locale }: { locale: string }) => locale === "fr" ? { copy: FR } : { copy: EN, normalizeLabel };

test("the inspector is called once with error fields and results preserve error order", () => {
  const calls: unknown[] = [];
  assert.deepEqual(formValidationMessages({ formHtml: "<form>source</form>",
    errors: [{ field: "b", reason: "too_long" }, { field: "a", reason: "required" }], locale: "en", resolveCopy,
    inspect: (input) => { calls.push(input); return { controls: new Map([["a", { label: "Alpha" }], ["b", { label: "Beta" }]]) }; },
  }), [{ field: "b", message: "Please shorten Beta." }, { field: "a", message: "Please enter Alpha." }]);
  assert.deepEqual(calls, [{ formHtml: "<form>source</form>", fields: ["b", "a"] }]);
});

test("empty errors still inspect once and produce no messages", () => {
  const calls: unknown[] = [];
  assert.deepEqual(formValidationMessages({ formHtml: "<form></form>", errors: [], locale: "en", resolveCopy,
    inspect: (input) => { calls.push(input); return { controls: new Map() }; },
  }), []);
  assert.deepEqual(calls, [{ formHtml: "<form></form>", fields: [] }]);
});

test("reason selection preserves checkbox semantics, numeric caps and fallback templates", () => {
  const controls = new Map<string, { label?: string; type?: string; maxLength?: string }>([
    ["text", { label: "Topic" }], ["checkbox", { label: "Terms", type: "CheckBox" }],
    ["capped", { label: "Message", maxLength: "2000" }], ["invalidCap", { label: "Topic", maxLength: "8px" }],
  ]);
  assert.deepEqual(formValidationMessages({ formHtml: "ignored", locale: "en", resolveCopy, inspect: () => ({ controls }), errors: [
    { field: "text", reason: "required" }, { field: "text", reason: "too_long" }, { field: "text", reason: "invalid_email" },
    { field: "checkbox", reason: "required" }, { field: "checkbox", reason: "invalid" },
    { field: "capped", reason: "too_long" }, { field: "invalidCap", reason: "too_long" },
  ] }), [
    { field: "text", message: "Please enter Topic." }, { field: "text", message: "Please shorten Topic." },
    { field: "text", message: "Please check Topic." }, { field: "checkbox", message: "Please select Terms." },
    { field: "checkbox", message: "Please check Terms." }, { field: "capped", message: "Please keep Message to 2000 characters or fewer." },
    { field: "invalidCap", message: "Please shorten Topic." },
  ]);
});

test("form locale beats document locale, while an empty form locale falls back", () => {
  const locales: string[] = [];
  for (const [formLocale, expected] of [["fr", "Veuillez raccourcir Nom à 100 caractères maximum."], ["", "Please keep Nom to 100 characters or fewer."]] as const) {
    assert.deepEqual(formValidationMessages({ formHtml: "ignored", locale: "en", errors: [{ field: "f", reason: "too_long" }],
      inspect: () => ({ formLocale, controls: new Map([["f", { label: "Nom", maxLength: "100" }]]) }),
      resolveCopy: ({ locale }) => { locales.push(locale); return resolveCopy({ locale }); },
    }), [{ field: "f", message: expected }]);
  }
  assert.deepEqual(locales, ["fr", "en"]);
});

test("labels trim whitespace and one trailing star, with a localized fallback noun", () => {
  const controls = new Map([["star", { label: "  Full name & title *  " }], ["empty", { label: " * " }], ["blank", { label: "" }]]);
  assert.deepEqual(formValidationMessages({ formHtml: "ignored", locale: "fr", resolveCopy, inspect: () => ({ controls }),
    errors: ["star", "empty", "blank", "absent"].map((field) => ({ field, reason: "required" })),
  }), [
    { field: "star", message: "Veuillez renseigner Full name & title." },
    { field: "empty", message: "Veuillez renseigner ce champ." }, { field: "blank", message: "Veuillez renseigner ce champ." },
    { field: "absent", message: "Veuillez renseigner ce champ." },
  ]);
});

test("normalization is host-selected, including a fallback locale that selects English", () => {
  for (const [locale, expected] of [["en", "Please enter your email."], ["xx", "Please enter your email."], ["fr", "Veuillez renseigner EMAIL."]] as const) {
    assert.deepEqual(formValidationMessages({ formHtml: "ignored", errors: [{ field: "f", reason: "required" }], locale, resolveCopy,
      inspect: () => ({ controls: new Map([["f", { label: " EMAIL * " }]]) }),
    }), [{ field: "f", message: expected }]);
  }
  assert.deepEqual(formValidationMessages({ formHtml: "ignored", locale: "en", resolveCopy, errors: [{ field: "f", reason: "required" }],
    inspect: () => ({ controls: new Map([["f", { label: "Your full name *" }]]) }),
  }), [{ field: "f", message: "Please enter your full name." }]);
});

test("labels are substituted literally without dollar replacement expansion", () => {
  assert.deepEqual(formValidationMessages({ formHtml: "ignored", locale: "en", resolveCopy, errors: [{ field: "f", reason: "required" }],
    inspect: () => ({ controls: new Map([["f", { label: "Price $& $1 $$" }]]) }),
  }), [{ field: "f", message: "Please enter Price $& $1 $$." }]);
});

test("document locale handles every quoting shape and defaults to en", () => {
  for (const [html, expected] of [
    ['<!doctype html><html class="a" lang="pt-BR"><body>', "pt-BR"], ["<html lang='es'>", "es"], ["<HTML data-x=1 LANG = ja>", "ja"],
    ['<html lang="">', "en"], ['<html><body lang="de">', "en"], ['<htmlx lang="de">', "en"], ["", "en"],
  ]) assert.equal(formDocumentLocale({ html: html! }), expected);
});
