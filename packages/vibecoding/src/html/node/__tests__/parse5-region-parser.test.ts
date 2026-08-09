import { describe, expect, test } from "vitest";

import { applyEdit } from "../../../core/apply.js";
import { AGENT_ELEMENT_ATTRIBUTE, createHtmlRegionTarget } from "../../regions.js";
import { createParse5RegionParser } from "../parse5-region-parser.js";

/** An in-memory document store, exposing the raw HTML so tests can assert on bytes. */
function makeStore(initial: string): { read: () => Promise<string>; write: (h: string) => Promise<void>; html: () => string } {
  let html = initial;
  return {
    read: async () => html,
    write: async (next) => {
      html = next;
    },
    html: () => html,
  };
}

describe("findRegions — well-formed input", () => {
  test("reports each tagged region in document order, with correct inner offsets", () => {
    const parser = createParse5RegionParser();
    const html =
      '<section data-agent-element="hero" data-agent-role="region" data-agent-label="Hero">OLD HERO</section>' +
      '<section data-agent-element="pricing" data-agent-role="region">OLD PRICING</section>';

    const regions = parser.findRegions(html);

    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual({
      handle: "hero",
      role: "region",
      label: "Hero",
      innerStart: html.indexOf("OLD HERO"),
      innerEnd: html.indexOf("OLD HERO") + "OLD HERO".length,
    });
    expect(regions[1]).toEqual({
      handle: "pricing",
      role: "region",
      innerStart: html.indexOf("OLD PRICING"),
      innerEnd: html.indexOf("OLD PRICING") + "OLD PRICING".length,
    });
    // Prove the offsets are the real, parse5-derived thing — not a naive regex guess — by slicing
    // the raw string with them directly.
    expect(html.slice(regions[0]!.innerStart, regions[0]!.innerEnd)).toBe("OLD HERO");
    expect(html.slice(regions[1]!.innerStart, regions[1]!.innerEnd)).toBe("OLD PRICING");
  });

  test("a tagged div directly inside a <table> (foster-parented) still resolves a complete location", () => {
    // The HTML5 tree-construction algorithm moves non-table-content out of a <table> ("foster
    // parenting"), but the moved node is still the token's own element — parse5 keeps its
    // sourceCodeLocation. This must NOT be treated as a CIC-2 structural failure.
    const parser = createParse5RegionParser();
    const html = '<table><div data-agent-element="ftr">foster me</div><tr><td>cell</td></tr></table>';

    const regions = parser.findRegions(html);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.handle).toBe("ftr");
    expect(html.slice(regions[0]!.innerStart, regions[0]!.innerEnd)).toBe("foster me");
  });
});

describe("findRegions — duplicates and invalid handles are surfaced, never filtered", () => {
  test("a handle appearing twice is reported twice, not deduplicated", () => {
    const parser = createParse5RegionParser();
    const html = '<div data-agent-element="dup">A</div><div data-agent-element="dup">B</div>';

    const regions = parser.findRegions(html);

    expect(regions.map((r) => r.handle)).toEqual(["dup", "dup"]);
  });

  test("a handle violating the agentic grammar (uppercase, spaces) is still reported", () => {
    const parser = createParse5RegionParser();
    const html = '<div data-agent-element="Not Valid!">x</div>';

    const regions = parser.findRegions(html);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.handle).toBe("Not Valid!");
  });
});

describe("byte-preserving splice using this parser's own offsets", () => {
  test("replacePart through createHtmlRegionTarget preserves every byte outside the edited region", async () => {
    const parser = createParse5RegionParser();
    const html =
      "<!-- an author's comment -->" +
      '<section data-agent-element="hero" data-agent-label="Hero">OLD HERO</section>' +
      '<section data-agent-element="pricing">OLD PRICING</section>';
    const store = makeStore(html);
    const target = createHtmlRegionTarget({ store, parser });

    const outcome = await applyEdit(target, { id: "hero", content: "<h1>NEW</h1>" });

    expect(outcome).toEqual({ status: "applied", id: "hero" });
    const after = store.html();
    expect(after).toContain("<!-- an author's comment -->");
    expect(after).toContain('data-agent-label="Hero"');
    expect(after).toContain("OLD PRICING");
    expect(after).toContain("<h1>NEW</h1>");
    expect(after).not.toContain("OLD HERO");
  });
});

describe("checkWellFormed", () => {
  test("passes a genuinely well-formed fragment", () => {
    const parser = createParse5RegionParser();
    expect(parser.checkWellFormed?.('<div data-agent-element="hero">hi</div>')).toEqual({ ok: true });
  });

  test("surfaces parse5's own parse-error stream, phrased for the model, on malformed markup", () => {
    const parser = createParse5RegionParser();
    // An end tag carrying attributes is a genuine parse5 parse error (`end-tag-with-attributes`),
    // not silent, spec-compliant recovery — a good "real onParseError" fixture that has nothing to
    // do with location loss.
    const result = parser.checkWellFormed?.('<div data-agent-element="hero">hi</div id="oops">');

    expect(result?.ok).toBe(false);
    expect(result?.ok === false && result.reason).toMatch(/end.tag.with.attributes/i);
  });

  test("is genuinely allowed to pass a document parse5 silently repaired with no error entry", () => {
    // The FIRST <li> relies on HTML5's implied-end-tag grammar (no literal </li>, no onParseError
    // either — this is spec-mandated, silent recovery). The TAGGED <li> has its own explicit closing
    // tag, so ITS location is complete regardless of the untagged sibling's implied closure —
    // verified empirically before writing this fixture (an earlier draft of this test wrongly
    // assumed *any* implied closure anywhere in the document was error-free; it is, but that is
    // orthogonal to whether the TAGGED element's own boundaries are locatable — see the dedicated
    // test below for the case where the tagged element itself is the one relying on implied closure).
    const parser = createParse5RegionParser();
    const result = parser.checkWellFormed?.(
      '<ul><li>first<li data-agent-element="second">second</li></ul>'
    );

    expect(result).toEqual({ ok: true });
  });
});

describe("CIC-2 — a tagged element the parser could not reliably locate must never be silently dropped", () => {
  test(
    "REACHABLE (confirmed empirically): a tagged <td> outside a <table> is dropped by the HTML5 " +
      "table-tag recovery rule — findRegions throws rather than silently omitting it",
    () => {
      const parser = createParse5RegionParser();
      const html = '<div><td data-agent-element="stray-td">no table here</td></div>';

      expect(() => parser.findRegions(html)).toThrow(/stray-td|could not be located|dropped/i);
    }
  );

  test("the same stray-<td> document is also refused by checkWellFormed, never silently passed", () => {
    const parser = createParse5RegionParser();
    const html = '<div><td data-agent-element="stray-td">no table here</td></div>';

    const result = parser.checkWellFormed?.(html);

    expect(result?.ok).toBe(false);
  });

  test("an unclosed tagged element (implicit close at EOF) throws rather than silently omitting", () => {
    const parser = createParse5RegionParser();
    const html = '<div data-agent-element="hero">unclosed content, no closing tag anywhere';

    expect(() => parser.findRegions(html)).toThrow(/hero/);
  });

  test("a tagged VOID element (e.g. <img>) throws with a message naming the void-element cause", () => {
    const parser = createParse5RegionParser();
    const html = '<img data-agent-element="pic" data-agent-role="region" src="x.png">';

    expect(() => parser.findRegions(html)).toThrow(/void/i);
  });

  test(
    "an adoption-agency clone of a tagged, misnested formatting element throws instead of " +
      "silently returning only the located copy",
    () => {
      const parser = createParse5RegionParser();
      // <b><i data-agent-element="misnest">text</b>more</i> — misnested <b>/<i> forces parse5's
      // adoption agency algorithm to clone the <i data-agent-element="misnest"> node; one copy
      // ends up without a locatable end tag.
      const html = '<b><i data-agent-element="misnest">text</b>more</i>';

      expect(() => parser.findRegions(html)).toThrow();
    }
  );

  test("thrown errors never leak past findRegions as a partial, silently-shortened region list", () => {
    // Defense-in-depth: even when ONE region earlier in the document is perfectly fine, a later
    // un-locatable tagged element must fail the WHOLE call — a caller must never receive a region
    // list quietly missing one handle.
    const parser = createParse5RegionParser();
    const html =
      '<section data-agent-element="hero">fine</section>' +
      '<div><td data-agent-element="stray-td">dropped</td></div>';

    expect(() => parser.findRegions(html)).toThrow();
  });
});

describe("a tagged element that relies on ITS OWN implied/optional closing tag is also refused", () => {
  // Real, broader-than-the-ADR's-original-framing consequence found while writing these tests
  // (reported to the dispatching agent): CIC-2's premise names "implicit-insertion recovery" as the
  // trigger, but the actual signal this module uses — a missing `sourceCodeLocation.endTag` — also
  // fires for HTML5's *ordinary, spec-legal* optional-end-tag grammar (`<p>`, `<li>`, `<td>`, `<tr>`,
  // `<option>`, ...), not only for parser-recovery corruption. The ADR's own specified mechanism
  // (`startTag.endOffset` -> `endTag.startOffset`, refuse otherwise) gives no way to distinguish
  // "the parser lost track of a still-present node" from "this tag's closing tag was legally
  // omitted" — both leave `endTag` undefined, and the ADR's contract treats both as unsafe to
  // splice into. This is a genuine practical tradeoff: a Page author (the generation model) using
  // `<p data-agent-element="x">...` WITHOUT an explicit `</p>` bricks the region. The mitigation is
  // structural, not a parser fix: `<section>`/`<div>`/`<article>` (the realistic region-wrapper
  // tags) have NO optional-end-tag grammar in HTML5 at all, so tagging those with an explicit
  // closing tag is immune to this failure mode entirely — verified below.
  test("a tagged <li> with no literal closing tag is refused, even with zero parse5 errors", () => {
    const parser = createParse5RegionParser();
    const html = '<ul><li data-agent-element="only">no closing li tag</ul>';

    expect(parser.checkWellFormed?.(html)?.ok).toBe(false);
    expect(() => parser.findRegions(html)).toThrow(/only/);
  });

  test("the realistic mitigation: a <section> wrapper with an explicit close is never affected", () => {
    const parser = createParse5RegionParser();
    const html = '<ul><li><section data-agent-element="safe">content</section></li></ul>';

    expect(parser.checkWellFormed?.(html)).toEqual({ ok: true });
    expect(parser.findRegions(html)).toHaveLength(1);
  });
});

describe(`raw-source cross-check does not misfire on an ordinary ${AGENT_ELEMENT_ATTRIBUTE} mention`, () => {
  test("a document whose only tagged element is well-formed does not throw", () => {
    const parser = createParse5RegionParser();
    const html = `<div ${AGENT_ELEMENT_ATTRIBUTE}="hero">fine, one occurrence, one located element</div>`;

    expect(() => parser.findRegions(html)).not.toThrow();
  });
});
