import assert from "node:assert/strict";
import { test } from "vitest";

import { collectMediaUrlKeys, collectReferencedMediaKeys } from "../media-references.js";

/**
 * @file `collectReferencedMediaKeys` — which media a packed post/page state points at, so a scoped
 * "Publish pages"/"Publish posts" run can carry those images along (owner decision, 2026-09-25).
 *
 * Every shape here is one the real content DB holds today: a ref-based TipTap `image`/`media` node
 * (`attrs.assetId`), a legacy `image` node whose `attrs.src` is an admin media URL, a `/m/{key}/…`
 * public URL, an `"html"` Page's `data-embed-config` media marker (by `id` or `slug`), and an SEO
 * share-image ref (`"{assetId}:{transformName}"`).
 */

function keys(state: Record<string, unknown>): string[] {
  return [...collectReferencedMediaKeys({ state })].sort();
}

test("a ref-based image or media node contributes its assetId", () => {
  const bodyJson = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "image", attrs: { assetId: "asset-1", transformName: "public" } },
      { type: "blockquote", content: [{ type: "media", attrs: { assetId: "asset-2" } }] },
    ],
  };
  assert.deepEqual(keys({ bodyJson }), ["asset-1", "asset-2"]);
});

test("a legacy image node's admin media URL and a /m/ public URL both contribute their key", () => {
  const bodyJson = {
    type: "doc",
    content: [
      { type: "image", attrs: { src: "http://localhost:3000/api/admin/v1/workspaces/w/media/asset-3/original" } },
      { type: "image", attrs: { src: "/m/blue-circle/public.v2/image.webp" } },
    ],
  };
  assert.deepEqual(keys({ bodyJson }), ["asset-3", "blue-circle"]);
});

test("an html body contributes media markers by id or slug, and /m/ URLs", () => {
  const bodyHtml =
    `<div data-embed-config='{"type":"media","id":"asset-4"}'></div>` +
    `<div data-embed-config='{"type":"media","slug":"hero-shot"}'></div>` +
    `<div data-embed-config='{"type":"widget","id":"not-media"}'></div>` +
    `<img src="/m/asset-5/original">`;
  assert.deepEqual(keys({ bodyHtml }), ["asset-4", "asset-5", "hero-shot"]);
});

test("URL media keys are decoded while malformed escapes retain their original key", () => {
  const bodyJson = {
    type: "doc",
    content: [
      { type: "image", attrs: { src: "/api/admin/v1/workspaces/w/media/hero%20photo/original" } },
      { type: "image", attrs: { src: "/m/caf%C3%A9/public.v1/image.webp" } },
      { type: "image", attrs: { src: "/m/bad%ZZ/original" } },
    ],
  };
  assert.deepEqual(keys({ bodyJson }), ["bad%ZZ", "café", "hero photo"]);
});

test("an SEO share image ref contributes its asset id (seoExtJson is stored as a JSON string)", () => {
  assert.deepEqual(keys({ seoExtJson: JSON.stringify({ ogImage: "asset-6:public", twitterImage: "asset-7:public" }) }), [
    "asset-6",
    "asset-7",
  ]);
});

test("a state with no media reference contributes nothing", () => {
  assert.deepEqual(
    keys({
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "/m/ is just text" }] }] },
      bodyHtml: null,
      seoExtJson: JSON.stringify({ schemaType: "TechArticle" }),
    }),
    []
  );
});

test("a link mark pointing at a media file contributes its key (a copied /m/ public URL pasted as a link)", () => {
  const bodyJson = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Download the brochure", marks: [{ type: "link", attrs: { href: "/m/brochure-pdf/original" } }] },
          { type: "text", text: " or the old one", marks: [{ type: "link", attrs: { href: "https://example.test/api/admin/v1/workspaces/w/media/asset-9/original" } }] },
        ],
      },
    ],
  };
  assert.deepEqual(keys({ bodyJson }), ["asset-9", "brochure-pdf"]);
});

test("an html media marker is matched case-insensitively, the way the embed resolver reads it", () => {
  const bodyHtml = `<div data-embed-config='{"type":"Media","slug":"hand-typed"}'></div>`;
  assert.deepEqual(keys({ bodyHtml }), ["hand-typed"]);
});

test("an SEO share image given as an absolute /m/ URL contributes its key, not the URL scheme", () => {
  assert.deepEqual(keys({ seoExtJson: JSON.stringify({ ogImage: "https://site.example/m/og-card/public.v3/image.webp" }) }), [
    "og-card",
  ]);
});

test("TW2 pins malformed documents, asset precedence, inline config and SEO fallbacks", () => {
  assert.deepEqual(keys({ bodyJson: [null, 3, { type: "image", attrs: { assetId: "", src: "/m/ignored/x" } },
    { type: "media", attrs: { src: "/m/legacy/x" }, marks: [null, { attrs: { href: "/m/marked/x", count: 1 } }] },
    { type: "widgetEmbed", attrs: { content: { html: '<img src="/m/inline/x">' } } }],
    seoExtJson: { ogImage: ":empty", twitterImage: "seo:public" } }), ["", "inline", "legacy", "marked", "seo"]);
  for (const seoExtJson of ['{', null, [], 2, { ogImage: 7 }]) assert.deepEqual(keys({ seoExtJson }), []);
  assert.deepEqual(keys({ bodyHtml: `<div data-embed-config='{"type":"gallery","images":[{"src":"/m/decoded/x"},null]}'></div>` }), ["decoded"]);
});

import { collectPlacedWidgetMediaKeys } from "../media-references.js";
test("TW2 pins placed-widget readability, missing entries, active modes and overlays", () => {
  const bodyJson = [null, { type: "widgetEmbed", attrs: { widgetEntryId: "saved", content: { html: '<img src="/m/overlay/x">' } } }];
  assert.deepEqual(collectPlacedWidgetMediaKeys({ bodyJson }), { keys: new Set(), readable: false });
  assert.deepEqual(collectPlacedWidgetMediaKeys({ bodyJson, savedWidgets: new Map() }), { keys: new Set(), readable: true });
  for (const config of [{ mode: "html", html: '<img src="/m/old/x">' }, { html: '<img src="/m/old/x">' }]) {
    assert.deepEqual(collectPlacedWidgetMediaKeys({ bodyJson, savedWidgets: new Map([["saved", config]]) }), { keys: new Set(["overlay"]), readable: true });
  }
  const bodyHtml = `<div data-embed-config='{"type":"Widget","id":"saved"}'></div><div data-embed-config='{"type":"media","id":"other"}'></div>`;
  assert.deepEqual(collectPlacedWidgetMediaKeys({ bodyHtml, savedWidgets: new Map([["saved", { mode: "html", html: '<img src="/m/saved/x">' }]]) }), { keys: new Set(["saved"]), readable: true });
});

test("placed widgets with no explicit mode scan their items, and a config with neither items nor html is scanned whole", () => {
  const bodyJson = [{ type: "widgetEmbed", attrs: { widgetEntryId: "saved" } }];
  const scan = (config: Record<string, unknown>) => collectPlacedWidgetMediaKeys({ bodyJson, savedWidgets: new Map([["saved", config]]) });
  assert.deepEqual(scan({ items: [{ slug: "from-items" }], html: '<img data-media-slug="ignored">' }), { keys: new Set(["from-items"]), readable: true });
  assert.deepEqual(scan({ content: { items: [{ slug: "legacy-nested" }] } }), { keys: new Set(["legacy-nested"]), readable: true });
});

test("data-media-slug references in raw HTML count, in body HTML and in free text", () => {
  assert.deepEqual([...collectReferencedMediaKeys({ state: { bodyHtml: '<p><img data-media-slug="body-slug"></p>' } })], ["body-slug"]);
  assert.ok(collectMediaUrlKeys({ text: 'Intro <img data-media-slug="text-slug"> and /m/url-key/file.png' }).has("text-slug"));
});

test("a gallery marker with no images array contributes nothing and does not throw", () => {
  assert.deepEqual([...collectReferencedMediaKeys({ state: { bodyHtml: `<div data-embed-config='{"type":"gallery","layout":"grid"}'></div>` } })], []);
});

test("collectMediaUrlKeys finds every /m/ and /media/ URL key in free text, decoded", () => {
  const keys = collectMediaUrlKeys({ text: 'See https://site.example/m/hero%20shot/w800.webp and /media/logo/original.png' });
  assert.deepEqual([...keys].sort(), ["hero shot", "logo"]);
});
