import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { MAX_HTML_EMBEDS_PER_PAGE, scanHtmlEmbeds, substituteHtmlEmbeds } from "../support/compat/html-html-embeds.js";

test("legacy widget attributes resolve in either order/quoting, alongside current markers", () => {
  const html = `<p>before</p><DIV data-embed-id='w1' DATA-EMBED-TYPE='Widget'></DIV>` +
    `<div data-embed-type=widget data-embed-id=w2></div>` +
    `<div data-embed-config='{"type":"widget","id":"w3"}'></div><p>after</p>`;
  assert.equal(scanHtmlEmbeds(html).map((ref) => ref.id).join(","), "w1,w2,w3");
  assert.equal(substituteHtmlEmbeds(html, (ref) => `<b>${ref.id}</b>`), "<p>before</p><b>w1</b><b>w2</b><b>w3</b><p>after</p>");
});

test("legacy widgets keep authored attributes and consume nested fallback content", () => {
  const html = `<aside class="promo" data-embed-type="widget" data-embed-id="w1"><div>fallback</div></aside>`;
  assert.equal(substituteHtmlEmbeds(html, () => "<b>real widget</b>"), '<aside class="promo"><b>real widget</b></aside>');
});

test("legacy marker text in comments, scripts and styles stays byte-identical", () => {
  const marker = '<div data-embed-type="widget" data-embed-id="w1"></div>';
  const inert = `<!-- ${marker} --><script>const example = '${marker}';</script><style>/* ${marker} */</style>`;
  assert.equal(scanHtmlEmbeds(inert).length, 0);
  assert.equal(substituteHtmlEmbeds(inert + marker, () => "<b>live widget</b>"), inert + "<b>live widget</b>");
});

test("a current config remains authoritative when obsolete widget attributes coexist", () => {
  const html = `<div data-embed-type="widget" data-embed-id="old" data-embed-config='{"type":"widget","id":"current"}'></div>`;
  assert.equal(scanHtmlEmbeds(html).map((ref) => ref.id).join(","), "current");
  assert.equal(substituteHtmlEmbeds(html, (ref) => `<b>${ref.id}</b>`), "<b>current</b>");
});

test("legacy widget IDs decode entities without corrupting the JSON marker attribute", () => {
  const html = `<div data-embed-type="widget" data-embed-id="a&apos;b&amp;c"></div>`;
  assert.equal(scanHtmlEmbeds(html)[0]?.id, "a'b&c");
  assert.equal(substituteHtmlEmbeds(html, () => "<b>widget</b>"), "<b>widget</b>");
});

test("an empty widget replacement removes even an attributed wrapper and its fallback", () => {
  const html = `<p>before</p><div class="promo" data-embed-type="widget" data-embed-id="missing">fallback</div><p>after</p>`;
  assert.equal(substituteHtmlEmbeds(html, () => ""), "<p>before</p><p>after</p>");
});

/**
 * @file SPEC-047 Slice 2 — `html-embeds.ts`'s scan/substitute pair, tested as the pure string
 * functions they are (no repo, no resolver — see `resolve-html-page-embeds.integration.test.ts` for
 * the resolution-layer coverage).
 *
 * **Rewritten 2026-08-10 onto `data-embed-config`.** Every fixture here spoke the retired
 * `data-embed-type`/`data-embed-id`/`data-embed-variant` vocabulary, which `scanEmbedMarkers` does
 * not read at all — so the whole suite had been failing since the marker-spine unification (`b7acc21`)
 * while asserting behavior that no longer existed.
 *
 * Two tests were INVERTED rather than re-spelled, because the migration deliberately changed the
 * rule they pinned: the old scanner required an EMPTY `<div></div>` and skipped any marker with
 * content inside it. The shared parser matches inner content on purpose, so a theme marker's authored
 * fallback survives when nothing resolves. Re-spelling those two would have re-pinned the exact
 * behavior the migration set out to remove — see `core/embeds/marker.ts`'s `MARKER_PATTERN` doc and
 * `html-entry-refs-consistency.integration.test.ts`'s own note retiring the matching fixture.
 *
 * **Widened 2026-08-31 for `slug`.** Every fixture below now carries `slug: null` in its expected
 * shape — a genuinely new field on `PageHtmlEmbedRef`, not a rename of anything — plus a dedicated
 * block of new tests pinning `slug`'s own scan/normalize behavior. See `resolveHtmlPageEmbeds`'s own
 * integration suite for what actually RESOLVES a slug; this file only proves it is scanned correctly.
 */

test("scanHtmlEmbeds: finds two embeds of different types, in document order", () => {
  const refs = scanHtmlEmbeds(
    `<p>intro</p><div data-embed-config='{"type":"widget","id":"w1"}'></div><div data-embed-config='{"type":"media","id":"asset-1"}'></div>`
  );
  assert.deepEqual(refs, [
    { type: "widget", id: "w1", slug: null, name: null, variant: null, header: true },
    { type: "media", id: "asset-1", slug: null, name: null, variant: null, header: true },
  ]);
});

test("scanHtmlEmbeds: an unregistered/future type token scans exactly like a known one — the scanner never gates on type", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"some-future-type","id":"x1"}'></div>`);
  assert.deepEqual(refs, [{ type: "some-future-type", id: "x1", slug: null, name: null, variant: null, header: true }]);
});

test('scanHtmlEmbeds: the "form" type scans like any other token — its 2026-08-10 removal and 2026-10-04 restoration changed resolution, never scanning', () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"form","id":"f1"}'></div>`);
  assert.deepEqual(refs, [{ type: "form", id: "f1", slug: null, name: null, variant: null, header: true }]);
});

test('scanHtmlEmbeds: only mode "html" is carried onto the ref; any other mode value is dropped', () => {
  const refs = scanHtmlEmbeds(
    `<div data-embed-config='{"type":"form","id":"f1","mode":"html"}'></div><div data-embed-config='{"type":"form","id":"f2","mode":"fancy"}'></div>`,
  );
  assert.deepEqual(refs, [
    { type: "form", id: "f1", slug: null, name: null, variant: null, header: true, mode: "html" },
    { type: "form", id: "f2", slug: null, name: null, variant: null, header: true },
  ]);
});

test("scanHtmlEmbeds: name and variant config keys are captured alongside id", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"media","id":"asset-1","variant":"thumb"}'></div>`);
  assert.deepEqual(refs, [{ type: "media", id: "asset-1", slug: null, name: null, variant: "thumb", header: true }]);
});

test("scanHtmlEmbeds: the marker attribute may sit anywhere among the element's other attributes, which survive the scan untouched", () => {
  const refs = scanHtmlEmbeds(
    `<div class="slot" data-extra="y" data-embed-config='{"type":"media","id":"asset-1","variant":"thumb"}'></div>`
  );
  assert.deepEqual(refs, [{ type: "media", id: "asset-1", slug: null, name: null, variant: "thumb", header: true }]);
});

test("scanHtmlEmbeds: whitespace between the opening and closing tag is tolerated", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","id":"w1"}'>\n  \n</div>`);
  assert.deepEqual(refs, [{ type: "widget", id: "w1", slug: null, name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: an element with real content between the tags DOES match — that content is a fallback the parser deliberately preserves, not a reason to skip the marker (this inverts the pre-b7acc21 empty-div-only rule)", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","id":"w1"}'><span>authored fallback</span></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: "w1", slug: null, name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: an id longer than the sanity bound normalizes to null rather than being carried into a resolver/entry_refs lookup — the reference itself is still reported (scanning never gates on id validity, see this file's own header)", () => {
  const longId = "x".repeat(500);
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","id":"${longId}"}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: null, slug: null, name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: an empty id normalizes to null", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","id":""}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: null, slug: null, name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: a missing id key reports id: null rather than dropping the reference — resolution (not scanning) decides whether a targetless reference is usable", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget"}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: null, slug: null, name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: a non-string id is exactly as unusable as a missing one", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","id":7}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: null, slug: null, name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: a marker whose config does not parse is absent from the result entirely — render-time stays forgiving, and the unparseable markup survives untouched because substituteHtmlEmbeds cannot see it either", () => {
  assert.deepEqual(scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","id":}'></div>`), []);
});

test("scanHtmlEmbeds: truncates at MAX_HTML_EMBEDS_PER_PAGE, never returns more", () => {
  const html = Array.from(
    { length: MAX_HTML_EMBEDS_PER_PAGE + 20 },
    (_, i) => `<div data-embed-config='{"type":"widget","id":"w${i}"}'></div>`
  ).join("");
  const refs = scanHtmlEmbeds(html);
  assert.equal(refs.length, MAX_HTML_EMBEDS_PER_PAGE);
  assert.equal(refs[0]?.id, "w0", "truncation keeps the FIRST refs in document order, not an arbitrary subset");
});

// ---------------------------------------------------------------------------
// `slug` (2026-08-31) — the owner-requested, human-memorable alternative to `id`. See
// `html-embeds.ts`'s file header for why this is a distinct mechanism from `name`, not a rename of
// it. These tests only prove SCANNING/normalization; `resolve-html-page-embeds.integration.test.ts`
// covers actual slug -> entry resolution and the id-wins-when-both-present rule.
// ---------------------------------------------------------------------------

test('scanHtmlEmbeds: a "slug" config key is captured alongside (and independently of) id/name/variant', () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","slug":"contact-form"}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: null, slug: "contact-form", name: null, variant: null, header: true }]);
});

test('scanHtmlEmbeds: both "id" and "slug" present on one marker are both reported by the scanner — deciding which wins is a resolver-side concern, not a scanner-side one', () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","id":"w1","slug":"contact-form"}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: "w1", slug: "contact-form", name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: a missing slug key reports slug: null, exactly like a missing id", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","id":"w1"}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: "w1", slug: null, name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: an empty slug normalizes to null", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","slug":""}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: null, slug: null, name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: a non-string slug is exactly as unusable as a missing one", () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","slug":7}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: null, slug: null, name: null, variant: null, header: true }]);
});

test("scanHtmlEmbeds: a slug longer than the sanity bound normalizes to null, same guard as an oversized id", () => {
  const longSlug = "x".repeat(500);
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"widget","slug":"${longSlug}"}'></div>`);
  assert.deepEqual(refs, [{ type: "widget", id: null, slug: null, name: null, variant: null, header: true }]);
});

// ---------------------------------------------------------------------------
// `header` (2026-09-04) — the `"content"` marker's opt-out of the app-side `.post-detail-header`
// (`<h1>` + date byline) wrapper `renderWidgetPostContent` always used to emit unconditionally. See
// `resolve-html-page-embeds.integration.test.ts` for actual resolution into IR props and
// `render.test.ts` for the rendered-HTML assertions; this file only proves SCANNING/normalization.
// No-silent-behavior-change requirement: an absent `header` key (every marker written before this
// field existed) must normalize to `true`, exactly like the `slug: null` widening above did for
// every existing fixture — hence updating those fixtures to `header: true` above rather than leaving
// them mismatched.
// ---------------------------------------------------------------------------

test('scanHtmlEmbeds: a "header" config key of JSON boolean false is captured as header: false', () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"content","id":"c1","header":false}'></div>`);
  assert.deepEqual(refs, [{ type: "content", id: "c1", slug: null, name: null, variant: null, header: false }]);
});

test('scanHtmlEmbeds: a missing "header" key reports header: true — the no-silent-behavior-change default', () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"content","id":"c1"}'></div>`);
  assert.deepEqual(refs, [{ type: "content", id: "c1", slug: null, name: null, variant: null, header: true }]);
});

test('scanHtmlEmbeds: "header":true is reported as header: true, same as an absent key', () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"content","id":"c1","header":true}'></div>`);
  assert.deepEqual(refs, [{ type: "content", id: "c1", slug: null, name: null, variant: null, header: true }]);
});

test('scanHtmlEmbeds: a non-boolean "header" value (a string "false") is NOT a recognized opt-out — only the JSON boolean literal false suppresses the header, so this normalizes to true rather than silently mis-suppressing on a typo', () => {
  const refs = scanHtmlEmbeds(`<div data-embed-config='{"type":"content","id":"c1","header":"false"}'></div>`);
  assert.deepEqual(refs, [{ type: "content", id: "c1", slug: null, name: null, variant: null, header: true }]);
});

test("substituteHtmlEmbeds: replaces each placeholder with resolve()'s return value, leaves surrounding markup untouched", () => {
  const html = `<p>before</p><div data-embed-config='{"type":"widget","id":"w1"}'></div><p>after</p>`;
  const out = substituteHtmlEmbeds(html, (ref) => `[${ref.type}:${ref.id}]`);
  assert.equal(out, "<p>before</p>[widget:w1]<p>after</p>");
});

test("substituteHtmlEmbeds: resolve() returning undefined leaves the marker EXACTLY as authored, fallback content included — the invariant that stops a later-stage marker (a theme's nav) from being blanked by this stage", () => {
  const html = `<nav data-embed-config='{"type":"menu","id":"main"}'><em>keep me</em></nav>`;
  const out = substituteHtmlEmbeds(html, () => undefined);
  assert.equal(out, html);
});

test("substituteHtmlEmbeds: an element WITH content is matched and replaced when resolve() returns a value — the pre-b7acc21 rule that skipped it is gone (this inverts that test, it does not re-spell it)", () => {
  const html = `<div data-embed-config='{"type":"widget","id":"w1"}'><em>fallback</em></div>`;
  let calls = 0;
  const out = substituteHtmlEmbeds(html, () => {
    calls += 1;
    return "REPLACED";
  });
  assert.equal(out, "REPLACED");
  assert.equal(calls, 1);
});

test("substituteHtmlEmbeds: the captured id is handed to resolve() as plain data, never re-interpolated into the output by this function itself — a hostile id cannot break out of resolve()'s own returned markup", () => {
  const hostileId = `'><script>alert(1)</script>`;
  const encoded = JSON.stringify({ type: "widget", id: hostileId }).replace(/'/g, "\\u0027").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const html = `<div data-embed-config='${encoded}'></div>`;
  const seen: Array<{ type: string; id: string | null }> = [];
  const out = substituteHtmlEmbeds(html, (ref) => {
    seen.push({ type: ref.type, id: ref.id });
    return "<strong>resolved widget</strong>";
  });
  assert.deepEqual(seen, [{ type: "widget", id: hostileId }]);
  assert.equal(out, "<strong>resolved widget</strong>");
});

test("substituteHtmlEmbeds: invalid JSON markers stay byte-identical and never reach resolve", () => {
  const html = `<div data-embed-config='{"type":"widget","id":"'><script>alert(1)</script>"></div>`;
  // The `'` closing the attribute early means the config text is `{"type":"widget","id":"` — invalid
  // JSON, so the marker is rejected and left inert rather than exploited. This function does not
  // attempt to be a general HTML sanitizer; it only ever emits what `resolve()` returns for a marker
  // the shared parser accepted.
  let calls = 0;
  const out = substituteHtmlEmbeds(html, () => {
    calls += 1;
    return "SHOULD-NOT-BE-CALLED";
  });
  assert.equal(calls, 0);
  assert.equal(out, html);
  assert.doesNotMatch(out, /SHOULD-NOT-BE-CALLED/);
});

test("substituteHtmlEmbeds: multiple embeds of the same id each resolve independently (resolve() is called once per occurrence, not once per distinct id)", () => {
  const html =
    `<div data-embed-config='{"type":"widget","id":"w1"}'></div><div data-embed-config='{"type":"widget","id":"w1"}'></div>`;
  const seen: string[] = [];
  const out = substituteHtmlEmbeds(html, () => {
    seen.push("call");
    return `[${seen.length}]`;
  });
  // `substituteMarkers` applies right-to-left so each splice leaves earlier offsets valid, so the
  // FIRST call resolves the LAST occurrence — asserted here rather than glossed, since a caller that
  // assumed document order for a stateful `resolve` would be silently wrong.
  assert.equal(out, "[2][1]");
  assert.equal(seen.length, 2);
});

test("substituteHtmlEmbeds: an unknown embed type is still substituted via resolve() — the caller (render.ts) decides how an unresolvable type degrades, not this function", () => {
  const html = `<div data-embed-config='{"type":"some-future-type","id":"x1"}'></div>`;
  const out = substituteHtmlEmbeds(html, (ref) => `[unknown-type:${ref.type}]`);
  assert.equal(out, "[unknown-type:some-future-type]");
});

test('substituteHtmlEmbeds: a "media" marker\'s own wrapper element (tag AND authored attributes, e.g. style) survives — only the marker\'s content becomes the resolved tag, unlike every other type\'s whole-element replace — and the now-dead data-embed-config attribute is stripped rather than shipped to the rendered output', () => {
  const html = `<div style="max-width: 600px;" data-embed-config='{"type":"media","id":"asset-1"}'></div>`;
  const out = substituteHtmlEmbeds(html, () => `<video src="/m/asset-1/original" controls></video>`);
  assert.equal(out, `<div style="max-width: 600px;"><video src="/m/asset-1/original" controls></video></div>`);
});

test('substituteHtmlEmbeds: a "media" marker\'s own tag/attrs survive even when it is a non-div container (nav, span, figure, …) — the wrapper-preserving behavior is not div-specific', () => {
  const html = `<figure class="hero" data-embed-config='{"type":"media","id":"asset-1"}'></figure>`;
  const out = substituteHtmlEmbeds(html, () => `<img src="/m/asset-1/x.jpg" alt="">`);
  assert.equal(out, `<figure class="hero"><img src="/m/asset-1/x.jpg" alt=""></figure>`);
});

test('substituteHtmlEmbeds: a "media" marker authored DIRECTLY on a self-rendering tag (video/img/audio) falls back to whole-element replace — nesting the resolved tag inside an identical marker tag would not be meaningful, playable markup', () => {
  const html = `<video data-embed-config='{"type":"media","id":"asset-1"}'></video>`;
  const out = substituteHtmlEmbeds(html, () => `<video src="/m/asset-1/original" controls></video>`);
  assert.equal(out, `<video src="/m/asset-1/original" controls></video>`);
});

test('substituteHtmlEmbeds: a "media" marker\'s own resolve() returning undefined still leaves it exactly as authored, same invariant as every other type', () => {
  const html = `<div style="max-width: 600px;" data-embed-config='{"type":"media","id":"asset-1"}'></div>`;
  const out = substituteHtmlEmbeds(html, () => undefined);
  assert.equal(out, html);
});

test('substituteHtmlEmbeds: a "widget" marker that carries its own attributes keeps its element (minus data-embed-config) around the resolved output — owner rule 2026-09-16: authored attributes reach the rendered output', () => {
  const html = `<div style="max-width: 600px;" data-embed-config='{"type":"widget","id":"w1"}'></div>`;
  const out = substituteHtmlEmbeds(html, () => "<section>widget output</section>");
  assert.equal(out, `<div style="max-width: 600px;"><section>widget output</section></div>`);
});

test('substituteHtmlEmbeds: a BARE "widget" marker is still whole-element replaced, byte-identical to before', () => {
  const html = `<div data-embed-config='{"type":"widget","id":"w1"}'></div>`;
  const out = substituteHtmlEmbeds(html, () => "<section>widget output</section>");
  assert.equal(out, "<section>widget output</section>");
});

test('substituteHtmlEmbeds: a "post" marker\'s own wrapper element (tag AND authored attributes) survives — "post" joined the wrapper-preserving group alongside "media" (both resolve through the same post-content IR)', () => {
  const html = `<div class="spotlight" data-embed-config='{"type":"post","id":"post-1"}'></div>`;
  const out = substituteHtmlEmbeds(
    html,
    () => `<div class="post-detail-header"><h1>Title</h1></div><div class="post-detail-body"><p>Body</p></div>`
  );
  assert.equal(
    out,
    `<div class="spotlight"><div class="post-detail-header"><h1>Title</h1></div><div class="post-detail-body"><p>Body</p></div></div>`
  );
});

test('substituteHtmlEmbeds: a "content" marker\'s own wrapper element survives too — matches the realistic authored shape documented in embed-type-inventory.md (`<main class="page-body" data-embed-config=\'{"type":"content"}\'></main>`)', () => {
  const html = `<main class="page-body" data-embed-config='{"type":"content"}'></main>`;
  const out = substituteHtmlEmbeds(html, () => `<div class="post-detail-header"><h1>Title</h1></div><div class="post-detail-body"></div>`);
  assert.equal(out, `<main class="page-body"><div class="post-detail-header"><h1>Title</h1></div><div class="post-detail-body"></div></main>`);
});

test('substituteHtmlEmbeds: "post"/"content" have no self-rendering-tag exception like "media" — a div-rooted resolution splices fine inside a same-named div marker, since (unlike video-in-video) div-in-div is ordinary markup', () => {
  const html = `<div data-embed-config='{"type":"post","id":"post-1"}'></div>`;
  const out = substituteHtmlEmbeds(html, () => `<div class="post-detail-header"><h1>Title</h1></div>`);
  assert.equal(out, `<div><div class="post-detail-header"><h1>Title</h1></div></div>`);
});

// ---------------------------------------------------------------------------
// Marker attributes (2026-09-16) — owner: "regular attributes that somebody puts on a
// data-embed-config should work on the rendered tag". `occurrence` is the second arg `resolve` now
// receives; T5 (`render.ts`) is what actually merges `occurrence.elementAttributes`/`controls` onto
// the rendered `<video>`/`<img>` tag — these tests only prove what `substituteHtmlEmbeds` computes
// and hands to `resolve`, plus how the wrapper (if any) gets rebuilt.
// ---------------------------------------------------------------------------

test("substituteHtmlEmbeds: media-element attributes on a media wrapper move to the occurrence, the rest stay on the wrapper", () => {
  const html = `<div class="xai-video" data-embed-config='{"type":"media","id":"a"}' autoplay muted loop playsinline></div>`;
  let seenNames: string[] = [];
  const out = substituteHtmlEmbeds(html, (_ref, occurrence) => {
    seenNames = occurrence.elementAttributes.map((a) => a.name);
    return "RESOLVED";
  });
  assert.equal(out, `<div class="xai-video">RESOLVED</div>`);
  assert.deepEqual(seenNames, ["autoplay", "muted", "loop", "playsinline"]);
});

test("substituteHtmlEmbeds: a media wrapper with no media-element attributes is byte-identical to before", () => {
  const html = `<div style="max-width: 600px;" data-embed-config='{"type":"media","id":"asset-1"}'></div>`;
  const out = substituteHtmlEmbeds(html, () => `<video src="/m/asset-1/original" controls></video>`);
  assert.equal(out, `<div style="max-width: 600px;"><video src="/m/asset-1/original" controls></video></div>`);
});

test("substituteHtmlEmbeds: a media marker authored on <video> hands ALL its attributes to the occurrence and emits no wrapper", () => {
  const html = `<video class="collapse" muted data-embed-config='{"type":"media","id":"a"}'></video>`;
  let seenNames: string[] = [];
  const out = substituteHtmlEmbeds(html, (_ref, occurrence) => {
    seenNames = occurrence.elementAttributes.map((a) => a.name);
    return "<video>RESOLVED</video>";
  });
  assert.equal(out, "<video>RESOLVED</video>");
  assert.deepEqual(seenNames, ["class", "muted"]);
});

test("substituteHtmlEmbeds: occurrence.controls is false only when the marker's own controls attribute trims/lowercases to 'false'", () => {
  const cases: Array<{ html: string; expectedControls: boolean }> = [
    { html: `<div data-embed-config='{"type":"media","id":"a"}' controls="false"></div>`, expectedControls: false },
    { html: `<div data-embed-config='{"type":"media","id":"a"}' controls=" FALSE "></div>`, expectedControls: false },
    { html: `<div data-embed-config='{"type":"media","id":"a"}' controls></div>`, expectedControls: true },
    { html: `<div data-embed-config='{"type":"media","id":"a"}' controls="yes"></div>`, expectedControls: true },
    { html: `<div data-embed-config='{"type":"media","id":"a"}'></div>`, expectedControls: true },
  ];
  for (const { html, expectedControls } of cases) {
    let seenControls: boolean | undefined;
    substituteHtmlEmbeds(html, (_ref, occurrence) => {
      seenControls = occurrence.controls;
      return "RESOLVED";
    });
    assert.equal(seenControls, expectedControls, html);
  }
});

test("substituteHtmlEmbeds: a controls-only marker on a media wrapper still moves it off the rebuilt wrapper tag (never left as a stray controls attribute on the div)", () => {
  const html = `<div class="hero" data-embed-config='{"type":"media","id":"a"}' controls="false"></div>`;
  const out = substituteHtmlEmbeds(html, () => "RESOLVED");
  assert.equal(out, `<div class="hero">RESOLVED</div>`);
});

test("substituteHtmlEmbeds: controls is NEVER forwarded via occurrence.elementAttributes, on a wrapper or a collapsed <video> — a browser treats controls=\"false\" as controls ON by presence alone, so the boolean must be the only channel", () => {
  const wrapperHtml = `<div class="hero" data-embed-config='{"type":"media","id":"a"}' autoplay controls="false"></div>`;
  let wrapperNames: string[] = [];
  substituteHtmlEmbeds(wrapperHtml, (_ref, occurrence) => {
    wrapperNames = occurrence.elementAttributes.map((a) => a.name);
    return "RESOLVED";
  });
  assert.deepEqual(wrapperNames, ["autoplay"], "the wrapper case must never hand a controls entry to the occurrence");

  const collapseHtml = `<video muted controls data-embed-config='{"type":"media","id":"a"}'></video>`;
  let collapseNames: string[] = [];
  substituteHtmlEmbeds(collapseHtml, (_ref, occurrence) => {
    collapseNames = occurrence.elementAttributes.map((a) => a.name);
    return "<video>RESOLVED</video>";
  });
  assert.deepEqual(collapseNames, ["muted"], "the collapse case must never hand a controls entry to the occurrence either");
});
