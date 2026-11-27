import { expect, it } from "vitest";
import { editorTemplateOptions } from "../editor-template-options.rules.js";

it("keeps the first theme default ahead of a retired saved template without changing the theme list", () => {
  const templates = ["landing", "article"];
  expect(editorTemplateOptions({ templates, savedTemplate: "retired" })).toEqual(["landing", "article", "retired"]);
  expect(templates).toEqual(["landing", "article"]);
});

it.each([["existing", "article"], ["unset", null], ["omitted", undefined], ["blank", ""]] as const)(
  "does not append an extra choice when the saved template is %s", (_label, savedTemplate) => {
    expect(editorTemplateOptions({ templates: ["landing", "article"], savedTemplate })).toEqual(["landing", "article"]);
  },
);
