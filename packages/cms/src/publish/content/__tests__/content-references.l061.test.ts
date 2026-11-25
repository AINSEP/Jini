import { expect, it } from "vitest";
import { collectBodyReferences, collectPlacementReferences } from "../content-references.js";

it("L061 body references preserve order, deduplication and ignored values", () => {
  expect(collectBodyReferences({ state: { bodyHtml: 1, termIds: "term", bodyJson: "invalid" } })).toStrictEqual([]);
  expect(collectBodyReferences({
                                           state: {
      bodyJson: { type: "doc", content: [
        { type: "image", attrs: { assetId: "m1" } },
        { type: "widgetEmbed", attrs: { widgetEntryId: "w1" } },
      ] },
      bodyHtml: `<div data-embed-config='{"type":"widget","id":"w1","slug":"ignored"}'></div><div data-embed-config='{"type":"WIDGET","slug":"w2"}'></div><div data-embed-config='{"type":"widget"}'></div><div data-embed-config='{"type":"post","id":"p1"}'></div>`,
      termIds: ["t1", null, 1, "", "t1", "t2"],
    }
                                         })).toStrictEqual([
    { entityType: "media", key: "m1" }, { entityType: "widget", key: "w1" },
    { entityType: "widget", key: "w2" }, { entityType: "term", key: "t1" }, { entityType: "term", key: "t2" },
  ]);
});

it("L061 placements keep disabled widget refs and authored media while ignoring non-objects", () => {
  expect(collectPlacementReferences({ state: { placements: "invalid" } })).toStrictEqual([]);
  expect(collectPlacementReferences({
                                                state: { placements: [null, 1, "placement", {
      placementId: "p1", widgetEntryId: "w1", enabled: false, content: { html: "/m/m1/original/file.png" },
    }, { placementId: "p2", widgetEntryId: "w1", content: { html: "/m/m1/original/file.png" } }, {}] }
                                              })).toStrictEqual([
    { entityType: "widget", key: "w1" }, { entityType: "media", key: "m1" },
  ]);
});
