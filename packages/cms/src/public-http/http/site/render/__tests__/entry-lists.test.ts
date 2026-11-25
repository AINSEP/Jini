import { expect, it, vi } from "vitest";
import { entryList } from "../components/entry-lists.js";
import type { SiteRenderContext } from "../../render-context.js";
import type { PublicPostRecord as PostRecord } from "../../../../../posts/post.js";

it("keeps the next link on the second non-final batch", () => {
  const posts: PostRecord[] = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, workspaceId: "ws", title: `T<${i}>`, slug: `s${i}`, kind: "post", bodyFormat: "doc", bodyHtml: null, bodyJson: {}, status: "published", updatedAt: "2026-01-01T00:00:00Z", version: 1 }));
  const ctx: SiteRenderContext = {
    siteTitle: "Site", route: "home", posts, products: [], themeName: null, widgetRegions: {}, widgetInlineResolved: new Map(),
    mediaTransformVersions: new Map(), mediaAssetMetadata: new Map(), assignedTerms: [], listing: { pagePath: "/blog", after: 12 },
  };
  const { listing: _listing, ...withoutListing } = ctx;
  const renderCoverImageTag = vi.fn(() => "<img>");
  const html = entryList({ ctx, props: {}, renderCoverImageTag, emptyPostsText: "none" });
  expect(html).toContain("№ 13");
  expect(html).toContain("№ 24");
  expect(html).not.toContain("№ 25");
  expect(html).toContain("T&lt;12&gt;");
  expect(html).toContain("/blog/_more/1/24");
  expect(entryList({ ctx: { ...withoutListing, posts: [] }, props: {}, renderCoverImageTag, emptyPostsText: "none <x>" })).toContain("<p>none &lt;x&gt;</p>");
});
