import assert from "node:assert/strict";
import { test } from "vitest";

import {
  handlesMadeAmbiguous,
  locateRegion as locate,
  moveRegion as move,
  regionHandlesIn as handlesIn,
  replaceRegionInner as replaceInner,
  suggestRegionHandle as suggest,
  untaggedTopLevelSections as untagged,
  type ScannedRegion,
} from "../index.js";
import { scanHtmlRegions } from "../node/index.js";

/**
 * Ported from Tovu regions.test.ts and regions.move.test.ts. Intentional changes (review change 12):
 * - Non-void `<div … />` is an open div in parse5 and swallows following siblings until closed.
 *   `<section … />body</section>` has an explicit close and is therefore replaceable.
 * - Unclosed top-level elements use parse5's recovered boundaries, not the lexical pending marker.
 * - Malformed open tags / unterminated declarations follow parse5 recovery. A dropped unfinished
 *   handle appears in documentProblem; other safely located handles remain readable/editable.
 * - Unquoted and upper-case attribute names are newly recognised (pinned in scan.test.ts).
 * - Region depth was intentionally cut from the API: ordering, top-level status and nested edits
 *   are still asserted, with no synthetic depth added just for these tests.
 * The test-only wrappers adapt the old calling convention to scan-based pure functions. The ASCII
 * slugifier represents these original ASCII fixtures; the host supplies transliteration in use.
 */
const slugOptions = { slugify: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") };
const scanPageMarkup = (html: string) => scanHtmlRegions({ html });
const locateRegion = (html: string, handle: string) => locate({ scan: scanPageMarkup(html), handle });
const regionHandlesIn = (html: string) => handlesIn({ scan: scanPageMarkup(html) });
const replaceRegionInner = (html: string, region: ScannedRegion, fragment: string) => replaceInner({ html, region, fragment });
const suggestRegionHandle = (inner: string, taken: ReadonlySet<string>) => suggest({ inner, taken }, slugOptions);
const untaggedTopLevelSections = (html: string) => untagged({ html, scan: scanPageMarkup(html) }, slugOptions);
const moveRegion = (html: string, moving: ScannedRegion, target: ScannedRegion, placement: "before" | "after") =>
  move({ html, moving, target, placement });

/**
 * @file The region scanner's own branches, exercised directly rather than only through the tool.
 *
 * Worth its own file because the scanner is where a quiet, off-target write would come from. Every
 * case below is markup a model plausibly emits, and each one defeats the regex approach
 * `Jini/packages/cms/src/widgets/markers/marker.ts` uses for its own (differently-shaped) job: a nested same-tag element, a
 * `>` inside a quoted attribute, an implicitly-closed `<p>`, a handle written inside a `<style>`
 * block. A splice that lands one byte off in any of these corrupts a live page silently.
 */

test("a nested same-tag element does not end the region early — the whole subtree is the region", () => {
  const html = `<section data-agent-element="outer"><section><p>in</p></section><p>tail</p></section>`;
  const found = locateRegion(html, "outer");
  assert.ok("region" in found);
  assert.equal(replaceRegionInner(html, found.region, "X"), `<section data-agent-element="outer">X</section>`);
});

test("a '>' inside a quoted attribute value does not terminate the open tag", () => {
  const html = `<section data-agent-element="hero" title="a > b"><p>body</p></section>`;
  assert.deepEqual(regionHandlesIn(html), ["hero"]);
  const found = locateRegion(html, "hero");
  assert.ok("region" in found);
  assert.equal(replaceRegionInner(html, found.region, "X"), `<section data-agent-element="hero" title="a > b">X</section>`);
});

test("a single-quoted handle attribute is read the same as a double-quoted one", () => {
  assert.deepEqual(regionHandlesIn(`<section data-agent-element='hero'><p>x</p></section>`), ["hero"]);
});

test("a region-shaped string inside a <style> block is not a region — CSS is not markup", () => {
  // The original lexical scanner did not track quotes in TEXT, only inside a tag: without its
  // raw-text mask this CSS string contributed a phantom handle. A weaker /* CSS comment */ fixture
  // did not distinguish that defect. parse5 itself keeps this content literal; its raw-source
  // dropped-handle cross-check must also mask the text (asserted directly in scan.test.ts).
  const html =
    `<section data-agent-element="real"><p>r</p></section>` +
    `<style>.a::after{content:'<section data-agent-element="ghost">'}</style>`;
  assert.deepEqual(regionHandlesIn(html), ["real"]);
});

test("a region-shaped string inside a <script> block is not a region either", () => {
  const html =
    `<section data-agent-element="real"><p>r</p></section>` +
    `<script>var s = '<section data-agent-element="ghost">';</script>`;
  assert.deepEqual(regionHandlesIn(html), ["real"]);
});

test("a region inside an HTML comment is not a region", () => {
  const html = `<!-- <section data-agent-element="ghost"></section> --><section data-agent-element="real"><p>r</p></section>`;
  assert.deepEqual(regionHandlesIn(html), ["real"]);
});

test("a handle carried by two elements is ambiguous, and locateRegion refuses rather than taking the first", () => {
  const html = `<section data-agent-element="dup"><p>1</p></section><section data-agent-element="dup"><p>2</p></section>`;
  const found = locateRegion(html, "dup");
  assert.ok("problem" in found, "taking the first match would land an edit somewhere the caller did not mean");
  assert.deepEqual(found.problem, { kind: "ambiguous", count: 2 });
});

test("a void element at the top level does not swallow what follows it", () => {
  // Distinguishing case for void handling: if <img> were pushed onto the open-element stack, the
  // section after it would be scanned at depth 1 — reported as nested inside a region rather than as
  // a top-level one, which is what the tagging check keys off.
  const html = `<img data-agent-element="logo" src="/a.png"><section data-agent-element="hero"><p>x</p></section>`;
  const { regions, topLevel } = scanPageMarkup(html);
  assert.deepEqual(
    regions.map((region) => region.handle),
    ["logo", "hero"]
  );
  assert.deepEqual(topLevel.map((element) => element.tag), ["img", "section"]);
});

test("an implicitly-closed <p> does not steal the region's closing tag", () => {
  const html = `<section data-agent-element="a"><p>one<p>two</section><section data-agent-element="b"><p>x</p></section>`;
  const found = locateRegion(html, "a");
  assert.ok("region" in found);
  assert.equal(
    replaceRegionInner(html, found.region, "X"),
    `<section data-agent-element="a">X</section><section data-agent-element="b"><p>x</p></section>`
  );
});

test("a stray closing tag with nothing open to match is ignored rather than throwing", () => {
  const html = `</div><section data-agent-element="hero"><p>x</p></section>`;
  assert.deepEqual(regionHandlesIn(html), ["hero"]);
});

test("a doctype is skipped rather than parsed as an element", () => {
  assert.deepEqual(regionHandlesIn(`<!doctype html><section data-agent-element="hero"><p>x</p></section>`), ["hero"]);
});

test("an outer region's close tag arriving before a NESTED region's own close implicitly closes the nested one — the outer still replaces correctly, and the orphaned nested region is reported unclosed rather than mis-replaced", () => {
  // Generalizes the existing "implicitly-closed <p>" case to an element that itself carries a
  // handle: the same browser-tolerant stack-pop applies whether or not the swallowed element was
  // addressable. A splice that guessed at "b"'s close instead of refusing it would silently corrupt
  // whatever came after — this proves the refusal fires instead.
  const html = `<section data-agent-element="a"><div data-agent-element="b">x</section><section data-agent-element="c"><p>y</p></section>`;
  const b = locateRegion(html, "b");
  assert.ok("problem" in b, "the implicitly-closed nested region must be refused as a target, not spliced on a guess");
  assert.equal(b.problem.kind, "not-replaceable");

  const a = locateRegion(html, "a");
  assert.ok("region" in a);
  assert.equal(
    replaceRegionInner(html, a.region, "REPLACED"),
    `<section data-agent-element="a">REPLACED</section><section data-agent-element="c"><p>y</p></section>`,
    "everything from a's real close tag onward, including the sibling region, must survive byte-identically"
  );
});

test("literal (unescaped) markup inside <pre>/<code> is a REAL region, matching how a browser parses it — <pre>/<code> are not raw-text elements the way <script>/<style> are", () => {
  // Deliberately the opposite finding from the <script>/<style>/comment masking tests above: masking
  // those three is correct because a browser never parses their content as markup. <pre> and <code>
  // are NOT on that list — a browser parses their content as ordinary child elements, so a
  // data-agent-element left unescaped inside one is genuinely live, addressable markup, not
  // documentation text. An author who wants to SHOW example markup inside <pre><code> must escape it
  // (&lt;section&gt;), exactly as they already must for it to display correctly at all.
  const html =
    `<section data-agent-element="real"><p>r</p></section>` +
    `<pre><code><section data-agent-element="live-in-pre"><p>x</p></section></code></pre>`;
  assert.deepEqual(regionHandlesIn(html), ["real", "live-in-pre"]);
});

test("a region that is never closed is reported but refused as a write target — there is no delimited span to replace", () => {
  const found = locateRegion(`<section data-agent-element="hero"><p>x</p>`, "hero");
  assert.ok("problem" in found);
  assert.equal(found.problem.kind, "not-replaceable");
});

test("a handle on a void element is refused — an <img> has no inner content to replace", () => {
  const found = locateRegion(`<img data-agent-element="logo" src="/a.png">`, "logo");
  assert.ok("problem" in found);
  assert.deepEqual(found.problem, { kind: "not-replaceable", tag: "img" });
});

test("a self-closing element carrying a handle is refused for the same reason", () => {
  const found = locateRegion(`<div data-agent-element="spacer" />`, "spacer");
  assert.ok("problem" in found);
  assert.equal(found.problem.kind, "not-replaceable");
});

test("a nested region follows its enclosing region in source order, and is still individually addressable", () => {
  const html = `<section data-agent-element="outer"><div data-agent-element="inner"><p>x</p></div></section>`;
  const { regions } = scanPageMarkup(html);
  assert.deepEqual(
    regions.map((region) => region.handle),
    ["outer", "inner"]
  );
  const found = locateRegion(html, "inner");
  assert.ok("region" in found);
  assert.equal(
    replaceRegionInner(html, found.region, "Y"),
    `<section data-agent-element="outer"><div data-agent-element="inner">Y</div></section>`
  );
});

test("replacing a region with an empty fragment empties it without removing the element or its handle", () => {
  const html = `<section data-agent-element="hero"><p>x</p></section>`;
  const found = locateRegion(html, "hero");
  assert.ok("region" in found);
  assert.equal(replaceRegionInner(html, found.region, ""), `<section data-agent-element="hero"></section>`);
});

test("whitespace and a trailing <style> block on either side of the target survive byte-for-byte", () => {
  const html = `\n  <section data-agent-element="hero">\n    <h1>Old</h1>\n  </section>\n\n<style>\n  .hero { color: red }\n</style>\n`;
  const found = locateRegion(html, "hero");
  assert.ok("region" in found);
  assert.equal(
    replaceRegionInner(html, found.region, "<h1>New</h1>"),
    `\n  <section data-agent-element="hero"><h1>New</h1></section>\n\n<style>\n  .hero { color: red }\n</style>\n`
  );
});

test("an absent handle reports the handles that exist; an empty document reports none", () => {
  const absent = locateRegion(`<section data-agent-element="a"><p>x</p></section>`, "b");
  assert.ok("problem" in absent);
  assert.deepEqual(absent.problem, { kind: "absent", available: ["a"] });

  const empty = locateRegion("", "b");
  assert.ok("problem" in empty);
  assert.deepEqual(empty.problem, { kind: "absent", available: [] });
});

test("suggestRegionHandle slugifies the section's own heading, strips inline tags, and truncates without a trailing dash", () => {
  assert.equal(suggestRegionHandle(`<h2>Our <em>Pricing</em> &amp; Plans!</h2>`, new Set()), "our-pricing-amp-plans");
  assert.equal(suggestRegionHandle(`<h1>${"a".repeat(60)}</h1>`, new Set()), "a".repeat(48));
  assert.equal(suggestRegionHandle(`<h3>!!!</h3>`, new Set()), undefined, "a heading that slugifies to nothing yields no suggestion");
});

test("suggestRegionHandle withholds a suggestion that would collide with a handle already in the document", () => {
  assert.equal(suggestRegionHandle(`<h2>Pricing</h2>`, new Set(["pricing"])), undefined);
});

test("a section with no heading gets no suggestion — 'you pick one' beats an address that will go stale", () => {
  assert.equal(suggestRegionHandle(`<p>Just some copy.</p>`, new Set()), undefined);
});

test("untaggedTopLevelSections names every offender, and never suggests the same handle twice in one batch", () => {
  // The aggregate case: two untagged sections whose headings slugify identically. A per-element
  // suggester would offer "pricing" for both, and following that advice would produce exactly the
  // ambiguous handle `locateRegion` refuses — the batch has to remember what it already handed out.
  const html =
    `<section data-agent-element="hero"><h1>Hi</h1></section>` +
    `<section><h2>Pricing</h2></section>` +
    `<section><h2>Pricing</h2></section>` +
    `<div><p>no heading here</p></div>`;
  assert.deepEqual(untaggedTopLevelSections(html), [
    { tag: "section", suggestedHandle: "pricing" },
    { tag: "section", suggestedHandle: undefined },
    { tag: "div", suggestedHandle: undefined },
  ]);
});

test("untaggedTopLevelSections exempts <style>/<script> and only looks at the TOP level", () => {
  const html =
    `<section data-agent-element="hero"><div><p>nested and untagged, which is fine</p></div></section>` +
    `<style>.a{}</style><script>var x = 1;</script>`;
  assert.deepEqual(untaggedTopLevelSections(html), []);
});

test("untaggedTopLevelSections flags a bare heading at the top level — the contract asks for sections, and a loose <h1> is not one", () => {
  assert.deepEqual(untaggedTopLevelSections(`<h1>Untagged</h1><p>Copy.</p>`), [
    { tag: "h1", suggestedHandle: undefined },
    { tag: "p", suggestedHandle: undefined },
  ]);
});

test("literal less-than text and malformed close tags do not hide a later editable region", () => {
  const html = `2 < 3 </ broken><section data-agent-element="real">body</section>`;
  const found = locateRegion(html, "real");
  assert.ok("region" in found);
  assert.equal(replaceRegionInner(html, found.region, "edited"), `2 < 3 </ broken><section data-agent-element="real">edited</section>`);
});

test("an unterminated open tag creates no phantom region", () => {
  const html = `<section data-agent-element="real">body</section><div data-agent-element="unfinished" title="never closed`;
  assert.deepEqual(regionHandlesIn(html), ["real"]);
  assert.deepEqual(locateRegion(html, "unfinished"), { problem: { kind: "absent", available: ["real"] } });
});

test("an unterminated declaration after a region leaves its replacement offsets intact", () => {
  const html = `<section data-agent-element="real">body</section><!unfinished`;
  const found = locateRegion(html, "real");
  assert.ok("region" in found);
  assert.equal(replaceRegionInner(html, found.region, "edited"), `<section data-agent-element="real">edited</section><!unfinished`);
});

test("empty void and unclosed top-level sections are still reported for missing handles", () => {
  assert.deepEqual(untaggedTopLevelSections(`<br><section>`), [
    { tag: "br", suggestedHandle: undefined },
    { tag: "section", suggestedHandle: undefined },
  ]);
});

// L254: pin the quote-aware open-tag walk before separating it from attribute parsing.
for (const { opening, handle, tag } of [
  { opening: `<SECTION title="left > 'right'" data-agent-element="hero">`, handle: "hero", tag: "section" },
  { opening: `<section title='left > "right"' data-agent-element='hero'>`, handle: "hero", tag: "section" },
  { opening: `<section data-agent-element="">`, handle: "", tag: "section" },
  { opening: `<section data-agent-element='hero'/>`, handle: "hero", tag: "section" },
  { opening: `<section title=plain data-agent-element="hero">`, handle: "hero", tag: "section" },
]) {
  test(`L254 open-tag offsets and handle survive ${opening}`, () => {
    const html = opening + "body</section>";
    assert.deepEqual(scanPageMarkup(html).regions, [{
      handle, tag, start: 0, innerStart: opening.length,
      innerEnd: opening.length + 4,
      end: opening.length + "body</section>".length,
    }]);
  });
}

for (const prefix of ["< 3", `<div title="unterminated >`, `<div title='unterminated >`, "<div no-end"]) {
  test(`L254 malformed open tag contributes no region: ${prefix}`, () => {
    const html = `<section data-agent-element="hero">body</section>` + prefix;
    assert.deepEqual(regionHandlesIn(html), ["hero"]);
    const found = locateRegion(html, "hero");
    assert.ok("region" in found);
    assert.equal(replaceRegionInner(html, found.region, "changed"), `<section data-agent-element="hero">changed</section>` + prefix);
  });
}

test("L254 an unhandled open tag preserves the next region's offsets", () => {
  const html = `<div title='ordinary > text'></div><section data-agent-element='hero'>body</section>`;
  assert.deepEqual(scanPageMarkup(html).topLevel.map(({ handle }) => handle), [undefined, "hero"]);
  const found = locateRegion(html, "hero");
  assert.ok("region" in found);
  assert.equal(replaceRegionInner(html, found.region, "X"), `<div title='ordinary > text'></div><section data-agent-element='hero'>X</section>`);
});

/**
 * @file `moveRegion` — reordering whole sections of a page body, byte-for-byte.
 *
 * The incident (chat "Can You See Higgsfield Plugin", 2026-10-01): the owner asked to swap two
 * landing-page sections. Every section was a tagged region, but the only tools were "replace one
 * region's INNER content" and "rewrite the whole ~55KB page", so the assistant refused. Moving a
 * section is a pure splice of an element the scanner already delimits; these cases pin that splice.
 */

function region(html: string, handle: string): ScannedRegion {
  const found = locateRegion(html, handle);
  assert.ok("region" in found, `fixture has no single region "${handle}"`);
  return found.region;
}

const A = `<section data-agent-element="a" data-agent-role="region"><h2>A</h2></section>`;
const B = `<section data-agent-element="b" data-agent-role="region"><h2>B</h2></section>`;
const C = `<section data-agent-element="c" data-agent-role="region"><h2>C</h2></section>`;
const STYLE = `<style>\n  .x > .y { color: red; }\n</style>\n`;
const PAGE = `${STYLE}${A}\n${B}\n${C}\n`;

test("moving a region before an earlier one puts the whole element there and leaves every other byte in order", () => {
  assert.deepEqual(moveRegion(PAGE, region(PAGE, "c"), region(PAGE, "a"), "before"), { html: `${STYLE}${C}\n${A}\n${B}\n` });
});

test("moving a region after a later one", () => {
  assert.deepEqual(moveRegion(PAGE, region(PAGE, "a"), region(PAGE, "c"), "after"), { html: `${STYLE}${B}\n${C}\n${A}\n` });
});

test("swapping two adjacent sections is one move, in either direction", () => {
  const expected = { html: `${STYLE}${B}\n${A}\n${C}\n` };
  assert.deepEqual(moveRegion(PAGE, region(PAGE, "b"), region(PAGE, "a"), "before"), expected);
  assert.deepEqual(moveRegion(PAGE, region(PAGE, "a"), region(PAGE, "b"), "after"), expected);
});

test("a region already in the requested position yields the identical document", () => {
  assert.deepEqual(moveRegion(PAGE, region(PAGE, "b"), region(PAGE, "a"), "after"), { html: PAGE });
});

test("the last region with no trailing whitespace carries its leading whitespace instead of gluing onto a neighbour", () => {
  const html = `${A}\n${B}`;
  assert.deepEqual(moveRegion(html, region(html, "b"), region(html, "a"), "before"), { html: `${B}\n${A}` });
});

test("a region holding a nested same-tag element and nested regions moves as one piece", () => {
  const outer = `<section data-agent-element="outer"><section data-agent-element="inner"><p>i</p></section><p>tail</p></section>`;
  const html = `${A}\n${outer}\n`;
  const moved = moveRegion(html, region(html, "outer"), region(html, "a"), "before");
  assert.deepEqual(moved, { html: `${outer}\n${A}\n` });
  assert.deepEqual(regionHandlesIn((moved as { html: string }).html), ["outer", "inner", "a"]);
});

test("moving a region relative to itself is refused", () => {
  assert.deepEqual(moveRegion(PAGE, region(PAGE, "a"), region(PAGE, "a"), "after"), { problem: "self" });
});

test("moving a region next to one of its own descendants is refused — it would have to sit inside itself", () => {
  const html = `<section data-agent-element="outer"><div data-agent-element="inner"><p>i</p></div></section>`;
  assert.deepEqual(moveRegion(html, region(html, "outer"), region(html, "inner"), "before"), { problem: "into-itself" });
});

test("regions at the document edges can move without inventing whitespace", () => {
  const html = A + B;
  assert.deepEqual(moveRegion(html, region(html, "a"), region(html, "b"), "after"), { html: B + A });
  assert.deepEqual(moveRegion(html, region(html, "b"), region(html, "a"), "before"), { html: B + A });
});

test("one caller-owned scan supports lookup, reads, tagging advice and replacement without mutation", () => {
  const html = '<section data-agent-element="Legacy Handle!">old</section><section><h2>New</h2></section>';
  const scan = scanHtmlRegions({ html });
  const original = JSON.stringify(scan);
  const found = locate({ scan, handle: "Legacy Handle!" });
  assert.ok("region" in found);
  assert.deepEqual(handlesIn({ scan }), ["Legacy Handle!"]);
  assert.deepEqual(untagged({ html, scan }, slugOptions), [{ tag: "section", suggestedHandle: "new" }]);
  assert.equal(replaceInner({ html, region: found.region, fragment: "changed" }), html.replace("old", "changed"));
  assert.equal(JSON.stringify(scan), original);
});

test("new ambiguity is counted across the whole document, once per handle in after's source order", () => {
  const before = scanHtmlRegions({ html: A + B });
  const after = scanHtmlRegions({ html: B + B + A + A + B });
  assert.deepEqual(handlesMadeAmbiguous({ before, after }), ["b", "a"]);
  assert.deepEqual(handlesMadeAmbiguous({ before: after, after }), []);
  assert.deepEqual(handlesMadeAmbiguous({ before: after, after: before }), []);
});

test("existing ambiguity may improve or stay unchanged, while adding/removing unique handles is allowed", () => {
  const before = scanHtmlRegions({ html: A + A + B });
  assert.deepEqual(handlesMadeAmbiguous({ before, after: scanHtmlRegions({ html: A + A + C }) }), []);
  assert.deepEqual(handlesMadeAmbiguous({ before, after: scanHtmlRegions({ html: A + C }) }), []);
  assert.deepEqual(handlesMadeAmbiguous({ before, after: scanHtmlRegions({ html: A + A + A + C }) }), ["a"]);
  assert.deepEqual(handlesMadeAmbiguous({ before, after: scanHtmlRegions({ html: C + C }) }), ["c"]);
});

test("ambiguity checks retain unsafe and invalid handles, including empty handle values", () => {
  const before = scanHtmlRegions({ html: '<div data-agent-element="">x</div>' });
  const after = scanHtmlRegions({ html: '<div data-agent-element="">x</div><img data-agent-element="">' });
  assert.deepEqual(handlesMadeAmbiguous({ before, after }), [""]);
  assert.deepEqual(locate({ scan: after, handle: "" }), { problem: { kind: "ambiguous", count: 2 } });
});

test("a fragment duplicating the target's own handle is newly ambiguous; replacing nested handles is allowed", () => {
  const html = '<section data-agent-element="outer"><div data-agent-element="inner">x</div></section>';
  const before = scanHtmlRegions({ html });
  const found = locate({ scan: before, handle: "outer" });
  assert.ok("region" in found);
  const duplicate = replaceInner({ html, region: found.region, fragment: '<div data-agent-element="outer">y</div>' });
  assert.deepEqual(handlesMadeAmbiguous({ before, after: scanHtmlRegions({ html: duplicate }) }), ["outer"]);
  const replaced = replaceInner({ html, region: found.region, fragment: '<div data-agent-element="new">y</div>' });
  const after = scanHtmlRegions({ html: replaced });
  assert.deepEqual(handlesMadeAmbiguous({ before, after }), []);
  assert.deepEqual(handlesIn({ scan: after }), ["outer", "new"]);
});

test("suggestions use the injected slug policy and remove a trailing dash after truncation", () => {
  const calls: string[] = [];
  const options = { slugify: (text: string) => { calls.push(text); return "cafe-munster"; } };
  assert.equal(suggest({ inner: "<h2>Café <em>Münster</em></h2>", taken: new Set() }, options), "cafe-munster");
  assert.deepEqual(calls, ["Café  Münster "]);
  assert.equal(suggest({ inner: "<h2>anything</h2>", taken: new Set() }, { slugify: () => "a".repeat(47) + "-tail" }), "a".repeat(47));
});

test("top-level suggestions use the same injected policy and reserve earlier suggestions", () => {
  const html = "<section><h2>Café</h2></section><section><h2>Café</h2></section>";
  const scan = scanHtmlRegions({ html });
  const options = { slugify: () => "cafe" };
  assert.deepEqual(untagged({ html, scan }, options), [
    { tag: "section", suggestedHandle: "cafe" },
    { tag: "section", suggestedHandle: undefined },
  ]);
});

test("a nested region can move to a destination outside its ancestor", () => {
  const outer = '<section data-agent-element="outer"><div data-agent-element="inner">i</div></section>';
  const html = outer + A;
  const moving = region(html, "inner");
  const target = region(html, "a");
  assert.deepEqual(move({ html, moving, target, placement: "after" }), {
    html: '<section data-agent-element="outer"></section>' + A + '<div data-agent-element="inner">i</div>',
  });
});

test("a region may move into a separately located ancestor without crossing the moved span", () => {
  const outer = '<section data-agent-element="outer"><div data-agent-element="inner">i</div></section>';
  const html = A + outer;
  assert.deepEqual(moveRegion(html, region(html, "a"), region(html, "inner"), "before"), {
    html: '<section data-agent-element="outer">' + A + '<div data-agent-element="inner">i</div></section>',
  });
});
