import { expect, it, vi } from "vitest";
import { renderPostBody } from "../post-body.js";
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
