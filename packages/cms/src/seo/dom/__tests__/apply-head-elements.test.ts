// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { applyHeadElements } from "../index.js";

afterEach(() => {
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

test("all head kinds retain their order and attributes through safe DOM sinks", () => {
  const setter = vi.spyOn(Element.prototype, "innerHTML", "set");
  const payload = '\"><img src=x onerror=alert(1)>&';
  const nodes = applyHeadElements({ elements: [
    { kind: "title", text: payload, priority: 100 },
    { kind: "meta", name: "description", content: payload, priority: 110 },
    { kind: "link", rel: "canonical", href: '/?a="&b=2', priority: 120 },
    { kind: "link", rel: "alternate", href: "/feed.xml", type: "application/rss+xml", title: payload, hreflang: "en", priority: 125 },
    { kind: "og", property: "og:title", content: payload, priority: 140 },
    { kind: "jsonld", data: { name: "</script><script>alert(1)</script>" }, priority: 900 },
  ] }, { document });
  assert.deepEqual(nodes.map(node => node.tagName), ["TITLE", "META", "LINK", "LINK", "META", "SCRIPT"]);
  assert.deepEqual(Array.from(document.head.children), nodes);
  assert.equal(nodes[0]!.textContent, payload);
  assert.equal(nodes[1]!.getAttribute("content"), payload);
  assert.equal(nodes[2]!.getAttribute("href"), '/?a="&b=2');
  assert.equal(nodes[3]!.getAttribute("type"), "application/rss+xml");
  assert.equal(nodes[3]!.getAttribute("title"), payload);
  assert.equal(nodes[3]!.getAttribute("hreflang"), "en");
  assert.equal(nodes[4]!.getAttribute("property"), "og:title");
  // Golden captured by reading today's server page-head serializeJsonLd: every `<` is escaped.
  assert.equal(nodes[5]!.textContent, '{"name":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}');
  assert.equal(nodes[5]!.getAttribute("type"), "application/ld+json");
  assert.equal(document.head.querySelectorAll("script").length, 1);
  assert.equal(document.head.querySelector("img"), null);
  assert.equal(setter.mock.calls.length, 0);
});

test("empty descriptors and absent optional link attributes", () => {
  assert.deepEqual(applyHeadElements({ elements: [] }, { document }), []);
  const [link] = applyHeadElements({ elements: [{ kind: "link", rel: "canonical", href: "/", priority: 120 }] }, { document });
  assert.deepEqual(link!.getAttributeNames(), ["rel", "href"]);
  link!.remove();
  assert.equal(document.head.children.length, 0);
});
