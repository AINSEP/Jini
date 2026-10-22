import assert from "node:assert/strict";
import { test } from "vitest";
import { FormFieldValidationError } from "../../errors.js";
import { deriveHtmlForm } from "../html-authoring.js";

/** Golden outputs recorded from the pre-refactor deriveHtmlForm (2026-10-19). Comparing JSON text,
 * not deep equality, also pins descriptor key order: encodeFormFields stores these objects as JSON. */
const golden = {
  labelText: {
    html: '<label>Full <span>name</span><!-- note --><script>x</script><style>y</style><select></select><input name="n"></label>',
    expected: {"mode":"html","html":"<label>Full <span>name</span><!-- note --><script>x</script><style>y</style><select></select><input name=\"n\"></label>","fields":[{"id":"n","label":"Full name","type":"text","required":false}]},
  },
  legend: {
    html: '<fieldset><legend>Pick <b>one</b></legend><label>A<input type="radio" name="r" value="a"></label></fieldset>',
    expected: {"mode":"html","html":"<fieldset><legend>Pick <b>one</b></legend><label>A<input type=\"radio\" name=\"r\" value=\"a\"></label></fieldset>","fields":[{"id":"r","label":"Pick one","type":"radio","required":false,"options":[{"value":"a","label":"A"}]}]},
  },
  blankLegend: {
    html: '<fieldset><legend> </legend><input type="radio" name="r" value="a" aria-label="X"></fieldset>',
    expected: {"mode":"html","html":"<fieldset><legend> </legend><input type=\"radio\" name=\"r\" value=\"a\" aria-label=\"X\"></fieldset>","fields":[{"id":"r","label":"X","type":"radio","required":false,"options":[{"value":"a","label":"a"}]}]},
  },
  noLegend: {
    html: '<fieldset><div><input type="radio" name="r"></div></fieldset>',
    expected: {"mode":"html","html":"<fieldset><div><input type=\"radio\" name=\"r\"></div></fieldset>","fields":[{"id":"r","label":"r","type":"radio","required":false,"options":[{"value":"on","label":"on"}]}]},
  },
  adoptedRequired: {
    html: '<b required><p>x</b>y<input name="a" required="">',
    expected: {"mode":"html","html":"<b required></b><p><b required=\"\">x</b>y<input name=\"a\" required=\"\"></p>","fields":[{"id":"a","label":"a","type":"text","required":true}]},
  },
  unnamed: {
    html: '<input type="text"><input name="" type="text"><textarea></textarea>',
    expected: {"mode":"html","html":"<input type=\"text\"><input name=\"\" type=\"text\"><textarea></textarea>","fields":[]},
  },
  actions: {
    html: '<button name="b" formaction="/x" formmethod="get" formenctype="text/plain" formtarget="_blank" form="f">Go</button><button name="_hp">Hp</button><input type="SUBMIT" name="s"><input type="reset" name="r"><input type="button" name="bb"><input type="image" name="i"><div form="f">x</div>',
    expected: {"mode":"html","html":"<button>Go</button><button>Hp</button><input type=\"SUBMIT\"><input type=\"reset\"><input type=\"button\"><input type=\"image\"><div>x</div>","fields":[]},
  },
  checkboxGroup: {
    html: '<fieldset><legend>Toppings</legend><input type="checkbox" name="g"><label>B<input type="checkbox" name="g" value="b" required></label><input type="checkbox" name="g" value=""><label><input type="checkbox" name="g" value="c"></label></fieldset>',
    expected: {"mode":"html","html":"<fieldset><legend>Toppings</legend><input type=\"checkbox\" name=\"g\"><label>B<input type=\"checkbox\" name=\"g\" value=\"b\" required></label><input type=\"checkbox\" name=\"g\" value=\"\"><label><input type=\"checkbox\" name=\"g\" value=\"c\"></label></fieldset>","fields":[{"id":"g","label":"Toppings","type":"checkbox-group","required":true,"options":[{"value":"on","label":"g"},{"value":"b","label":"B"},{"value":"","label":""},{"value":"c","label":"c"}]}]},
  },
  checkboxNoLegend: {
    html: '<label>One<input type="checkbox" name="c" value="1"></label><label>Two<input type="checkbox" name="c" value="2"></label>',
    expected: {"mode":"html","html":"<label>One<input type=\"checkbox\" name=\"c\" value=\"1\"></label><label>Two<input type=\"checkbox\" name=\"c\" value=\"2\"></label>","fields":[{"id":"c","label":"One","type":"checkbox-group","required":false,"options":[{"value":"1","label":"One"},{"value":"2","label":"Two"}]}]},
  },
  radioGroup: {
    html: '<label>Yes<input type="radio" name="r" value="yes"></label><input type="radio" name="r" required><label><input type="radio" name="r" value="maybe"></label>',
    expected: {"mode":"html","html":"<label>Yes<input type=\"radio\" name=\"r\" value=\"yes\"></label><input type=\"radio\" name=\"r\" required><label><input type=\"radio\" name=\"r\" value=\"maybe\"></label>","fields":[{"id":"r","label":"Yes","type":"radio","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"on","label":"on"},{"value":"maybe","label":"maybe"}]}]},
  },
  controls: {
    html: '<textarea name="t" maxlength="50" minlength="2" placeholder="Say"></textarea><input type="checkbox" role="switch" name="sw" value="on"><select name="s"><option>Plain</option><option value="">Choose</option><option value="v">V</option></select><select name="m" multiple><option value="a">A</option></select>',
    expected: {"mode":"html","html":"<textarea name=\"t\" maxlength=\"50\" minlength=\"2\" placeholder=\"Say\"></textarea><input type=\"checkbox\" role=\"switch\" name=\"sw\" value=\"on\"><select name=\"s\"><option>Plain</option><option value=\"\">Choose</option><option value=\"v\">V</option></select><select name=\"m\" multiple=\"\"><option value=\"a\">A</option></select>","fields":[{"id":"t","label":"t","type":"textarea","required":false,"maxLength":50,"placeholder":"Say","minLength":2},{"id":"sw","label":"sw","type":"toggle","required":false},{"id":"s","label":"s","type":"select","required":false,"options":[{"value":"Plain","label":"Plain"},{"value":"v","label":"V"}]},{"id":"m","label":"m","type":"multi-select","required":false,"options":[{"value":"a","label":"A"}]}]},
  },
  types: {
    html: '<input name="u" inputmode="url"><input type="color" name="c"><input name="e" type="EMAIL"><input type="number" name="n" min="1" max="9" step="0.5"><input type="date" name="d" min="2026-01-01" max="2026-12-31"><input type="range" name="g" min="0" max="10"><input type="file" name="f" accept="image/*, .pdf"><input name="x" accept=".txt" pattern="[a-z]+">',
    expected: {"mode":"html","html":"<input name=\"u\" type=\"text\" inputmode=\"url\" autocomplete=\"url\" spellcheck=\"false\" autocapitalize=\"off\"><input type=\"color\" name=\"c\"><input name=\"e\" type=\"EMAIL\"><input type=\"number\" name=\"n\" min=\"1\" max=\"9\" step=\"0.5\"><input type=\"date\" name=\"d\" min=\"2026-01-01\" max=\"2026-12-31\"><input type=\"range\" name=\"g\" min=\"0\" max=\"10\"><input type=\"file\" name=\"f\" accept=\"image/*, .pdf\"><input name=\"x\" accept=\".txt\" pattern=\"[a-z]+\">","fields":[{"id":"u","label":"u","type":"url","required":false},{"id":"c","label":"c","type":"text","required":false},{"id":"e","label":"e","type":"email","required":false},{"id":"n","label":"n","type":"number","required":false,"min":1,"max":9,"step":0.5},{"id":"d","label":"d","type":"date","required":false,"min":"2026-01-01","max":"2026-12-31"},{"id":"g","label":"g","type":"range","required":false,"min":0,"max":10},{"id":"f","label":"f","type":"file","required":false,"accept":["image/*",".pdf"]},{"id":"x","label":"x","type":"text","required":false,"pattern":"[a-z]+"}]},
  },
  labels: {
    html: '<label for="a">Alpha</label><input id="a" name="a"><input id="b" name="b" aria-label="Beta"><label for="c"></label><input id="c" name="c"><input name="d"><label>  <input name="e" aria-label="ignored"></label>',
    expected: {"mode":"html","html":"<label for=\"a\">Alpha</label><input id=\"a\" name=\"a\"><input id=\"b\" name=\"b\" aria-label=\"Beta\"><label for=\"c\"></label><input id=\"c\" name=\"c\"><input name=\"d\"><label>  <input name=\"e\" aria-label=\"ignored\"></label>","fields":[{"id":"a","label":"Alpha","type":"text","required":false},{"id":"b","label":"Beta","type":"text","required":false},{"id":"c","label":"c","type":"text","required":false},{"id":"d","label":"d","type":"text","required":false},{"id":"e","label":"e","type":"text","required":false}]},
  },
  radioLabelFor: {
    html: '<label for="r1">First</label><input id="r1" type="radio" name="r" value="1"><input type="radio" name="q" value="9">',
    expected: {"mode":"html","html":"<label for=\"r1\">First</label><input id=\"r1\" type=\"radio\" name=\"r\" value=\"1\"><input type=\"radio\" name=\"q\" value=\"9\">","fields":[{"id":"r","label":"First","type":"radio","required":false,"options":[{"value":"1","label":"First"}]},{"id":"q","label":"q","type":"radio","required":false,"options":[{"value":"9","label":"9"}]}]},
  },
  blankRadioLabel: {
    html: '<label for="r1"> </label><input id="r1" type="radio" name="r" value="1">',
    expected: {"mode":"html","html":"<label for=\"r1\"> </label><input id=\"r1\" type=\"radio\" name=\"r\" value=\"1\">","fields":[{"id":"r","label":"r","type":"radio","required":false,"options":[{"value":"1","label":"r"}]}]},
  },
  outerForm: {
    html: '<form action="/x" method="get"><input name="a"></form>',
    expected: {"mode":"html","html":"<input name=\"a\">","fields":[{"id":"a","label":"a","type":"text","required":false}]},
  },
  templateForm: {
    html: '<template><form><input name="hidden"></form></template><input name="v">',
    expected: {"mode":"html","html":"<template><form><input name=\"hidden\"></form></template><input name=\"v\">","fields":[{"id":"v","label":"v","type":"text","required":false}]},
  },
} as const;

for (const [name, { html, expected }] of Object.entries(golden)) {
  test(`deriveHtmlForm golden output: ${name}`, () => {
    assert.equal(JSON.stringify(deriveHtmlForm({ html })), JSON.stringify(expected));
  });
}

test("deriveHtmlForm refuses markup that would create an ambiguous or unsafe column", () => {
  const refusals: Array<[string, string]> = [
    ['<input name="a"><input name="a">', "Duplicate field name 'a'"],
    ['<input type="radio" name="a"><input type="checkbox" name="a">', "Duplicate field name 'a'"],
    ['<input type="checkbox" name="a"><input type="radio" name="a">', "Duplicate field name 'a'"],
    ['<input type="radio" name="a"><input type="text" name="a">', "Duplicate field name 'a'"],
    ['<input type="submit" name="_hp">', "Reserved field name '_hp'"],
    ['<select name="constructor"></select>', "Reserved field name 'constructor'"],
    ['<input type="password" name="p">', "Password fields are not supported"],
    ["<form></form><form></form>", "Use a form body or one outer form wrapper"],
  ];
  for (const [html, message] of refusals) {
    assert.throws(() => deriveHtmlForm({ html }), (error: unknown) => error instanceof FormFieldValidationError && error.message === message, html);
  }
});

test("deriveHtmlForm accepts exactly 200000 characters and refuses longer or non-string input", () => {
  assert.deepEqual(deriveHtmlForm({ html: "x".repeat(200_000) }).fields, []);
  for (const html of ["x".repeat(200_001), 5 as unknown as string]) {
    assert.throws(() => deriveHtmlForm({ html }), /HTML must be a string of at most 200000 characters/);
  }
});
