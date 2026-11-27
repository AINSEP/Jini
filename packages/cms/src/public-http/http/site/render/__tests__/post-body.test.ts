import { expect, it, vi } from "vitest";
import { entryContent, renderPostBody } from "../post-body.js";
import type { BodyRenderPorts } from "../body-render-ports.js";
import type { SiteRenderContext } from "../../render-context.js";
import type { PublicPostRecord as PostRecord } from "../../../../../posts/post.js";

it("appends escaped assigned terms after the selected body", () => {
  const post: PostRecord = { id: "p", workspaceId: "ws", title: "Post", slug: "post", kind: "page", bodyFormat: "html", bodyHtml: "<b>authored</b>", bodyJson: {}, status: "published", updatedAt: "2026-01-01T00:00:00Z", version: 1 };
  const ctx: SiteRenderContext = {
    siteTitle: "Site", route: "post", posts: [], products: [], themeName: null, widgetRegions: {}, widgetInlineResolved: new Map(),
    mediaTransformVersions: new Map(), mediaAssetMetadata: new Map(),
    assignedTerms: [{ termId: "t1", termName: "<i>QA</i>", taxonomyName: "Cat&" }, { termId: "t2", termName: "Ops", taxonomyName: "Cat&" }],
  };
  const renderHtmlPageBody = vi.fn(({ html }: { html: string }) => html);
  const renderDocNode = vi.fn(() => "doc");
  const html = renderPostBody({ ctx, post, renderers: { renderHtmlPageBody, renderDocNode } });
  expect(renderHtmlPageBody).toHaveBeenCalledWith({ html: "<b>authored</b>", resolved: undefined });
  expect(renderDocNode).not.toHaveBeenCalled();
  expect(html).toBe(
    '<b>authored</b><div class="entry-terms"><span class="entry-terms__group"><span class="entry-terms__taxonomy">Cat&amp;:</span> <span class="entry-terms__term">&lt;i&gt;QA&lt;/i&gt;</span>, <span class="entry-terms__term">Ops</span></span></div>',
  );
});

it("renders a document entry with the site's calendar day, public byline, and resolved render context", () => {
  const post: PostRecord = {
    id: "post-7", workspaceId: "ws", title: "Night & day", slug: "night-day", kind: "post", bodyFormat: "doc",
    bodyHtml: null, bodyJson: { type: "doc", content: [{ type: "widgetEmbed", attrs: { placementId: "one" } }] },
    status: "published", updatedAt: "2026-04-04T18:00:00Z", publishAt: "2026-05-04T01:20:00Z", version: 1,
    author: "  M. <Moon>  ", showAuthor: true,
  };
  const ctx: SiteRenderContext = {
    siteTitle: "Atlas & Co", route: "post", posts: [], post, products: [], themeName: null, widgetRegions: {},
    widgetInlineResolved: new Map([["one", { componentId: "text", props: { body: "Live widget" } }]]),
    mediaTransformVersions: new Map([["public", 9]]),
    mediaAssetMetadata: new Map([["a1", { width: 320, height: 240, slug: "cover", contentType: "image/png", cssClass: null, htmlAttributes: null }]]),
    assignedTerms: [], timeZone: "America/Los_Angeles",
  };
  const renderDocNode = vi.fn<BodyRenderPorts["renderDocNode"]>(() => "<p>Rendered document</p>");
  const renderers: BodyRenderPorts = { renderDocNode, renderHtmlPageBody: () => { throw new Error("unexpected HTML body"); } };
  expect(entryContent({ ctx, renderers, bylinePrefix: "Written by & " })).toBe(
    '<div class="wrap"><a class="back" href="/">← Atlas &amp; Co</a><article class="entry"><h1 class="entry-title">Night &amp; day</h1><p class="entry-meta">2026-05-03 · <span class="post-author">Written by &amp; M. &lt;Moon&gt;</span></p><div class="prose"><p>Rendered document</p></div></article></div>',
  );
  expect(renderDocNode.mock.calls).toEqual([[
    { node: { type: "doc", content: [{ type: "widgetEmbed", attrs: { placementId: "one" } }] } },
    { inlineResolved: ctx.widgetInlineResolved, mediaTransformVersions: ctx.mediaTransformVersions, mediaAssetMetadata: ctx.mediaAssetMetadata },
  ]]);
  const { post: _post, ...withoutPost } = ctx;
  expect(entryContent({ ctx: withoutPost, renderers, bylinePrefix: "Written by & " })).toBe("");
});
