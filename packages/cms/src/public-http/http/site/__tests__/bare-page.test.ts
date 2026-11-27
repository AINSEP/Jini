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

it("threads resolved document data through and wraps the rendered fragment in a bare shell", () => {
  const bodyJson = { type: "doc", content: [{ type: "text", text: "Original" }] };
  const post: PostRecord = { id: "p", workspaceId: "ws", title: "A & B", slug: "post", kind: "page", bodyFormat: "doc", bodyHtml: null, bodyJson, status: "published", updatedAt: "now", version: 1 };
  const mediaTransformVersions = new Map([["hero", 7]]);
  const widgetInlineResolved: NonNullable<Parameters<typeof renderBareEntryDocument>[0]["widgetInlineResolved"]> = new Map([["inline", { componentId: "notice", props: { label: "Editorial" } }]]);
  const mediaAssetMetadata: NonNullable<Parameters<typeof renderBareEntryDocument>[0]["mediaAssetMetadata"]> = new Map([["hero", { width: 1200, height: 600, cssClass: null, htmlAttributes: null, contentType: "image/png", slug: "hero" }]]);
  const renderDocNode = vi.fn(() => "<p>Resolved document</p>");
  const renderHtmlPageBody = vi.fn(() => "<p>Wrong renderer</p>");
  const renderers = { renderDocNode, renderHtmlPageBody };
  const rendered = renderBareEntryDocument({ post, siteTitle: "Site", widgetInlineResolved, mediaTransformVersions,
    mediaAssetMetadata, documentAssets: { head: '<meta name="host">', body: '<aside>Host asset</aside>' }, renderers });
  expect(rendered).toBe('<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>A &amp; B — Site</title><meta name="host"></head><body><p>Resolved document</p><aside>Host asset</aside></body></html>');
  expect(renderDocNode).toHaveBeenCalledExactlyOnceWith({ node: bodyJson }, {
    inlineResolved: widgetInlineResolved, mediaTransformVersions, mediaAssetMetadata });
  expect(renderHtmlPageBody).not.toHaveBeenCalled();
});

it("treats a missing HTML body as an empty fragment and uses the supplied head title", () => {
  const post: PostRecord = { id: "p", workspaceId: "ws", title: "Fallback", slug: "post", kind: "page", bodyFormat: "html", bodyHtml: null, bodyJson: {}, status: "published", updatedAt: "now", version: 1 };
  const renderHtmlPageBody = vi.fn(() => "");
  const renderDocNode = vi.fn(() => "Wrong renderer");
  const html = renderBareEntryDocument({ post, siteTitle: "Site", extraHead: "<title>Editorial title</title>",
    renderers: { renderHtmlPageBody, renderDocNode } });
  expect(renderHtmlPageBody).toHaveBeenCalledExactlyOnceWith({ html: "", resolved: undefined });
  expect(html).toBe('<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Editorial title</title></head><body></body></html>');
  expect(renderDocNode).not.toHaveBeenCalled();
});
