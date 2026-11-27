import { describe, expect, it } from "vitest";

import { prettifyHtml } from "../lib/prettify-html.js";

/**
 * @file `prettifyHtml` — the exact regression shape the owner reported (machine-generated HTML with
 * zero inter-element whitespace, e.g. `</h2><h2 ...>`) plus the adversarial cases that matter most
 * for a function whose output can end up saved as the page's real content: it must never touch text,
 * inline markup, or raw-text-element bodies, since doing so would be a visible content change, not a
 * cosmetic one. See `lib/prettify-html.ts`'s own file header for the full safety argument.
 */
describe("prettifyHtml", () => {
  it("returns the empty string unchanged", () => {
    expect(prettifyHtml({ html: "" })).toBe("");
  });

  it("inserts a line break between adjacent block siblings with zero existing whitespace", () => {
    const input = '<h2 id="a">What is Jini?</h2><p>Jini is a content platform.</p>';
    const output = prettifyHtml({ html: input });
    expect(output).toBe('<h2 id="a">What is Jini?</h2>\n<p>Jini is a content platform.</p>');
  });

  it("indents nested block containers one level per depth, tree-style", () => {
    const input = "<div><section><h2>A</h2><p>B</p></section></div>";
    const output = prettifyHtml({ html: input });
    expect(output).toBe(
      ["<div>", "  <section>", "    <h2>A</h2>", "    <p>B</p>", "  </section>", "</div>"].join("\n")
    );
  });

  it("is idempotent — reformatting already-formatted output changes nothing", () => {
    const input = '<h2 id="a">What is Jini?</h2><p>Jini is a content platform.</p>';
    const once = prettifyHtml({ html: input });
    expect(prettifyHtml({ html: once })).toBe(once);
  });

  it("leaves existing whitespace between tags untouched (no double-formatting hand-authored markup)", () => {
    const input = "<div>\n  <p>Already formatted.</p>\n</div>";
    expect(prettifyHtml({ html: input })).toBe(input);
  });

  it("never inserts whitespace inside a paragraph's mixed text/inline content", () => {
    const input = "<p>Jini is a content platform <strong>vibecoded</strong> alongside a real one.</p>";
    expect(prettifyHtml({ html: input })).toBe(input);
  });

  it("never inserts whitespace around inline-only siblings, even with zero gap", () => {
    const input = "<p><span>A</span><span>B</span></p>";
    expect(prettifyHtml({ html: input })).toBe(input);
  });

  it("copies <pre> content byte for byte, including tag-like characters inside it", () => {
    const input = "<div><pre>  <p>not real markup</p>\n  literal</pre></div>";
    const output = prettifyHtml({ html: input });
    // The <div>/<pre> boundary is a safe zero-gap block boundary and may be indented; everything
    // from <pre> through </pre> must reappear byte for byte with no reformatting inside it.
    expect(output).toContain("<pre>  <p>not real markup</p>\n  literal</pre>");
  });

  it("copies <script> content byte for byte, including a literal '<div><div>' the tokenizer must not treat as markup", () => {
    const input = '<script>if (1<2) { var s = "<div><div>"; }</script><p>after</p>';
    const output = prettifyHtml({ html: input });
    expect(output).toContain('<script>if (1<2) { var s = "<div><div>"; }</script>');
  });

  it.each(["style", "textarea"])("copies <%s> content byte for byte", (tag) => {
    const input = `<${tag}>\n  literal <div><p>text</p></div>\n    indented\n</${tag}>`;
    expect(prettifyHtml({ html: input })).toBe(input);
  });

  it("does not treat a quoted '>' inside an attribute value as the tag's end", () => {
    const input = '<div data-x="a > b"><p>text</p></div>';
    const output = prettifyHtml({ html: input });
    expect(output).toBe('<div data-x="a > b">\n  <p>text</p>\n</div>');
  });

  it("degrades gracefully on a malformed close tag with no matching open, without corrupting output", () => {
    const input = "<div><p>A</p></div></section>";
    // Should not throw, and every original character must still be present somewhere in the output
    // (only whitespace may be added, nothing removed or reordered).
    expect(() => prettifyHtml({ html: input })).not.toThrow();
    const output = prettifyHtml({ html: input });
    expect(output.replace(/\n\s*/g, "")).toBe(input);
  });

  it("round-trips through JSON.stringify-style content unchanged when adjacent to text", () => {
    const input = "<li>Item one</li><li>Item two</li>";
    expect(prettifyHtml({ html: input })).toBe("<li>Item one</li>\n<li>Item two</li>");
  });

  it("copies an HTML comment through untouched, without treating it as a tag", () => {
    const input = "<div><!-- a note --><p>text</p></div>";
    const output = prettifyHtml({ html: input });
    expect(output).toBe("<div><!-- a note --><p>text</p>\n</div>");
  });

  it("degrades gracefully on an unterminated comment at end of input", () => {
    const input = "<div><!-- never closed";
    expect(() => prettifyHtml({ html: input })).not.toThrow();
    expect(prettifyHtml({ html: input })).toContain("<!-- never closed");
  });

  it("copies a leading doctype declaration through untouched", () => {
    const input = "<!doctype html><html><body><p>x</p></body></html>";
    const output = prettifyHtml({ html: input });
    expect(output).toBe("<!doctype html><html>\n  <body>\n    <p>x</p>\n  </body>\n</html>");
  });

  it("degrades gracefully on an unterminated doctype at end of input", () => {
    const input = "<!doctype html";
    expect(() => prettifyHtml({ html: input })).not.toThrow();
    expect(prettifyHtml({ html: input })).toBe(input);
  });

  it("recognizes a self-closing tag as its own tag kind, not an open tag", () => {
    // A non-void block tag makes self-close classification decide the sibling depth.
    const input = "<div><section/><hr/><p>after</p></div>";
    const output = prettifyHtml({ html: input });
    expect(output).toBe("<div>\n  <section/>\n  <hr/>\n  <p>after</p>\n</div>");
  });

  it("degrades gracefully on a raw-text element with no closing tag at all", () => {
    const input = "<script>var x = 1;";
    expect(() => prettifyHtml({ html: input })).not.toThrow();
    expect(prettifyHtml({ html: input })).toBe(input);
  });

  it("treats a stray '<' not starting a valid tag as literal text", () => {
    const input = "<p>5 < 10</p>";
    expect(prettifyHtml({ html: input })).toBe(input);
  });

  it("leaves trailing plain text after the last tag untouched", () => {
    const input = "<p>A</p> trailing text, no more tags";
    expect(prettifyHtml({ html: input })).toBe(input);
  });
});

it("leaves literal comparisons in text but formats adjacent real block elements", () => {
  expect(prettifyHtml({ html: "<div>3 < 4 and 9 > 8</div><section>Next</section>" }))
    .toBe("<div>3 < 4 and 9 > 8</div>\n<section>Next</section>");
});
