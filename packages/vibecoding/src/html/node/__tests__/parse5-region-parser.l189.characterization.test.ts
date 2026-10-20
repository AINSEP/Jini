import { defaultTreeAdapter, html as parse5Html, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createParse5RegionParser } from "../parse5-region-parser.js";

// Real parse5 handles ordinary fixtures; only location-defense cases replace its tree output.
vi.mock("parse5", async (importOriginal) => {
  const actual = await importOriginal<typeof import("parse5")>();
  return { ...actual, parseFragment: vi.fn(actual.parseFragment) };
});

afterEach(() => vi.mocked(parseFragment).mockReset());

function expectRejected(
  { html, reason }: { readonly html: string; readonly reason: string },
  _options: Record<string, never> = {},
): void {
  const parser = createParse5RegionParser();
  expect(() => parser.findRegions({ html })).toThrow(new Error(reason));
  expect(parser.checkWellFormed({ html })).toEqual({ ok: false, reason });
}

describe("L189 — region analysis characterization", () => {
  test.each(["", "text<!-- comment --><div>untagged<span>child</span></div>"])(
    "returns an empty list and accepts a fragment with no handle: %j",
    (html) => {
      const parser = createParse5RegionParser();
      expect(parser.findRegions({ html })).toEqual([]);
      expect(parser.checkWellFormed({ html })).toEqual({ ok: true });
    },
  );

  test.each([
    { attributes: "", metadata: {} },
    { attributes: ' data-agent-role="region"', metadata: { role: "region" } },
    { attributes: ' data-agent-label="Hero"', metadata: { label: "Hero" } },
    { attributes: ' data-agent-role="" data-agent-label=""', metadata: { role: "", label: "" } },
    { attributes: ' data-agent-role="region" data-agent-label="Hero"', metadata: { role: "region", label: "Hero" } },
  ])("preserves metadata presence and empty values: $attributes", ({ attributes, metadata }) => {
    const parser = createParse5RegionParser();
    const html = `<section data-agent-element="hero"${attributes}>😀&amp;</section>`;
    const innerStart = html.indexOf("😀");
    expect(parser.findRegions({ html })).toEqual([
      { handle: "hero", innerStart, innerEnd: innerStart + "😀&amp;".length, ...metadata },
    ]);
    expect(parser.checkWellFormed({ html })).toEqual({ ok: true });
  });

  test("walks nested template content and preserves duplicate, invalid and empty handles", () => {
    const parser = createParse5RegionParser();
    const html = '<template data-agent-element="outer"><div data-agent-element="dup">A</div>' +
      '<template><span data-agent-element="dup">B</span></template></template>' +
      '<div data-agent-element="Not Valid!">C</div><div data-agent-element="">D</div>';
    const regions = parser.findRegions({ html });
    expect(regions.map((region) => ({ handle: region.handle, content: html.slice(region.innerStart, region.innerEnd) })))
      .toEqual([
        { handle: "outer", content: '<div data-agent-element="dup">A</div><template><span data-agent-element="dup">B</span></template>' },
        { handle: "dup", content: "A" },
        { handle: "dup", content: "B" },
        { handle: "Not Valid!", content: "C" },
        { handle: "", content: "D" },
      ]);
    expect(parser.checkWellFormed({ html })).toEqual({ ok: true });
  });

  test("reports an empty-valued bare handle attribute even though the raw scan counts no assignment", () => {
    const parser = createParse5RegionParser();
    const html = "<div data-agent-element>x</div>";
    const innerStart = html.indexOf(">") + 1;
    expect(parser.findRegions({ html })).toEqual([{ handle: "", innerStart, innerEnd: innerStart + 1 }]);
    expect(parser.checkWellFormed({ html })).toEqual({ ok: true });
  });

  test.each([
    '<div DATA-AGENT-ELEMENT = "hero">x</div>',
    "<div data-agent-element='hero'>x</div>",
    "<div data-agent-element=hero>x</div>",
  ])("matches raw attributes regardless of case, spacing and quoting: %s", (html) => {
    const parser = createParse5RegionParser();
    const innerStart = html.indexOf(">") + 1;
    expect(parser.findRegions({ html })).toEqual([{ handle: "hero", innerStart, innerEnd: innerStart + 1 }]);
    expect(parser.checkWellFormed({ html })).toEqual({ ok: true });
  });

  test("refuses a tagged void element with its specific diagnostic", () => {
    expectRejected({
      html: '<img data-agent-element="pic">',
      reason: '"pic" tags a <img> element, which is void and has no inner content — void elements cannot be a data-agent-element region',
    });
  });

  test("keeps the first location problem ahead of later tagged nodes, raw mismatch and parse errors", () => {
    expectRejected({
      html: '<div data-agent-element="good">ok</div><img data-agent-element="first">' +
        '<br data-agent-element="later"><span>untagged</span><div data-agent-element="last">ok</div id="oops">' +
        '<!-- data-agent-element="example" -->',
      reason: '"first" tags a <img> element, which is void and has no inner content — void elements cannot be a data-agent-element region',
    });
  });

  test("refuses an unclosed tagged container with its boundary diagnostic", () => {
    expectRejected({
      html: '<div data-agent-element="hero">unclosed',
      reason: 'a "data-agent-element" region ("hero") has no closing tag the parser could ' +
        "locate — its content boundaries cannot be determined safely. Close the tag explicitly.",
    });
  });

  test("refuses a dropped table-only region even after an otherwise valid region", () => {
    expectRejected({
      html: '<div data-agent-element="good">ok</div><td data-agent-element="lost">bad</td>',
      reason: "the source mentions data-agent-element 2 time(s) but only 1 could be located in the parsed document — the parser's error-recovery " +
        "rules likely dropped one entirely (a common cause: a table-only tag, such as <td>, used " +
        "outside a <table>). Rewrite the document so every tagged element sits in ordinary, " +
        "non-table-recovery document structure.",
    });
  });

  test.each([
    '<!-- data-agent-element="example" -->',
    '<script>const example = \'data-agent-element="example"\';</script>',
  ])("rejects a raw attribute example without a tagged element (reported, not fixed): %s", (html) => {
    // Documented conservative false positive: the raw scan intentionally sees comments/script text.
    expectRejected({
      html,
      reason: "the source mentions data-agent-element 1 time(s) but only 0 could be located in the parsed document — the parser's error-recovery " +
        "rules likely dropped one entirely (a common cause: a table-only tag, such as <td>, used " +
        "outside a <table>). Rewrite the document so every tagged element sits in ordinary, " +
        "non-table-recovery document structure.",
    });
  });

  test("findRegions still returns located regions when checkWellFormed reports a parse error", () => {
    const parser = createParse5RegionParser();
    const html = '<div data-agent-element="hero">hi</div id="oops">';
    expect(parser.findRegions({ html })).toEqual([{ handle: "hero", innerStart: 31, innerEnd: 33 }]);
    expect(parser.checkWellFormed({ html })).toEqual({
      ok: false,
      reason: "the document does not parse cleanly: end tag with attributes near character 48",
    });
  });

  test.each(["null", "undefined", "missing start tag"] as const)(
    "refuses a parser-provided tagged element with %s location",
    (kind) => {
      // These are legal shapes in parse5's public tree types, not a claim about a recovery fixture.
      const fragment = defaultTreeAdapter.createDocumentFragment();
      const element = defaultTreeAdapter.createElement("div", parse5Html.NS.HTML, [
        { name: "data-agent-element", value: "lost" },
      ]);
      const location: DefaultTreeAdapterTypes.Element["sourceCodeLocation"] = {
        startLine: 1, startCol: 1, startOffset: 0, endLine: 1, endCol: 1, endOffset: 0,
      };
      if (kind === "null") element.sourceCodeLocation = null;
      if (kind === "missing start tag") element.sourceCodeLocation = location;
      defaultTreeAdapter.appendChild(fragment, element);
      vi.mocked(parseFragment).mockReturnValueOnce(fragment).mockReturnValueOnce(fragment);

      expectRejected({
        html: '<div data-agent-element="lost"></div>',
        reason: 'a "data-agent-element" region ("lost") could not be located in the document — ' +
          "the parser's error-recovery rules likely dropped or repositioned it. Rewrite the document " +
          "so this element is reachable in ordinary document structure (for example, not a table-only " +
          "tag used outside a <table>).",
      });
    },
  );
});
