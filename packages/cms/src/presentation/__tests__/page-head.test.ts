import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";

import {
  foldPageHead as fold,
  serializeHeadElements,
} from "../page-head.js";
import type { HeadElement, PageHeadContext, PageHeadHook } from "../../seo/types.js";

/**
 * @file T005 — failing-first certification of `page-head.ts`'s
 * `foldPageHead`/`serializeHeadElements` (ADR-PIPE-008 Decision §2, INV-03,
 * Named Risk #2, behavior.spec.md §2.1/§5/§6.1). Certified BEFORE T009
 * implements it and BEFORE T030/T031/T048/T049 depend on its exact behavior.
 */

const ctx: PageHeadContext = {
  workspaceId: "workspace-1",
  route: "/",
  canonicalUrl: "https://example.com/",
  siteTitle: "Example Site",
};

let contributors: PageHeadHook[] = [];
beforeEach(() => { contributors = []; });
function registerPageHeadContributor(hook: PageHeadHook) { contributors.push(hook); }
function foldPageHead(ctx: PageHeadContext) { return fold({ context: ctx }, { contributors }); }

function hook(priority: number, elements: HeadElement[], opts: { throws?: boolean } = {}): PageHeadHook {
  return {
    priority,
    async handle() {
      if (opts.throws) throw new Error("contributor exploded");
      return elements;
    },
  };
}

test("foldPageHead: folds registered contributors' elements in ascending priority order", async () => {
  registerPageHeadContributor(
    hook(10, [
      { kind: "meta", name: "robots", content: "index,follow", priority: 130 },
      { kind: "title", text: "Hi", priority: 100 },
    ])
  );

  const result = await foldPageHead(ctx);
  assert.deepEqual(
    result.map((e) => e.priority),
    [100, 130]
  );
});

test("foldPageHead: dedups by HeadElementKey — the element with the numerically highest priority wins", async () => {
  registerPageHeadContributor(hook(10, [{ kind: "meta", name: "description", content: "low", priority: 50 }]));
  registerPageHeadContributor(hook(20, [{ kind: "meta", name: "description", content: "high", priority: 900 }]));

  const result = await foldPageHead(ctx);
  const descriptions = result.filter((e) => e.kind === "meta" && e.name === "description");
  assert.equal(descriptions.length, 1);
  assert.equal((descriptions[0] as { content: string }).content, "high");
});

test("foldPageHead: same-priority collision — the later-registered contributor's element wins (§6.1)", async () => {
  registerPageHeadContributor(hook(10, [{ kind: "meta", name: "robots", content: "first", priority: 130 }]));
  registerPageHeadContributor(hook(20, [{ kind: "meta", name: "robots", content: "second", priority: 130 }]));

  const result = await foldPageHead(ctx);
  const robots = result.filter((e) => e.kind === "meta" && e.name === "robots");
  assert.equal(robots.length, 1);
  assert.equal((robots[0] as { content: string }).content, "second");
});

test("foldPageHead: equal contributor priorities preserve registration order for collisions", async () => {
  registerPageHeadContributor(hook(10, [{ kind: "title", text: "first", priority: 100 }]));
  registerPageHeadContributor(hook(10, [{ kind: "title", text: "second", priority: 100 }]));
  assert.deepEqual(await foldPageHead(ctx), [{ kind: "title", text: "second", priority: 100 }]);
});

test("foldPageHead: contributors receive the page context and execute by priority, independently of element order", async () => {
  const calls: string[] = [];
  registerPageHeadContributor({
    priority: 20,
    async handle(page) {
      calls.push("high");
      return [{ kind: "title", text: page.siteTitle, priority: 100 }];
    },
  });
  registerPageHeadContributor({
    priority: 10,
    async handle(page) {
      calls.push("low");
      return [{ kind: "link", rel: "canonical", href: page.canonicalUrl, priority: 120 }];
    },
  });

  const result = await foldPageHead(ctx);
  assert.deepEqual(calls, ["low", "high"]);
  assert.deepEqual(result, [
    { kind: "title", text: "Example Site", priority: 100 },
    { kind: "link", rel: "canonical", href: "https://example.com/", priority: 120 },
  ]);
});

test("foldPageHead: a throwing contributor's output is dropped; the fold itself never throws and other contributors still render", async () => {
  registerPageHeadContributor(hook(10, [], { throws: true }));
  registerPageHeadContributor(hook(20, [{ kind: "title", text: "Still here", priority: 100 }]));

  const result = await foldPageHead(ctx);
  assert.deepEqual(result, [{ kind: "title", text: "Still here", priority: 100 }]);
});

test("foldPageHead: different keys are never deduped (e.g. two distinct jsonld @types both survive)", async () => {
  registerPageHeadContributor(
    hook(10, [
      { kind: "jsonld", data: { "@type": "Article" }, priority: 900 },
      { kind: "jsonld", data: { "@type": "BreadcrumbList" }, priority: 900 },
    ])
  );

  const result = await foldPageHead(ctx);
  assert.equal(result.length, 2);
  assert.deepEqual(result, [
    { kind: "jsonld", data: { "@type": "Article" }, priority: 900 },
    { kind: "jsonld", data: { "@type": "BreadcrumbList" }, priority: 900 },
  ]);
});

test("registerPageHeadContributor: multiple registered contributors both fold", async () => {
  registerPageHeadContributor(hook(10, [{ kind: "title", text: "A", priority: 100 }]));
  registerPageHeadContributor(hook(20, [{ kind: "link", rel: "canonical", href: "https://example.com/", priority: 120 }]));

  const result = await foldPageHead(ctx);
  assert.equal(result.length, 2);
});

test("serializeHeadElements: renders one case per HeadElement kind, escaped", async () => {
  const hostileJsonLd = { "@type": "Article", name: '</script><script>alert("breakout")</script>' };
  const html = serializeHeadElements({ elements: [
    { kind: "title", text: "A & B", priority: 100 },
    { kind: "meta", name: "description", content: '"quoted"', priority: 110 },
    { kind: "link", rel: "canonical", href: "https://example.com/?a=1&b=2", priority: 120 },
    { kind: "og", property: "og:title", content: "<script>", priority: 140 },
    { kind: "jsonld", data: hostileJsonLd, priority: 900 },
  ] });

  assert.match(html, /<title>A &amp; B<\/title>/);
  assert.match(html, /<meta name="description" content="&quot;quoted&quot;"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/\?a=1&amp;b=2"/);
  assert.match(html, /<meta property="og:title" content="&lt;script&gt;"/);
  assert.match(html, /<script type="application\/ld\+json">/);
  // The jsonld payload must never let a literal `</script>` break out of the tag.
  assert.ok(!html.includes("<script>Article"));
  const scriptBodyMatch = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
  assert.ok(scriptBodyMatch);
  assert.ok(!scriptBodyMatch![1]!.includes("</script>"));
  assert.deepEqual(JSON.parse(scriptBodyMatch[1]!), hostileJsonLd);
  assert.equal((html.match(/<script\b/gi) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/gi) ?? []).length, 1);
  assert.ok(html.includes("\\u003c/script>"));
});

test("serializeHeadElements: never string-concatenates jsonld — the payload round-trips through JSON.stringify", async () => {
  const html = serializeHeadElements({ elements: [{ kind: "jsonld", data: { "@type": "Article", headline: "Hi" }, priority: 900 }] });
  const scriptBodyMatch = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
  assert.ok(scriptBodyMatch);
  const parsed = JSON.parse(scriptBodyMatch![1]!.replace(/\\u003c/g, "<"));
  assert.equal(parsed["@type"], "Article");
  assert.equal(parsed.headline, "Hi");
});

/**
 * ESC-01 (2026-09-07). `1044e2d5`'s message claimed it added the apostrophe escape to "every
 * `escapeHtml` copy". It reached four of the eleven hand-rolled escapers in `apps/website/src`, and
 * this file's was not one of them — the commit message is not evidence, and neither is the absence
 * of a test.
 *
 * Not exploitable at HEAD: every sink in `page-head.ts` is a double-quoted attribute or a text node
 * (`<title>`, `content="…"`, `href="…"`, `rel="…"`, `hreflang="…"`), and a grep for `='` in that
 * module is empty. This test therefore pins the DEFENCE, not a live hole: `serializeHeadElements`
 * is a template-literal serializer, so the day someone writes a single-quoted attribute into it the
 * escaping either already covers them or silently does not — and the four sibling copies that do
 * escape `'` are what makes "it wasn't needed here" an assumption rather than a rule.
 */
test("serializeHeadElements: an apostrophe is escaped, so a single-quoted attribute added later cannot be broken out of", () => {
  const html = serializeHeadElements({ elements: [
    { kind: "title", text: "Ada's page", priority: 100 },
    { kind: "meta", name: "description", content: "it's a description' onload='alert(1)", priority: 110 },
    { kind: "link", rel: "canonical", href: "https://example.com/ada's", priority: 120 },
  ] });

  assert.match(html, /<title>Ada&#39;s page<\/title>/);
  assert.match(html, /content="it&#39;s a description&#39; onload=&#39;alert\(1\)"/);
  assert.match(html, /href="https:\/\/example\.com\/ada&#39;s"/);
  assert.ok(!html.includes("'"), `no raw apostrophe may survive serialization:\n${html}`);
});

test("serializeHeadElements: escaping this module's five entities agrees with its four sibling copies, character for character", () => {
  // The equivalence the ESC-01 fix restores, asserted rather than commented. `render.ts`,
  // `static-render.ts`, `form-render.ts` and `site-exporter.ts` all map exactly these five, `&`
  // first (it is the escape character for every entity below it, so escaping it later would
  // double-escape what the others introduce).
  const html = serializeHeadElements({ elements: [{ kind: "title", text: `&<>"'`, priority: 100 }] });

  assert.match(html, /<title>&amp;&lt;&gt;&quot;&#39;<\/title>/);
});

test("serializeHeadElements: a link's optional type and title render as escaped attributes (RSS auto-discovery)", async () => {
  const html = serializeHeadElements({ elements: [
    { kind: "link", rel: "alternate", type: "application/rss+xml", title: `Tom & "Jerry"`, href: "/feed.xml", priority: 125 },
  ] });
  assert.equal(html, `<link rel="alternate" href="/feed.xml" type="application/rss+xml" title="Tom &amp; &quot;Jerry&quot;"/>`);
});

test("foldPageHead: an RSS alternate link does not collide with an hreflang-free canonical or another alternate type", async () => {
  registerPageHeadContributor(
    hook(10, [
      { kind: "link", rel: "canonical", href: "/a", priority: 120 },
      { kind: "link", rel: "alternate", type: "application/rss+xml", href: "/feed.xml", priority: 125 },
      { kind: "link", rel: "alternate", type: "application/atom+xml", href: "/atom.xml", priority: 125 },
    ])
  );
  const folded = await foldPageHead(ctx);
  assert.equal(folded.length, 3);
});

test("foldPageHead: alternate languages survive together and serialize their hreflang", async () => {
  const links: HeadElement[] = [
    { kind: "link", rel: "alternate", hreflang: "en", href: "/en", priority: 125 },
    { kind: "link", rel: "alternate", hreflang: "fr", href: "/fr", priority: 125 },
  ];
  registerPageHeadContributor(hook(10, links));
  const folded = await foldPageHead(ctx);
  assert.deepEqual(folded, links);
  assert.equal(serializeHeadElements({ elements: folded }), '<link rel="alternate" href="/en" hreflang="en"/><link rel="alternate" href="/fr" hreflang="fr"/>');
  assert.equal(serializeHeadElements({ elements: [
    { kind: "link", rel: "alternate", hreflang: 'en&"', href: "/en", priority: 125 },
  ] }), '<link rel="alternate" href="/en" hreflang="en&amp;&quot;"/>');
});

test("foldPageHead: failure while appending a contribution is dropped and later contributors still execute", async () => {
  const elements = new Proxy<HeadElement[]>([], {
    get(target, key, receiver) {
      if (key === Symbol.iterator) throw new Error('cannot iterate contribution');
      return Reflect.get(target, key, receiver);
    },
  });
  registerPageHeadContributor(hook(10, elements));
  registerPageHeadContributor(hook(20, [{ kind: 'title', text: 'Still here', priority: 100 }]));
  assert.deepEqual(await foldPageHead(ctx), [{ kind: 'title', text: 'Still here', priority: 100 }]);
});

test("foldPageHead: awaits each contribution before reading the next handle", async () => {
  const calls: string[] = [];
  let release: () => void = () => { throw new Error('contributor not started'); };
  registerPageHeadContributor({
    priority: 10,
    async handle(context) {
      assert.equal(context, ctx);
      calls.push('first start');
      await new Promise<void>(resolve => { release = resolve; });
      calls.push('first end');
      return [];
    },
  });
  registerPageHeadContributor({
    priority: 20,
    get handle() {
      calls.push('second read');
      return async () => { calls.push('second start'); return []; };
    },
  });
  const pending = foldPageHead(ctx);
  assert.deepEqual(calls, ['first start']);
  release();
  assert.deepEqual(await pending, []);
  assert.deepEqual(calls, ['first start', 'first end', 'second read', 'second start']);
});
