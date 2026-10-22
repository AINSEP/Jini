/** Direct boundary certification of `getEntryMeta`/`analyzeEntry` branches (seo.ts) over typed port fakes. */
import assert from "node:assert/strict";
import { test } from "vitest";

import { analyzeEntry, getEntryMeta, type GetEntryMetaDeps } from "../seo.js";
import type { SeoPostRecord } from "../ports.js";
import type { SeoExtFields, SeoSettings } from "../types.js";
import type { MediaRecord } from "../../media/types.js";
import { InMemoryTransformDefinitionRepo } from "../../media/repo.memory.js";

const now = "2026-10-20T00:00:00.000Z";
const basePost: SeoPostRecord = { id: "post", workspaceId: "w", slug: "page", title: "Page", kind: "post", status: "published", bodyFormat: "doc", bodyJson: null, bodyHtml: null, updatedAt: now, version: 1 };
const asset: MediaRecord = { id: "asset", workspaceId: "w", slug: "cover", title: "Cover", alt: "", caption: "", credit: "", source: { sha256: "abc" }, status: "active", createdAt: now, updatedAt: now, version: 1, width: 1, height: 1, cssClass: null, htmlAttributes: null };
const baseSettings: SeoSettings = { titleTemplate: "%s | Site", defaultRobots: { noindex: false, nofollow: true }, sitemapEnabled: true, robotsRules: [] };

interface FakeOptions {
  post?: Partial<SeoPostRecord>;
  overrides?: SeoExtFields;
  settings?: Partial<SeoSettings>;
  routed?: { canonicalUrl: string } | null;
  missingAssets?: boolean;
}

/** Typed fake over the real `GetEntryMetaDeps`; `htmlSeen` records every html body extracted. */
function fakeDeps({ post = {}, overrides = {}, settings = {}, routed = null, missingAssets = false }: FakeOptions = {}) {
  const htmlSeen: string[] = [];
  const deps: GetEntryMetaDeps = {
    postRepo: {
      findById: async () => ({ ...basePost, seoExtJson: JSON.stringify(overrides), ...post }),
      extractPlainText: ({ html }) => { htmlSeen.push(html); return ""; },
      isTrashed: () => false,
    },
    settings: { getSeoSettings: async () => ({ ...baseSettings, ...settings }), isDefaultRobotsNoindexExplicitlySet: async () => false },
    media: {
      featuredImage: {
        findMediaByIdOrSlug: async () => (missingAssets ? null : asset),
        mediaUrlKey: ({ asset: a }) => a.slug,
        mediaPublicPath: ({ key, variant }) => `/m/${key}/${variant.name}.v${variant.version}/image.${variant.ext}`,
        resolveFeaturedImageRef: async () => ({ ok: true }),
      },
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [
        { id: "public", workspaceId: "w", name: "public", version: 1, owner: "core", createdAt: now, params: { format: "webp" } },
      ] }),
    },
    originRegistry: { canonicalOrigin: async () => ({ scheme: "https", host: "site.example", verifiedAt: now, source: "workspace-setting" }), isAllowedRedirectTarget: async () => false, isAllowedEgressTarget: async () => false },
    runtimeMode: "production",
    urls: { postPublicPath: ({ slug }) => `/posts/${slug}`, urlFor: async () => routed },
    liveness: { isScheduledAt: () => false, isLiveAt: () => true, postDisplayDateIso: () => now },
    clock: { nowIso: () => now },
  };
  return { deps, htmlSeen };
}

const input = { workspaceId: "w", entryId: "post" };

test("an html-format entry with no stored html derives its excerpt from an empty html body", async () => {
  const { deps, htmlSeen } = fakeDeps({ post: { bodyFormat: "html", bodyHtml: null } });
  const meta = await getEntryMeta({ deps, input });
  assert.deepEqual(htmlSeen, [""]);
  assert.equal(meta.description, undefined);
});

test("canonical falls back to the bare public path when routing resolves nothing", async () => {
  const { deps } = fakeDeps({ routed: null });
  assert.equal((await getEntryMeta({ deps, input })).canonical, "https://site.example/posts/page");
});

test("canonical uses the routing-resolved URL over the bare public path", async () => {
  const { deps } = fakeDeps({ routed: { canonicalUrl: "/blog/page" } });
  assert.equal((await getEntryMeta({ deps, input })).canonical, "https://site.example/blog/page");
});

test("robots nofollow falls back to the site default when the entry has no override", async () => {
  const { deps } = fakeDeps({ settings: { defaultRobots: { noindex: false, nofollow: true } } });
  assert.equal((await getEntryMeta({ deps, input })).robots.nofollow, true);
});

test("robots nofollow override beats the site default", async () => {
  const { deps } = fakeDeps({ overrides: { nofollow: false }, settings: { defaultRobots: { noindex: false, nofollow: true } } });
  assert.equal((await getEntryMeta({ deps, input })).robots.nofollow, false);
});

test("with no resolvable image, openGraph carries no image metadata keys at all", async () => {
  const { deps } = fakeDeps({ missingAssets: true });
  const meta = await getEntryMeta({ deps, input });
  assert.deepEqual(meta.openGraph, { title: "Page | Site", description: undefined, type: "article", url: "https://site.example/posts/page", image: undefined, siteName: undefined });
});

test("an unresolved image override still flags the override, without an image source", async () => {
  const { deps } = fakeDeps({ overrides: { ogImage: "gone:public" }, missingAssets: true });
  const meta = await getEntryMeta({ deps, input });
  assert.equal(meta.openGraph.imageOverridden, true);
  assert.equal("imageSource" in meta.openGraph, false);
  assert.equal(meta.openGraph.image, undefined);
});

test("a resolved override image reports source 'override', its type, and keeps the key order", async () => {
  const { deps } = fakeDeps({ overrides: { ogImage: "cover:public", ogTitle: "OG", ogDescription: "OG desc" } });
  const meta = await getEntryMeta({ deps, input });
  assert.deepEqual(Object.entries(meta.openGraph), [
    ["title", "OG"], ["description", "OG desc"], ["type", "article"], ["url", "https://site.example/posts/page"],
    ["image", "https://site.example/m/cover/public.v1/image.webp"], ["imageSource", "override"], ["imageOverridden", true],
    ["imageType", "image/webp"], ["siteName", undefined],
  ]);
});

test("a featured image reports source 'content'", async () => {
  const { deps } = fakeDeps({ post: { featuredMediaId: "asset" } });
  assert.equal((await getEntryMeta({ deps, input })).openGraph.imageSource, "content");
});

test("the site default image reports source 'default'", async () => {
  const { deps } = fakeDeps({ settings: { defaultOgImage: "cover:public" } });
  assert.equal((await getEntryMeta({ deps, input })).openGraph.imageSource, "default");
});

test("a page entry derives the 'website' ogType", async () => {
  const { deps } = fakeDeps({ post: { kind: "page" } });
  assert.equal((await getEntryMeta({ deps, input })).openGraph.type, "website");
});

test("an ogType override beats the derived ogType", async () => {
  const { deps } = fakeDeps({ post: { kind: "page" }, overrides: { ogType: "article" } });
  assert.equal((await getEntryMeta({ deps, input })).openGraph.type, "article");
});

test("analyzeEntry scores 100 with no issues", async () => {
  const { deps } = fakeDeps({ settings: { defaultDescription: "Site description" } });
  const analysis = await analyzeEntry({ deps, input });
  assert.equal(analysis.score, 100);
  assert.deepEqual(analysis.issues, []);
});

test("analyzeEntry deducts 20 per issue for an empty title and missing description", async () => {
  const { deps } = fakeDeps({ overrides: { title: "" } });
  const analysis = await analyzeEntry({ deps, input });
  assert.deepEqual(analysis.issues.map(i => i.code), ["missing_title", "missing_description"]);
  assert.equal(analysis.score, 60);
});
