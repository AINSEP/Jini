import assert from "node:assert/strict";
import { test } from "vitest";

import { mediaPublicPath, mediaUrlKey } from "../public-path.js";

/**
 * @file `mediaUrlKey`/`mediaPublicPath` (readable-slugs plan S1) — the one place that decides
 * whether a `/m/...` URL is keyed by id or by slug, and the one place that templates the path
 * itself. See `../public-path.ts`'s own header for the design.
 */

test("mediaUrlKey prefers a valid slug over the id", () => {
  assert.equal(mediaUrlKey({ id: "asset-1", slug: "fox" }), "fox");
});

test("mediaUrlKey falls back to the id for a null, empty, or malformed slug", () => {
  for (const slug of [null, "", "..", "a/b", "550e8400-e29b-41d4-a716-446655440000"]) {
    assert.equal(mediaUrlKey({ id: "asset-1", slug }), "asset-1", `expected fallback to id for slug ${JSON.stringify(slug)}`);
  }
});

test("mediaUrlKey falls back to the id when a slug is not present at all", () => {
  assert.equal(mediaUrlKey({ id: "asset-1" }), "asset-1");
});

// Guards mediaPublicPath's single content-version suffix for both original and transform variants.
test("mediaPublicPath versions every managed URL with the current source SHA prefix", () => {
  const sha256 = "0123456789abcdef".repeat(4);
  assert.equal(mediaPublicPath({ key: "fox", sha256, variant: { kind: "original", contentType: "video/mp4" } }), "/m/fox/original.mp4?v=0123456789ab");
  assert.equal(mediaPublicPath({ key: "fox", sha256, variant: { kind: "transform", name: "public", version: 3, ext: "jpg" } }), "/m/fox/public.v3/image.jpg?v=0123456789ab");
});

test("mediaPublicPath gives originals their trusted content-type extension, encoding the key", () => {
  for (const [contentType, ext] of [["image/svg+xml", "svg"], ["video/mp4", "mp4"], ["application/pdf", "pdf"], ["audio/mpeg", "mp3"]] as const) {
    assert.equal(mediaPublicPath({ key: "fox photo", variant: { kind: "original", contentType } }), `/m/fox%20photo/original.${ext}`);
  }
  assert.equal(mediaPublicPath({ key: "fox", variant: { kind: "original", contentType: "unknown/../../svg" } }), "/m/fox/original.bin");
});

test("mediaPublicPath builds the versioned-transform path, encoding key and transform name", () => {
  assert.equal(
    mediaPublicPath({ key: "fox", variant: { kind: "transform", name: "public", version: 3, ext: "jpg" } }),
    "/m/fox/public.v3/image.jpg"
  );
  assert.equal(
    mediaPublicPath({ key: "asset-1", variant: { kind: "transform", name: "a b", version: 1, ext: "webp" } }),
    "/m/asset-1/a%20b.v1/image.webp"
  );
});
