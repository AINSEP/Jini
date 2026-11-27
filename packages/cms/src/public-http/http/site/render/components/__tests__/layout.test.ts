import { describe, expect, it } from "vitest";
import { siteFooter, siteFooterRich, siteHeader, siteNav } from "../layout.js";
import type { SiteRenderContext } from "../../../render-context.js";

const ctx = (over: Partial<SiteRenderContext> = {}): SiteRenderContext => ({
  siteTitle: "Acme & Co", route: "home", posts: [], products: [], themeName: "Fresh",
  widgetRegions: {}, widgetInlineResolved: new Map(), mediaTransformVersions: new Map(),
  mediaAssetMetadata: new Map(), assignedTerms: [], ...over,
});

it("only shows the escaped tagline on a non-compact header", () => {
  const props = { tagline: "Local <stories>" };
  expect(siteHeader(ctx(), props)).toContain('<a class="wordmark" href="/">Acme &amp; Co</a><p class="tagline">Local &lt;stories&gt;</p>');
  expect(siteHeader(ctx(), { ...props, compact: true })).toBe(
    '<header class="site-header"><div class="wrap"><a class="wordmark" href="/">Acme &amp; Co</a><nav class="site-nav"><a href="/">Home</a></nav></div></header>',
  );
});

it("renders dropdown, standalone, and CTA links with their own labels and destinations", () => {
  const html = siteNav(ctx(), {
    brand: "Atlas & Co",
    items: [null, { label: "Stories <all>", href: "/stories", children: [false, { label: "Local & live", href: "/stories/local?one=1&two=2" }] },
      { label: "About", href: "/about" }],
    cta: { href: "/join" },
  });
  expect(html).toContain('<a class="brand" href="/">Atlas &amp; Co</a>');
  expect(html).toContain('<li class="nav-item has-children"><a class="nav-link" href="/stories">Stories &lt;all&gt;<svg');
  expect(html).toContain('<ul class="nav-dropdown"><li><a href="/stories/local?one=1&amp;two=2">Local &amp; live</a></li></ul>');
  expect(html).toContain('<li class="nav-item"><a class="nav-link" href="/about">About</a></li>');
  expect(html).toContain('<a class="btn btn--primary nav-cta" href="/join">Get started</a>');
});

it("renders rich footer columns and custom legal copy without a theme badge on a themeless site", () => {
  expect(siteFooterRich(ctx({ themeName: null }), {
    blurb: "Around & about",
    social: [null, { label: "Talk <here>", href: "https://social.example.test/atlas" }],
    columns: [false, { title: "Explore & learn", links: [null, { label: "Catalog", href: "/catalog" }] }],
    legal: "Atlas <2026>",
  })).toBe(
    '<footer class="site-footer site-footer--rich"><div class="wrap footer__top"><div class="footer__brandcol"><a class="brand" href="/">Acme &amp; Co</a><p class="footer__blurb">Around &amp; about</p><div class="footer__socials"><a class="footer__social" href="https://social.example.test/atlas">Talk &lt;here&gt;</a></div></div><div class="footer__cols"><div class="footer__col"><h4>Explore &amp; learn</h4><ul><li><a href="/catalog">Catalog</a></li></ul></div></div></div><div class="wrap footer__bottom"><span>Atlas &lt;2026&gt;</span></div></footer>',
  );
});

describe("siteFooter host credit", () => {
  it("renders the host-supplied credit after the escaped site title, byte-for-byte", () => {
    expect(siteFooter(ctx(), { creditText: "powered by Host" })).toBe(
      '<footer class="site-footer"><div class="wrap"><span>Acme &amp; Co — powered by Host</span><span class="theme-badge">theme: Fresh</span></div></footer>',
    );
  });
  it("shows the site title alone when the host supplies no credit", () => {
    expect(siteFooter(ctx())).toBe(
      '<footer class="site-footer"><div class="wrap"><span>Acme &amp; Co</span><span class="theme-badge">theme: Fresh</span></div></footer>',
    );
  });
  it("escapes the credit and drops the badge when the theme is off", () => {
    expect(siteFooter(ctx({ themeName: null }), { creditText: "<b>x</b>" })).toContain("<span>Acme &amp; Co — &lt;b&gt;x&lt;/b&gt;</span></div>");
  });
});
