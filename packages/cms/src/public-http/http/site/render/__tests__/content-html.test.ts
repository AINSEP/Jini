import { expect, it, vi } from "vitest";
import { createContentHtmlRenderer } from "../content-html.js";
import type { DocNodeHost } from "../doc/doc-render-contract.js";
import type { WidgetRenderHost } from "../widgets/widget-render-contract.js";
import type { SiteRenderContext } from "../../render-context.js";

it("shares one injected widget renderer with doc nodes and returns an empty region unchanged", () => {
  const renderImageTag = vi.fn(() => "<host-image/>");
  const renderer = createContentHtmlRenderer({
    docHost: { attributes: {}, classes: {} } as DocNodeHost,
    widgetHost: { media: { media: { renderImageTag, mediaUrlKey: () => "asset", mediaPublicPath: () => "/m/asset", plausibleMediaRefId: () => "asset" }, noMarkerAttributes: [] } } as unknown as WidgetRenderHost,
    taxonomyAttributes: { section: "data-taxonomy", list: "data-list", term: "data-term", label: "data-label" },
    newMarkerToken: () => "TOKEN",
  });
  const ir = { componentId: "media-image", props: { assetId: "asset", transformName: "public", version: 1 } };
  expect(renderer.renderWidgetIr({ ir })).toBe("<host-image/>");
  expect(renderer.renderDocNode({ node: { type: "widgetEmbed", attrs: { placementId: "one" } } }, { inlineResolved: new Map([["one", ir]]) })).toBe("<host-image/>");
  expect(renderImageTag).toHaveBeenCalledTimes(2);
  expect(renderer.renderWidgetRegion({ ctx: { widgetRegions: {} } as SiteRenderContext, regionKey: "empty" })).toBe("");
  const placeholder = renderer.renderWidgetIr({ ir: { componentId: "widget-placeholder", props: {} } });
  for (const componentId of ["toString", "constructor", "__proto__"]) expect(renderer.renderWidgetIr({ ir: { componentId, props: {} } })).toBe(placeholder);
});
