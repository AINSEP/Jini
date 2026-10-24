/**
 * parse5 scan compatibility (binding review changes 1–2, 4–5, 11–12).
 * Intentional changes from Tovu's lexical scanner:
 * - A non-void `<div … />` stays open and contains subsequent siblings; a later explicit close
 *   delimits it normally. The slash alone does not make an empty, closed region.
 * - Unclosed top-level elements use parse5's recovered EOF/implied-close boundaries for advice.
 * - Malformed open tags and unterminated declarations follow HTML5 recovery, rather than the old
 *   scanner's internal skip rules. Dropped raw handles are document diagnostics, never read throws.
 * - Unquoted and upper-case attribute names now publish handles, matching browser parsing.
 * - `<noscript>` content is literal text (scripting enabled, as in a browser running the page), so a
 *   tagged element inside it is not a region; the old scanner listed it.
 * No region depth is exposed; callers use source order and actual top-level elements.
 */
import { describe, expect, test } from "vitest";

import { handlesMadeAmbiguous, locateRegion, regionHandlesIn, replaceRegionInner } from "../../index.js";
import { createParse5RegionParser, scanHtmlRegions } from "../index.js";

describe("original-string offsets", () => {
  test.each([
    { name: "CRLF", prefix: "\r\n", content: "first\r\nsecond" },
    { name: "BOM", prefix: "\uFEFF", content: "body" },
    { name: "astral/emoji", prefix: "😀", content: "🪐 body 😀" },
    { name: "combined", prefix: "\uFEFF😀\r\n", content: "🪐\r\n😀" },
  ])("preserves $name inner and outer slices", ({ prefix, content }) => {
    const opening = '<section data-agent-element="hero">';
    const outer = opening + content + "</section>";
    const html = prefix + outer + "\r\nTAIL";
    const scan = scanHtmlRegions({ html });
    const region = scan.regions[0]!;
    expect(region).toEqual({
      handle: "hero", tag: "section", start: prefix.length, end: prefix.length + outer.length,
      innerStart: prefix.length + opening.length, innerEnd: prefix.length + opening.length + content.length,
    });
    expect(html.slice(region.start, region.end)).toBe(outer);
    expect(html.slice(region.innerStart, region.innerEnd)).toBe(content);
    expect(replaceRegionInner({ html, region, fragment: "NEW" })).toBe(prefix + opening + "NEW</section>\r\nTAIL");
  });
});

test("an unsafe handle never prevents another handle from being read or edited", () => {
  const html = '<section data-agent-element="a"><div data-agent-element="b">x</section>' +
    '<section data-agent-element="c">y</section>';
  const scan = scanHtmlRegions({ html });
  expect(regionHandlesIn({ scan })).toEqual(["a", "b", "c"]);
  expect(scan.regions[1]?.problem).toMatch(/closing tag/);
  expect(scan.regions[0]?.problem).toBeUndefined();
  expect(scan.regions[2]?.problem).toBeUndefined();
  expect(locateRegion({ scan, handle: "b" })).toEqual({ problem: { kind: "not-replaceable", tag: "div" } });
  const found = locateRegion({ scan, handle: "c" });
  expect("region" in found).toBe(true);
  if (!("region" in found)) throw new Error("fixture region missing");
  expect(replaceRegionInner({ html, region: found.region, fragment: "NEW" })).toBe(html.replace(">y</section>", ">NEW</section>"));
  const strict = createParse5RegionParser();
  expect(() => strict.findRegions({ html })).toThrow(/closing tag/);
  expect(strict.checkWellFormed({ html }).ok).toBe(false);
});

test.each([
  '<!-- <section data-agent-element="ghost"> -->',
  '<style>.a::after{content:\'<section data-agent-element="ghost">\'}</style>',
  '<script>const s = \'<section data-agent-element="ghost">\';</script>',
  '<template><!-- data-agent-element="ghost" --><style>.a{content:\'data-agent-element="ghost"\'}</style></template>',
  '<textarea>data-agent-element="ghost"</textarea>',
  '<noscript><div data-agent-element="ghost">x</div></noscript>',
])("comments and literal text bodies do not inflate the raw-handle count: %s", (example) => {
  const html = example + '<section data-agent-element="real">body</section>';
  const scan = scanHtmlRegions({ html });
  expect(regionHandlesIn({ scan })).toEqual(["real"]);
  expect(scan.documentProblem).toBeUndefined();
  expect(() => createParse5RegionParser().findRegions({ html })).not.toThrow();
});

test("tagged script/style opening tags still count and their inner content stays literal", () => {
  const html = '<script data-agent-element="code">const s = \'data-agent-element="ghost"\';</script>' +
    '<style data-agent-element="css">.a{content:\'data-agent-element="ghost"\'}</style>';
  const scan = scanHtmlRegions({ html });
  expect(regionHandlesIn({ scan })).toEqual(["code", "css"]);
  expect(scan.documentProblem).toBeUndefined();
  expect(scan.regions.every((region) => region.problem === undefined)).toBe(true);
});

test("a dropped table-only handle is reported without losing safely located regions", () => {
  const html = '<section data-agent-element="real">body</section><td data-agent-element="lost">x</td>';
  const scan = scanHtmlRegions({ html });
  expect(regionHandlesIn({ scan })).toEqual(["real"]);
  expect(scan.documentProblem).toMatch(/dropped/);
  expect(locateRegion({ scan, handle: "real" })).toHaveProperty("region");
  expect(() => createParse5RegionParser().findRegions({ html })).toThrow(/dropped/);
});

test("foster parenting cannot reorder region output relative to the source", () => {
  const html = '<table data-agent-element="table"><tr><td data-agent-element="cell">x</td></tr>' +
    '<div data-agent-element="foster">y</div></table>';
  const scan = scanHtmlRegions({ html });
  expect(regionHandlesIn({ scan })).toEqual(["table", "cell", "foster"]);
  expect(scan.regions.map((region) => html.slice(region.start, region.end))).toEqual([
    html, '<td data-agent-element="cell">x</td>', '<div data-agent-element="foster">y</div>',
  ]);
  expect(scan.topLevel.map((element) => element.tag)).toEqual(["table", "div"]);
});

test("a non-void slash stays open and swallows following siblings, but only its handle is unsafe", () => {
  const html = '<div data-agent-element="spacer" /><section data-agent-element="safe">x</section>';
  const scan = scanHtmlRegions({ html });
  expect(scan.topLevel.map((element) => element.tag)).toEqual(["div"]);
  expect(scan.regions[0]?.problem).toMatch(/closing tag/);
  expect(scan.regions[1]?.problem).toBeUndefined();
  expect(locateRegion({ scan, handle: "safe" })).toHaveProperty("region");
  expect(scan.regions[0]?.end).toBe(html.length);
});

test("a non-void slash followed by an explicit close has real inner and outer offsets", () => {
  const html = '<section data-agent-element="hero"/>body</section>';
  expect(scanHtmlRegions({ html }).regions).toEqual([
    { handle: "hero", tag: "section", start: 0, end: html.length, innerStart: html.indexOf("body"), innerEnd: html.indexOf("</") },
  ]);
});

test("unclosed top-level sections and voids remain available for tagging advice", () => {
  const html = "<br><section><h2>Pricing</h2>";
  const scan = scanHtmlRegions({ html });
  expect(scan.topLevel).toEqual([
    { tag: "br", start: 0, end: 4, innerStart: 4, innerEnd: 4 },
    { tag: "section", start: 4, end: html.length, innerStart: 13, innerEnd: html.length },
  ]);
});

test.each(["< 3", '<div title="unterminated >', "<div title='unterminated >", "<div no-end", "<!unfinished"])(
  "malformed trailing markup preserves the preceding region: %s", (suffix) => {
    const outer = '<section data-agent-element="hero">body</section>';
    const html = outer + suffix;
    const scan = scanHtmlRegions({ html });
    expect(regionHandlesIn({ scan })).toEqual(["hero"]);
    expect(scan.regions[0]?.end).toBe(outer.length);
    expect(replaceRegionInner({ html, region: scan.regions[0]!, fragment: "X" })).toBe(outer.replace("body", "X") + suffix);
  },
);

test("an unfinished tagged open token is a document diagnostic, never a guessed region", () => {
  const html = '<section data-agent-element="real">body</section><div data-agent-element="unfinished" title="never closed';
  const scan = scanHtmlRegions({ html });
  expect(regionHandlesIn({ scan })).toEqual(["real"]);
  expect(scan.documentProblem).toMatch(/dropped/);
  expect(locateRegion({ scan, handle: "unfinished" })).toEqual({ problem: { kind: "absent", available: ["real"] } });
});

test.each(['<section data-agent-element=hero>', '<SECTION DATA-AGENT-ELEMENT="hero">'])(
  "unquoted and upper-case attribute names now publish handles: %s", (opening) => {
    const html = opening + "body</section>";
    const scan = scanHtmlRegions({ html });
    expect(scan.regions).toEqual([
      { handle: "hero", tag: "section", start: 0, end: html.length, innerStart: opening.length, innerEnd: opening.length + 4 },
    ]);
    expect(scan.documentProblem).toBeUndefined();
  },
);

test("parse-error diagnostics do not turn reads into throws", () => {
  const html = '<section data-agent-element="hero">body</section id="stray">';
  const scan = scanHtmlRegions({ html });
  expect(scan.parseErrorReasons).toEqual([expect.stringMatching(/end tag with attributes/)]);
  expect(scan.regions[0]?.problem).toBeUndefined();
  expect(locateRegion({ scan, handle: "hero" })).toHaveProperty("region");
  expect(createParse5RegionParser().checkWellFormed({ html }).ok).toBe(false);
});

test.each([
  '<p><b data-agent-element="x">bold</p><p>one</p><p>two</p>',
  // The reconstructed clone picks up this later </b>, which does not delimit the authored <b>.
  '<p><b data-agent-element="x">bold</p><p>two</b></p>',
])("a formatting element parse5 clones stays one unsafe address: %s", (html) => {
  const scan = scanHtmlRegions({ html });
  expect(regionHandlesIn({ scan })).toEqual(["x"]);
  expect(scan.regions[0]?.start).toBe(3);
  expect(locateRegion({ scan, handle: "x" })).toEqual({ problem: { kind: "not-replaceable", tag: "b" } });
  expect(scan.documentProblem).toBeUndefined();
});

test("an edit adding text after an unclosed formatting handle does not newly duplicate it", () => {
  const before = scanHtmlRegions({ html: '<p><b data-agent-element="x">bold</p><section data-agent-element="s"><p>one</p></section>' });
  const after = scanHtmlRegions({ html: '<p><b data-agent-element="x">bold</p><section data-agent-element="s"><p>one</p><p>two</p></section>' });
  expect(handlesMadeAmbiguous({ before, after })).toEqual([]);
});
