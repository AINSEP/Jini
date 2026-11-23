import { expect, it } from "vitest";

import { initialPlacementDraft, placementContentAttr } from "../widget-embed-placement-content.js";

/**
 * @file The per-placement content override draft: an existing override is edited as-is, otherwise
 * the widget's saved config seeds a non-custom draft; Save writes the override or `null`.
 */

it("edits an existing override as-is", () => {
  const attrsContent = { items: ["a"] };
  expect(initialPlacementDraft({ attrsContent, widgetConfig: { items: ["b"] } })).toEqual({ custom: true, content: attrsContent });
});

it("seeds a non-custom draft from a copy of the widget's saved config", () => {
  const widgetConfig = { items: ["b"] };
  const draft = initialPlacementDraft({ attrsContent: null, widgetConfig });
  expect(draft).toEqual({ custom: false, content: { items: ["b"] } });
  expect(draft.content).not.toBe(widgetConfig);
});

it.each([
  ["no saved config", undefined],
  ["a non-object config", "legacy"],
  ["an array config", [1, 2]],
  ["a null config", null],
])("starts from an empty draft for %s, and never treats an array override as one", (_label, widgetConfig) => {
  expect(initialPlacementDraft({ attrsContent: ["not", "an", "override"], widgetConfig })).toEqual({ custom: false, content: {} });
});

it("writes the override on Save only when the draft is custom", () => {
  expect(placementContentAttr({ draft: { custom: true, content: { items: ["a"] } } })).toEqual({ items: ["a"] });
  expect(placementContentAttr({ draft: { custom: false, content: { items: ["a"] } } })).toBeNull();
});
