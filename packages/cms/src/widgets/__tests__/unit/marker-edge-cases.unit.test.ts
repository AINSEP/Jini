import assert from "node:assert/strict";
import { test } from "vitest";

import {
  decodeMarkerHtmlAttribute,
  describeRejection,
  markersOfType,
  scanEmbedMarkers,
  withAddedId,
} from "../../markers/index.js";

/**
 * @file Edge cases of the one embed-marker parser, exercised through the `widgets/markers` public
 * barrel: attribute-entity decoding limits, malformed trailing tags, a `>` inside the JSON config
 * forcing the linear balanced-close fallback, double-quoted id insertion, per-type filtering, and the
 * human-readable rejection lines.
 */

test("decodeMarkerHtmlAttribute leaves an unknown named reference exactly as written", () => {
  assert.equal(decodeMarkerHtmlAttribute({ value: "a &amp; b &bogus; c" }), "a & b &bogus; c");
});

test("decodeMarkerHtmlAttribute decodes in-range numeric references and leaves out-of-range ones as written", () => {
  assert.equal(decodeMarkerHtmlAttribute({ value: "&#65;&#x42;" }), "AB");
  assert.equal(decodeMarkerHtmlAttribute({ value: "&#0;|&#x110000;" }), "&#0;|&#x110000;");
});

test("a trailing malformed tag with no closing '>' does not disturb the marker before it", () => {
  const html = `<div data-embed-config='{"type":"menu","id":"main"}'>fallback</div><div class="unterminated"`;
  const { markers, rejected } = scanEmbedMarkers({ html });

  assert.deepEqual(rejected, []);
  assert.equal(markers.length, 1);
  assert.equal(markers[0]!.inner, "fallback");
  assert.equal(markers[0]!.whole, `<div data-embed-config='{"type":"menu","id":"main"}'>fallback</div>`);
});

test("a '>' inside the JSON config still balances a nested same-name child (linear fallback path)", () => {
  const html = `<div data-embed-config='{"type":"partial","id":"a>b"}'><div>inner</div></div><p>after</p>`;
  const { markers } = scanEmbedMarkers({ html });

  assert.equal(markers.length, 1);
  assert.equal(markers[0]!.id, "a>b");
  assert.equal(markers[0]!.inner, "<div>inner</div>");
  assert.equal(markers[0]!.whole, `<div data-embed-config='{"type":"partial","id":"a>b"}'><div>inner</div></div>`);
});

test("withAddedId keeps a double-quoted marker double-quoted, entity-encoding the rewritten JSON", () => {
  const html = `<section class="x" data-embed-config="{&quot;type&quot;:&quot;form&quot;}">fb</section>`;
  const [marker] = scanEmbedMarkers({ html }).markers;

  const rebuilt = withAddedId({ marker: marker!, id: "contact" });

  assert.equal(rebuilt, `<section class="x" data-embed-config="{&quot;type&quot;:&quot;form&quot;,&quot;id&quot;:&quot;contact&quot;}">fb</section>`);
  assert.deepEqual(scanEmbedMarkers({ html: rebuilt }).markers[0]!.config, { type: "form", id: "contact" });
});

test("withAddedId keeps a single-quoted marker single-quoted, with raw JSON", () => {
  const [marker] = scanEmbedMarkers({ html: `<div data-embed-config='{"type":"menu"}'></div>` }).markers;
  assert.equal(withAddedId({ marker: marker!, id: "main" }), `<div data-embed-config='{"type":"menu","id":"main"}'></div>`);
});

test("markersOfType returns only markers of the requested type, in document order", () => {
  const html = [
    `<nav data-embed-config='{"type":"menu","id":"top"}'></nav>`,
    `<div data-embed-config='{"type":"partial","id":"footer"}'></div>`,
    `<nav data-embed-config='{"type":"menu","id":"side"}'></nav>`,
  ].join("");

  assert.deepEqual(markersOfType({ html, type: "menu" }).map((m) => m.id), ["top", "side"]);
  assert.deepEqual(markersOfType({ html, type: "gallery" }), []);
});

test("describeRejection names the marker occurrence and quotes the offending JSON for each problem kind", () => {
  const html = [
    `<div data-embed-config='{nope'></div>`,
    `<div data-embed-config='[1,2]'></div>`,
    `<div data-embed-config='{"id":"x"}'></div>`,
  ].join("");
  const lines = scanEmbedMarkers({ html }).rejected.map((rejection) => describeRejection({ rejection }));

  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^embed marker #1: data-embed-config is not valid JSON \(.+\) — \{nope$/);
  assert.equal(lines[1], "embed marker #2: data-embed-config must be a JSON object — [1,2]");
  assert.equal(lines[2], `embed marker #3: data-embed-config is missing a "type" — {"id":"x"}`);
});
