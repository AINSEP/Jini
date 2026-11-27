import { expect, it, vi } from "vitest";
import { entryList, productEntryContent, productEntryList } from "../components/entry-lists.js";
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

it("links product listings by slug and shows the host-formatted price on the matching detail", () => {
  const product = { id: "internal-id", slug: "copper-kettle", title: "Copper & steel", currency: "eur", price: 2375 };
  const ctx: SiteRenderContext = {
    siteTitle: "Catalog & Co", route: "products", posts: [], products: [product], themeName: null, widgetRegions: {},
    widgetInlineResolved: new Map(), mediaTransformVersions: new Map(), mediaAssetMetadata: new Map(), assignedTerms: [],
  };
  const formatMoney = vi.fn(({ money }: { money: { minorUnits: number; currency: string } }) => `${money.currency} <${money.minorUnits}>`);
  expect(productEntryList({ ctx, formatMoney, emptyProductsText: "No stock" })).toBe(
    '<section class="entry-list entry-list--products"><div class="wrap"><ol class="entries"><li class="entry"><a class="entry-link" href="/products/copper-kettle"><span class="entry-index">№ 01</span><h2 class="entry-title">Copper &amp; steel</h2><p class="entry-meta">EUR &lt;2375&gt;</p></a></li></ol></div></section>',
  );
  expect(productEntryContent({ ctx: { ...ctx, route: "product", product }, formatMoney })).toBe(
    '<div class="wrap"><a class="back" href="/products">← Catalog &amp; Co</a><article class="entry"><h1 class="entry-title">Copper &amp; steel</h1><p class="entry-meta">EUR &lt;2375&gt;</p></article></div>',
  );
  expect(productEntryContent({ ctx: { ...ctx, route: "product" }, formatMoney })).toBe("");
  expect(productEntryList({ ctx: { ...ctx, products: [] }, formatMoney, emptyProductsText: "No <stock>" })).toBe(
    '<section class="entry-list entry-list--products"><div class="wrap"><ol class="entries"><li class="entry entry--empty"><p>No &lt;stock&gt;</p></li></ol></div></section>',
  );
  expect(formatMoney.mock.calls).toEqual([
    [{ money: { minorUnits: 2375, currency: "EUR" } }], [{ money: { minorUnits: 2375, currency: "EUR" } }],
  ]);
});
