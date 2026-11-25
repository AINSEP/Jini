import { expect, it, vi } from "vitest";
import { renderBlock, type BlockRenderPorts } from "../blocks.js";
import type { SiteRenderContext } from "../../render-context.js";

it("dispatches declared regions without calling the doc renderer", () => {
  const ctx: SiteRenderContext = {
    siteTitle: "Site", route: "home", posts: [], products: [], themeName: null, widgetRegions: {}, widgetInlineResolved: new Map(),
    mediaTransformVersions: new Map(), mediaAssetMetadata: new Map(), assignedTerms: [],
  };
  const renderDocNode = vi.fn(() => "<doc/>");
  const renderWidgetRegion = vi.fn(({ regionKey }: { regionKey: string }) => `<region:${regionKey}>`);
  const ports: BlockRenderPorts = {
    renderHtmlPageBody: () => "", renderDocNode, renderWidgetRegion, entryList: () => "<list/>",
    componentFor: ({ id }) => (id === "known" ? ({ props }) => `<known ${JSON.stringify(props)}>` : undefined),
  };
  const node = { type: "doc", content: [{ type: "region", key: "footer" }, { type: "component", id: "known", props: { a: 1 } }, { type: "component", id: "<x>" }, { type: "slot", name: "entry-list" }, { type: "constructor" }, "text"] };
  const html = renderBlock({ node, ctx, ports });
  expect(renderWidgetRegion).toHaveBeenCalledWith({ ctx, regionKey: "footer" });
  expect(html).toBe('<region:footer><known {"a":1}><!-- unknown component: &lt;x&gt; --><list/><doc/>');
  expect(renderDocNode).toHaveBeenCalledTimes(1);
  expect(renderDocNode).toHaveBeenCalledWith({ node: { type: "constructor" } }, { inlineResolved: ctx.widgetInlineResolved, mediaTransformVersions: ctx.mediaTransformVersions, mediaAssetMetadata: ctx.mediaAssetMetadata });
});
