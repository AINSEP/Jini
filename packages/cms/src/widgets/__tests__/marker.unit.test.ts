import assert from "node:assert/strict";
import { test } from "vitest";

import {
  embedMarkerSnippet,
  embedMarkerTarget,
  formatMarkerAttributes,
  hasAuthoredAttributes,
  normalizeEmbedMarkerQuoting,
  parseEmbedMarkerConfig,
  parseMarkerAttributes,
  scanEmbedMarkers,
  substituteMarkers,
  withAddedId,
  withElementKeptIfAttributed,
  withInnerContent,
  withInnerContentFinal,
} from "./support/compat/markers-marker.js";

/**
 * @file Direct unit coverage of the three marker-rebuild functions that
 * `marker.canary.test.ts` never calls (it only exercises `scanEmbedMarkers`,
 * `describeRejection`, `markersOfType`, `withAddedId` against real theme fixtures):
 *
 * - {@link withInnerContent} — splice new inner content, keep tag/attrs, keep the marker attribute
 * - {@link withInnerContentFinal} — same, but also strips `data-embed-config` so a later re-scan
 *   can't rediscover it
 * - {@link substituteMarkers} — whole-element replace driven by a resolver callback, right-to-left
 */

test("withInnerContent keeps the marker's tag and every authored attribute, swaps only the inner content", () => {
  const html = `<nav class="docs-nav" data-embed-config='{"type":"menu","id":"docs"}'>old fallback</nav>`;
  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);
  assert.equal(markers.length, 1);

  const result = withInnerContent(markers[0], "<ul><li>new</li></ul>");

  assert.equal(
    result,
    `<nav class="docs-nav" data-embed-config='{"type":"menu","id":"docs"}'><ul><li>new</li></ul></nav>`
  );
});

test("withInnerContent preserves the marker attribute (unlike withInnerContentFinal)", () => {
  const html = `<div data-embed-config='{"type":"partial","id":"nav"}'></div>`;
  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  const result = withInnerContent(markers[0], "resolved content");

  assert.match(result, /data-embed-config='\{"type":"partial","id":"nav"\}'/);
});

test("withInnerContentFinal strips data-embed-config so a later scan cannot rediscover the marker", () => {
  const html = `<div data-embed-config='{"type":"content","id":"e1"}'>old</div>`;
  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  const result = withInnerContentFinal(markers[0], "<p>final body</p>");

  assert.equal(result, `<div><p>final body</p></div>`);
  assert.doesNotMatch(result, /data-embed-config/);
  // and the result is genuinely inert to a later scan:
  assert.equal(scanEmbedMarkers(result).markers.length, 0);
});

test("withInnerContentFinal keeps other authored attributes while removing only data-embed-config", () => {
  const html = `<section id="hero" data-embed-config='{"type":"content"}' aria-label="Hero">old</section>`;
  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  const result = withInnerContentFinal(markers[0], "new");

  assert.equal(result, `<section id="hero" aria-label="Hero">new</section>`);
});

test("substituteMarkers replaces a marker's whole element with the resolver's output", () => {
  const html = `before<div data-embed-config='{"type":"partial","id":"nav"}'></div>after`;

  const result = substituteMarkers(html, (marker) => {
    assert.equal(marker.type, "partial");
    return "<nav>RESOLVED</nav>";
  });

  assert.equal(result, "before<nav>RESOLVED</nav>after");
});

test("substituteMarkers leaves a marker exactly as authored when resolve returns undefined", () => {
  const html = `<nav data-embed-config='{"type":"menu","id":"missing"}'>fallback content</nav>`;

  const result = substituteMarkers(html, () => undefined);

  assert.equal(result, html);
});

test("substituteMarkers splices right-to-left so earlier markers' offsets stay valid after a later replacement changes length", () => {
  const html =
    `<div data-embed-config='{"type":"a","id":"1"}'></div>` +
    `middle` +
    `<div data-embed-config='{"type":"b","id":"2"}'></div>`;

  const result = substituteMarkers(html, (marker) =>
    marker.type === "a" ? "A-OUT" : "B-OUTPUT-MUCH-LONGER-THAN-THE-ORIGINAL-MARKER"
  );

  assert.equal(result, "A-OUTmiddleB-OUTPUT-MUCH-LONGER-THAN-THE-ORIGINAL-MARKER");
});

test("substituteMarkers handles a mix of resolved and left-as-authored markers in one pass", () => {
  const html =
    `<div data-embed-config='{"type":"a","id":"1"}'></div>` +
    `<div data-embed-config='{"type":"b","id":"2"}'>keep me</div>`;

  const result = substituteMarkers(html, (marker) => (marker.type === "a" ? "REPLACED" : undefined));

  assert.equal(result, `REPLACED<div data-embed-config='{"type":"b","id":"2"}'>keep me</div>`);
});

test("substituteMarkers is a no-op on html with no markers", () => {
  const html = "<p>just plain html</p>";

  const result = substituteMarkers(html, () => "should never be called");

  assert.equal(result, html);
});

/**
 * A browser never parses HTML-comment text, or the raw text content of `<script>`/`<style>`
 * elements, as markup — so a well-formed `data-embed-config` marker written inside either is inert,
 * not live. `MARKER_PATTERN` used to be a plain regex over the raw string with no awareness of
 * either boundary, so an authoring note demonstrating the marker syntax (a real pattern in this
 * codebase — see the theme fixtures below) was extracted and resolved as if it were on the page.
 * See `ADS-memory/reports/2026-09-07-media-embed-unresolved.md` for the production incident this
 * regressed: three published pages, including the site root, logged a spurious "unresolved media
 * reference" warning on every render because of exactly this.
 */
test("scanEmbedMarkers ignores a marker written inside an HTML comment, but still finds a live marker elsewhere in the same document", () => {
  const html =
    `<!-- [VIDEO PLACEHOLDER] swap for the wrapper-div marker form: ` +
    `<div class="xai-video" data-embed-config='{"type":"media","id":"placeholder"}'></div> -->` +
    `<div data-embed-config='{"type":"partial","id":"nav"}'></div>`;

  const { markers, rejected } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.deepEqual(rejected, []);
  assert.equal(markers.length, 1, "the commented-out marker must not be extracted");
  assert.equal(markers[0].type, "partial");
  assert.equal(markers[0].id, "nav");
});

test("scanEmbedMarkers ignores a marker written inside a <style> block's CSS comment, but still finds a live marker elsewhere in the same document", () => {
  const html =
    `<style>` +
    `/* VIDEO SLOT. Replace with the wrapper-div marker form ` +
    `<div class="lp-video-media" data-embed-config='{"type":"media","id":"placeholder"}'></div> */` +
    `.foo { color: red; }` +
    `</style>` +
    `<div data-embed-config='{"type":"partial","id":"nav"}'></div>`;

  const { markers, rejected } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.deepEqual(rejected, []);
  assert.equal(markers.length, 1, "the marker inside the <style> block's CSS comment must not be extracted");
  assert.equal(markers[0].type, "partial");
  assert.equal(markers[0].id, "nav");
});

test("scanEmbedMarkers ignores a marker written inside a <script> block, but still finds a live marker elsewhere in the same document", () => {
  const html =
    `<script>` +
    `// example: <div data-embed-config='{"type":"media","id":"placeholder"}'></div>` +
    `</script>` +
    `<div data-embed-config='{"type":"partial","id":"nav"}'></div>`;

  const { markers, rejected } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.deepEqual(rejected, []);
  assert.equal(markers.length, 1, "the marker inside the <script> block must not be extracted");
  assert.equal(markers[0].type, "partial");
  assert.equal(markers[0].id, "nav");
});

test("scanEmbedMarkers still finds a live marker whose fallback content sits right next to a comment/style/script block, with fields read from the ORIGINAL text", () => {
  // Regression guard for the fix itself: a naive fix could blind the scanner to markers, or could
  // read `whole`/`attrs`/`inner` back off a masked (space-filled) copy instead of the real HTML.
  const html =
    `<!-- unrelated note, no marker inside --><style>.x{color:red}</style><script>1;</script>` +
    `<nav class="docs-nav" aria-label="Documentation" data-embed-config='{"type":"menu","id":"docs"}'>` +
    `<span>fallback</span></nav>`;

  const { markers, rejected } = scanEmbedMarkers(html);

  assert.deepEqual(rejected, []);
  assert.equal(markers.length, 1);
  const [marker] = markers;
  assert.ok(marker);
  assert.equal(marker.tag, "nav");
  assert.ok(marker.attrs.includes('class="docs-nav"'));
  assert.ok(marker.attrs.includes('aria-label="Documentation"'));
  assert.equal(marker.inner, "<span>fallback</span>");
  assert.ok(marker.whole.startsWith('<nav class="docs-nav"'));
  assert.ok(marker.whole.endsWith("</nav>"));
  // The marker's true offset in the ORIGINAL (unmasked) string — substituteMarkers splices by this.
  assert.equal(html.slice(marker.index, marker.index + marker.whole.length), marker.whole);
});

/**
 * 2026-09-16 — owner: "regular attributes that somebody puts on a data-embed-config should work on
 * the rendered tag". These primitives are the shared read/write half of that contract; per-type
 * forwarding rules live in `features/widgets/__tests__/unit/html-embeds.unit.test.ts` (T4).
 */
test('parseMarkerAttributes: drops data-embed-config even though its JSON holds double quotes', () => {
  const html = `<div class="a" data-embed-config='{"type":"media","id":"x"}' autoplay></div>`;
  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  const attrs = parseMarkerAttributes(markers[0]);

  assert.deepEqual(attrs, [
    { name: "class", value: "a" },
    { name: "autoplay", value: null },
  ]);
});

test("parseMarkerAttributes: reads unquoted, single-quoted and double-quoted values as source text, never entity-decoded", () => {
  const html = `<div title="a &amp; b" single='x &quot; y' unquoted=z&amp;q data-embed-config='{"type":"widget"}'></div>`;
  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  const attrs = parseMarkerAttributes(markers[0]);

  assert.deepEqual(attrs, [{ name: "title", value: "a &amp; b" }, { name: "single", value: "x &quot; y" }, { name: "unquoted", value: "z&amp;q" }]);
});

test("parseMarkerAttributes: lowercases names and keeps the FIRST of a duplicate", () => {
  const html = `<div CLASS="first" class="second" data-embed-config='{"type":"widget"}'></div>`;
  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  const attrs = parseMarkerAttributes(markers[0]);

  assert.deepEqual(attrs, [{ name: "class", value: "first" }]);
});

test("parseMarkerAttributes: skips a token whose name is not a valid attribute name instead of throwing", () => {
  const html = `<div 1bad="x" ok="y" data-embed-config='{"type":"widget"}'></div>`;
  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  const attrs = parseMarkerAttributes(markers[0]);

  assert.deepEqual(attrs, [{ name: "ok", value: "y" }]);
});

test('formatMarkerAttributes: round-trips source text without double-escaping & and turns an embedded " into &quot;', () => {
  const result = formatMarkerAttributes([{ name: "title", value: 'say "hi" &amp; bye' }]);

  assert.equal(result, ' title="say &quot;hi&quot; &amp; bye"');
});

test("formatMarkerAttributes: a valueless attribute is emitted bare", () => {
  const result = formatMarkerAttributes([{ name: "autoplay", value: null }]);

  assert.equal(result, " autoplay");
});

test("hasAuthoredAttributes: false for a bare marker, true once any other attribute is present", () => {
  const bare = scanEmbedMarkers(`<div data-embed-config='{"type":"widget"}'></div>`).markers[0];
  assert.ok(bare);
  const attributed = scanEmbedMarkers(`<div class="a" data-embed-config='{"type":"widget"}'></div>`).markers[0];
  assert.ok(attributed);

  assert.equal(hasAuthoredAttributes(bare), false);
  assert.equal(hasAuthoredAttributes(attributed), true);
});

test("withElementKeptIfAttributed: a bare marker returns inner alone; an attributed one keeps tag and attributes and strips data-embed-config", () => {
  const bare = scanEmbedMarkers(`<div data-embed-config='{"type":"widget"}'></div>`).markers[0];
  assert.ok(bare);
  const attributed = scanEmbedMarkers(`<div style="max-width: 600px;" data-embed-config='{"type":"widget"}'></div>`).markers[0];
  assert.ok(attributed);

  assert.equal(withElementKeptIfAttributed(bare, "resolved"), "resolved");
  assert.equal(withElementKeptIfAttributed(attributed, "resolved"), `<div style="max-width: 600px;">resolved</div>`);
});

/**
 * @file Nesting-aware close: {@link scanEmbedMarkers} finds a marker's own close tag by depth count
 * rather than by nearest textual `</tag>`, so a same-named descendant (`<div><div>…</div></div>`) no
 * longer truncates the marker at the first inner close.
 */

test("scanEmbedMarkers: a marker's inner is everything between its outer tags, even with nested elements of other names", () => {
  const html =
    `<div data-embed-config='{"type":"collection","id":"x"}'>` +
    `<template><div>{{title}}</div></template><div>none</div>` +
    `</div>`;

  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].type, "collection");
  assert.equal(markers[0].inner, `<template><div>{{title}}</div></template><div>none</div>`);
  assert.equal(markers[0].whole, html);
});

test("scanEmbedMarkers: same-name nesting three deep closes at the balanced tag, not the first close", () => {
  const html = `<div data-embed-config='{"type":"collection","id":"x"}'><div><div>deep</div></div></div>`;

  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].inner, `<div><div>deep</div></div>`);
  assert.equal(markers[0].whole, html);
});

test("scanEmbedMarkers: an unbalanced inner <div> falls back to the first </div>, matching today's behaviour, without swallowing the rest of the document", () => {
  const html = `<div data-embed-config='{"type":"collection","id":"x"}'><div>oops</div><p>after</p>`;

  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].inner, `<div>oops`);
  assert.equal(markers[0].whole, `<div data-embed-config='{"type":"collection","id":"x"}'><div>oops</div>`);
});

test("scanEmbedMarkers: a marker nested inside another marker's inner is not reported separately", () => {
  const html =
    `<div data-embed-config='{"type":"outer","id":"o"}'>` +
    `<div data-embed-config='{"type":"inner","id":"i"}'>x</div>` +
    `</div>`;

  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].type, "outer");
  assert.equal(markers[0].inner, `<div data-embed-config='{"type":"inner","id":"i"}'>x</div>`);
});

test("scanEmbedMarkers: comment/style masking hides a marker written inside them, and hides tags inside those regions from the balanced-close depth count", () => {
  const html =
    `<div data-embed-config='{"type":"collection","id":"x"}'>` +
    `<!-- <div> --><div>real</div>` +
    `</div>` +
    `<style>.x{} <div data-embed-config='{"type":"style-fake"}'></div></style>`;

  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].type, "collection");
  assert.equal(markers[0].inner, `<!-- <div> --><div>real</div>`);
});

test("scanEmbedMarkers: recognises a marker on an <h2> and on a custom element like <my-card>", () => {
  const h2 = scanEmbedMarkers(`<h2 data-embed-config='{"type":"widget","id":"w"}'>fallback</h2>`).markers;
  assert.ok(h2[0]);
  const custom = scanEmbedMarkers(`<my-card data-embed-config='{"type":"widget","id":"w"}'>fallback</my-card>`).markers;
  assert.ok(custom[0]);

  assert.equal(h2.length, 1);
  assert.equal(h2[0].tag, "h2");
  assert.equal(custom.length, 1);
  assert.equal(custom[0].tag, "my-card");
});

test("scanEmbedMarkers: a marker with no close tag at all (a void <img>) is just its open tag and never swallows the rest of the document", () => {
  const open = `<img data-embed-config='{"type":"media","id":"asset-1"}' class="hero">`;
  const html = `<p>before</p>${open}<p>rest of the page</p><div>more</div>`;

  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].whole, open);
  assert.equal(markers[0].inner, "");
  assert.equal(markers[0].index, `<p>before</p>`.length);
});

test("scanEmbedMarkers: a </div> inside a <script> in a marker's inner is not counted toward its balanced close", () => {
  const html =
    `<div data-embed-config='{"type":"collection","id":"x"}'>` +
    `<script>document.write("</div>")</script><div>real</div>` +
    `</div><p>after</p>`;

  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].inner, `<script>document.write("</div>")</script><div>real</div>`);
});

test("scanEmbedMarkers: thousands of unbalanced markers scan in linear, not quadratic, time", () => {
  // Each marker opens a <div>, closes an inner one, and never closes itself, so a per-marker depth
  // count that runs to the end of the document on every marker is O(markers x length). 8000 of them
  // (~520 KB) took ~16 s that way; a linear scan takes a few tens of milliseconds.
  const html = `<div data-embed-config='{"type":"widget","id":"x"}'><div>x</div>\n`.repeat(8000);

  const started = performance.now();
  const { markers } = scanEmbedMarkers(html);
  const elapsedMs = performance.now() - started;

  assert.equal(markers.length, 8000);
  assert.ok(markers[1]);
  assert.equal(markers[1].whole, `<div data-embed-config='{"type":"widget","id":"x"}'><div>x</div>`);
  assert.ok(elapsedMs < 1500, `scan took ${elapsedMs.toFixed(0)} ms`);
});

/**
 * @file Bug A (2026-09-23 interactive-bugs plan, Slice A1): `parseEmbedMarkerConfig` is the exported
 * form of the same config-parsing rule `scanEmbedMarkers` already applies to every marker it finds,
 * and `embedMarkerTarget` is the ONE per-type "which key names the target" rule shared by the server's
 * four page-embed resolvers (`resolver-service.ts`'s widget/media/post/content) and the two
 * theme-owned types with no target at all — the fact that used to live only inside those resolvers,
 * unreachable from the admin's own placeholder describer.
 */

test("parseEmbedMarkerConfig: valid JSON object with a type returns { config }", () => {
  const result = parseEmbedMarkerConfig('{"type":"widget","slug":"x"}');

  assert.deepEqual(result, { config: { type: "widget", slug: "x" } });
});

test("parseEmbedMarkerConfig: invalid JSON returns the same rejection kind scanEmbedMarkers emits", () => {
  const result = parseEmbedMarkerConfig("{not json");

  assert.ok("problem" in result);
  assert.equal(result.problem.kind, "invalid-json");
});

test("parseEmbedMarkerConfig: a non-object (array) returns not-an-object", () => {
  const result = parseEmbedMarkerConfig("[1,2,3]");

  assert.ok("problem" in result);
  assert.equal(result.problem.kind, "not-an-object");
});

test("parseEmbedMarkerConfig: an object missing type returns missing-type", () => {
  const result = parseEmbedMarkerConfig('{"id":"x"}');

  assert.ok("problem" in result);
  assert.equal(result.problem.kind, "missing-type");
});

test("embedMarkerTarget: widget, media, post, content resolve by slug when no id is present", () => {
  assert.deepEqual(embedMarkerTarget("widget", { slug: "contact-form" }), { key: "slug", value: "contact-form" });
  assert.deepEqual(embedMarkerTarget("media", { slug: "hero-video" }), { key: "slug", value: "hero-video" });
  assert.deepEqual(embedMarkerTarget("post", { slug: "hello-world" }), { key: "slug", value: "hello-world" });
  assert.deepEqual(embedMarkerTarget("content", { slug: "about" }), { key: "slug", value: "about" });
});

test("embedMarkerTarget: id wins over slug when both are present", () => {
  assert.deepEqual(embedMarkerTarget("widget", { id: "abc", slug: "x" }), { key: "id", value: "abc" });
});

test("embedMarkerTarget: collection resolves by typeKey, and ignores slug entirely", () => {
  assert.deepEqual(embedMarkerTarget("collection", { typeKey: "recipes" }), { key: "typeKey", value: "recipes" });
  assert.equal(embedMarkerTarget("collection", { slug: "x" }), undefined);
});

test("embedMarkerTarget: collection with both slug and typeKey resolves to typeKey (slug is never consulted)", () => {
  assert.deepEqual(embedMarkerTarget("collection", { slug: "x", typeKey: "recipes" }), { key: "typeKey", value: "recipes" });
});

test("embedMarkerTarget: collection id wins over typeKey when both are present", () => {
  assert.deepEqual(embedMarkerTarget("collection", { id: "recipes-id", typeKey: "recipes" }), { key: "id", value: "recipes-id" });
});

test("embedMarkerTarget: menu and partial resolve only by id, never by slug", () => {
  assert.equal(embedMarkerTarget("menu", { slug: "x" }), undefined);
  assert.deepEqual(embedMarkerTarget("menu", { id: "main" }), { key: "id", value: "main" });
  assert.equal(embedMarkerTarget("partial", { slug: "x" }), undefined);
  assert.deepEqual(embedMarkerTarget("partial", { id: "main" }), { key: "id", value: "main" });
});

test('embedMarkerTarget: post-previews needs no target at all — a distinct "none" outcome, not "missing"', () => {
  assert.deepEqual(embedMarkerTarget("post-previews", {}), { key: "none" });
});

test("embedMarkerTarget: an empty string, a non-string value, or an overlong value counts as absent", () => {
  assert.equal(embedMarkerTarget("widget", { id: "" }), undefined);
  assert.equal(embedMarkerTarget("widget", { id: 123 }), undefined);
  assert.equal(embedMarkerTarget("widget", { id: "x".repeat(201) }), undefined);
  assert.deepEqual(embedMarkerTarget("widget", { id: "x".repeat(200) }), { key: "id", value: "x".repeat(200) });
});

test("embedMarkerTarget: falls through to the next key when the first is absent", () => {
  assert.deepEqual(embedMarkerTarget("widget", { id: "", slug: "contact-form" }), { key: "slug", value: "contact-form" });
  assert.deepEqual(embedMarkerTarget("widget", { id: 123, slug: "contact-form" }), { key: "slug", value: "contact-form" });
});

test("embedMarkerTarget: the type is compared lower-cased", () => {
  assert.deepEqual(embedMarkerTarget("Widget", { slug: "contact-form" }), { key: "slug", value: "contact-form" });
});

test("embedMarkerTarget: an unknown type resolves only by id", () => {
  assert.deepEqual(embedMarkerTarget("mystery", { id: "x" }), { key: "id", value: "x" });
  assert.equal(embedMarkerTarget("mystery", { slug: "x" }), undefined);
});

test("embedMarkerSnippet: builds the data-embed-config wrapper div, byte-for-byte the same shape collectionEmbedSnippet always produced", () => {
  assert.equal(
    embedMarkerSnippet("collection", "id", "tovu_feature"),
    '<div data-embed-config=\'{"type":"collection","id":"tovu_feature"}\'></div>'
  );
});

test("embedMarkerSnippet: a media snippet keyed by slug (readable-slugs S5a's 'Copy embed code' button)", () => {
  assert.equal(
    embedMarkerSnippet("media", "slug", "cover-photo"),
    '<div data-embed-config=\'{"type":"media","slug":"cover-photo"}\'></div>'
  );
});

// A browser DOM (or any HTML serializer: GrapesJS in the admin's Interactive canvas, innerHTML,
// parse5) never writes a single-quoted attribute: it re-emits `data-embed-config='{"type":…}'` as
// `data-embed-config="{&quot;type&quot;:…}"`. Same attribute value, different quoting. The bytes
// below are the live /pages body's "That marker, live:" example, exactly as stored after an
// Interactive-canvas save (2026-09-26 embed-live investigation).
const DOM_SERIALIZED_MARKER = `<div data-embed-config="{&quot;type&quot;:&quot;widget&quot;,&quot;slug&quot;:&quot;contact-form&quot;}"></div>`;

test("scanEmbedMarkers: finds a double-quoted, entity-encoded marker as written by a DOM serializer", () => {
  const { markers, rejected } = scanEmbedMarkers(`<div class="live-example">${DOM_SERIALIZED_MARKER}</div>`);
  assert.ok(markers[0]);

  assert.deepEqual(rejected, []);
  assert.equal(markers.length, 1);
  assert.deepEqual(markers[0].config, { type: "widget", slug: "contact-form" });
  assert.equal(markers[0].type, "widget");
  assert.equal(markers[0].whole, DOM_SERIALIZED_MARKER);
});

test("scanEmbedMarkers: a double-quoted marker's value is HTML-decoded (&amp; and numeric references), exactly as a browser reads it", () => {
  const html = `<div data-embed-config="{&quot;type&quot;:&quot;media&quot;,&quot;id&quot;:&quot;m1&quot;,&quot;alt&quot;:&quot;A &amp; B &#39;x&#39; &#x3C;y&#x3E;&quot;}"></div>`;

  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.equal(markers.length, 1);
  assert.deepEqual(markers[0].config, { type: "media", id: "m1", alt: "A & B 'x' <y>" });
});

test("scanEmbedMarkers: a double-quoted marker alongside other attributes keeps them in attrs", () => {
  const html = `<nav class="docs-nav" data-embed-config="{&quot;type&quot;:&quot;menu&quot;,&quot;id&quot;:&quot;docs&quot;}" aria-label="Docs">fallback</nav>`;

  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].id, "docs");
  assert.equal(markers[0].inner, "fallback");
  assert.deepEqual(parseMarkerAttributes(markers[0]), [
    { name: "class", value: "docs-nav" },
    { name: "aria-label", value: "Docs" },
  ]);
});

test("withInnerContentFinal strips a double-quoted data-embed-config too", () => {
  const html = `<section id="hero" data-embed-config="{&quot;type&quot;:&quot;content&quot;}" aria-label="Hero">old</section>`;
  const { markers } = scanEmbedMarkers(html);
  assert.ok(markers[0]);

  const result = withInnerContentFinal(markers[0], "new");

  assert.equal(result, `<section id="hero" aria-label="Hero">new</section>`);
});

test("withAddedId rewrites a double-quoted marker's config so a re-scan sees the id", () => {
  const { markers } = scanEmbedMarkers(`<main class="page-body" data-embed-config="{&quot;type&quot;:&quot;content&quot;}">x</main>`);
  assert.ok(markers[0]);

  const result = withAddedId(markers[0], "e1");

  const rescanned = scanEmbedMarkers(result).markers;
  assert.ok(rescanned[0]);
  assert.equal(rescanned.length, 1);
  assert.deepEqual(rescanned[0].config, { type: "content", id: "e1" });
  assert.equal(rescanned[0].inner, "x");
  assert.equal((result.match(/data-embed-config/g) ?? []).length, 1);
});

test("scanEmbedMarkers: a single-quoted marker's value is still read verbatim (no entity decoding)", () => {
  const { markers } = scanEmbedMarkers(`<div data-embed-config='{"type":"media","id":"m1","alt":"a &amp; b"}'></div>`);
  assert.ok(markers[0]);

  assert.equal(markers[0].config.alt, "a &amp; b");
});

// normalizeEmbedMarkerQuoting (2026-09-26): the save-side half of the fix above. The scanner reads
// both quotings, but the stored page source should read the way it was authored, so every Page HTML
// write turns a DOM-serialized marker back into the single-quoted JSON form.

test("normalizeEmbedMarkerQuoting: rewrites a DOM-serialized marker to the readable single-quoted form", () => {
  const html = `<div class="live-example">${DOM_SERIALIZED_MARKER}</div>`;

  assert.equal(
    normalizeEmbedMarkerQuoting(html),
    `<div class="live-example"><div data-embed-config='{"type":"widget","slug":"contact-form"}'></div></div>`
  );
});

test("normalizeEmbedMarkerQuoting: the config a scan reads is identical before and after, including ' and & in values", () => {
  const html = `<nav class="n" data-embed-config="{&quot;type&quot;:&quot;media&quot;,&quot;id&quot;:&quot;m1&quot;,&quot;alt&quot;:&quot;Tom&#39;s A &amp; B &lt;y&gt;&quot;}" aria-label="x">fb</nav>`;

  const normalized = normalizeEmbedMarkerQuoting(html);

  assert.equal(
    normalized,
    `<nav class="n" data-embed-config='{"type":"media","id":"m1","alt":"Tom\\u0027s A \\u0026 B <y>"}' aria-label="x">fb</nav>`
  );
  const before = scanEmbedMarkers(html).markers[0];
  assert.ok(before);
  const after = scanEmbedMarkers(normalized).markers[0];
  assert.ok(after);
  assert.deepEqual(after.config, before.config);
  assert.equal(after.config.alt, "Tom's A & B <y>");
  assert.equal(after.inner, "fb");
  assert.deepEqual(parseMarkerAttributes(after), parseMarkerAttributes(before));
});

test("normalizeEmbedMarkerQuoting: idempotent, and a single-quoted marker is left byte-identical", () => {
  const authored = `<div data-embed-config='{"type":"widget","slug":"contact-form"}'></div><p>x</p>`;

  assert.equal(normalizeEmbedMarkerQuoting(authored), authored);
  const once = normalizeEmbedMarkerQuoting(DOM_SERIALIZED_MARKER);
  assert.equal(normalizeEmbedMarkerQuoting(once), once);
});

test("normalizeEmbedMarkerQuoting: leaves a marker inside a comment or <script>, and an unparseable value, exactly as written", () => {
  const commented = `<!-- ${DOM_SERIALIZED_MARKER} -->`;
  const scripted = `<script>const s = '${DOM_SERIALIZED_MARKER}';</script>`;
  const broken = `<div data-embed-config="{&quot;type&quot;:"></div>`;

  assert.equal(normalizeEmbedMarkerQuoting(commented), commented);
  assert.equal(normalizeEmbedMarkerQuoting(scripted), scripted);
  assert.equal(normalizeEmbedMarkerQuoting(broken), broken);
});

test("normalizeEmbedMarkerQuoting: rewrites every marker in a document, not just the first", () => {
  const second = `<aside class="second" data-embed-config="{&quot;type&quot;:&quot;media&quot;,&quot;id&quot;:&quot;image-2&quot;,&quot;alt&quot;:&quot;Second image&quot;}">fallback</aside>`;
  const html = `<p>before</p>${DOM_SERIALIZED_MARKER}<p>between</p>${second}<p>after</p>`;

  const normalized = normalizeEmbedMarkerQuoting(html);

  assert.equal(normalized.includes("&quot;"), false);
  assert.equal(scanEmbedMarkers(normalized).markers.length, 2);
  assert.equal(normalized, `<p>before</p><div data-embed-config='{"type":"widget","slug":"contact-form"}'></div><p>between</p><aside class="second" data-embed-config='{"type":"media","id":"image-2","alt":"Second image"}'>fallback</aside><p>after</p>`);
});
