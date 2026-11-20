import assert from "node:assert/strict";
import { test } from "vitest";
import { applicableThemeTemplates, parseTemplateFor, type TemplateForIssue } from "../template-applicability.js";

const templates = ["post.html", "shared.html", "page.html", "both.html"];
const templateFor = { "post.html": ["post"], "page.html": ["page"], "both.html": ["post", "page"] } as const;
const onInvalid = ({ issue }: { issue: TemplateForIssue }): never => { throw issue; };

for (const [value, expected] of [
  [null, { kind: "invalid-map" }],
  [[], { kind: "invalid-map" }],
  ["post", { kind: "invalid-map" }],
  [{ "post.html": "post" }, { kind: "invalid-kinds", template: "post.html" }],
  [{ "post.html": [] }, { kind: "invalid-kinds", template: "post.html" }],
  [{ "post.html": ["product"] }, { kind: "invalid-kinds", template: "post.html" }],
  [{ "post.html": ["post", "post"] }, { kind: "invalid-kinds", template: "post.html" }],
  [{ "missing.html": ["page"] }, { kind: "undeclared-template", template: "missing.html" }],
] as const) {
  test(`parser rejects ${JSON.stringify(value)} through the issue port`, () => {
    const failure = new Error("invalid applicability");
    assert.throws(() => parseTemplateFor({ value, templates, onInvalid: ({ issue }) => {
      assert.deepEqual(issue, expected);
      throw failure;
    } }), error => error === failure);
  });
}

test("parser preserves undefined and declared mappings", () => {
  assert.equal(parseTemplateFor({ value: undefined, templates, onInvalid }), undefined);
  assert.deepEqual(parseTemplateFor({ value: templateFor, templates, onInvalid }), templateFor);
});

test("filtering preserves manifest order and shares omitted or dual-kind entries", () => {
  const manifest = { templates, templateFor };
  assert.deepEqual(applicableThemeTemplates({ manifest, kind: "post" }), ["post.html", "shared.html", "both.html"]);
  assert.deepEqual(applicableThemeTemplates({ manifest, kind: "page" }), ["shared.html", "page.html", "both.html"]);
  assert.deepEqual(applicableThemeTemplates({ manifest: { templates }, kind: "post" }), templates);
  assert.deepEqual(applicableThemeTemplates({ manifest: { templates }, kind: "page" }), templates);
  assert.deepEqual(applicableThemeTemplates({ manifest }), templates);
  assert.deepEqual(applicableThemeTemplates({}), []);
});

test("inherited object property names remain unlisted and apply to both kinds", () => {
  const manifest = { templates: ["constructor", "toString"], templateFor: {} };
  for (const kind of ["post", "page"] as const) {
    assert.deepEqual(applicableThemeTemplates({ manifest, kind }), manifest.templates);
  }
});

test("without declared templates an empty map parses and any named template is refused", () => {
  assert.deepEqual(parseTemplateFor({ value: {}, onInvalid }), {});
  assert.throws(() => parseTemplateFor({ value: { "landing.html": ["page"] }, onInvalid }), issue => {
    assert.deepEqual(issue, { kind: "undeclared-template", template: "landing.html" });
    return true;
  });
});
