import { expect, it, vi } from "vitest";
import { buildTemplateRenderData, featuredImageView } from "../template-render-data.js";
import type { SiteRenderContext } from "../../render-context.js";
import type { PublicPostRecord as PostRecord } from "../../../../../posts/post.js";

it("uses one injected body renderer and keeps the legacy date and product fields", () => {
  const post: PostRecord = { id: "p", workspaceId: "ws", title: "Post", slug: "post", kind: "post", bodyFormat: "doc", bodyHtml: null, bodyJson: {}, status: "published", publishAt: "2026-03-04T23:30:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1 };
  const ctx: SiteRenderContext = {
    siteTitle: "Site", route: "post", posts: [post], post, themeName: "t", widgetRegions: {}, widgetInlineResolved: new Map(),
    mediaTransformVersions: new Map(), mediaAssetMetadata: new Map(), assignedTerms: [], timeZone: "America/Los_Angeles",
    products: [{ id: "pr", slug: "pr", title: "P", price: 1250, currency: "eur", compareAtPrice: 2000 }, { id: "q", slug: "q", title: "Q", price: 5 }],
  };
  const renderPostBody = vi.fn(() => "<p>one body</p>");
  const formatMoney = vi.fn(({ money }: { money: { minorUnits: number; currency: string } }) => `${money.currency}:${money.minorUnits}`);
  const data = buildTemplateRenderData({ ctx, renderPostBody, formatMoney }) as { posts: Record<string, unknown>[]; post: Record<string, unknown>; products: Record<string, unknown>[]; product: unknown };
  expect(renderPostBody).toHaveBeenCalledTimes(1);
  expect(renderPostBody).toHaveBeenCalledWith({ ctx, post });
  expect(data.post).toMatchObject({ content: "<p>one body</p>", date: "2026-03-04T23:30:00Z", dateShort: "2026-03-04", featuredImage: null });
  expect(data.posts[0]).toMatchObject({ date: "2026-03-04T23:30:00Z", dateShort: "2026-03-04", showAuthor: false });
  expect(data.products[0]).toMatchObject({ priceFormatted: "EUR:1250", compareAtPriceFormatted: "EUR:2000" });
  expect(data.products[1]).toMatchObject({ priceFormatted: "USD:5", compareAtPriceFormatted: undefined });
  expect("compareAtPriceFormatted" in (data.products[1] as object)).toBe(true);
  expect(data.product).toBeNull();
});

it("returns a versioned cover URL only when the media and public transform are available", () => {
  const post: PostRecord = {
    id: "post-7", workspaceId: "ws", title: "Rain & sun", slug: "rain-sun", kind: "post", bodyFormat: "doc",
    bodyHtml: null, bodyJson: { type: "doc", content: [] }, status: "published", updatedAt: "2026-04-02T00:00:00Z",
    featuredMediaId: "cover7", version: 1,
  };
  const ctx: Pick<SiteRenderContext, "mediaAssetMetadata" | "mediaTransformVersions"> = {
    mediaAssetMetadata: new Map([["cover7", { slug: "ridge-view", width: 720, height: 480, contentType: "image/webp",
      cssClass: null, htmlAttributes: null, sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" }]]),
    mediaTransformVersions: new Map([["public", 7]]),
  };
  expect(featuredImageView({ ctx, post })).toEqual({
    url: "/m/ridge-view/public.v7/image.jpg?v=abcdef012345", alt: "Rain & sun", width: 720, height: 480,
  });
  expect(featuredImageView({ ctx: { ...ctx, mediaTransformVersions: new Map([["private", 7]]) }, post })).toBeNull();
  expect(featuredImageView({ ctx: { ...ctx, mediaAssetMetadata: new Map() }, post })).toBeNull();
});

it("publishes the selected product price ID alongside its independently formatted current and comparison prices", () => {
  const ctx: SiteRenderContext = {
    siteTitle: "Atlas", route: "product", posts: [], products: [],
    product: { id: "entry-4", slug: "ridge-map", title: "Ridge map", price: 1750, priceId: "tier-B", currency: "gbp",
      stock: 0, compareAtPrice: 2100, specs: [{ label: "Scale", value: "1:50,000" }] },
    themeName: null, widgetRegions: {}, widgetInlineResolved: new Map(), mediaTransformVersions: new Map(),
    mediaAssetMetadata: new Map(), assignedTerms: [],
  };
  const formatMoney = vi.fn(({ money }: { money: { minorUnits: number; currency: string } }) => `${money.currency}:${money.minorUnits}`);
  expect(buildTemplateRenderData({
    ctx, formatMoney, renderPostBody: () => { throw new Error("unexpected post"); },
  })).toEqual({
    site: { title: "Atlas" }, theme: { name: null }, route: "product", posts: [], post: null, products: [],
    product: { id: "entry-4", slug: "ridge-map", title: "Ridge map", price: 1750, priceId: "tier-B",
      priceFormatted: "GBP:1750", stock: 0, compareAtPriceFormatted: "GBP:2100", currency: "gbp",
      specs: [{ label: "Scale", value: "1:50,000" }] },
  });
  expect(formatMoney.mock.calls).toEqual([[{ money: { minorUnits: 1750, currency: "GBP" } }], [{ money: { minorUnits: 2100, currency: "GBP" } }]]);
});
