import assert from "node:assert/strict";
import { test } from "vitest";
import { attributeValueHtml, resolveEmbedHtmlAttributes, formatHtmlAttributes, omitKey, NO_MARKER_ATTRIBUTES,
  mergeMediaClassAttr, foldHtmlAttributesClass, mediaAltAttrValue, mediaDimensionAttr, mergeMediaExtraAttributes } from "../media-attributes.js";

test("a bare marker dimension suppresses its asset fallback", () => {
  assert.equal(mediaDimensionAttr({ name: "width", assetValue: 640, markerAttributes: [{ name: "width", value: null }] }), "");
  assert.equal(mediaDimensionAttr({ name: "width", assetValue: 640, markerAttributes: [{ name: "width", value: "320" }] }), ' width="320"');
  assert.equal(mediaDimensionAttr({ name: "height", assetValue: 480, markerAttributes: NO_MARKER_ATTRIBUTES }), ' height="480"');
  assert.equal(mediaDimensionAttr({ name: "height", assetValue: null, markerAttributes: NO_MARKER_ATTRIBUTES }), "");
});

test("marker source entities remain single-encoded while asset values are escaped", () => {
  assert.equal(attributeValueHtml({ value: 'A &amp; \"caption\"', source: "marker" }), "A &amp; &quot;caption&quot;");
  assert.equal(attributeValueHtml({ value: 'A & \"caption\"', source: "asset" }), "A &amp; &quot;caption&quot;");
  assert.equal(mediaAltAttrValue({ assetAlt: "asset & alt", markerAttributes: [{ name: "alt", value: "Marker &amp; caption" }] }), "Marker &amp; caption");
  assert.equal(mediaAltAttrValue({ assetAlt: "asset", markerAttributes: [{ name: "alt", value: null }] }), "");
  assert.equal(mediaAltAttrValue({ assetAlt: "asset & alt", markerAttributes: NO_MARKER_ATTRIBUTES }), "asset &amp; alt");
});

test("class contributions keep asset, marker, then extra order", () => {
  const classAttr = mergeMediaClassAttr({ assetClass: "rounded & wide", markerAttributes: [{ name: "class", value: "hero &amp; framed" }] });
  assert.equal(classAttr, ' class="rounded &amp; wide hero &amp; framed"');
  assert.equal(foldHtmlAttributesClass({ classAttr, extraClass: "extra & bold" }), ' class="rounded &amp; wide hero &amp; framed extra &amp; bold"');
  assert.equal(foldHtmlAttributesClass({ classAttr: "", extraClass: "extra" }), ' class="extra"');
  assert.equal(foldHtmlAttributesClass({ classAttr, extraClass: undefined }), classAttr);
});

test("marker extras win in place and new extras append in authored order with fixed names filtered", () => {
  assert.equal(mergeMediaExtraAttributes({
    assetExtras: { "data-first": "asset & first", title: "old", loading: "lazy" },
    markerAttributes: [{ name: "title", value: "new &amp; title" }, { name: "id", value: "v1" }, { name: "autoplay", value: null },
      { name: "src", value: "bad" }, { name: "srcset", value: "bad" }, { name: "loading", value: "eager" }],
    excludeNames: new Set(["loading"]),
  }), ' data-first="asset &amp; first" title="new &amp; title" id="v1" autoplay');
});

test("render-time parsing drops one unsafe token and formats accepted attributes in order", () => {
  const attributes = resolveEmbedHtmlAttributes({ raw: 'data-x="1" onclick="alert(1)" style="border:0" title="A & B"' });
  assert.equal(formatHtmlAttributes({ attributes }), ' data-x="1" style="border:0" title="A &amp; B"');
  assert.deepEqual(omitKey({ attributes, key: "style" }), { "data-x": "1", title: "A & B" });
  assert.deepEqual(resolveEmbedHtmlAttributes({ raw: null }), {});
});
