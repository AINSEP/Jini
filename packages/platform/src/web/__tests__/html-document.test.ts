/** Boundary pins for html-document.ts: element collection, meta/link facts, head facts and the text projection. */
import { describe, expect, test } from "vitest";
import { absolute, ASSET_PROTOCOLS, htmlToText, readHtmlDocument, stripActiveHtml } from "../html-document.js";

const pageUrl = "https://www.a.example/dir/page";
const read = (html: string) => readHtmlDocument({ html, pageUrl });

describe("collection", () => {
  test("the first title wins", () => {
    expect(read("<title>One</title><title>Two</title>").title).toBe("One");
  });
  test("the first base with an href wins, resolved against the page URL", () => {
    expect(read('<base target="_blank"><base href="/docs/"><base href="/other/"><a href="x">x</a>').links[0]!.href).toBe("https://www.a.example/docs/x");
  });
  test("an unusable base falls back to the page URL", () => {
    expect(read('<base href="javascript:x"><a href="x">x</a>').links[0]!.href).toBe("https://www.a.example/dir/x");
  });
  test("element names shared with Object.prototype are not collected", () => {
    expect(read("<constructor>c</constructor><tostring>t</tostring><a href='/x'>x</a>").links).toHaveLength(1);
  });
});

describe("head facts", () => {
  test("title, description and lang are collapsed or trimmed", () => {
    expect(read('<html lang=" en "><head><title> A\n B </title><meta name="DESCRIPTION" content=" d\n e "></head></html>')).toMatchObject({ title: "A B", description: "d e", lang: "en" });
  });
  test("empty title, description and lang are absent keys", () => {
    const facts = read('<html lang=" "><head><title> </title><meta name="description"></head></html>');
    expect(["title", "description", "lang"].filter(key => key in facts)).toEqual([]);
  });
});

describe("meta facts", () => {
  test("og properties and allowlisted names are returned, with URL-valued ones made absolute", () => {
    const html = '<meta property="OG:Title" content=" T "><meta property="og:image" content="/i.png"><meta property="og:url" content="/u"><meta name="twitter:image" content="/t.png"><meta name="Author" content="Me"><meta name="robots" content="noindex"><meta property="article:author" content="x">';
    expect(read(html).meta).toEqual({ "og:title": "T", "og:image": "https://www.a.example/i.png", "og:url": "https://www.a.example/u", "twitter:image": "https://www.a.example/t.png", author: "Me" });
  });
  test("the first value for a key wins and a missing value is skipped", () => {
    expect(read('<meta property="og:title"><meta property="og:title" content="first"><meta property="og:title" content="second"><meta name="author" content="a">').meta).toEqual({ "og:title": "first", author: "a" });
  });
  test("an unusable og:image URL is skipped", () => {
    expect(read('<meta property="og:image" content="javascript:x">').meta).toEqual({});
  });
  test("meta values are capped at 500 characters", () => {
    expect(read(`<meta name="author" content="${"a".repeat(600)}">`).meta.author).toHaveLength(500);
  });
  test("at most 60 meta entries are returned", () => {
    const html = Array.from({ length: 70 }, (_, i) => `<meta property="og:k${i}" content="v">`).join("");
    expect(Object.keys(read(html).meta)).toHaveLength(60);
  });
  test("link rels supply canonical, favicon and apple-touch-icon; one tag can supply several", () => {
    const html = '<link rel="Canonical" href="/c"><link rel="shortcut icon apple-touch-icon" href="/f.ico"><link rel="icon" href="/second.ico"><link href="/no-rel">';
    expect(read(html).meta).toEqual({ canonical: "https://www.a.example/c", favicon: "https://www.a.example/f.ico", "apple-touch-icon": "https://www.a.example/f.ico" });
  });
});

describe("links and images", () => {
  test("internal ignores www and case; mailto is never internal", () => {
    expect(read('<a href="https://A.example/x">x</a><a href="https://b.example/">b</a><a href="mailto:me@a.example">m</a>').links.map(link => link.internal)).toEqual([true, false, false]);
  });
  test("link text falls back to aria-label, then title, then image alt, then empty", () => {
    const html = '<a href="/1" aria-label=" Label "></a><a href="/2" title="Title"></a><a href="/3"><img alt=" Alt\n text "></a><a href="/4"><img></a><a href="/5"></a>';
    expect(read(html).links.map(link => link.text)).toEqual(["Label", "Title", "Alt text", "", ""]);
  });
  test("link text is capped at 200 characters", () => {
    expect(read(`<a href="/x">${"t".repeat(250)}</a>`).links[0]!.text).toHaveLength(200);
  });
  test("duplicate links and images are deduplicated", () => {
    const facts = read('<a href="/x#a">1</a><a href="/x#b">2</a><img src="/i.png"><img src="/i.png#z" alt="dup">');
    expect([facts.links.length, facts.images]).toEqual([1, [{ src: "https://www.a.example/i.png", alt: "" }]]);
  });
  test("lazy images use data-src, then data-lazy-src, behind a data: placeholder", () => {
    const html = '<img src=" data:image/gif;base64,AA" data-src="/lazy.png"><img data-lazy-src="/lazier.png"><img src="data:x">';
    expect(read(html).images.map(image => image.src)).toEqual(["https://www.a.example/lazy.png", "https://www.a.example/lazier.png"]);
  });
  test("stylesheets are deduplicated and require a usable href", () => {
    expect(read('<link rel="stylesheet" href="/a.css"><link rel="STYLESHEET alternate" href="/a.css"><link rel="stylesheet" href="javascript:x"><link rel="stylesheet">').stylesheets).toEqual(["https://www.a.example/a.css"]);
  });
  test("at most 100 stylesheets are returned", () => {
    const html = Array.from({ length: 105 }, (_, i) => `<link rel="stylesheet" href="/${i}.css">`).join("");
    expect(read(html).stylesheets).toHaveLength(100);
  });
});

describe("absolute", () => {
  test.each([[undefined], [""], ["  "], ["#frag"], ["http://["], ["ftp://a.example/"]])("%s resolves to nothing", raw => {
    expect(absolute({ raw, base: pageUrl, protocols: ASSET_PROTOCOLS })).toBeUndefined();
  });
  test("http fragments are dropped", () => {
    expect(absolute({ raw: " /x#y ", base: pageUrl, protocols: ASSET_PROTOCOLS })).toBe("https://www.a.example/x");
  });
});

describe("htmlToText", () => {
  test("blocks become lines, inline text joins, and invisible subtrees are dropped", () => {
    expect(htmlToText({ html: "<head><title>T</title></head><body>a <b>b</b><div>c<p>d</p>e</div><svg><text>s</text></svg><style>x</style>f<br>g<!--c--></body>" })).toBe("a b\nc\nd\ne\nf\ng");
  });
  test("runs of spaces and tabs collapse and blank lines are removed", () => {
    expect(htmlToText({ html: "<p> a \t b </p><p> </p><p>c</p>" })).toBe("a b\nc");
  });
  test("an empty document is empty text", () => {
    expect(htmlToText({ html: "" })).toBe("");
  });
});

describe("stripActiveHtml", () => {
  test("nested scripts and handler attributes are removed everywhere", () => {
    expect(stripActiveHtml({ html: '<div><section><script>x</script><img src="/i.png" onerror="x" data-x=" javascript:y"></section></div>' })).toBe('<html><head></head><body><div><section><img src="/i.png"></section></div></body></html>');
  });
});
