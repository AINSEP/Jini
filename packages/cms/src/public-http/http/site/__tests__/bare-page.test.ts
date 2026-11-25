import { expect, it, vi } from "vitest";
import { renderBareEntryDocument } from "../bare-page.js";
import type { PostRecord } from "../../../../posts/post.js";

it("does not wrap or augment a complete authored document", () => {
  const authored = '<!doctype html><html><head><title>Authored</title></head><body>Raw</body></html>';
  const post: PostRecord = { id: "p", workspaceId: "ws", title: "Post", slug: "post", kind: "page", bodyFormat: "html", bodyHtml: authored, bodyJson: {}, status: "published", updatedAt: "now", version: 1 };
  const renderHtmlPageBody = vi.fn(() => "<p>resolved output</p>");
  const renderDocNode = vi.fn(() => "doc");
  const result = renderBareEntryDocument({ post, siteTitle: "Site", extraHead: "<meta name=extra>", documentAssets: { head: "host-head", body: "host-body" }, renderers: { renderHtmlPageBody, renderDocNode } });
  expect(result).toBe("<p>resolved output</p>");
  expect(renderHtmlPageBody).toHaveBeenCalledWith({ html: authored, resolved: undefined });
  expect(renderDocNode).not.toHaveBeenCalled();
});
