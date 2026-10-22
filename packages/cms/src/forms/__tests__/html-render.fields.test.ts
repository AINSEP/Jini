import assert from "node:assert/strict";
import { test } from "vitest";
import { renderHtmlForm, renderHtmlFormBody, type FormBodyOptions } from "../html-render.js";
import type { FieldDescriptor } from "../types.js";

const choices = [{ value: "a", label: "A & 1" }, { value: "b", label: "B" }];
const render = (field: FieldDescriptor, options: FormBodyOptions = {}): string =>
  renderHtmlFormBody({ fields: [field], hooks: { field: "data-f" } }, options).replace(/\n<button type="submit">Send<\/button>$/, "");

test("renderHtmlFormBody: a required radio group marks the fieldset, legend and every option required, checks the default and links help", () => {
  assert.equal(render({ id: "r", label: "Pick", type: "radio", required: true, options: choices, default: "b", helpText: "Help" }),
    "<fieldset id=\"form-r\" class=\"widget-form-field\" aria-describedby=\"form-r-help form-r-error\" aria-required=\"true\"><legend>Pick *</legend><label for=\"form-r-0\"><input id=\"form-r-0\" type=\"radio\" name=\"r\" data-f=\"r\" toolparamtitle=\"Pick\" toolparamdescription=\"Help\" aria-describedby=\"form-r-help form-r-error\" value=\"a\" required>A &amp; 1</label><label for=\"form-r-1\"><input id=\"form-r-1\" type=\"radio\" name=\"r\" data-f=\"r\" toolparamtitle=\"Pick\" toolparamdescription=\"Help\" aria-describedby=\"form-r-help form-r-error\" value=\"b\" checked required>B</label><div id=\"form-r-help\" class=\"widget-form-field-help\">Help</div><div class=\"widget-form-field-error\" data-field=\"r\" id=\"form-r-error\" hidden></div></fieldset>");
});

test("renderHtmlFormBody: an optional radio group has no required markers and no help slot", () => {
  assert.equal(render({ id: "r", label: "Pick", type: "radio", required: false, options: choices }),
    "<fieldset id=\"form-r\" class=\"widget-form-field\" aria-describedby=\"form-r-error\"><legend>Pick</legend><label for=\"form-r-0\"><input id=\"form-r-0\" type=\"radio\" name=\"r\" data-f=\"r\" toolparamtitle=\"Pick\" toolparamdescription=\"Pick\" aria-describedby=\"form-r-error\" value=\"a\">A &amp; 1</label><label for=\"form-r-1\"><input id=\"form-r-1\" type=\"radio\" name=\"r\" data-f=\"r\" toolparamtitle=\"Pick\" toolparamdescription=\"Pick\" aria-describedby=\"form-r-error\" value=\"b\">B</label><div class=\"widget-form-field-error\" data-field=\"r\" id=\"form-r-error\" hidden></div></fieldset>");
});

test("renderHtmlFormBody: a checkbox group never puts required on each box, checks array defaults and honours id/class options", () => {
  assert.equal(render({ id: "g", label: "Many", type: "checkbox-group", required: true, options: choices, default: ["a", "b"], className: "c" }, { idPrefix: "p", fieldClass: "fc", errorClass: "ec" }),
    "<fieldset id=\"p-g\" class=\"fc\" aria-describedby=\"p-g-error\" aria-required=\"true\"><legend>Many *</legend><label for=\"p-g-0\"><input id=\"p-g-0\" type=\"checkbox\" name=\"g\" data-f=\"g\" toolparamtitle=\"Many\" toolparamdescription=\"Many\" aria-describedby=\"p-g-error\" value=\"a\" checked class=\"c\">A &amp; 1</label><label for=\"p-g-1\"><input id=\"p-g-1\" type=\"checkbox\" name=\"g\" data-f=\"g\" toolparamtitle=\"Many\" toolparamdescription=\"Many\" aria-describedby=\"p-g-error\" value=\"b\" checked class=\"c\">B</label><div class=\"ec\" data-field=\"g\" id=\"p-g-error\" hidden></div></fieldset>");
});

test("renderHtmlFormBody: a group with no options renders an empty fieldset", () => {
  assert.equal(render({ id: "g", label: "Many", type: "checkbox-group", required: false }),
    "<fieldset id=\"form-g\" class=\"widget-form-field\" aria-describedby=\"form-g-error\"><legend>Many</legend><div class=\"widget-form-field-error\" data-field=\"g\" id=\"form-g-error\" hidden></div></fieldset>");
});

test("renderHtmlFormBody: a required select renders the authored placeholder option and selects the default", () => {
  assert.equal(render({ id: "s", label: "One", type: "select", required: true, options: choices, default: "a", placeholder: "Pick <one>" }),
    "<div class=\"widget-form-field\"><label for=\"form-s\">One *</label><select id=\"form-s\" name=\"s\" data-f=\"s\" toolparamtitle=\"One\" toolparamdescription=\"One\" aria-describedby=\"form-s-error\" required placeholder=\"Pick &lt;one&gt;\"><option value=\"\">Pick &lt;one&gt;</option><option value=\"a\" selected>A &amp; 1</option><option value=\"b\">B</option></select><div class=\"widget-form-field-error\" data-field=\"s\" id=\"form-s-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a select falls back to the 'Choose an option' placeholder", () => {
  assert.equal(render({ id: "s", label: "One", type: "select", required: false, options: choices }),
    "<div class=\"widget-form-field\"><label for=\"form-s\">One</label><select id=\"form-s\" name=\"s\" data-f=\"s\" toolparamtitle=\"One\" toolparamdescription=\"One\" aria-describedby=\"form-s-error\"><option value=\"\">Choose an option</option><option value=\"a\">A &amp; 1</option><option value=\"b\">B</option></select><div class=\"widget-form-field-error\" data-field=\"s\" id=\"form-s-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a select with no options renders only its placeholder", () => {
  assert.equal(render({ id: "s", label: "One", type: "select", required: false }),
    "<div class=\"widget-form-field\"><label for=\"form-s\">One</label><select id=\"form-s\" name=\"s\" data-f=\"s\" toolparamtitle=\"One\" toolparamdescription=\"One\" aria-describedby=\"form-s-error\"><option value=\"\">Choose an option</option></select><div class=\"widget-form-field-error\" data-field=\"s\" id=\"form-s-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a multi-select has no placeholder option and selects array defaults", () => {
  assert.equal(render({ id: "m", label: "Some", type: "multi-select", required: false, options: choices, default: ["b"] }),
    "<div class=\"widget-form-field\"><label for=\"form-m\">Some</label><select id=\"form-m\" name=\"m\" data-f=\"m\" toolparamtitle=\"Some\" toolparamdescription=\"Some\" aria-describedby=\"form-m-error\" multiple><option value=\"a\">A &amp; 1</option><option value=\"b\" selected>B</option></select><div class=\"widget-form-field-error\" data-field=\"m\" id=\"form-m-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a textarea escapes its default as content and carries length constraints", () => {
  assert.equal(render({ id: "t", label: "Msg", type: "textarea", required: true, default: "<hi>", minLength: 2, maxLength: 10 }),
    "<div class=\"widget-form-field\"><label for=\"form-t\">Msg *</label><textarea id=\"form-t\" name=\"t\" data-f=\"t\" toolparamtitle=\"Msg\" toolparamdescription=\"Msg\" aria-describedby=\"form-t-error\" required minlength=\"2\" maxlength=\"10\">&lt;hi&gt;</textarea><div class=\"widget-form-field-error\" data-field=\"t\" id=\"form-t-error\" hidden></div></div>");
});

test("renderHtmlFormBody: text inputs render valid constraints, then safe authored attributes that are not already claimed", () => {
  assert.equal(render({ id: "x", name: "x", label: "X", type: "text", required: false, placeholder: "ph", minLength: 0, maxLength: 5, pattern: "[a-z]+", attributes: { title: "t", "aria-describedby": "other", onclick: "bad", pattern: "[0-9]+", "data-x": "1" } }),
    "<div class=\"widget-form-field\"><label for=\"form-x\">X</label><input type=\"text\" id=\"form-x\" name=\"x\" data-f=\"x\" toolparamtitle=\"X\" toolparamdescription=\"X\" aria-describedby=\"form-x-error other\" placeholder=\"ph\" minlength=\"0\" maxlength=\"5\" pattern=\"[a-z]+\" title=\"t\" data-x=\"1\"><div class=\"widget-form-field-error\" data-field=\"x\" id=\"form-x-error\" hidden></div></div>");
});

test("renderHtmlFormBody: negative minlength, non-positive maxlength and unsafe patterns are dropped", () => {
  assert.equal(render({ id: "x", label: "X", type: "text", required: false, minLength: -1, maxLength: 0, pattern: "(a)", attributes: { pattern: "(b)", "data-ok": "y" } }),
    "<div class=\"widget-form-field\"><label for=\"form-x\">X</label><input type=\"text\" id=\"form-x\" name=\"x\" data-f=\"x\" toolparamtitle=\"X\" toolparamdescription=\"X\" aria-describedby=\"form-x-error\" data-ok=\"y\"><div class=\"widget-form-field-error\" data-field=\"x\" id=\"form-x-error\" hidden></div></div>");
});

test("renderHtmlFormBody: fractional minlength/maxlength are dropped", () => {
  assert.equal(render({ id: "x", label: "X", type: "text", required: false, minLength: 1.5, maxLength: 2.5 }),
    "<div class=\"widget-form-field\"><label for=\"form-x\">X</label><input type=\"text\" id=\"form-x\" name=\"x\" data-f=\"x\" toolparamtitle=\"X\" toolparamdescription=\"X\" aria-describedby=\"form-x-error\"><div class=\"widget-form-field-error\" data-field=\"x\" id=\"form-x-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a null maxLength renders nothing and a numeric default becomes the value", () => {
  assert.equal(render({ id: "x", label: "X", type: "text", required: false, maxLength: null, default: 7 }),
    "<div class=\"widget-form-field\"><label for=\"form-x\">X</label><input type=\"text\" id=\"form-x\" name=\"x\" data-f=\"x\" toolparamtitle=\"X\" toolparamdescription=\"X\" aria-describedby=\"form-x-error\" value=\"7\"><div class=\"widget-form-field-error\" data-field=\"x\" id=\"form-x-error\" hidden></div></div>");
});

test("renderHtmlFormBody: number inputs render min/max/step", () => {
  assert.equal(render({ id: "n", label: "N", type: "number", required: false, min: 0, max: "10", step: 2, default: 4 }),
    "<div class=\"widget-form-field\"><label for=\"form-n\">N</label><input type=\"number\" id=\"form-n\" name=\"n\" data-f=\"n\" toolparamtitle=\"N\" toolparamdescription=\"N\" aria-describedby=\"form-n-error\" value=\"4\" min=\"0\" max=\"10\" step=\"2\"><div class=\"widget-form-field-error\" data-field=\"n\" id=\"form-n-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a native checkbox with default true is checked", () => {
  assert.equal(render({ id: "c", label: "Agree", type: "checkbox", required: true, default: true }),
    "<div class=\"widget-form-field widget-form-field-checkbox\"><label for=\"form-c\">Agree *</label><input type=\"checkbox\" id=\"form-c\" name=\"c\" data-f=\"c\" toolparamtitle=\"Agree\" toolparamdescription=\"Agree\" aria-describedby=\"form-c-error\" required checked><div class=\"widget-form-field-error\" data-field=\"c\" id=\"form-c-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a native checkbox with default false is unchecked", () => {
  assert.equal(render({ id: "c", label: "Agree", type: "checkbox", required: false, default: false }),
    "<div class=\"widget-form-field widget-form-field-checkbox\"><label for=\"form-c\">Agree</label><input type=\"checkbox\" id=\"form-c\" name=\"c\" data-f=\"c\" toolparamtitle=\"Agree\" toolparamdescription=\"Agree\" aria-describedby=\"form-c-error\"><div class=\"widget-form-field-error\" data-field=\"c\" id=\"form-c-error\" hidden></div></div>");
});

test("renderHtmlFormBody: an authored checkbox value renders as value and is checked when it is the default", () => {
  assert.equal(render({ id: "c", label: "Agree", type: "checkbox", required: false, checkboxValue: "yes", default: "yes" }),
    "<div class=\"widget-form-field widget-form-field-checkbox\"><label for=\"form-c\">Agree</label><input type=\"checkbox\" id=\"form-c\" name=\"c\" data-f=\"c\" toolparamtitle=\"Agree\" toolparamdescription=\"Agree\" aria-describedby=\"form-c-error\" value=\"yes\" checked><div class=\"widget-form-field-error\" data-field=\"c\" id=\"form-c-error\" hidden></div></div>");
});

test("renderHtmlFormBody: an authored checkbox value without a matching default is unchecked", () => {
  assert.equal(render({ id: "c", label: "Agree", type: "checkbox", required: false, checkboxValue: "yes" }),
    "<div class=\"widget-form-field widget-form-field-checkbox\"><label for=\"form-c\">Agree</label><input type=\"checkbox\" id=\"form-c\" name=\"c\" data-f=\"c\" toolparamtitle=\"Agree\" toolparamdescription=\"Agree\" aria-describedby=\"form-c-error\" value=\"yes\"><div class=\"widget-form-field-error\" data-field=\"c\" id=\"form-c-error\" hidden></div></div>");
});

test("renderHtmlFormBody: an empty authored checkbox value still renders and checks", () => {
  assert.equal(render({ id: "c", label: "Agree", type: "checkbox", required: false, checkboxValue: "", default: "" }),
    "<div class=\"widget-form-field widget-form-field-checkbox\"><label for=\"form-c\">Agree</label><input type=\"checkbox\" id=\"form-c\" name=\"c\" data-f=\"c\" toolparamtitle=\"Agree\" toolparamdescription=\"Agree\" aria-describedby=\"form-c-error\" value=\"\" checked><div class=\"widget-form-field-error\" data-field=\"c\" id=\"form-c-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a toggle is a checkbox with the switch role", () => {
  assert.equal(render({ id: "t", label: "On", type: "toggle", required: false }),
    "<div class=\"widget-form-field widget-form-field-checkbox\"><label for=\"form-t\">On</label><input type=\"checkbox\" id=\"form-t\" name=\"t\" data-f=\"t\" toolparamtitle=\"On\" toolparamdescription=\"On\" aria-describedby=\"form-t-error\" role=\"switch\"><div class=\"widget-form-field-error\" data-field=\"t\" id=\"form-t-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a file input lists accepted types", () => {
  assert.equal(render({ id: "f", label: "File", type: "file", required: true, accept: ["image/png", "image/*"] }),
    "<div class=\"widget-form-field\"><label for=\"form-f\">File *</label><input type=\"file\" id=\"form-f\" name=\"f\" data-f=\"f\" toolparamtitle=\"File\" toolparamdescription=\"File\" aria-describedby=\"form-f-error\" required accept=\"image/png,image/*\"><div class=\"widget-form-field-error\" data-field=\"f\" id=\"form-f-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a file input without accept has no accept attribute", () => {
  assert.equal(render({ id: "f", label: "File", type: "file", required: false }),
    "<div class=\"widget-form-field\"><label for=\"form-f\">File</label><input type=\"file\" id=\"form-f\" name=\"f\" data-f=\"f\" toolparamtitle=\"File\" toolparamdescription=\"File\" aria-describedby=\"form-f-error\"><div class=\"widget-form-field-error\" data-field=\"f\" id=\"form-f-error\" hidden></div></div>");
});

test("renderHtmlFormBody: url inputs use registry attributes that override authored ones", () => {
  assert.equal(render({ id: "u", label: "Site", type: "url", required: false, attributes: { inputmode: "email" } }),
    "<div class=\"widget-form-field\"><label for=\"form-u\">Site</label><input type=\"text\" id=\"form-u\" name=\"u\" data-f=\"u\" toolparamtitle=\"Site\" toolparamdescription=\"Site\" aria-describedby=\"form-u-error\" inputmode=\"url\" autocomplete=\"url\" spellcheck=\"false\" autocapitalize=\"off\"><div class=\"widget-form-field-error\" data-field=\"u\" id=\"form-u-error\" hidden></div></div>");
});

test("renderHtmlFormBody: date inputs render a min bound", () => {
  assert.equal(render({ id: "d", label: "When", type: "date", required: false, min: "2026-01-01" }),
    "<div class=\"widget-form-field\"><label for=\"form-d\">When</label><input type=\"date\" id=\"form-d\" name=\"d\" data-f=\"d\" toolparamtitle=\"When\" toolparamdescription=\"When\" aria-describedby=\"form-d-error\" min=\"2026-01-01\"><div class=\"widget-form-field-error\" data-field=\"d\" id=\"form-d-error\" hidden></div></div>");
});

test("renderHtmlFormBody: a hidden input renders bare, but still points aria-describedby at unrendered help/error ids (reported, not fixed)", () => {
  assert.equal(render({ id: "h", label: "H", type: "hidden", required: false, default: "v", helpText: "ignored" }),
    "<input type=\"hidden\" id=\"form-h\" name=\"h\" data-f=\"h\" toolparamtitle=\"H\" toolparamdescription=\"ignored\" aria-describedby=\"form-h-help form-h-error\" value=\"v\">");
});

test("renderHtmlFormBody: descriptors that are not objects, lack a string id/label, or have an unregistered type render nothing", () => {
  const malformed: unknown[] = [null, { id: 1, label: "L", type: "text", required: false }, { id: "x", label: 2, type: "text", required: false }, { id: "x", label: "L", type: "password", required: false }, { id: "x", label: "L", type: "toString", required: false }];
  const fields: FieldDescriptor[] = JSON.parse(JSON.stringify(malformed));
  assert.equal(renderHtmlFormBody({ fields, hooks: { field: "data-f" } }), "\n\n\n\n\n<button type=\"submit\">Send</button>");
});

test("renderHtmlFormBody: the submit label is configurable and escaped", () => {
  assert.equal(renderHtmlFormBody({ fields: [], hooks: { field: "data-f" } }, { submitLabel: "Go <now>" }), "\n<button type=\"submit\">Go &lt;now&gt;</button>");
});

const formHooks = { field: "data-f", form: "data-form", success: "data-ok", error: "data-err" };
test("renderHtmlForm: authored html, success message, de-duplicated classes, file enctype and escaped slug/action", () => {
  assert.equal(renderHtmlForm({ slug: "a b<c>", fields: [{ id: "f", label: "F", type: "file", required: false }], action: "/x?a=1&b", hooks: formHooks }, { html: "<p>custom</p>", successMessage: "Done <ok>", className: "  one two one  " }),
    '<div data-ok data-form-slug="a b&lt;c&gt;" role="status" hidden>Done &lt;ok&gt;</div><form class="one two" data-form="a b&lt;c&gt;" data-form-slug="a b&lt;c&gt;" toolname="form_a_b_c_" tooldescription="a b&lt;c&gt;" method="post" enctype="multipart/form-data" action="/x?a=1&amp;b"><div data-err data-form-slug="a b&lt;c&gt;" role="alert" hidden></div><p>custom</p><div hidden aria-hidden="true"><input type="text" name="_hp" tabindex="-1" autocomplete="off"></div></form>');
});

test("renderHtmlForm: a blank className renders no class and the default success message is used", () => {
  assert.equal(renderHtmlForm({ slug: "s", fields: [], action: "/s", hooks: formHooks }, { className: "   " }),
    '<div data-ok data-form-slug="s" role="status" hidden>Thanks — your message has been sent.</div><form data-form="s" data-form-slug="s" toolname="form_s" tooldescription="s" method="post" action="/s"><div data-err data-form-slug="s" role="alert" hidden></div>\n<button type="submit">Send</button><div hidden aria-hidden="true"><input type="text" name="_hp" tabindex="-1" autocomplete="off"></div></form>');
});
