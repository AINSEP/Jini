import assert from "node:assert/strict";
import { test } from "vitest";

import { markOffSiteLinksOpenInNewTab, isFullHtmlDocument, injectExtraHeadIntoStaticPage, insertBeforeUncommentedTag } from "../html.js";

/**
 * @file Owner rule (2026-09-24): every off-site `<a href>` a public page renders should open in a
 * new tab with `rel="noopener noreferrer"`, generically, without any theme author having to add
 * `target="_blank"` to each link by hand. Certifies {@link markOffSiteLinksOpenInNewTab} against the
 * exact cases the rule names: off-site, same-site relative, same-host absolute, an existing `rel`,
 * an existing `target`, `mailto:`/`tel:`, and bare `#anchor` hrefs.
 */

const SITE_HOST = "site.example";

test("quoted and uppercase off-site anchors, subdomains and lookalike hosts receive the full link attributes", () => {
  const cases: Array<[string, string]> = [
    ["<a href='https://other.example/x'>Other</a>", "<a href='https://other.example/x' rel=\"noopener noreferrer\" target=\"_blank\">Other</a>"],
    ['<A HREF="https://other.example/x">Other</A>', '<A HREF="https://other.example/x" rel="noopener noreferrer" target="_blank">Other</A>'],
    ['<a href="https://blog.site.example/x">Blog</a>', '<a href="https://blog.site.example/x" rel="noopener noreferrer" target="_blank">Blog</a>'],
    ['<a href="https://notsite.example/x">Lookalike</a>', '<a href="https://notsite.example/x" rel="noopener noreferrer" target="_blank">Lookalike</a>'],
  ];
  for (const [html, expected] of cases) assert.equal(markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST }), expected);
});

test("protocol-relative hrefs stay unchanged under the absolute-http-only policy", () => {
  const html = '<a href="//other.example/x">Other</a>';
  assert.equal(markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST }), html);
});

test("off-site absolute http(s) link gets target=_blank and rel=noopener noreferrer", () => {
  const html = `<a href="https://agent-plugins.org/specification">Spec</a>`;
  const result = markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST });
  assert.equal(result, `<a href="https://agent-plugins.org/specification" rel="noopener noreferrer" target="_blank">Spec</a>`);
});

test("plain http off-site link is rewritten the same as https", () => {
  const html = `<a href="http://other-host.example/page">Other</a>`;
  const result = markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST });
  assert.match(result, /target="_blank"/);
  assert.match(result, /rel="noopener noreferrer"/);
  assert.equal(result, `<a href="http://other-host.example/page" rel="noopener noreferrer" target="_blank">Other</a>`);
});

test("same-site relative link is left byte-identical", () => {
  const cases = [`<a href="pricing.html">Pricing</a>`, `<a href="/blog">Blog</a>`, `<a href="../docs/intro">Intro</a>`];
  for (const html of cases) {
    assert.equal(markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST }), html, html);
  }
});

test("absolute link to the site's own host is left byte-identical", () => {
  const html = `<a href="https://site.example/about">About</a>`;
  assert.equal(markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST }), html);
});

test("absolute link to the site's own host under a www. prefix mismatch is still same-site", () => {
  const html = `<a href="https://www.site.example/about">About</a>`;
  assert.equal(markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST }), html);
  const reverse = `<a href="https://site.example/about">About</a>`;
  assert.equal(markOffSiteLinksOpenInNewTab({ html: reverse, siteHost: "www.site.example" }), reverse);
});

test("off-site link with an existing rel merges noopener/noreferrer instead of overwriting", () => {
  const html = `<a href="https://other.example/x" rel="nofollow">X</a>`;
  const result = markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST });
  assert.equal(result, `<a href="https://other.example/x" rel="nofollow noopener noreferrer" target="_blank">X</a>`);
});

test("off-site link that already carries noopener in rel is not duplicated", () => {
  const html = `<a href="https://other.example/x" rel="noopener">X</a>`;
  const result = markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST });
  assert.equal(result, `<a href="https://other.example/x" rel="noopener noreferrer" target="_blank">X</a>`);
});

test("off-site link with an explicit target is never overridden, but rel is still merged", () => {
  const html = `<a href="https://other.example/x" target="_self">X</a>`;
  const result = markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST });
  assert.equal(result, `<a href="https://other.example/x" target="_self" rel="noopener noreferrer">X</a>`);
  assert.doesNotMatch(result, /target="_blank"/);
});

test("off-site link already authored with target=_blank keeps it and still gets rel merged", () => {
  const html = `<a href="https://other.example/x" target="_blank">X</a>`;
  const result = markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST });
  assert.equal(result, `<a href="https://other.example/x" target="_blank" rel="noopener noreferrer">X</a>`);
});

test("mailto: and tel: links are left byte-identical", () => {
  const mailto = `<a href="mailto:hello@example.com">Email</a>`;
  const tel = `<a href="tel:+15551234567">Call</a>`;
  assert.equal(markOffSiteLinksOpenInNewTab({ html: mailto, siteHost: SITE_HOST }), mailto);
  assert.equal(markOffSiteLinksOpenInNewTab({ html: tel, siteHost: SITE_HOST }), tel);
});

test("bare #anchor hrefs are left byte-identical", () => {
  const html = `<a href="#pricing">Jump to pricing</a>`;
  assert.equal(markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST }), html);
});

test("a page mixing off-site, same-site, and anchor links only rewrites the off-site one", () => {
  const html = [
    `<a href="/pricing">Pricing</a>`,
    `<a href="https://agent-plugins.org/specification">Spec</a>`,
    `<a href="#top">Top</a>`,
    `<a href="mailto:hi@site.example">Contact</a>`,
  ].join("");
  const result = markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST });
  assert.match(result, /<a href="\/pricing">Pricing<\/a>/);
  assert.match(result, /<a href="https:\/\/agent-plugins\.org\/specification" rel="noopener noreferrer" target="_blank">Spec<\/a>/);
  assert.match(result, /<a href="#top">Top<\/a>/);
  assert.match(result, /<a href="mailto:hi@site\.example">Contact<\/a>/);
  assert.equal(result, html.replace(`<a href="https://agent-plugins.org/specification">`, `<a href="https://agent-plugins.org/specification" rel="noopener noreferrer" target="_blank">`));
});

test("an <a> tag with no href at all is left untouched", () => {
  const html = `<a name="anchor-target">Named anchor</a>`;
  assert.equal(markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST }), html);
});

test("a malformed absolute-looking href is left untouched rather than guessed at", () => {
  const html = `<a href="https://">Broken</a>`;
  assert.equal(markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST }), html);
});

test("an attribute that merely ends in 'href' (e.g. an authored data-href) is not mistaken for href", () => {
  const html = `<a data-href="https://other.example/x">No real href</a>`;
  assert.equal(markOffSiteLinksOpenInNewTab({ html, siteHost: SITE_HOST }), html);
});

test("a self-closing off-site anchor gets its attributes inserted before the '/>'", () => {
  assert.equal(
    markOffSiteLinksOpenInNewTab({ html: `<a href="https://elsewhere.example/x"/>`, siteHost: "mysite.test" }),
    // Each insertion re-emits " />", so two insertions leave a doubled space — harmless in HTML.
    `<a href="https://elsewhere.example/x" rel="noopener noreferrer"  target="_blank" />`,
  );
});

test("an empty single-quoted rel is replaced by the merged tokens, not left empty", () => {
  assert.equal(
    markOffSiteLinksOpenInNewTab({ html: `<a rel='' href='https://elsewhere.example/'>x</a>`, siteHost: "mysite.test" }),
    `<a rel="noopener noreferrer" href='https://elsewhere.example/' target="_blank">x</a>`,
  );
});

test("isFullHtmlDocument: recognizes a plain doctype, an <html> tag, a leading HTML comment, a leading BOM, and an uppercase DOCTYPE", () => {
  assert.equal(isFullHtmlDocument({ html: "<!doctype html><html><body>x</body></html>" }), true);
  assert.equal(isFullHtmlDocument({ html: "<html><body>x</body></html>" }), true);
  assert.equal(isFullHtmlDocument({ html: "<!-- authored by me --><!doctype html><html></html>" }), true);
  assert.equal(isFullHtmlDocument({ html: "﻿<!doctype html><html></html>" }), true);
  assert.equal(isFullHtmlDocument({ html: "<!DOCTYPE HTML><HTML></HTML>" }), true);
  assert.equal(isFullHtmlDocument({ html: "   \n  <!doctype html><html></html>" }), true);
});

test("isFullHtmlDocument: an ordinary fragment that merely mentions doctype/html in prose is NOT a full document", () => {
  assert.equal(isFullHtmlDocument({ html: "<p>Read about &lt;!doctype html&gt; sometime.</p>" }), false);
  assert.equal(isFullHtmlDocument({ html: "<div>hello</div>" }), false);
  assert.equal(isFullHtmlDocument({ html: "" }), false);
});


// `page-shell.html`'s head opens with an explanatory comment whose prose mentions `<title>` — the
// SEO splice used to strip the theme's own title with an unanchored `/<title>[\s\S]*?<\/title>/`,
// which matched THAT mention and deleted everything through the real title, taking the comment's
// own `-->` with it. Every downstream head element then parsed as comment text, so `/contact`,
// `/team`, `/faq` and `/terms-of-service` shipped with no stylesheet at all.
const HEAD_COMMENT_MENTIONING_TITLE = [
  "<!doctype html>",
  '<html lang="en"><head>',
  "<meta charset=\"utf-8\" />",
  "<!-- the tag directly below carries a <title> placeholder the renderer substitutes -->",
  "<title>Theme Title</title>",
  '<link rel="stylesheet" href="/theme-assets/basic/css/theme.css" />',
  "</head><body><h1>Get in touch</h1></body></html>",
].join("\n");

const SEO_HEAD = '<title>Contact</title><link rel="canonical" href="/contact"/>';

test("injectExtraHeadIntoStaticPage: a <title> mentioned inside a head comment does not swallow the rest of the head (regression)", () => {
  const out = injectExtraHeadIntoStaticPage({ html: HEAD_COMMENT_MENTIONING_TITLE, extraHead: SEO_HEAD });

  assert.equal((out.match(/-->/g) ?? []).length, 1, "the head comment must still be terminated");
  assert.ok(
    out.indexOf("-->") < out.indexOf('rel="stylesheet"'),
    "the theme stylesheet must sit outside the comment, not be commented out by it"
  );
});

test("injectExtraHeadIntoStaticPage: the theme's own title is still the one removed, not the comment's mention", () => {
  const out = injectExtraHeadIntoStaticPage({ html: HEAD_COMMENT_MENTIONING_TITLE, extraHead: SEO_HEAD });

  const afterComment = out.slice(out.indexOf("-->") + "-->".length);
  assert.equal((afterComment.match(/<title>/g) ?? []).length, 1, "exactly one real <title> element ships");
  assert.ok(out.includes("<title>Contact</title>"), "the SEO fold's title wins");
  assert.ok(!out.includes("<title>Theme Title</title>"), "the theme's own title is suppressed");
  assert.ok(out.includes("a <title> placeholder"), "the comment's prose is left alone");
});

test("injectExtraHeadIntoStaticPage: extraHead without a title leaves the theme's own title in place", () => {
  const out = injectExtraHeadIntoStaticPage({ html: HEAD_COMMENT_MENTIONING_TITLE, extraHead: '<link rel="canonical" href="/contact"/>' });

  assert.ok(out.includes("<title>Theme Title</title>"), "nothing to suppress it, so it stays");
  assert.equal((out.match(/-->/g) ?? []).length, 1, "and the comment is untouched");
});

test("injectExtraHeadIntoStaticPage: preserving an authored title skips comment mentions and keeps the other head elements", () => {
  const out = injectExtraHeadIntoStaticPage({ html: HEAD_COMMENT_MENTIONING_TITLE, extraHead: SEO_HEAD }, { preserveThemeTitle: true });
  const withoutComments = out.replace(/<!--[\s\S]*?-->/g, "");
  assert.deepEqual(withoutComments.match(/<title>[\s\S]*?<\/title>/g), ["<title>Theme Title</title>"]);
  assert.ok(out.includes('<link rel="canonical" href="/contact"/>'));
  assert.ok(out.includes("a <title> placeholder"));
  assert.ok(out.includes('rel="stylesheet"'));
});

test("injectExtraHeadIntoStaticPage: a theme with only a comment mentioning title still receives the fold's fallback title", () => {
  const html = HEAD_COMMENT_MENTIONING_TITLE.replace("<title>Theme Title</title>", "");
  const out = injectExtraHeadIntoStaticPage({ html, extraHead: SEO_HEAD }, { preserveThemeTitle: true });
  const withoutComments = out.replace(/<!--[\s\S]*?-->/g, "");
  assert.deepEqual(withoutComments.match(/<title>[\s\S]*?<\/title>/g), ["<title>Contact</title>"]);
  assert.ok(out.includes('<link rel="canonical" href="/contact"/>'));
});

// A head comment that names `</head>` and `</body>` literally (kUInetic's pre-JS cloak note did) must
// not be taken for the document's closing tags: the splice used to insert before the FIRST match, so
// the chat mount and its script landed inside the comment and the site FAB never loaded.
const HEAD_COMMENT_MENTIONING_CLOSING_TAGS = [
  "<!doctype html>",
  '<html lang="en"><head>',
  "<!-- cloak: armed before </head> runs, then at the end of <body> rather than at </body>. -->",
  "<title>Home</title>",
  "</head><body><h1>Hi</h1></body></html>",
].join("\n");

test("injectExtraHeadIntoStaticPage: a </head> named inside a head comment is skipped (regression)", () => {
  const out = injectExtraHeadIntoStaticPage({ html: HEAD_COMMENT_MENTIONING_CLOSING_TAGS, extraHead: '<link rel="canonical" href="/"/>' });

  assert.equal(
    out,
    [
      "<!doctype html>",
      '<html lang="en"><head>',
      "<!-- cloak: armed before </head> runs, then at the end of <body> rather than at </body>. -->",
      "<title>Home</title>",
      '<link rel="canonical" href="/"/></head><body><h1>Hi</h1></body></html>',
    ].join("\n")
  );
});


test("head edits preserve every other byte under default and authored-title precedence", () => {
  const html = '<head><!-- <title>prose </head> --><title>Authored</title><meta charset="utf-8"></head><body>x</body>';
  const extraHead = '<title>Fold</title><link rel="canonical" href="/">';
  assert.equal(injectExtraHeadIntoStaticPage({ html, extraHead }), '<head><!-- <title>prose </head> --><meta charset="utf-8"><title>Fold</title><link rel="canonical" href="/"></head><body>x</body>');
  assert.equal(injectExtraHeadIntoStaticPage({ html, extraHead }, { preserveThemeTitle: true }), '<head><!-- <title>prose </head> --><title>Authored</title><meta charset="utf-8"><link rel="canonical" href="/"></head><body>x</body>');
  const noTitle = html.replace('<title>Authored</title>', '');
  assert.equal(injectExtraHeadIntoStaticPage({ html: noTitle, extraHead }, { preserveThemeTitle: true }), '<head><!-- <title>prose </head> --><meta charset="utf-8"><title>Fold</title><link rel="canonical" href="/"></head><body>x</body>');
  assert.equal(injectExtraHeadIntoStaticPage({ html, extraHead: '<meta name="x">' }), html.replace('</head><body>', '<meta name="x"></head><body>'));
});

test("head splice no-ops and head/body comment scanning preserve bytes", () => {
  const html = '<head><!-- </head> </body> --></head><body>x</body>';
  assert.equal(injectExtraHeadIntoStaticPage({ html, extraHead: undefined }), html);
  assert.equal(injectExtraHeadIntoStaticPage({ html, extraHead: '' }), html);
  assert.equal(injectExtraHeadIntoStaticPage({ html: '<body>x</body>', extraHead: '<meta name="x">' }), '<body>x</body>');
  assert.equal(insertBeforeUncommentedTag({ html, tag: 'head', markup: 'H' }), '<head><!-- </head> </body> -->H</head><body>x</body>');
  assert.equal(insertBeforeUncommentedTag({ html, tag: 'body', markup: 'B' }), '<head><!-- </head> </body> --></head><body>xB</body>');
  assert.equal(insertBeforeUncommentedTag({ html: '<!-- </head>', tag: 'head', markup: 'H' }), '<!-- </head>');
  assert.equal(insertBeforeUncommentedTag({ html: '<HEAD></HEAD>', tag: 'head', markup: 'H' }), '<HEAD>H</HEAD>');
});

test("document detection consumes alternating leading whitespace and comments only", () => {
  assert.equal(isFullHtmlDocument({ html: '\ufeff \n<!-- one --> \t<!-- two -->\n<html lang="fr">' }), true);
  for (const html of ['<!-- unfinished <html>', '<div></div><html>', '<htmlish>', '<!-- only -->']) {
    assert.equal(isFullHtmlDocument({ html }), false);
  }
});

test("a malformed theme title with no closing tag does not remove the rest of the head", () => {
  const html = '<head><title>Unfinished<meta name="theme" content="light"></head><body>Kept</body>';
  assert.equal(injectExtraHeadIntoStaticPage({ html, extraHead: '<title>Fold</title>' }),
    '<head><title>Unfinished<meta name="theme" content="light"><title>Fold</title></head><body>Kept</body>');
});
