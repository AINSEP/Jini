import assert from "node:assert/strict";
import { test } from "vitest";
import { menuLinkRelAttr, renderWidgetMenu } from "../menu-render.js";

test("HTML mode forwards trusted markup, escapes the title and never revives retained items", () => {
  assert.equal(renderWidgetMenu({ props: {
    title: "Header <&>", mode: "html",
    html: '<ul class="custom"><li><a href="/docs">Docs &amp; guides</a></li></ul><script>window.menuReady=true</script>',
    items: [{ label: "Home", href: "/", available: true }],
  } }), '<nav class="widget widget-menu"><h3 class="widget-menu-title">Header &lt;&amp;&gt;</h3><ul class="custom"><li><a href="/docs">Docs &amp; guides</a></li></ul><script>window.menuReady=true</script></nav>');
  for (const props of [{ mode: "html", html: "" }, { mode: "html" }]) {
    assert.equal(renderWidgetMenu({ props: { ...props, items: [{ label: "Home", href: "/", available: true }] } }), '<nav class="widget widget-menu"></nav>');
  }
});

test("item and legacy modes retain URL safety and ignore stored HTML", () => {
  for (const props of [{ mode: "items" }, {}]) {
    assert.equal(renderWidgetMenu({ props: { ...props, html: "<p>Custom</p>", items: [{ label: "<Home>", href: "javascript:alert(1)", available: true }] } }), '<nav class="widget widget-menu"><ul><li><a href="#">&lt;Home&gt;</a></li></ul></nav>');
  }
});

test("authored decoration and link attributes retain exact order", () => {
  assert.equal(renderWidgetMenu({ props: { title: "Main", items: [{
    label: "Docs", href: "/docs", available: true,
    attrs: { cssClass: "is-featured", rel: "nofollow", openInNewTab: true, icon: "book", description: "Guides" }, children: [],
  }] } }), '<nav class="widget widget-menu"><h3 class="widget-menu-title">Main</h3><ul><li class="is-featured"><a href="/docs" rel="nofollow noopener noreferrer" target="_blank"><span class="widget-menu-item-icon" data-icon="book"></span>Docs<span class="widget-menu-item-desc">Guides</span></a></li></ul></nav>');
  assert.equal(renderWidgetMenu({ props: { items: [{ label: "Out", href: "https://example.test/", available: true, attrs: { openInNewTab: true }, children: [] }] } }), '<nav class="widget widget-menu"><ul><li><a href="https://example.test/" rel="noopener noreferrer" target="_blank">Out</a></li></ul></nav>');
  assert.equal(renderWidgetMenu({ props: { items: [{ label: "Home", href: "/", available: true }] } }), '<nav class="widget widget-menu"><ul><li><a href="/">Home</a></li></ul></nav>');
});

test("nested hostile labels are inert, hostile hrefs are refused and unavailable children have no link", () => {
  assert.equal(renderWidgetMenu({ props: { title: "<Menu>", items: [{
    label: "<Parent>", href: "/parent", available: true,
    attrs: { cssClass: "featured", rel: "nofollow", openInNewTab: true },
    children: [
      { label: "<script>alert(1)</script>", href: "javascript:alert(1)", available: true },
      { label: "Hidden & private", href: "/unavailable-target", available: false },
    ],
  }] } }), '<nav class="widget widget-menu"><h3 class="widget-menu-title">&lt;Menu&gt;</h3><ul><li class="featured"><a href="/parent" rel="nofollow noopener noreferrer" target="_blank">&lt;Parent&gt;</a><ul><li><a href="#">&lt;script&gt;alert(1)&lt;/script&gt;</a></li><li><span class="widget-menu-item--unavailable">Hidden &amp; private</span></li></ul></li></ul></nav>');
});

test("render-time rel preserves quoted nonstandard tokens and authored token order", () => {
  assert.equal(menuLinkRelAttr({ openInNewTab: true, rel: 'noreferrer x"y' }), ' rel="noreferrer x&quot;y noopener"');
});
