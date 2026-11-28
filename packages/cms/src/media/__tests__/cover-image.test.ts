/** @file featfallback: read-only cover selection for public output, with injected media metadata. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { JsonValue } from "@jini-ai/core/primitives";
import { collectCoverMediaRefs, projectPostBody, resolveCoverImage, type CoverImagePost } from "../cover-image.js";

function buildPostRecord(fields: Partial<CoverImagePost> = {}): CoverImagePost {
  return { title: "Hello World", kind: "post", bodyFormat: "doc", bodyJson: { type: "doc", content: [] }, bodyHtml: null, ...fields };
}

const photo = { id: "photo", width: 1200, height: 800, contentType: "image/jpeg" };
const mediaLookup = ({ ref }: { ref: string }) => ref === "photo" || ref === "photo-slug" ? photo : null;
const bodyJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { assetId: "photo", alt: "Body credit" } }] }] };

test("featfallback: nested first body image supplies cover, featured wins, no image yields null, and storage is untouched", () => {
  const post = buildPostRecord({ bodyJson, featuredMediaId: null });
  const before = structuredClone(post);
  assert.deepEqual(resolveCoverImage({ post, mediaLookup }), { mediaId: "photo", alt: "Body credit", width: 1200, height: 800, bodyOccurrence: 0 });
  assert.deepEqual(post, before);
  assert.equal(resolveCoverImage({ post: { ...post, featuredMediaId: "missing" }, mediaLookup }), null);
  assert.deepEqual(resolveCoverImage({ post: { ...post, featuredMediaId: "photo" }, mediaLookup }), { mediaId: "photo", alt: post.title, width: 1200, height: 800 });
  assert.equal(resolveCoverImage({ post: buildPostRecord(), mediaLookup }), null);
});

test("featfallback: media nodes skip videos, select the first image, and default empty alt to the title", () => {
  const post = buildPostRecord({ bodyJson: { type: "doc", content: [
    { type: "media", attrs: { assetId: "video" } },
    { type: "media", attrs: { assetId: "photo", alt: "" } },
    { type: "image", attrs: { assetId: "later" } },
  ] } });
  const lookup = ({ ref }: { ref: string }) => ref === "video" ? { ...photo, id: "video", contentType: "video/mp4" } : mediaLookup({ ref });
  assert.equal(resolveCoverImage({ post, mediaLookup: lookup })?.mediaId, "photo");
  assert.equal(resolveCoverImage({ post, mediaLookup: lookup })?.alt, post.title);
  assert.deepEqual(collectCoverMediaRefs({ post }), ["video", "photo", "later"]);
});

test("featfallback: HTML uses real document order, entity-decoded alt, and the existing media marker parser", () => {
  const post = buildPostRecord({ bodyFormat: "html", bodyJson: {}, bodyHtml:
    `<!-- <img src="/m/later/public.v1/image.jpg"> --><script>"<img src='/m/later/public.v1/image.jpg'>"</script>` +
    `<template><img src="/m/later/public.v1/image.jpg"></template>` +
    `<figure data-embed-config='{"type":"media","slug":"photo-slug","alt":"First & second"}'></figure>` +
    `<img src="/m/later/public.v1/image.jpg">`,
  });
  assert.equal(resolveCoverImage({ post, mediaLookup })?.alt, "First & second");
  assert.equal(resolveCoverImage({ post, mediaLookup })?.mediaId, "photo");
  const htmlImage = { ...post, bodyHtml: `<IMG SRC='/m/photo-slug/public.v1/image.jpg' ALT='Body &amp; image'>` };
  assert.equal(resolveCoverImage({ post: htmlImage, mediaLookup })?.alt, "Body & image");
});

test("featfallback: external images are opt-in HTTPS OG candidates, never private previews or malformed schemes", () => {
  for (const src of ["https://images.example/first.jpg", "http://images.example/a.jpg", "//images.example/a.jpg", "/local.jpg", "data:image/png;base64,abc", "javascript:alert(1)", "https://user:pass@example.com/a.jpg", "https://site.example/api/admin/v1/workspaces/ws/media/id/original"]) {
    const post = buildPostRecord({ bodyJson: { type: "doc", content: [{ type: "image", attrs: { src } }] } });
    assert.equal(resolveCoverImage({ post, mediaLookup }), null);
    const cover = resolveCoverImage({ post, mediaLookup }, { allowExternalHttps: true });
    assert.equal(cover?.url ?? null, src === "https://images.example/first.jpg" ? src : null, src);
  }
});

test("featfallback: HTML external URL and deep documents work without recursive traversal", () => {
  const html = buildPostRecord({ bodyFormat: "html", bodyHtml: '<img src="https://images.example/a.jpg?x=1&amp;y=2" alt="HTML alt">' });
  assert.equal(resolveCoverImage({ post: html, mediaLookup }, { allowExternalHttps: true })?.url, "https://images.example/a.jpg?x=1&y=2");
  let body: unknown = { type: "image", attrs: { assetId: "photo" } };
  for (let i = 0; i < 6000; i++) body = { type: "blockquote", content: [body] };
  assert.equal(resolveCoverImage({ post: { ...html, bodyFormat: "doc", bodyJson: body }, mediaLookup })?.mediaId, "photo");
});

test("postpolish: omit exactly the selected nested occurrence, preserving repeats, captions and the stored tree", () => {
  const post = buildPostRecord({ bodyJson: { type: "doc", content: [
    { type: "media", attrs: { assetId: "missing" } },
    { type: "paragraph", content: [{ type: "image", attrs: { assetId: "photo" } }, { type: "text", text: "Caption" }] },
    { type: "image", attrs: { assetId: "photo" } },
  ] } });
  const before = structuredClone(post);
  const options = { mediaLookup, hasPublicTransform: true };
  assert.deepEqual(projectPostBody({ post, ...options }), { type: "doc", content: [
    { type: "media", attrs: { assetId: "missing" } },
    { type: "paragraph", content: [{ type: "text", text: "Caption" }] },
    { type: "image", attrs: { assetId: "photo" } },
  ] });
  assert.deepEqual(post, before);
  for (const variant of [
    { ...post, ext: { "post-presentation": { hideCoverImageInBody: false } } },
    { ...post, featuredMediaId: "photo" }, { ...post, featuredMediaId: "missing" },
    { ...post, kind: "page" as const }, { ...post, bodyFormat: "html" as const, bodyHtml: '<img src="/m/photo/public.v1/image.jpg">' },
  ]) assert.equal(projectPostBody({ post: variant, ...options }), post.bodyJson);
  assert.equal(projectPostBody({ post, ...options, hasPublicTransform: false }), post.bodyJson);
});

test("postpolish: repeating the same node object still removes exactly one occurrence", () => {
  const image = { type: "image", attrs: { assetId: "photo" } };
  const post = buildPostRecord({ bodyJson: { type: "doc", content: [image, image] } });
  assert.deepEqual(projectPostBody({ post, mediaLookup, hasPublicTransform: true }), { type: "doc", content: [image] });
  assert.deepEqual(post.bodyJson, { type: "doc", content: [image, image] });
});

test("postpolish: malformed nested arrays keep occurrence numbering aligned with selection", () => {
  const image = { type: "image", attrs: { assetId: "photo" } };
  const post = buildPostRecord({ bodyJson: { type: "doc", content: [[image], image] } });
  assert.deepEqual(projectPostBody({ post, mediaLookup, hasPublicTransform: true }), { type: "doc", content: [[], image] });
});

const docPost = (content: JsonValue[]) => buildPostRecord({ bodyJson: { type: "doc", content } });
const htmlPost = (bodyHtml: string | null) => buildPostRecord({ bodyFormat: "html", bodyJson: {}, bodyHtml });

test("cover refs: a rendition src resolves to its library ref, and a malformed escape is no ref", () => {
  assert.deepEqual(collectCoverMediaRefs({ post: docPost([{ type: "image", attrs: { src: " /m/photo%20one/public.v2/a.jpg?w=1 " } }]) }), ["photo one"]);
  assert.deepEqual(collectCoverMediaRefs({ post: docPost([{ type: "image", attrs: { src: "/m/%E0%A4%A/public.v1/a.jpg" } }]) }), []);
  assert.deepEqual(collectCoverMediaRefs({ post: docPost([{ type: "image", attrs: { src: "/m/photo/original/a.jpg" } }]) }), []);
});

test("cover refs: non-string src/assetId/alt attributes are ignored rather than coerced", () => {
  const post = docPost([{ type: "image", attrs: { src: 7, assetId: 8, alt: 9 } }, { type: "image", attrs: { assetId: "photo", alt: 10 } }]);
  assert.deepEqual(collectCoverMediaRefs({ post }), ["photo"]);
  assert.equal(resolveCoverImage({ post, mediaLookup })?.alt, post.title);
});

test("cover refs: image nodes without an attrs object, and non-object nodes, are not candidates", () => {
  const post = docPost([{ type: "image" }, { type: "media", attrs: [] }, "text", null, { type: "image", attrs: { assetId: "photo" } }]);
  assert.deepEqual(collectCoverMediaRefs({ post }), ["photo"]);
  assert.equal(resolveCoverImage({ post, mediaLookup })?.bodyOccurrence, 0);
});

test("cover refs: deduplicates repeated references in first-seen order", () => {
  const post = docPost([{ type: "image", attrs: { assetId: "b" } }, { type: "image", attrs: { assetId: "a" } }, { type: "image", attrs: { assetId: "b" } }]);
  assert.deepEqual(collectCoverMediaRefs({ post }), ["b", "a"]);
});

test("cover refs: an HTML post with no stored HTML has no candidates", () => {
  assert.deepEqual(collectCoverMediaRefs({ post: htmlPost(null) }), []);
});

test("HTML media markers: the id wins over the slug, a marker without a string ref is skipped, and its fallback is never a candidate", () => {
  const html = `<figure data-embed-config='{"type":"media","id":"by-id","slug":"by-slug"}'><img src="/m/fallback/public.v1/a.jpg"></figure>` +
    `<figure data-embed-config='{"type":"media","slug":5}'><img src="/m/inner/public.v1/a.jpg"></figure>` +
    `<div data-embed-config='{"type":"menu","id":"nav"}'><img src="/m/menu-child/public.v1/a.jpg"></div>`;
  assert.deepEqual(collectCoverMediaRefs({ post: htmlPost(html) }), ["by-id", "menu-child"]);
});

test("HTML media markers: with no marker alt, the element alt is the fallback", () => {
  const html = `<img data-embed-config='{"type":"media","id":"photo"}' alt="Element alt">`;
  assert.equal(resolveCoverImage({ post: htmlPost(html), mediaLookup })?.alt, "Element alt");
});

test("resolve: unknown MIME follows the featured contract, and lookup canonical ids replace slugs", () => {
  const post = docPost([{ type: "image", attrs: { assetId: "slug" } }]);
  assert.deepEqual(resolveCoverImage({ post, mediaLookup: () => ({ width: null, height: null, contentType: null }) }), { mediaId: "slug", alt: post.title, width: null, height: null, bodyOccurrence: 0 });
  assert.equal(resolveCoverImage({ post, mediaLookup: () => ({ id: "canonical", width: 1, height: 2, contentType: "image/png" }) })?.mediaId, "canonical");
});

test("resolve: an external candidate without a usable URL falls through to a later library image", () => {
  const post = docPost([{ type: "image", attrs: { src: "https://[broken" } }, { type: "image", attrs: { alt: "no src" } }, { type: "image", attrs: { assetId: "photo" } }]);
  assert.equal(resolveCoverImage({ post, mediaLookup }, { allowExternalHttps: true })?.mediaId, "photo");
});

test("external OG URLs: an upper-case HTTPS scheme is accepted verbatim, and a password-only credential is refused", () => {
  const upper = docPost([{ type: "image", attrs: { src: "HTTPS://images.example/a.jpg" } }]);
  assert.equal(resolveCoverImage({ post: upper, mediaLookup }, { allowExternalHttps: true })?.url, "HTTPS://images.example/a.jpg");
  const password = docPost([{ type: "image", attrs: { src: "https://:secret@images.example/a.jpg" } }]);
  assert.equal(resolveCoverImage({ post: password, mediaLookup }, { allowExternalHttps: true }), null);
});

test("projectPostBody: a non-object stored body is returned as-is even when a cover is selected", () => {
  const body = [{ type: "image", attrs: { assetId: "photo" } }];
  const post: CoverImagePost = { ...buildPostRecord(), bodyJson: body };
  assert.equal(projectPostBody({ post, mediaLookup, hasPublicTransform: true }), body);
});

test("projectPostBody: an explicit hideCoverImageInBody true still hides, and a non-object presentation is ignored", () => {
  const post = docPost([{ type: "image", attrs: { assetId: "photo" } }, { type: "text", text: "after" }]);
  for (const presentation of [{ hideCoverImageInBody: true }, "off"]) {
    assert.deepEqual(projectPostBody({ post: { ...post, ext: { "post-presentation": presentation } }, mediaLookup, hasPublicTransform: true }), { type: "doc", content: [{ type: "text", text: "after" }] });
  }
});

test("projectPostBody: an image node without attrs is copied and does not consume an occurrence", () => {
  const post = docPost([{ type: "image" }, { type: "image", attrs: { assetId: "photo" } }]);
  assert.deepEqual(projectPostBody({ post, mediaLookup, hasPublicTransform: true }), { type: "doc", content: [{ type: "image" }] });
});

test("projectPostBody: no usable cover returns the stored body unchanged", () => {
  const post = docPost([{ type: "image", attrs: { assetId: "missing" } }]);
  assert.equal(projectPostBody({ post, mediaLookup, hasPublicTransform: true }), post.bodyJson);
});

test("HTML: images inside parser-implied elements (a table's tbody has no source location) are still candidates", () => {
  assert.deepEqual(collectCoverMediaRefs({ post: htmlPost(`<table><tr><td><img src="/m/photo/public.v1/a.jpg"></td></tr></table>`) }), ["photo"]);
});

test("projectPostBody: primitive children in malformed content are copied through in place", () => {
  const post = docPost(["raw", null, { type: "image", attrs: { assetId: "photo" } }, 3]);
  assert.deepEqual(projectPostBody({ post, mediaLookup, hasPublicTransform: true }), { type: "doc", content: ["raw", null, 3] });
});

// Mutation: prefer bodyHtml for doc posts, reverse HTML traversal, or prefer img to marker.
test("cover priority follows body format, then marker and image document order", () => {
  const html = `<figure data-embed-config='{"type":"media","id":"marker"}'></figure><img src="/m/html/public.v1/a.jpg">`;
  const post = buildPostRecord({ bodyJson, bodyHtml: html });
  const lookup = ({ ref }: { ref: string }) => ({ ...photo, id: ref });
  assert.equal(resolveCoverImage({ post, mediaLookup: lookup })?.mediaId, "photo");
  assert.deepEqual(collectCoverMediaRefs({ post: { ...post, bodyFormat: "html" } }), ["marker", "html"]);
  assert.equal(resolveCoverImage({ post: { ...post, bodyFormat: "html" }, mediaLookup: lookup })?.mediaId, "marker");
});

// Mutation: return null on the first missing body candidate instead of continuing.
test("a missing body reference falls through while a missing featured reference remains final", () => {
  const post = docPost([{ type: "image", attrs: { assetId: "missing" } }, { type: "image", attrs: { assetId: "photo" } }]);
  assert.equal(resolveCoverImage({ post, mediaLookup })?.bodyOccurrence, 1);
  assert.equal(resolveCoverImage({ post: { ...post, featuredMediaId: "missing" }, mediaLookup }), null);
});

// Mutation: replace the iterative body copy with recursive descent or remove all matching ids.
test("projectPostBody removes one occurrence in a 5,000-deep document without changing storage", () => {
  const image = { type: "image", attrs: { assetId: "photo" } };
  let body: unknown = { type: "paragraph", content: [image, image] };
  for (let i = 0; i < 5000; i++) body = { type: "blockquote", content: [body] };
  const post = buildPostRecord({ bodyJson: body });
  let projected = projectPostBody({ post, mediaLookup, hasPublicTransform: true });
  let stored = post.bodyJson;
  for (let i = 0; i < 5000; i++) {
    assert.notEqual(projected, stored);
    assert.ok(projected && typeof projected === "object" && "content" in projected && Array.isArray(projected.content));
    assert.ok(stored && typeof stored === "object" && "content" in stored && Array.isArray(stored.content));
    projected = projected.content[0];
    stored = stored.content[0];
  }
  assert.deepEqual(projected, { type: "paragraph", content: [image] });
  assert.deepEqual(stored, { type: "paragraph", content: [image, image] });
  assert.equal(post.bodyJson, body);
});

// Gap fill (cloud A3-4). Mutation: drop the `i in items` hole check (a hole would then be read as undefined and skipped).
test("a hole in an in-memory body array fails closed in both cover selection and body projection", () => {
  const holey: unknown[] = [];
  holey[1] = { type: "image", attrs: { assetId: "photo" } }; // index 0 stays a hole
  const post: CoverImagePost = { ...buildPostRecord(), bodyJson: { type: "doc", content: holey } };
  assert.throws(() => resolveCoverImage({ post, mediaLookup }), /^Error: Cover image traversal has a missing item$/);
  assert.throws(() => collectCoverMediaRefs({ post }), /^Error: Cover image traversal has a missing item$/);
  // Selection runs first in projection, so a holey body never reaches the copy step half-copied.
  assert.throws(() => projectPostBody({ post, mediaLookup, hasPublicTransform: true }), /^Error: Cover image traversal has a missing item$/);
});
