import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { InMemoryPostRepo, ROOT_SLUG, type PostRecord } from "./support/post.fixture.js";
import { InMemorySettingsRepo, set } from "./support/legacy-api.fixture.js";
import { ensureSiteTitleSettingDefinition, SITE_TITLE_KEY, SITE_TITLE_NAMESPACE } from "./support/legacy-api.fixture.js";
import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError, type OriginRegistryPort } from "@jini-ai/http-kit/verified-origin";
import type { HeadElement, PageHeadContext } from "../types.js";
import { SeoEntryNotFoundError } from "../errors.js";
import { ensureSeoSettingDefinitions, setSeoSettings } from "./support/legacy-api.fixture.js";
import { createSeoPageHeadHook } from "./support/legacy-api.fixture.js";
import { buildPostRecord } from "./support/post.fixture.js";

/**
 * @file T030 — failing-first unit certification of `seoPageHeadHook`
 * (ADR-PIPE-008 Decision, C-003; behavior.spec.md §2.1): maps `SeoMeta` into
 * `HeadElement[]` per the fixed priority bands; `page`->`WebPage`,
 * `post`->`Article`; `schemaType` override changes `@type`; ancestor chain ->
 * `BreadcrumbList`; never throws for a normal case.
 */

const WORKSPACE = "workspace-1";
const clock = { nowIso: () => "2026-07-13T00:00:00.000Z", nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") };
let idCounter = 0;
const ids = { newId: () => `head-contrib-id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function seedPost(overrides: Partial<PostRecord> = {}): PostRecord {
  return buildPostRecord({
    id: "post-1",
    workspaceId: WORKSPACE,
    title: "Hello World",
    slug: "hello-world",
    bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body text." }] }] },
    status: "published",
    kind: "post",
    updatedAt: "2026-07-13T00:00:00.000Z",
    version: 1,
    seoExtJson: null,
    ...overrides,
  });
}

/** No verified origin registered — mirrors `seo.test.ts`'s own copy of this fake. Keeps every
 *  canonical/og:url assertion below unchanged (still relative); this suite's job is the
 *  SeoMeta -> HeadElement[] mapping, not the absolute-URL join itself (see `seo.test.ts`/
 *  `absolute-url.test.ts` for that coverage). */
function fakeOriginRegistry(): OriginRegistryPort {
  return {
    async canonicalOrigin() {
      throw new OriginNotVerifiedError({ message: "no verified origin registered for this workspace" });
    },
    async isAllowedRedirectTarget() {
      return false;
    },
    async isAllowedEgressTarget() {
      return false;
    },
  };
}

async function makeDeps(posts: PostRecord[]) {
  const postRepo = new InMemoryPostRepo(posts);
  const settingsRepo = new InMemorySettingsRepo();
  const settingsDeps = { settingsRepo, clock, ids, authorize: alwaysAllow, principals: { findById: async () => null } as never };
  await ensureSeoSettingDefinitions(settingsDeps, { workspaceId: WORKSPACE, systemPrincipalId: "system-seo" });

  return {
    postRepo,
    settingsRepo,
    settingsDeps,
    media: {
      mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
      assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
    },
    originRegistry: fakeOriginRegistry(),
  };
}

function baseCtx(entryId: string): PageHeadContext {
  return {
    workspaceId: WORKSPACE,
    route: `/${entryId}`,
    canonicalUrl: `/${entryId}`,
    siteTitle: "Example Site",
    entry: {
      id: entryId,
      type: "post",
      slug: entryId,
      title: "Hello World",
      status: "published",
      updatedAt: "2026-07-13T00:00:00.000Z",
      ext: {},
    },
  };
}

// REGRESSION: fails if the head contributor stops supplying the configured home title to getEntryMeta.
test("seoPageHeadHook: the content-owned homepage uses the configured site title without the SEO title template", async () => {
  const deps = await makeDeps([seedPost({ kind: "page", slug: ROOT_SLUG, title: "Home" })]);
  await ensureSiteTitleSettingDefinition(deps.settingsDeps, { systemPrincipalId: "system-seo" });
  await set({
    deps: { repo: deps.settingsRepo, clock, ids, authorize: alwaysAllow, principals: deps.settingsDeps.principals },
    input: { namespace: SITE_TITLE_NAMESPACE, key: SITE_TITLE_KEY, scope: "workspace", workspaceId: WORKSPACE, value: "Owner Site", callerPrincipalId: "caller-1" },
  });
  await setSeoSettings(deps.settingsDeps, { workspaceId: WORKSPACE, callerPrincipalId: "caller-1", patch: { titleTemplate: "%s — template" } });
  const ctx = baseCtx("post-1");
  ctx.entry = { ...ctx.entry!, type: "page", slug: ROOT_SLUG, title: "Home" };
  // Production currently renders this content-owned home through the same "post" seam as pages.
  ctx.route = "post";

  const elements = await createSeoPageHeadHook(deps).handle(ctx);
  assert.deepEqual(elements.find((element) => element.kind === "title"), { kind: "title", text: "Owner Site", priority: 100 });
  assert.deepEqual(elements.find((element) => element.kind === "og" && element.property === "og:title"), { kind: "og", property: "og:title", content: "Owner Site", priority: 140 });
});

// PARITY: missing settings, registered defaults, explicit SEO overrides, and non-home titles retain their behavior.
test("seoPageHeadHook: home-title fallback preserves explicit SEO titles and non-home pages", async () => {
  const deps = await makeDeps([
    seedPost({ kind: "page", slug: ROOT_SLUG, title: "Home" }),
    seedPost({ id: "about", kind: "page", slug: "about", title: "About" }),
  ]);
  const hook = createSeoPageHeadHook(deps);
  const ctx = baseCtx("post-1");
  ctx.entry = { ...ctx.entry!, type: "page", slug: ROOT_SLUG, title: "Home" };
  await setSeoSettings(deps.settingsDeps, { workspaceId: WORKSPACE, callerPrincipalId: "caller-1", patch: { titleTemplate: "%s — template" } });

  const withoutDefinition = await hook.handle(ctx);
  assert.deepEqual(withoutDefinition.find((element) => element.kind === "title"), { kind: "title", text: "Home — template", priority: 100 });
  await ensureSiteTitleSettingDefinition(deps.settingsDeps, { systemPrincipalId: "system-seo" });
  const withoutOwnerValue = await hook.handle(ctx);
  assert.deepEqual(withoutOwnerValue.find((element) => element.kind === "title"), { kind: "title", text: "Home — template", priority: 100 });

  await set({
    deps: { repo: deps.settingsRepo, clock, ids, authorize: alwaysAllow, principals: deps.settingsDeps.principals },
    input: { namespace: SITE_TITLE_NAMESPACE, key: SITE_TITLE_KEY, scope: "workspace", workspaceId: WORKSPACE, value: "Owner Site", callerPrincipalId: "caller-1" },
  });
  await deps.postRepo.save(seedPost({ kind: "page", slug: ROOT_SLUG, title: "Home", seoExtJson: JSON.stringify({ title: "Home SEO override", ogTitle: "Home OG override", twitterTitle: "Home Twitter override" }) }));
  const explicit = await hook.handle(ctx);
  assert.deepEqual(explicit.find((element) => element.kind === "title"), { kind: "title", text: "Home SEO override", priority: 100 });
  assert.deepEqual(explicit.find((element) => element.kind === "og" && element.property === "og:title"), { kind: "og", property: "og:title", content: "Home OG override", priority: 140 });
  assert.deepEqual(explicit.find((element) => element.kind === "meta" && element.name === "twitter:title"), { kind: "meta", name: "twitter:title", content: "Home Twitter override", priority: 151 });

  const otherPage = await hook.handle(baseCtx("about"));
  assert.deepEqual(otherPage.find((element) => element.kind === "title"), { kind: "title", text: "About — template", priority: 100 });
});

test("seoPageHeadHook: maps SeoMeta into HeadElement[] per the fixed priority bands", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({
    title: "SEO title", description: "SEO description", canonical: "https://canonical.example/article",
    noindex: true, nofollow: false, ogTitle: "OG title", ogDescription: "OG description",
    ogImage: "https://images.example/og.jpg", twitterTitle: "Twitter title", twitterDescription: "Twitter description",
    twitterCard: "summary", twitterImage: "https://images.example/twitter.jpg",
  }) })]);
  await setSeoSettings(deps.settingsDeps, { workspaceId: WORKSPACE, callerPrincipalId: "caller-1", patch: { twitterSite: "@example" } });
  const hook = createSeoPageHeadHook(deps);
  const elements = await hook.handle(baseCtx("post-1"));

  const byKindName = (kind: string, discriminator?: string) =>
    elements.find((e) => e.kind === kind && (!discriminator || (e as never as Record<string, unknown>).name === discriminator || (e as never as Record<string, unknown>).rel === discriminator));

  const title = elements.find((e) => e.kind === "title");
  assert.ok(title);
  assert.equal(title!.priority, 100);

  const description = byKindName("meta", "description");
  assert.ok(description);
  assert.equal(description!.priority, 110);

  const canonical = byKindName("link", "canonical");
  assert.ok(canonical);
  assert.equal(canonical!.priority, 120);

  const robots = byKindName("meta", "robots");
  assert.ok(robots);
  assert.equal(robots!.priority, 130);

  const og = elements.filter((e) => e.kind === "og");
  assert.ok(og.length > 0);
  assert.ok(og.every((e) => e.priority >= 140 && e.priority <= 149));

  const twitter = elements.filter((e) => e.kind === "meta" && (e as { name: string }).name.startsWith("twitter:"));
  assert.ok(twitter.length > 0);
  assert.ok(twitter.every((e) => e.priority >= 150 && e.priority <= 159));

  const jsonld = elements.filter((e) => e.kind === "jsonld");
  assert.ok(jsonld.length > 0);
  assert.ok(jsonld.every((e) => e.priority === 900));
  assert.deepEqual(elements, [
    { kind: "title", text: "SEO title", priority: 100 },
    { kind: "meta", name: "description", content: "SEO description", priority: 110 },
    { kind: "link", rel: "canonical", href: "https://canonical.example/article", priority: 120 },
    { kind: "link", rel: "alternate", type: "application/rss+xml", title: "Example Site", href: "/feed.xml", priority: 125 },
    { kind: "meta", name: "robots", content: "noindex,follow", priority: 130 },
    { kind: "og", property: "og:title", content: "OG title", priority: 140 },
    { kind: "og", property: "og:type", content: "article", priority: 141 },
    { kind: "og", property: "og:url", content: "https://canonical.example/article", priority: 142 },
    { kind: "og", property: "og:image", content: "https://images.example/og.jpg", priority: 143 },
    { kind: "og", property: "og:description", content: "OG description", priority: 144 },
    { kind: "meta", name: "twitter:card", content: "summary", priority: 150 },
    { kind: "meta", name: "twitter:title", content: "Twitter title", priority: 151 },
    { kind: "meta", name: "twitter:description", content: "Twitter description", priority: 152 },
    { kind: "meta", name: "twitter:image", content: "https://images.example/twitter.jpg", priority: 153 },
    { kind: "meta", name: "twitter:site", content: "@example", priority: 154 },
    { kind: "jsonld", data: { "@context": "https://schema.org", "@type": "Article", headline: "SEO title", description: "SEO description" }, priority: 900 },
  ]);
});

test("seoPageHeadHook: a post-kind entry with no schemaType override emits @type: Article (AC-13)", async () => {
  const deps = await makeDeps([seedPost({ kind: "post" })]);
  const hook = createSeoPageHeadHook(deps);
  const elements = await hook.handle(baseCtx("post-1"));
  const jsonld = elements.find((e) => e.kind === "jsonld") as Extract<HeadElement, { kind: "jsonld" }>;
  assert.equal(jsonld.data["@type"], "Article");
});

test("seoPageHeadHook: a page-kind entry with no schemaType override emits @type: WebPage", async () => {
  const deps = await makeDeps([seedPost({ id: "page-1", kind: "page", slug: "about" })]);
  const hook = createSeoPageHeadHook(deps);
  const elements = await hook.handle(baseCtx("page-1"));
  const jsonld = elements.find((e) => e.kind === "jsonld") as Extract<HeadElement, { kind: "jsonld" }>;
  assert.equal(jsonld.data["@type"], "WebPage");
});

test("seoPageHeadHook: a schemaType override changes the emitted @type (AC-14)", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ schemaType: "NewsArticle" }) })]);
  const hook = createSeoPageHeadHook(deps);
  const elements = await hook.handle(baseCtx("post-1"));
  const jsonld = elements.find((e) => e.kind === "jsonld") as Extract<HeadElement, { kind: "jsonld" }>;
  assert.equal(jsonld.data["@type"], "NewsArticle");
});

test("seoPageHeadHook: an ancestor chain in context is included as a BreadcrumbList", async () => {
  const deps = await makeDeps([seedPost()]);
  const hook = createSeoPageHeadHook(deps);
  const ctx = baseCtx("post-1");
  ctx.entry!.ancestors = [{ title: "Home", url: "/" }, { title: "Blog", url: "/blog" }];

  const elements = await hook.handle(ctx);
  const jsonldEntries = elements.filter((e) => e.kind === "jsonld") as Array<Extract<HeadElement, { kind: "jsonld" }>>;
  const breadcrumb = jsonldEntries.find((e) => e.data["@type"] === "BreadcrumbList");
  assert.ok(breadcrumb);
  assert.deepEqual(breadcrumb.data, { "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "/blog" },
    ],
  });
  for (const ancestors of [undefined, []]) {
    if (ancestors === undefined) delete ctx.entry!.ancestors;
    else ctx.entry!.ancestors = ancestors;
    const without = await hook.handle(ctx);
    assert.equal(without.some((e) => e.kind === "jsonld" && e.data["@type"] === "BreadcrumbList"), false);
  }
});

test("seoPageHeadHook: never throws for a normal case", async () => {
  const deps = await makeDeps([seedPost()]);
  const hook = createSeoPageHeadHook(deps);
  await assert.doesNotReject(() => hook.handle(baseCtx("post-1")));
});

test("seoPageHeadHook: a home/entry-less context still emits site-level tags", async () => {
  const deps = await makeDeps([seedPost()]);
  const hook = createSeoPageHeadHook(deps);
  const elements = await hook.handle({
    workspaceId: WORKSPACE,
    route: "/",
    canonicalUrl: "/",
    siteTitle: "Example Site",
  });
  assert.ok(elements.some((e) => e.kind === "title"));
  assert.deepEqual(elements, [
    { kind: "title", text: "Example Site", priority: 100 },
    { kind: "link", rel: "canonical", href: "/", priority: 120 },
    { kind: "link", rel: "alternate", type: "application/rss+xml", title: "Example Site", href: "/feed.xml", priority: 125 },
  ]);
});

test("seoPageHeadHook: every page, with or without an entry, advertises the RSS feed for auto-discovery", async () => {
  const deps = await makeDeps([seedPost()]);
  const hook = createSeoPageHeadHook(deps);
  const expected = { kind: "link", rel: "alternate", type: "application/rss+xml", title: "Example Site", href: "/feed.xml", priority: 125 };
  const onEntry = await hook.handle(baseCtx("post-1"));
  assert.deepEqual(onEntry.find((e) => e.kind === "link" && e.rel === "alternate"), expected);
  const onHome = await hook.handle({ workspaceId: WORKSPACE, route: "/", canonicalUrl: "/", siteTitle: "Example Site" });
  assert.deepEqual(onHome.find((e) => e.kind === "link" && e.rel === "alternate"), expected);
});


test("seoPageHeadHook: a missing entry rejects with the typed entry-not-found error", async () => {
  const deps = await makeDeps([]);
  await assert.rejects(() => createSeoPageHeadHook(deps).handle(baseCtx("missing")), SeoEntryNotFoundError);
});

for (const [noindex, nofollow, content] of [
  [false, false, "index,follow"], [false, true, "index,nofollow"],
  [true, false, "noindex,follow"], [true, true, "noindex,nofollow"],
] as const) {
  test(`seoPageHeadHook: explicit robots overrides emit ${content}`, async () => {
    const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ noindex, nofollow }) })]);
    const elements = await createSeoPageHeadHook(deps).handle(baseCtx("post-1"));
    assert.deepEqual(elements.find((e) => e.kind === "meta" && e.name === "robots"), {
      kind: "meta", name: "robots", content, priority: 130,
    });
  });
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
