/** Direct boundary certification of `resolveSeoImageDetails` and `seoImageRefRefusal` (media.ts). */
import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveSeoImageDetails, seoImageRefRefusal, type ResolveSeoImageRefDeps } from "../media.js";
import type { SeoFeaturedImagePort } from "../ports.js";
import type { MediaRecord } from "../../media/types.js";
import type { TransformDefinitionRecord, TransformParams } from "../../media/transform-types.js";

const WS = "w";
const now = "2026-10-20T00:00:00.000Z";
const asset: MediaRecord = { id: "asset-id", workspaceId: WS, slug: "cover", title: "Cover", alt: "", caption: "", credit: "", source: { sha256: "abc" }, status: "active", createdAt: now, updatedAt: now, version: 1, width: 1, height: 1, cssClass: null, htmlAttributes: null };

function definition(name: string, version: number, params: TransformParams): TransformDefinitionRecord {
  return { id: `${name}-${version}`, workspaceId: WS, name, version, params, owner: "core", createdAt: now };
}

/** Typed fake over the real ports; `lookups` records every transform name listed, in order. */
function fakeDeps({ found = asset as MediaRecord | null, definitions = [] as TransformDefinitionRecord[] } = {}) {
  const lookups: string[] = [];
  const featuredImage: SeoFeaturedImagePort = {
    findMediaByIdOrSlug: async () => found,
    mediaUrlKey: ({ asset: a }) => a.slug,
    mediaPublicPath: ({ key, variant }) => `/m/${key}/${variant.name}.v${variant.version}/image.${variant.ext}`,
    resolveFeaturedImageRef: async () => ({ ok: true }),
  };
  const deps: ResolveSeoImageRefDeps = {
    featuredImage,
    transformDefinitionRepo: {
      listByName: async ({ name }) => {
        lookups.push(name);
        return definitions.filter(d => d.name === name);
      },
    },
  };
  return { deps, lookups };
}

const og = definition("og", 2, { format: "jpeg", width: 1200, height: 630, fit: "cover" });
const pub = definition("public", 1, { format: "webp" });

test("a blank ref resolves undefined without any lookup", async () => {
  const { deps, lookups } = fakeDeps({ definitions: [og] });
  assert.equal(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "   " } }), undefined);
  assert.deepEqual(lookups, []);
});

test("an absolute URL passes through without metadata or provenance when no share transform is selected", async () => {
  const { deps } = fakeDeps();
  assert.deepEqual(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: " https://cdn.example/x.jpg " } }), { url: "https://cdn.example/x.jpg" });
});

test("an absolute URL carries its trimmed ref as provenance when a share transform is selected", async () => {
  const { deps } = fakeDeps();
  assert.deepEqual(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "https://cdn.example/x.jpg" } }, { transformName: "og" }), { url: "https://cdn.example/x.jpg", ref: "https://cdn.example/x.jpg" });
});

test("a protocol-relative URL counts as absolute", async () => {
  const { deps } = fakeDeps();
  assert.deepEqual(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "//cdn.example/x.jpg" } }), { url: "//cdn.example/x.jpg" });
});

test.each([":og", "cover:", "nocolon"])("a ref without both halves resolves undefined: %s", async (ref) => {
  const { deps, lookups } = fakeDeps({ definitions: [og] });
  assert.equal(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref } }), undefined);
  assert.deepEqual(lookups, []);
});

test("a missing asset resolves undefined before any transform lookup", async () => {
  const { deps, lookups } = fakeDeps({ found: null, definitions: [og] });
  assert.equal(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "cover:og" } }), undefined);
  assert.deepEqual(lookups, []);
});

test("a trashed asset resolves undefined", async () => {
  const { deps } = fakeDeps({ found: { ...asset, status: "trashed" }, definitions: [og] });
  assert.equal(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "cover:og" } }), undefined);
});

test("a registered share transform replaces the ref's own transform and advertises its exact box", async () => {
  const { deps } = fakeDeps({ definitions: [og, pub] });
  assert.deepEqual(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "cover:public" } }, { transformName: "og" }), {
    url: "/m/cover/og.v2/image.jpg", ref: "cover:public", width: 1200, height: 630, type: "image/jpeg",
  });
});

test("an unregistered share transform falls back to the ref's own transform, keeping provenance", async () => {
  const { deps, lookups } = fakeDeps({ definitions: [pub] });
  assert.deepEqual(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "cover:public" } }, { transformName: "og" }), {
    url: "/m/cover/public.v1/image.webp", ref: "cover:public", type: "image/webp",
  });
  assert.deepEqual(lookups, ["og", "public"]);
});

test("neither the share transform nor the ref's own transform registered resolves undefined", async () => {
  const { deps } = fakeDeps();
  assert.equal(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "cover:public" } }, { transformName: "og" }), undefined);
});

test("a share transform equal to the ref's own unregistered transform is looked up once", async () => {
  const { deps, lookups } = fakeDeps();
  assert.equal(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "cover:og" } }, { transformName: "og" }), undefined);
  assert.deepEqual(lookups, ["og"]);
});

test.each([
  ["inside fit", { format: "png", width: 10, height: 20, fit: "inside" }],
  ["outside fit", { format: "png", width: 10, height: 20, fit: "outside" }],
  ["width only", { format: "png", width: 10 }],
  ["height only", { format: "png", height: 20 }],
] satisfies [string, TransformParams][])("no exact box is advertised for %s", async (_label, params) => {
  const { deps } = fakeDeps({ definitions: [definition("t", 1, params)] });
  assert.deepEqual(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "cover:t" } }), { url: "/m/cover/t.v1/image.png", type: "image/png" });
});

test.each([
  ["no fit", { format: "gif", width: 10, height: 20 }],
  ["contain fit", { format: "gif", width: 10, height: 20, fit: "contain" }],
  ["fill fit", { format: "gif", width: 10, height: 20, fit: "fill" }],
] satisfies [string, TransformParams][])("the exact box is advertised for %s", async (_label, params) => {
  const { deps } = fakeDeps({ definitions: [definition("t", 1, params)] });
  assert.deepEqual(await resolveSeoImageDetails({ deps, input: { workspaceId: WS, ref: "cover:t" } }), { url: "/m/cover/t.v1/image.gif", width: 10, height: 20, type: "image/gif" });
});

/** Refusal fake: records the ref half passed to the featured-image check. */
function refusalDeps(result: Awaited<ReturnType<SeoFeaturedImagePort["resolveFeaturedImageRef"]>>) {
  const { deps } = fakeDeps();
  const seen: string[] = [];
  const featuredImage: SeoFeaturedImagePort = { ...deps.featuredImage, resolveFeaturedImageRef: async ({ ref }) => { seen.push(ref); return result; } };
  return { deps: { featuredImage }, seen };
}

test.each([undefined, null, 42])("a non-string share image value is accepted untouched: %s", async (ref) => {
  const { deps, seen } = refusalDeps({ ok: false, reason: "not-image", contentType: "application/pdf" });
  assert.equal(await seoImageRefRefusal({ deps, input: { workspaceId: WS, field: "ogImage", ref } }), null);
  assert.deepEqual(seen, []);
});

test.each(["  ", "https://cdn.example/x.pdf", "//cdn.example/x.pdf", "nocolon"])("a non-ref string is accepted without a media read: %j", async (ref) => {
  const { deps, seen } = refusalDeps({ ok: false, reason: "not-image", contentType: "application/pdf" });
  assert.equal(await seoImageRefRefusal({ deps, input: { workspaceId: WS, field: "ogImage", ref } }), null);
  assert.deepEqual(seen, []);
});

test("an image asset ref is accepted after checking only its id-or-slug half", async () => {
  const { deps, seen } = refusalDeps({ ok: true });
  assert.equal(await seoImageRefRefusal({ deps, input: { workspaceId: WS, field: "ogImage", ref: " cover:og " } }), null);
  assert.deepEqual(seen, ["cover"]);
});

test("a missing asset ref is accepted (render drops it fail-soft)", async () => {
  const { deps } = refusalDeps({ ok: false, reason: "not-found" });
  assert.equal(await seoImageRefRefusal({ deps, input: { workspaceId: WS, field: "ogImage", ref: "cover:og" } }), null);
});

test("a known non-image asset ref is refused with the field, asset and content type", async () => {
  const { deps } = refusalDeps({ ok: false, reason: "not-image", contentType: "application/pdf" });
  assert.equal(
    await seoImageRefRefusal({ deps, input: { workspaceId: WS, field: "twitterImage", ref: "doc:og" } }),
    "twitterImage: media asset 'doc' is application/pdf, not an image. A social share image must be an image.",
  );
});
