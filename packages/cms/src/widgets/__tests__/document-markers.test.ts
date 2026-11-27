import assert from "node:assert/strict";
import { test } from "vitest";
import { renderDocWithManagedMarkers } from "../document-markers.js";
import { isPlausibleMediaRefId, plausibleMediaRefId } from "../markers/media-reference.js";

test("managed media and widgets substitute in order with class folding, escaped alt and JSON apostrophes", () => {
  const legacy = { type: "image", attrs: { src: "https://example.test/a.png", alt: "Legacy" } };
  const invalid = { type: "media", attrs: { assetId: "bad/ref" } };
  const bodyJson = { type: "doc", content: [
    { type: "media", attrs: { assetId: "asset-1", alt: 'Our & "shop"', cssClass: "base", htmlAttributes: 'class="extra" title="A & B"' } },
    { type: "image", attrs: { assetId: "asset-2", transformName: "hero", alt: "Hero" } },
    { type: "widgetEmbed", attrs: { placementId: "p", widgetEntryId: "w", cssClass: "wide", content: { note: "it's" } } },
    legacy, invalid,
  ] };
  const html = renderDocWithManagedMarkers({ bodyJson, token: "DOC123N", maxDepth: 10, renderDocNode: ({ node }) => {
    assert.deepEqual(node, { type: "doc", content: [
      { type: "text", text: "DOC123N0X" }, { type: "text", text: "DOC123N1X" }, { type: "text", text: "DOC123N2X" }, legacy, invalid,
    ] });
    return 'DOC123N0XDOC123N1XDOC123N2X<img src="https://example.test/a.png" alt="Legacy">placeholder';
  } });
  assert.equal(html, '<div class="base extra" alt="Our &amp; &quot;shop&quot;" title="A &amp; B" data-embed-config=\'{"type":"media","id":"asset-1"}\'></div>' +
    '<div alt="Hero" data-embed-config=\'{"type":"media","id":"asset-2"}\'></div>' +
    '<div class="wide" data-embed-config=\'{"type":"widget","id":"w","content":{"note":"it\\u0027s"}}\'></div>' +
    '<img src="https://example.test/a.png" alt="Legacy">placeholder');
});

test("reference shape rejects slashes, whitespace and overlong refs without changing legacy nodes", () => {
  for (const value of ["", "bad/ref", "two words", "x".repeat(201), null, 3]) {
    assert.equal(isPlausibleMediaRefId({ value }), false);
    assert.equal(plausibleMediaRefId({ value }), undefined);
  }
  assert.equal(plausibleMediaRefId({ value: "x".repeat(200) }), "x".repeat(200));
  const bodyJson = { type: "image", attrs: { assetId: "bad/ref", src: "/legacy.jpg" } };
  assert.equal(renderDocWithManagedMarkers({ bodyJson, token: "DOC1N", maxDepth: 10, renderDocNode: ({ node }) => {
    assert.equal(node, bodyJson);
    return "unchanged";
  } }), "unchanged");
});

test("the depth boundary includes the last allowed level and leaves deeper nodes intact", () => {
  const deep = { type: "image", attrs: { assetId: "deep" } };
  const bodyJson = { type: "doc", content: [
    { type: "image", attrs: { assetId: "edge" } }, { type: "paragraph", content: [deep] },
  ] };
  assert.equal(renderDocWithManagedMarkers({ bodyJson, token: "DOC2N", maxDepth: 1, renderDocNode: ({ node }) => {
    assert.deepEqual(node, { type: "doc", content: [
      { type: "text", text: "DOC2N0X" }, { type: "paragraph", content: [deep] },
    ] });
    return "DOC2N0Xdeep";
  } }), '<div data-embed-config=\'{"type":"media","id":"edge"}\'></div>deep');
});

test("functional replacement keeps literal replacement metacharacters in marker JSON", () => {
  assert.equal(renderDocWithManagedMarkers({ bodyJson: { type: "widgetEmbed", attrs: { widgetEntryId: "w", content: { note: "$&" } } }, token: "DOC3N", maxDepth: 0, renderDocNode: ({ node }) => {
    assert.deepEqual(node, { type: "text", text: "DOC3N0X" });
    return "beforeDOC3N0Xafter";
  } }), 'before<div data-embed-config=\'{"type":"widget","id":"w","content":{"note":"$&"}}\'></div>after');
});

test("malformed children stay with the document renderer and non-text marker attributes are omitted", () => {
  const malformed = [null, ["legacy"], { type: "widgetEmbed", attrs: [] }, { type: "widgetEmbed", attrs: { widgetEntryId: 42 } }];
  const bodyJson = { type: "doc", content: [...malformed, { type: "image", attrs: { assetId: "photo", alt: 42, cssClass: 9, htmlAttributes: { title: "not text" } } }] };
  const html = renderDocWithManagedMarkers({ bodyJson, token: "DOC5N", maxDepth: 10, renderDocNode: ({ node }) => {
    assert.deepEqual(node, { type: "doc", content: [...malformed, { type: "text", text: "DOC5N0X" }] });
    return "<p>Legacy fallback</p>DOC5N0X";
  } });
  assert.equal(html, '<p>Legacy fallback</p><div data-embed-config=\'{"type":"media","id":"photo"}\'></div>');
});

test("the managed golden document preserves headings and tail at the document-renderer port", () => {
  const headings = [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Same" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Same" }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Über Café!" }] },
  ];
  const tail = { type: "paragraph", content: [{ type: "text", text: "tail" }] };
  const bodyJson = { type: "doc", content: [
    ...headings,
    { type: "widgetEmbed", attrs: { widgetEntryId: "w1", cssClass: "emb", htmlAttributes: 'data-k="v" class="c2"' } },
    { type: "image", attrs: { assetId: "asset1", transformName: "thumb", alt: "managed <x>" } },
    { type: "media", attrs: { assetId: "asset2", cssClass: "m" } },
    tail,
  ] };
  assert.equal(renderDocWithManagedMarkers({ bodyJson, token: "DOC4N", maxDepth: 200, renderDocNode: ({ node }) => {
    assert.deepEqual(node, { type: "doc", content: [
      ...headings, { type: "text", text: "DOC4N0X" }, { type: "text", text: "DOC4N1X" }, { type: "text", text: "DOC4N2X" }, tail,
    ] });
    return '<h2 id="same">Same</h2><h2 id="same-2">Same</h2><h3 id="uber-cafe">Über Café!</h3>DOC4N0XDOC4N1XDOC4N2X<p>tail</p>';
  } }), '<h2 id="same">Same</h2><h2 id="same-2">Same</h2><h3 id="uber-cafe">Über Café!</h3>' +
    '<div class="emb c2" data-k="v" data-embed-config=\'{"type":"widget","id":"w1"}\'></div>' +
    '<div alt="managed &lt;x&gt;" data-embed-config=\'{"type":"media","id":"asset1"}\'></div>' +
    '<div class="m" data-embed-config=\'{"type":"media","id":"asset2"}\'></div><p>tail</p>');
});
