/** 0.1.14: library conversion on document fixtures, with the reader's safety and size contracts. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { htmlToMarkdown } from "../html-to-markdown.js";
import { htmlToText, readHtmlDocument, stripActiveHtml, MAX_IMAGES, MAX_LINKS } from "../html-document.js";

const pageUrl = "https://a.example/dir/page";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
const md = (html: string) => htmlToMarkdown({ html, pageUrl });

test("article fixture: code delimiters and language survive alongside headings, lists and quotes", () => {
  assert.equal(md(fixture("article")), '# Release notes\n\nRun ``a`b`` safely.\n\n````js\nconst ticks = "```";\n````\n\n> Keep the indentation.\n\n- Read\n- Build');
});

test("table fixture: formatting, absolute links and code pipes survive inside GFM cells", () => {
  assert.equal(md(fixture("table")), "| Plan | Details |\n| - | - |\n| **Team** | [A \\| B](https://a.example/docs/team) |\n| Solo | `a\\|b` |");
});

test("unsafe fixture: allowlisted links and lazy images share page-fact URL resolution", () => {
  const html = fixture("unsafe");
  assert.equal(md(html), "Script Data Top [Next](https://a.example/docs/next) [Email](mailto:hi@example.com) [Call](tel:+123)\n\n![Hero image](https://a.example/docs/hero.png)![Small](https://a.example/docs/small.png)\n\nVisible");
  const facts = readHtmlDocument({ html, pageUrl });
  assert.deepEqual(facts.links.map(link => link.href), ["https://a.example/docs/next", "mailto:hi@example.com", "tel:+123"]);
  assert.deepEqual(facts.images, [{ src: "https://a.example/docs/hero.png", alt: "Hero image" }, { src: "https://a.example/docs/small.png", alt: "Small" }]);
});

test("unsafe, missing and fragment bases fall back to the final page URL", () => {
  for (const base of ["javascript:steal()", "#here", "http://[", ""]) {
    assert.equal(md(`<head><base href="${base}"></head><body><a href="next">Next</a></body>`), "[Next](https://a.example/dir/next)");
  }
  assert.equal(md('<a href="javascript:x">J</a><a href="https://b.example"></a><img src="data:image/png,AA">'), "J");
});

test("pathologically deep nesting degrades to text BEFORE recursive library traversal", () => {
  const deep = "<div>".repeat(5000) + "<b>deep</b><script>hidden</script>" + "</div>".repeat(5000);
  assert.equal(md(deep), "deep");
  assert.equal(htmlToText({ html: deep }), "deep");
  assert.equal(readHtmlDocument({ html: deep + "<a href='/x'>x</a>", pageUrl }).links.length, 1);
});

test("hostile table spans cannot amplify output; the existing first-row contract remains", () => {
  assert.equal(md('<table><tr><th colspan="1000000000" rowspan="1000000000">A</th></tr><tr><td>B</td></tr></table>'), "| A |\n| - |\n| B |");
  assert.equal(md('<table><tr><td>A</td></tr><tr><td>B</td></tr></table>'), "| A |\n| - |\n| B |");
});

test("form controls and active/embedded subtrees stay invisible; strikethrough stays text", () => {
  assert.equal(md('<style>hidden</style><noscript>hidden</noscript><select><option>hidden</option></select><textarea>hidden</textarea><input value="hidden"><canvas>hidden</canvas><object>hidden</object><audio src="javascript:x">Audio</audio><video src="javascript:x">Video</video><p><del>Removed</del> <s>old</s></p>'), "AudioVideo\n\nRemoved old");
});

test("page facts retain exact link/image caps and explicit flags", () => {
  const html = Array.from({ length: MAX_LINKS + 5 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join("") + Array.from({ length: MAX_IMAGES + 5 }, (_, i) => `<img src="/i${i}.png">`).join("");
  const facts = readHtmlDocument({ html, pageUrl });
  assert.deepEqual([facts.links.length, facts.linksTruncated, facts.images.length, facts.imagesTruncated], [MAX_LINKS, true, MAX_IMAGES, true]);
  assert.deepEqual(facts.links.at(-1), { href: `https://a.example/p${MAX_LINKS - 1}`, text: `p${MAX_LINKS - 1}`, internal: true });
});

test("text and inert HTML projections preserve their existing exact output", () => {
  const html = '<div class="hero"><!--x--><script>a()</script><style>.a{}</style><template><p>t</p></template><p onclick="x" ONLOAD="y">ok</p><a href=" JavaScript:steal()" title="t">j</a><a href="/fine">f</a></div>';
  assert.equal(htmlToText({ html }), "ok\njf");
  assert.equal(stripActiveHtml({ html }), '<html><head></head><body><div class="hero"><style>.a{}</style><p>ok</p><a title="t">j</a><a href="/fine">f</a></div></body></html>');
});

test('review wf: edge whitespace and whitespace-only attention never become character references', () => {
  assert.equal(md('Hello<b> world</b> <em> italic </em>end <i> </i>c'), 'Hello **world** *italic* end c');
  assert.equal(md('a<b>b</b>c a<i>b</i>c'), 'a**b**c a*b*c');
  assert.equal(md('a<b>.</b>c a<i>!</i>c'), 'a**.**c a*!*c');
  assert.equal(md('<strong><em> </em></strong>c'), 'c');
});

test('review wf: reader text remains unescaped outside table cells', () => {
  assert.equal(md('<p>snake_case</p><p>2024. release</p><p>[draft] *literal* \\path</p>'), 'snake_case\n\n2024. release\n\n[draft] *literal* \\path');
  assert.equal(md('<table><tr><th>Name</th></tr><tr><td>snake_case | next</td></tr></table>'), '| Name |\n| - |\n| snake_case \\| next |');
});

test('review wf: inline code retains repeated spaces alongside the serializer delimiter rules', () => {
  assert.equal(md('<p>Run <code>npm  i</code> then <code>a`b</code>.</p>'), 'Run `npm  i` then ``a`b``.');
});

test('review wf: an anchor requires visible content rather than an invisible child', () => {
  assert.equal(md('<a href="/x"><span></span></a><a href="/y">   </a><p>kept</p>'), 'kept');
});

test('linked images retain their destination, including nested images without alt text', () => {
  assert.equal(md('<a href="/logo"><img src="/logo.png" alt="Logo"></a>'), '[![Logo](https://a.example/logo.png)](https://a.example/logo)');
  assert.equal(md('<a href="/logo"><span><img src="/logo.png"></span></a>'), '[![](https://a.example/logo.png)](https://a.example/logo)');
  assert.equal(md('<a href="javascript:steal()"><img src="/logo.png" alt="Logo"></a>'), '![Logo](https://a.example/logo.png)');
  assert.equal(md('<a href="/logo"><img src="javascript:steal()" alt="Logo"></a>'), '');
});

test('review wf: direct conversion caps input before its synchronous parser pipeline', () => {
  assert.equal(md('a'.repeat(1_000_000) + '<p>unconverted tail</p>'), 'a'.repeat(1_000_000));
});

// Exact legacy reader cases move with their owner; fixture-covered cases stay above.
test("headings, paragraphs, emphasis, breaks and rules", () => {
  assert.equal(md("<h2>Title  <b>bold </b>end</h2><p>a<br>b</p><hr><h6>x</h6><p><i> </i>c</p>"), "## Title **bold** end\n\na\\\nb\n\n---\n\n###### x\n\nc");
});

test("code spans, code blocks keep their whitespace, blockquotes prefix every line", () => {
  assert.equal(md("<p>Run <code>npm  i</code></p><pre>line 1\n  line 2\n</pre><blockquote><p>q1</p><p>q2</p></blockquote>"),
    "Run `npm  i`\n\n```\nline 1\n  line 2\n```\n\n> q1\n>\n> q2");
});

test("ordered and nested lists indent continuation lines under their marker", () => {
  assert.equal(md("<ol><li>One</li><li>Two<ol><li>Two-a</li></ol></li></ol>"), "1. One\n2. Two\n   1. Two-a");
});

test("tables become pipe tables with escaped pipes and padded rows", () => {
  assert.equal(md("<table><tr><th>Plan</th><th>Price</th></tr><tr><td>A | B</td><td>$1</td></tr><tr><td>C</td></tr></table>"),
    "| Plan | Price |\n| - | - |\n| A \\| B | $1 |\n| C | |");
});

test("a page with no head facts reports none, and srcset-only images use their first candidate", () => {
  assert.deepEqual(readHtmlDocument({ html: `<p><img srcset="/s.png 1x, /s2.png 2x" alt="S"><a href="/t" aria-label="Go"></a></p>`, pageUrl: "https://a.example/" }), {
    links: [{ href: "https://a.example/t", text: "Go", internal: true }], linksTruncated: false,
    images: [{ src: "https://a.example/s.png", alt: "S" }], imagesTruncated: false, stylesheets: [], meta: {},
  });
});

test("strike is plain text like del and s", () => {
  assert.equal(md("<p><strike>gone</strike> x</p>"), "gone x");
});

test("attention containing only an image keeps the image inside the markers", () => {
  assert.equal(md('a<b><img src="/x.png" alt="X"></b>c'), "a**![X](https://a.example/x.png)**c");
});

test("attention finds an image nested below another element", () => {
  assert.equal(md('a<b><span><img src="/x.png"></span></b>c'), "a**![](https://a.example/x.png)**c");
});

test("attention ending in an image keeps text and image together", () => {
  assert.equal(md('a<b><span>t</span><img src="/x.png"></b>c'), "a**t![](https://a.example/x.png)**c");
});

test("nested attention moves trailing whitespace of the innermost text outside", () => {
  assert.equal(md("<b>x <i>y </i></b>z"), "**x *y*** z");
});

test("the first row under thead/tbody/caption becomes the header", () => {
  assert.equal(md("<table><thead><tr><td>H</td><td>I</td></tr></thead><tbody><tr><td>B</td><td>C</td></tr></tbody></table>"), "| H | I |\n| - | - |\n| B | C |");
  assert.equal(md("<table><caption>cap</caption><tbody><tr><td>H</td></tr><tr><td>B</td></tr></tbody></table>"), "| H |\n| - |\n| B |");
});

test("a nested table does not supply the outer table's header row", () => {
  assert.equal(md("<table><tr><td>Outer<table><tr><td>Inner</td></tr></table></td></tr><tr><td>B</td></tr></table>"), "| OuterInner |\n| - |\n| B |");
});

test("an empty table still serializes an empty header", () => {
  assert.equal(md("<table></table><p>x</p>"), "| |\n| - |\n\nx");
});

test("image alt whitespace is collapsed and link/image titles are dropped", () => {
  assert.equal(md('<img src="/a.png" alt="  multi\n  space  " title="t"><a href="/x" title="tt">L</a>'), "![multi space](https://a.example/a.png)[L](https://a.example/x)");
});

test("data-mdast overrides from the page are ignored on any element", () => {
  assert.equal(md('<a href="/x" data-mdast="ignore">L</a><p data-mdast="ignore">P</p>'), "[L](https://a.example/x)\n\nP");
});

test("an anchor without href is its text", () => {
  assert.equal(md("<a>no href</a>"), "no href");
});

test("comments are dropped", () => {
  assert.equal(md("<!-- c --><p>x</p>"), "x");
});

test("inline code flattens nested markup but keeps its spaces", () => {
  assert.equal(md("<p><code>a  <b>b</b></code></p>"), "`a  b`");
});

// Pinned current behaviour (reported, not fixed): an empty <code> serializes as a bare `` delimiter pair.
test("an empty code element currently emits an empty delimiter pair", () => {
  assert.equal(md("<code></code>x"), "``x");
});

test("a base element after other head elements still sets the link base", () => {
  assert.equal(md('<head><title>T</title><base href="https://b.example/docs/"></head><body><a href="next">Next</a></body>'), "[Next](https://b.example/docs/next)");
});
