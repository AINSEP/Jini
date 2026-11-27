import { expect, it, vi } from "vitest";
import { renderBlock, renderBlockSeam, type BlockRenderPorts } from "../blocks.js";
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

it("prioritizes an explicit region and strips selector props before invoking a component", () => {
  const ctx: SiteRenderContext = {
    siteTitle: "Atlas", route: "home", posts: [], products: [], themeName: null, widgetRegions: {},
    widgetInlineResolved: new Map(), mediaTransformVersions: new Map(), mediaAssetMetadata: new Map(), assignedTerms: [],
  };
  const renderWidgetRegion = vi.fn<BlockRenderPorts["renderWidgetRegion"]>(({ ctx, regionKey }) => `<aside>${ctx.siteTitle}/${regionKey}</aside>`);
  const component = vi.fn(({ ctx, props }: Parameters<NonNullable<ReturnType<BlockRenderPorts["componentFor"]>>>[0]) =>
    `<p>${ctx.siteTitle}/${String(props.label)}</p>`);
  const componentFor = vi.fn<BlockRenderPorts["componentFor"]>(({ id }) => id === "notice" ? component : undefined);
  const ports: BlockRenderPorts = {
    renderWidgetRegion, componentFor, renderDocNode: () => { throw new Error("unexpected document"); },
    renderHtmlPageBody: () => { throw new Error("unexpected page body"); },
    entryList: () => { throw new Error("unexpected list"); },
  };
  expect(renderBlockSeam({ ctx, props: { region: "sidebar", component: "notice" }, ports })).toBe("<aside>Atlas/sidebar</aside>");
  expect(renderWidgetRegion.mock.calls).toEqual([[{ ctx, regionKey: "sidebar" }]]);
  expect(componentFor).not.toHaveBeenCalled();
  expect(renderBlockSeam({ ctx, props: { region: 42, component: "notice", label: "Published" }, ports })).toBe("<p>Atlas/Published</p>");
  expect(component.mock.calls).toEqual([[{ ctx, props: { label: "Published" } }]]);
  expect(renderBlockSeam({ ctx, props: { component: "<missing>" }, ports })).toBe("<!-- unknown component: &lt;missing&gt; -->");
  expect(componentFor.mock.calls).toEqual([[{ id: "notice" }], [{ id: "<missing>" }]]);
});

it("renders the appropriate title and body slots and escapes unknown slot names", () => {
  const post: NonNullable<SiteRenderContext["post"]> = {
    id: "p", workspaceId: "ws", title: "An <entry>", slug: "entry", kind: "page", bodyFormat: "html",
    bodyHtml: "<p>Unresolved body</p>", bodyJson: {}, status: "published", updatedAt: "2026-04-02T00:00:00Z", version: 1,
  };
  const ctx: SiteRenderContext = {
    siteTitle: "Atlas & Co", route: "post", post, posts: [], products: [], themeName: null, widgetRegions: {},
    widgetInlineResolved: new Map(), mediaTransformVersions: new Map(), mediaAssetMetadata: new Map(), assignedTerms: [],
  };
  const renderHtmlPageBody = vi.fn<BlockRenderPorts["renderHtmlPageBody"]>(() => "<p>Resolved body</p>");
  const ports: BlockRenderPorts = {
    renderHtmlPageBody,
    renderDocNode: () => { throw new Error("unexpected document"); },
    renderWidgetRegion: () => { throw new Error("unexpected region"); },
    componentFor: () => { throw new Error("unexpected component"); },
    entryList: () => { throw new Error("unexpected list"); },
  };
  const slot = (name: string, context: SiteRenderContext) => renderBlock({ node: { type: "slot", name }, ctx: context, ports });
  expect(slot("title", ctx)).toBe('<h1 class="slot-title">An &lt;entry&gt;</h1>');
  expect(slot("title", { ...ctx, route: "home" })).toBe('<h1 class="slot-title">Atlas &amp; Co</h1>');
  expect(slot("content", ctx)).toBe('<div class="prose"><p>Resolved body</p></div>');
  const { post: _post, ...withoutPost } = ctx;
  expect(slot("content", withoutPost)).toBe("");
  expect(renderHtmlPageBody.mock.calls).toEqual([[{ html: "<p>Unresolved body</p>", resolved: undefined }]]);
  expect(slot("missing<&", ctx)).toBe("<!-- unknown slot: missing&lt;&amp; -->");
});
