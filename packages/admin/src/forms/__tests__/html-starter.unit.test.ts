// @vitest-environment node
import { FIELD_TYPE_REGISTRY } from "@jini-ai/cms/forms";
import { deriveHtmlForm } from "@jini-ai/cms/forms/html";
import { describe, expect, it } from "vitest";

import { formHtmlStarter } from "../html-rules.js";
import type { AdminFormField } from "../models.js";

/**
 * @file `formHtmlStarter` — the HTML a form seeds when it switches to HTML mode. It used to write
 * `<input type="${field.type}">` for every field, so a phone field became `type="phone"` (not an
 * HTML type: a plain text box) and a dropdown became `<input type="select">`; on save the CMS then
 * derived a text field from it and the field's type was lost. The starter now follows the registry,
 * and the CMS reads the same type back.
 */

const one = (type: string, extra: Partial<AdminFormField> = {}): AdminFormField => ({ id: "f", label: "Field", type, required: false, ...extra });
const options = [{ value: "a", label: "Apple" }, { value: "b", label: "Banana" }];
const starter = (field: AdminFormField) => formHtmlStarter({ fields: [field] }).split("\n\n<button")[0];

describe("formHtmlStarter", () => {
  it("round-trips a URL text control with URL keyboard hints and URL validation", () => {
    const html = formHtmlStarter({ fields: [one("url", { placeholder: "yoursite.com or @handle" })] });
    for (const attribute of ['type="text"', 'inputmode="url"', 'autocomplete="url"', 'spellcheck="false"', 'autocapitalize="off"']) expect(html).toContain(attribute);
    expect(html).not.toContain('type="url"');
    expect(deriveHtmlForm({ html }).fields[0]?.type).toBe("url");
  });

  it("keeps the original markup for a plain text-like field", () => {
    expect(formHtmlStarter({ fields: [{ id: "email", label: "Email", type: "email", required: true, maxLength: 120 }] }, { submitLabel: "Go" }))
      .toBe('<label>Email\n  <input type="email" name="email" required maxlength="120">\n</label>\n\n<button type="submit">Go</button>');
  });

  it("uses the registry's native input type, never the field type name", () => {
    expect(starter(one("phone"))).toContain('<input type="tel" name="f">');
    expect(starter(one("datetime"))).toContain('<input type="datetime-local" name="f">');
    expect(starter(one("range", { min: 0, max: 10, step: 2 }))).toContain('<input type="range" name="f" min="0" max="10" step="2">');
    expect(starter(one("file", { accept: ["image/*", "application/pdf"] }))).toContain('<input type="file" name="f" accept="image/*,application/pdf">');
    expect(starter(one("signature"))).toContain('<input type="text" name="f">');
  });

  it("writes a select with its options, an empty first choice for single select, and the default selected", () => {
    expect(starter(one("select", { options, default: "b", placeholder: "Pick" }))).toBe(
      '<label>Field\n  <select name="f">\n    <option value="">Pick</option>\n    <option value="a">Apple</option>\n    <option value="b" selected>Banana</option>\n  </select>\n</label>');
    expect(starter(one("multi-select", { options, default: ["a"] }))).toContain('<select name="f" multiple>\n    <option value="a" selected>Apple</option>');
  });

  it("writes radio and checkbox groups as a fieldset; only radios carry native required", () => {
    expect(starter(one("radio", { options, required: true, default: "a" }))).toBe(
      '<fieldset>\n  <legend>Field</legend>\n  <label><input type="radio" name="f" required value="a" checked> Apple</label>\n  <label><input type="radio" name="f" required value="b"> Banana</label>\n</fieldset>');
    expect(starter(one("checkbox-group", { options, required: true }))).not.toContain("required");
  });

  it("writes a toggle as a switch, a checkbox with its authored value, and a hidden value with its label", () => {
    expect(starter(one("toggle", { default: true }))).toBe('<label><input type="checkbox" role="switch" name="f" checked> Field</label>');
    expect(starter(one("checkbox", { checkboxValue: "yes", default: "yes" }))).toBe('<label><input type="checkbox" name="f" value="yes" checked> Field</label>');
    expect(starter(one("hidden", { default: "ad" }))).toBe('<input type="hidden" name="f" value="ad" aria-label="Field">');
  });

  it("escapes labels, option text and attribute values", () => {
    expect(starter(one("select", { label: "<b>", options: [{ value: '"x"', label: "<i>" }] }))).toContain('<option value="&quot;x&quot;">&lt;i&gt;</option>');
    expect(starter(one("text", { label: "<b>" }))).toContain("<label>&lt;b&gt;");
  });

  it("round-trips group labels separately from each radio and checkbox option label", () => {
    const fields: AdminFormField[] = [
      { id: "contact_method", type: "radio", label: "Contact method", required: false,
        options: [{ value: "email", label: "Email" }, { value: "phone", label: "Phone" }] },
      { id: "interests", type: "checkbox-group", label: "Interests", required: false,
        options: [{ value: "news", label: "News" }, { value: "events", label: "Events" }] },
    ];
    const derived = deriveHtmlForm({ html: formHtmlStarter({ fields }) }).fields;
    expect(derived).toHaveLength(2);
    expect(derived.map(({ id, type, label, options }) => ({ id, type, label, options })))
      .toEqual(fields.map(({ id, type, label, options }) => ({ id, type, label, options })));
  });

  it("round-trips every registry type through the CMS's own HTML derivation", () => {
    const fields: AdminFormField[] = Object.keys(FIELD_TYPE_REGISTRY).map((type) => ({
      id: type.replace(/-/g, "_"), label: `Label ${type}`, type, required: false,
      ...(FIELD_TYPE_REGISTRY[type as keyof typeof FIELD_TYPE_REGISTRY] as { choices?: boolean }).choices ? { options } : {},
    }));
    const derived = deriveHtmlForm({ html: formHtmlStarter({ fields }) }).fields;
    expect(derived.map((field) => [field.id, field.type])).toEqual(fields.map((field) => [field.id, field.type]));
    for (const field of derived.filter((item) => item.options)) expect(field.options, field.id).toEqual(options);
  });
});
