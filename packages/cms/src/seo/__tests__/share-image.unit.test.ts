/** Owner brief: tovu.dev link previews, 2026-10-09; exercises the actual evaluator/head producer. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { getEntryMeta, type GetEntryMetaDeps } from "../seo.js";
import { buildHeadElements } from "../page-head.js";
import type { SeoPostRecord } from "../ports.js";
import type { MediaRecord } from "../../media/types.js";
import { InMemoryTransformDefinitionRepo } from "../../media/repo.memory.js";

const now = "2026-10-09T00:00:00.000Z";
const post: SeoPostRecord = { id: "post", workspaceId: "w", slug: "page", title: "Page", kind: "page", status: "published", bodyFormat: "doc", bodyJson: null, bodyHtml: null, updatedAt: now, version: 1, featuredMediaId: "asset" };
const asset: MediaRecord = { id: "asset", workspaceId: "w", slug: "cover", title: "Cover", alt: "", caption: "", credit: "", source: { sha256: "abc" }, status: "active", createdAt: now, updatedAt: now, version: 1, width: 1, height: 1, cssClass: null, htmlAttributes: null };
function deps({ overrides = {}, featured = true, missing = false }: { overrides?: Record<string, string>; featured?: boolean; missing?: boolean } = {}): GetEntryMetaDeps {
  return {
    shareImageTransform: "og",
    postRepo: { findById: async () => ({ ...post, featuredMediaId: featured ? "asset" : undefined, seoExtJson: JSON.stringify(overrides) }), extractPlainText: () => "", isTrashed: () => false },
    settings: { getSeoSettings: async () => ({ titleTemplate: "%s", defaultOgImage: "cover:public", defaultRobots: { noindex: false, nofollow: false }, sitemapEnabled: true, robotsRules: [] }), isDefaultRobotsNoindexExplicitlySet: async () => false },
    media: {
      featuredImage: { findMediaByIdOrSlug: async () => missing ? null : asset, mediaUrlKey: ({ asset }) => asset.slug, mediaPublicPath: ({ key, variant }) => `/m/${key}/${variant.name}.v${variant.version}/image.${variant.ext}`, resolveFeaturedImageRef: async () => ({ ok: true }) },
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [
        { id: "public", workspaceId: "w", name: "public", version: 1, owner: "core", createdAt: now, params: { format: "webp" } },
        { id: "og1", workspaceId: "w", name: "og", version: 1, owner: "core", createdAt: now, params: { format: "jpeg", width: 1200, height: 630, fit: "cover", quality: 82 } },
        { id: "og2", workspaceId: "w", name: "og", version: 2, owner: "core", createdAt: now, params: { format: "jpeg", width: 1200, height: 630, fit: "cover", quality: 82 } },
      ] }),
    },
    originRegistry: { canonicalOrigin: async () => ({ scheme: "https", host: "unchanged.example", verifiedAt: now, source: "workspace-setting" }), isAllowedRedirectTarget: async () => false, isAllowedEgressTarget: async () => false },
    runtimeMode: "production", urls: { postPublicPath: () => "/page", urlFor: async () => ({ canonicalUrl: "/page" }) },
    liveness: { isScheduledAt: () => false, isLiveAt: () => true, postDisplayDateIso: () => now }, clock: { nowIso: () => now },
  };
}

const sourceCases: { overrides?: Record<string, string>; featured?: boolean }[] = [
  { overrides: { ogImage: "cover:public", twitterImage: "asset:public" } },
  { featured: true },
  { featured: false },
];
// Guards buildSeoImageUrl's source-SHA argument to the host-owned public URL builder.
test("share-image URL construction passes the current source hash through the host port", async () => {
  const ports = deps({ featured: true });
  const original = ports.media.featuredImage.mediaPublicPath;
  const calls: unknown[] = [];
  ports.media.featuredImage.mediaPublicPath = input => { calls.push(input); return original(input); };
  const meta = await getEntryMeta({ deps: ports, input: { workspaceId: "w", entryId: "post" } });
  assert.ok(meta.openGraph.image);
  assert.ok(calls.length > 0);
  for (const call of calls) assert.deepEqual(call, { key: "cover", sha256: "abc", variant: { kind: "transform", name: "og", version: 2, ext: "jpg" } });
});

test.each(sourceCases)("share images use latest og JPEG for overrides, featured media and site defaults: %j", async (input) => {
  const meta = await getEntryMeta({ deps: deps(input), input: { workspaceId: "w", entryId: "post" } });
  assert.equal(meta.openGraph.image, "https://unchanged.example/m/cover/og.v2/image.jpg");
  assert.equal(meta.twitter.image, meta.openGraph.image);
  assert.equal(meta.openGraph.imageRef, input.overrides?.ogImage ?? (input.featured === false ? "cover:public" : "asset:public"));
  assert.equal(meta.openGraph.imageSource, input.overrides?.ogImage ? "override" : input.featured === false ? "default" : "content");
  assert.equal(meta.openGraph.imageWidth, 1200);
  assert.equal(meta.openGraph.imageHeight, 630);
  assert.equal(meta.openGraph.imageType, "image/jpeg");
  assert.equal(meta.openGraph.url, "https://unchanged.example/page");
});

test.each(sourceCases)("missing og registration falls back to the reference's public rendition: %j", async (input) => {
  const ports = deps(input);
  const definitions = ports.media.transformDefinitionRepo;
  const listByName = definitions.listByName.bind(definitions);
  definitions.listByName = required => required.name === "og" ? Promise.resolve([]) : listByName(required);
  const meta = await getEntryMeta({ deps: ports, input: { workspaceId: "w", entryId: "post" } });
  assert.equal(meta.openGraph.image, "https://unchanged.example/m/cover/public.v1/image.webp");
  assert.equal(meta.twitter.image, meta.openGraph.image);
  assert.equal(meta.openGraph.imageType, "image/webp");
  assert.equal(meta.openGraph.imageWidth, undefined);
  assert.equal(meta.openGraph.imageHeight, undefined);
});

test.each(sourceCases)("image provenance is retained without a host share transform: %j", async (input) => {
  const ports = deps(input);
  delete ports.shareImageTransform;
  const meta = await getEntryMeta({ deps: ports, input: { workspaceId: "w", entryId: "post" } });
  assert.equal(meta.openGraph.imageSource, input.overrides?.ogImage ? "override" : input.featured === false ? "default" : "content");
  assert.equal("imageRef" in meta.openGraph, false, "older hosts retain their existing metadata shape");
});

test("a missing featured image reports the resolved site's default source", async () => {
  const ports = deps();
  ports.media.featuredImage.findMediaByIdOrSlug = async ({ idOrSlug }) => idOrSlug === "asset" ? null : asset;
  const meta = await getEntryMeta({ deps: ports, input: { workspaceId: "w", entryId: "post" } });
  assert.equal(meta.openGraph.imageSource, "default");
  assert.equal(meta.openGraph.imageRef, "cover:public");
});

test("head tags pair the actual JPEG URL with its declared output dimensions and type", async () => {
  const elements = await buildHeadElements({ deps: deps(), rootSlug: "home", siteTitle: async () => undefined, ctx: { workspaceId: "w", route: "/page", canonicalUrl: "/page", siteTitle: "Site", entry: { id: "post", slug: "page", type: "page", title: "Page", status: "published", updatedAt: now, ext: {} } } });
  assert.deepEqual(elements.filter(e => e.kind === "og" && e.property.startsWith("og:image")), [
    { kind: "og", property: "og:image", content: "https://unchanged.example/m/cover/og.v2/image.jpg", priority: 143 },
    { kind: "og", property: "og:image:width", content: "1200", priority: 143 },
    { kind: "og", property: "og:image:height", content: "630", priority: 143 },
    { kind: "og", property: "og:image:type", content: "image/jpeg", priority: 143 },
  ]);
  assert.deepEqual(elements.find(e => e.kind === "meta" && e.name === "twitter:image"), { kind: "meta", name: "twitter:image", content: "https://unchanged.example/m/cover/og.v2/image.jpg", priority: 153 });
});

test("flags an own image override even when it equals the site default, and only then", async () => {
  const own = await getEntryMeta({ deps: deps({ overrides: { ogImage: "cover:public" }, featured: false }), input: { workspaceId: "w", entryId: "post" } });
  const inherited = await getEntryMeta({ deps: deps({ featured: false }), input: { workspaceId: "w", entryId: "post" } });
  assert.equal(own.openGraph.imageRef, inherited.openGraph.imageRef);
  assert.equal(own.openGraph.imageOverridden, true);
  assert.equal("imageOverridden" in inherited.openGraph, false);
});

test("external URLs retain their authority and never get invented dimensions or MIME types", async () => {
  const meta = await getEntryMeta({ deps: deps({ overrides: { ogImage: "https://cdn.example/picture.png" } }), input: { workspaceId: "w", entryId: "post" } });
  assert.equal(meta.openGraph.image, "https://cdn.example/picture.png");
  assert.equal(meta.openGraph.imageRef, "https://cdn.example/picture.png");
  assert.equal(meta.openGraph.imageWidth, undefined);
  assert.equal(meta.openGraph.imageHeight, undefined);
  assert.equal(meta.openGraph.imageType, undefined);
});

test("available assets advertise output metadata; deleting the asset omits URL and metadata together", async () => {
  const ports = deps();
  let visible = true;
  ports.media.featuredImage.findMediaByIdOrSlug = async () => visible ? asset : null;
  const available = await getEntryMeta({ deps: ports, input: { workspaceId: "w", entryId: "post" } });
  assert.equal(available.openGraph.imageWidth, 1200);
  assert.equal(available.openGraph.imageType, "image/jpeg");
  visible = false;
  const meta = await getEntryMeta({ deps: ports, input: { workspaceId: "w", entryId: "post" } });
  assert.equal(meta.openGraph.image, undefined);
  assert.equal("imageSource" in meta.openGraph, false);
  assert.equal(meta.openGraph.imageWidth, undefined);
  assert.equal(meta.openGraph.imageType, undefined);
});
