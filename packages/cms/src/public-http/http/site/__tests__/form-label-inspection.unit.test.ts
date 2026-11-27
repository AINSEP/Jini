import { expect, test } from "vitest";
import { inspectFormLabels } from "../form-label-inspection.js";

const FORM = `<form lang="de"><label for="e">E-Mail <b>Adresse</b></label><input id="e" name="email" type="email" maxlength="80">
<label>Nachricht <style>.x{}</style><textarea name="message">draft</textarea></label>
<input name="phone" aria-label="Telefon" id="p"><label for="p">ignored</label>
<script>var x = '<input name="ghost">';</script><template><input name="tpl"></template></form>`;

// Named mutations rejected: label[for] winning over aria-label, losing nested label text, treating
// script/template markup as controls, reading style or textarea text into a label, or dropping the
// form's lang. (Skipping script/template in `elements` is an equivalent mutant: parse5 keeps their
// content out of `childNodes`, so no control can come from there either way.)
test("labels resolve aria-label first, then label[for], then the wrapping label, with nested text", () => {
  const { formLocale, controls } = inspectFormLabels({ formHtml: FORM, fields: ["email", "message", "phone", "ghost", "tpl", "absent"] });
  expect(formLocale).toBe("de");
  expect(Object.fromEntries(controls)).toEqual({
    email: { label: "E-Mail Adresse", type: "email", maxLength: "80" },
    message: { label: "Nachricht ", type: undefined, maxLength: undefined },
    phone: { label: "Telefon", type: undefined, maxLength: undefined },
  });
});

test("markup without a form has no locale and an unlabelled control keeps an undefined label", () => {
  const { formLocale, controls } = inspectFormLabels({ formHtml: '<select name="pick"><option>A</option></select>', fields: ["pick"] });
  expect(formLocale).toBeUndefined();
  expect(controls.get("pick")).toEqual({ label: undefined, type: undefined, maxLength: undefined });
});

test("an unmatched explicit label falls back to nested wrapping text and empty aria is not an override", () => {
  const html = '<form><label for="different">Not used</label><label>Choose &amp; say <span><select id="topic" name="topic" aria-label=""><option>Internal option</option></select></span> today</label></form>';
  const result = inspectFormLabels({ formHtml: html, fields: ["topic"] });
  expect(result.formLocale).toBeUndefined();
  expect(Object.fromEntries(result.controls)).toEqual({ topic: { label: "Choose & say  today", type: undefined, maxLength: undefined } });
});
