import assert from "node:assert/strict";
import { test } from "vitest";
import {
  FORM_SLUG_ATTR,
  FORM_SUCCESS_CLASS,
  formBaselineStyle,
  formRangeReadoutJs,
  formRangeReadoutScript,
  type FormPresentationNames,
} from "../form-presentation-assets.js";

/**
 * @file The generated CSS/JS carry exactly the host-injected names (the engine ships no product name).
 * The host's own test pins the full bytes for its production names.
 */

const names: FormPresentationNames = {
  formClass: "x-form",
  errorClass: "x-form-error",
  fieldClass: "x-field",
  fieldHelpClass: "x-field-help",
  fieldCheckboxClass: "x-field-checkbox",
  fieldErrorClass: "x-field-error",
  formAttr: "data-x-form",
  errorAttr: "data-x-form-error",
  rangeValueClass: "x-range-value",
  rangeMarkerAttr: "data-x-range",
  dangerFallbackProp: "--x-danger-fb",
  successFallbackProp: "--x-success-fb",
};

test("baseline style keys every rule on the injected names", () => {
  const css = formBaselineStyle({ names });
  assert.ok(css.startsWith("<style>:root{--x-danger-fb:#f87171;--x-success-fb:#4ade80;}"));
  assert.ok(css.endsWith("</style>"));
  assert.ok(css.includes(`:where(.x-form[hidden],[${FORM_SLUG_ATTR}][hidden]){display:none!important;}`));
  assert.ok(css.includes(":where([data-x-form] label:not([hidden]))"));
  assert.ok(css.includes(":where(.x-form-error,[data-x-form-error]){"));
  assert.ok(css.includes(`:where(.${FORM_SUCCESS_CLASS},[data-jini-form-success])`));
  assert.ok(css.includes("var(--danger,var(--x-danger-fb))") && css.includes("var(--success,var(--x-success-fb))"));
  assert.ok(css.includes(":where(.x-range-value){"));
});

test("range readout script wires sliders through the injected names", () => {
  const js = formRangeReadoutJs({ names });
  assert.ok(js.includes(".x-form input[type=range]:not([data-x-range]),[data-x-form] input[type=range]:not([data-x-range])"));
  assert.ok(js.includes("o.className='x-range-value'"));
  assert.equal(formRangeReadoutScript({ names }), `<script>${js}</script>`);
});

test("field classes come from the injected names, never a hardcoded legacy name", () => {
  const css = formBaselineStyle({ names });
  assert.ok(css.includes(":where(.x-field:not([hidden])){"));
  assert.ok(css.includes(":where(fieldset.x-field legend){"));
  assert.ok(css.includes(":where(.x-field input[role=switch]){"));
  assert.ok(css.includes(":where(.x-field-help){"));
  assert.ok(css.includes(":where(.x-field-checkbox .x-field-error){flex-basis:100%;}"));
  assert.ok(css.includes(":where(.x-field-error){color:var(--danger,var(--x-danger-fb));"));
  assert.doesNotMatch(css, /widget-form/);
});
