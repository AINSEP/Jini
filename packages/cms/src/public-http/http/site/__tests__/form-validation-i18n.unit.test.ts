import assert from "node:assert/strict";
import { test } from "vitest";
import { FORM_VALIDATION_COPY, formValidationCopy } from "../form-validation-i18n.js";

/**
 * @file Locale resolution for public form validation copy: an exact (case-insensitive) table key,
 * the Chinese script split (Traditional for tw/hk/hant, Simplified otherwise), a bare `pt` mapping
 * to `pt-BR`, a regional tag falling back to its base language, and English for anything unknown.
 */

test("an exact table key resolves case-insensitively", () => {
  assert.equal(formValidationCopy({ locale: "pt-br" }), FORM_VALIDATION_COPY["pt-BR"]);
  assert.equal(formValidationCopy({ locale: "ZH-cn" }), FORM_VALIDATION_COPY["zh-CN"]);
  assert.equal(formValidationCopy({ locale: "de" }, {}), FORM_VALIDATION_COPY.de);
});

test("Chinese variants split by script: tw/hk/hant read Traditional, everything else Simplified", () => {
  for (const locale of ["zh-HK", "zh-Hant", "zh-hant-tw"]) assert.equal(formValidationCopy({ locale }), FORM_VALIDATION_COPY["zh-TW"], locale);
  for (const locale of ["zh", "zh-SG", "zh-Hans"]) assert.equal(formValidationCopy({ locale }), FORM_VALIDATION_COPY["zh-CN"], locale);
});

test("a regional tag falls back to its base language, bare pt to pt-BR, and an unknown language to English", () => {
  assert.equal(formValidationCopy({ locale: "fr-CA" }), FORM_VALIDATION_COPY.fr);
  assert.equal(formValidationCopy({ locale: "pt" }), FORM_VALIDATION_COPY["pt-BR"]);
  assert.equal(formValidationCopy({ locale: "pt-PT" }), FORM_VALIDATION_COPY["pt-BR"]);
  assert.equal(formValidationCopy({ locale: "xx-YY" }), FORM_VALIDATION_COPY.en);
  assert.deepEqual(formValidationCopy({ locale: "" }), ["Please enter {label}.", "Please select {label}.", "Please shorten {label}.", "Please check {label}.", "this field", "Please keep {label} to {max} characters or fewer."]);
});

test("every locale row carries four templates, a fallback field name, and the bounded-length template (d6d0618b0)", () => {
  for (const [locale, row] of Object.entries(FORM_VALIDATION_COPY)) {
    assert.equal(row.length, 6, locale);
    for (const template of row.slice(0, 4)) assert.ok(template.includes("{label}"), `${locale}: ${template}`);
    assert.ok(!row[4].includes("{label}"), locale);
    assert.ok(row[5].includes("{label}") && row[5].includes("{max}"), locale);
  }
});

test("translated copy preserves the source locale's exact placeholders and every phrase is nonempty", () => {
  const placeholders = (message: string) => (message.match(/\{[^{}]+\}/g) ?? []).sort();
  const fallback = formValidationCopy({ locale: "en" });
  for (const [locale, row] of Object.entries(FORM_VALIDATION_COPY)) {
    assert.deepEqual(row.map(placeholders), fallback.map(placeholders), locale);
    for (const phrase of row) assert.notEqual(phrase.trim(), "", locale);
  }
});

test("unknown locale names that match Object prototype keys still get the English validation copy", () => {
  for (const locale of ["constructor", "__proto__"]) {
    assert.deepEqual(formValidationCopy({ locale }), [
      "Please enter {label}.", "Please select {label}.", "Please shorten {label}.", "Please check {label}.",
      "this field", "Please keep {label} to {max} characters or fewer.",
    ]);
  }
});
