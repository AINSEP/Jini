import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { expect, it } from "vitest";
import { appendMediaSlugs, insertAtSelection, legacyImagesToItems, mediaKindOf, mediaSlugProblem, mediaSnippetFor, moveMediaItem } from "../media-content-rules.js";

const library: AdminMedia[] = [{
  id: "legacy-17", workspaceId: "library", title: "Garden", slug: "roof-garden", alt: "Plants", caption: "Spring", credit: "",
  sha256: "a".repeat(64), status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01", version: 1,
  width: 120, height: 80, cssClass: null, htmlAttributes: null, contentType: "image/png", publicUrl: "/m/roof-garden",
}];

it("migrates legacy image IDs to slugs while keeping unresolved rows and authored text", () => {
  expect(legacyImagesToItems({ images: [
    { mediaId: "legacy-17", alt: "New alt", caption: "New caption", src: "ignored" },
    { mediaId: "deleted-asset", alt: 25 },
    null,
    { mediaId: 17 },
    { slug: "not-a-legacy-row" },
  ], library })).toEqual([
    { slug: "roof-garden", alt: "New alt", caption: "New caption" },
    { slug: "deleted-asset" },
  ]);
});

it("keeps a legacy row's ID until its library becomes available", () => {
  expect(legacyImagesToItems({ images: [{ mediaId: "legacy-17", alt: "" }], library: null })).toEqual([{ slug: "legacy-17", alt: "" }]);
});

it("clamps a real move to the destination boundary without overwriting an item's overrides", () => {
  const items = [{ slug: "first" }, { slug: "move-me", alt: "An override" }, { slug: "last" }];
  expect(moveMediaItem({ items, from: 1, to: -99 })).toEqual([{ slug: "move-me", alt: "An override" }, { slug: "first" }, { slug: "last" }]);
  expect(moveMediaItem({ items, from: 1, to: 99 })).toEqual([{ slug: "first" }, { slug: "last" }, { slug: "move-me", alt: "An override" }]);
  expect(items.map(({ slug }) => slug)).toEqual(["first", "move-me", "last"]);
});

it.each([
  { label: "below zero", from: -1, to: 1 },
  { label: "past the end", from: 2, to: 0 },
  { label: "already at the boundary", from: 0, to: -99 },
])("leaves the same array when moving $label", ({ from, to }) => {
  const items = [{ slug: "first" }, { slug: "last" }];
  expect(moveMediaItem({ items, from, to })).toBe(items);
});

it.each([
  { caseName: "whitespace only", slug: " \t ", count: 0, existing: "", loaded: true, problem: "empty" },
  { caseName: "slash inside a slug", slug: "roof/garden", count: 0, existing: "", loaded: false, problem: "invalid" },
  { caseName: "fifty items", slug: "roof-garden", count: 50, existing: "", loaded: true, problem: "full" },
  { caseName: "trimmed duplicate", slug: " roof-garden ", count: 0, existing: "roof-garden", loaded: true, problem: "duplicate" },
  { caseName: "unknown slug after lookup", slug: "absent", count: 0, existing: "", loaded: true, problem: "unknown" },
  { caseName: "unknown slug before lookup", slug: "absent", count: 0, existing: "", loaded: false, problem: null },
  { caseName: "known trimmed slug", slug: " roof-garden ", count: 0, existing: "", loaded: true, problem: null },
])("validates $caseName before adding it", ({ slug, count, existing, loaded, problem }) => {
  const items = Array.from({ length: count }, (_, i) => ({ slug: `item-${i}` }));
  if (existing) items.push({ slug: existing });
  expect(mediaSlugProblem({ slug, items, library: loaded ? library : null })).toBe(problem);
});

it("appends unique slugs in pick order without copying text or exceeding the 50-item limit", () => {
  const items = Array.from({ length: 48 }, (_, i) => ({ slug: `item-${i}`, alt: `Alt ${i}` }));
  const next = appendMediaSlugs({ items, slugs: ["item-0", "new-video", "new-video", "new-image", "over-limit"] });

  expect(next).toHaveLength(50);
  expect(next.slice(0, 48)).toEqual(items);
  expect(next.slice(48)).toEqual([{ slug: "new-video" }, { slug: "new-image" }]);
  expect(items).toHaveLength(48);
});

it.each([
  { contentType: "image/png", kind: "image", snippet: '<img data-media-slug="a&amp;&quot;b" alt="Fish &amp; &quot;chips&quot;">', alt: "Fish & \"chips\"" },
  { contentType: "video/webm", kind: "video", snippet: '<video data-media-slug="a&amp;&quot;b" controls></video>', alt: "Do not render this" },
  { contentType: "audio/mpeg", kind: "audio", snippet: '<audio data-media-slug="a&amp;&quot;b" controls></audio>', alt: "Do not render this" },
  { contentType: "application/pdf", kind: "unknown", snippet: '<img data-media-slug="a&amp;&quot;b" alt="">', alt: "" },
  { contentType: null, kind: "unknown", snippet: '<img data-media-slug="a&amp;&quot;b" alt="">' },
])("classifies $contentType and generates slug-based HTML", ({ contentType, kind, snippet, alt }) => {
  expect(mediaKindOf({ contentType })).toBe(kind);
  expect(mediaSnippetFor({ slug: 'a&"b', contentType, ...(alt === undefined ? {} : { alt }) })).toBe(snippet);
});

it.each([
  { label: "selected text", start: 2, end: 5, expected: { text: "ab<>f", caret: 4 } },
  { label: "a selection outside both edges", start: -5, end: 20, expected: { text: "<>", caret: 2 } },
  { label: "a negative-width selection", start: 3, end: 1, expected: { text: "abc<>def", caret: 5 } },
  { label: "a position beyond the end", start: 100, end: 100, expected: { text: "abcdef<>", caret: 8 } },
])("returns replacement text and the trailing caret for $label", ({ start, end, expected }) => {
  expect(insertAtSelection({ text: "abcdef", start, end, insert: "<>" })).toEqual(expected);
});
