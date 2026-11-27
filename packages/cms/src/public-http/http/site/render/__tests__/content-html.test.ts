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

it("renders region widgets in order, escaping the region key and text but retaining line breaks", () => {
  const renderer = createContentHtmlRenderer({
    docHost: {} as DocNodeHost,
    widgetHost: {} as WidgetRenderHost,
    taxonomyAttributes: { section: "data-taxonomy", list: "data-list", term: "data-term", label: "data-label" },
    newMarkerToken: () => { throw new Error("unexpected marker allocation"); },
  });
  const ctx: SiteRenderContext = {
    siteTitle: "Atlas", route: "home", posts: [], products: [], themeName: null, widgetInlineResolved: new Map(),
    mediaTransformVersions: new Map(), mediaAssetMetadata: new Map(), assignedTerms: [],
    widgetRegions: {
      'bottom"wide': [{ componentId: "text", props: { body: "One & two\nThree <four>" } }, { componentId: "text", props: { body: "Last" } }],
      other: [{ componentId: "text", props: { body: "Unrelated" } }],
    },
  };
  expect(renderer.renderWidgetRegion({ ctx, regionKey: 'bottom"wide' })).toBe(
    '<div class="widget-region widget-region--bottom&quot;wide"><div class="widget widget-text">One &amp; two<br/>Three &lt;four&gt;</div><div class="widget widget-text">Last</div></div>',
  );
});

it("converts managed document nodes to live Page markers while retaining ordinary text", () => {
  const newMarkerToken = vi.fn(() => "TOKEN");
  const renderer = createContentHtmlRenderer({
    docHost: {} as DocNodeHost,
    widgetHost: {} as WidgetRenderHost,
    taxonomyAttributes: { section: "data-taxonomy", list: "data-list", term: "data-term", label: "data-label" },
    newMarkerToken,
  });
  expect(renderer.renderDocBodyAsPageHtml({
    bodyJson: { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "A <live> embed" }] },
      { type: "widgetEmbed", attrs: { widgetEntryId: "widget-7", cssClass: "live-widget" } },
    ] },
  })).toBe('<p>A &lt;live&gt; embed</p><div class="live-widget" data-embed-config=\'{"type":"widget","id":"widget-7"}\'></div>');
  expect(newMarkerToken.mock.calls).toEqual([[{}]]);
});
