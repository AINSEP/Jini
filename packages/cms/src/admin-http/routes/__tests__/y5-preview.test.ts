import { describe, expect, it, vi } from "vitest";
import { createPostPreviewRenderer } from "../posts/template-preview-render.js";
import type { PublicPostRecord } from "../../../posts/post.js";

describe("bare preview binding", () => {
  it.each(["doc", "html"] as const)("resolves %s widgets and metadata in parallel without adding an SEO head", async bodyFormat => {
    const post: PublicPostRecord = { id: "p", workspaceId: "w", title: "Page", slug: "page", bodyJson: { type: "doc" }, kind: "page", bodyFormat, bodyHtml: bodyFormat === "html" ? "saved" : null, status: "draft", templateChoice: "", updatedAt: "now", version: 1 };
    let releaseTitle!: (title: string) => void;
    const title = new Promise<string>(resolve => { releaseTitle = resolve; });
    const events: string[] = [];
    const inlineResolved = new Map();
    const pageHtmlEmbeds = new Map();
    const mediaTransformVersions = new Map([["image", 2]]);
    const mediaAssetMetadata = new Map([["asset", { width: 640, height: 480, cssClass: null, htmlAttributes: null, contentType: "image/png", slug: "image" }]]);
    const getPresentationSettings = vi.fn(async () => ({ settings: { activeThemeId: "active" } }));
    const resolveWidgetsForRender = vi.fn(async () => { events.push("widgets"); return { inlineResolved }; });
    const renderBareEntryDocument = vi.fn(() => "<main>bare</main>");
    const render = createPostPreviewRenderer({
      getPresentationSettings, isBarePageChoice: value => value.templateChoice === "", resolveActiveTheme: vi.fn(() => null), NO_THEME_ID: "none",
      resolveTemplateBranchChoice: () => ({ kind: "ineligible" }), resolveStaticMenusForRender: async () => ({}), postPublicPath: ({ slug }) => `/${slug}`,
      createMemberAccessResolver: () => ({}), renderViaTemplate: vi.fn(async () => "template"), copy: { missingTheme: "missing", themeOff: "off" },
      resolveSiteTitle: () => { events.push("title"); return title; }, resolveWidgetsForRender,
      resolveHtmlEmbedsForRender: async () => { events.push("embeds"); return pageHtmlEmbeds; },
      resolveMediaTransformVersionsForRender: async () => { events.push("versions"); return mediaTransformVersions; },
      resolveMediaAssetMetadataForRender: async () => { events.push("metadata"); return mediaAssetMetadata; }, renderBareEntryDocument,
    });
    const pending = render({ input: { post, bodyJson: { type: "doc", content: [] }, bodyHtml: "pending" } });
    expect(events).toEqual(["title", "widgets", "embeds", "versions", "metadata"]);
    expect(renderBareEntryDocument).not.toHaveBeenCalled();
    releaseTitle("Site");
    expect(await pending).toEqual({ html: "<main>bare</main>", templateChoice: "" });
    const preview = { ...post, bodyJson: { type: "doc", content: [] }, ...(bodyFormat === "html" ? { bodyHtml: "pending" } : {}) };
    expect(resolveWidgetsForRender).toHaveBeenCalledWith({ theme: null }, { post: preview });
    expect(renderBareEntryDocument).toHaveBeenCalledWith({ post: preview, siteTitle: "Site", pageHtmlEmbeds, widgetInlineResolved: inlineResolved, mediaTransformVersions, mediaAssetMetadata });
    expect(getPresentationSettings).not.toHaveBeenCalled();
    expect(post.bodyJson).toEqual({ type: "doc" });
    expect(post.bodyHtml).toBe(bodyFormat === "html" ? "saved" : null);
  });
});
