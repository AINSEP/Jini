import { expect, it, vi } from "vitest";
import { buildTemplateRenderData } from "../template-render-data.js";
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
