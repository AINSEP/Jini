import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test, vi, afterEach } from "vitest";

import { InMemoryPostRepo, type PostRecord } from "./support/post.fixture.js";
import { InMemorySettingsRepo } from "./support/legacy-api.fixture.js";
import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError, type OriginRegistryPort, type VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { SeoEntryNotFoundError } from "../errors.js";
import type { DomainEvent, OutboxPort } from "../../core/index.js";
import type { SitemapInvalidationDeps } from "../sitemap.js";
import { ensureSeoSettingDefinitions, setSeoSettings } from "./support/legacy-api.fixture.js";
import { analyzeEntry, getEntryMeta } from "./support/legacy-api.fixture.js";
import { setEntrySeoOverrides } from "./support/legacy-api.fixture.js";
import { buildPostRecord } from "./support/post.fixture.js";

/**
 * @file T024 — failing-first unit certification of `getEntryMeta`
 * (ADR-PIPE-008 Decision, C-001; behavior.spec.md §1.1/§3/§7): per-field
 * precedence (override wins, site-default wins when no override,
 * derived-from-excerpt fallback when both absent), `title` never resolves
 * empty, canonical override accepted cross-domain as-is (EC-10), no-override
 * canonical falls back to routing, draft-safety `noindex` derivation (EC-11),
 * entry override beats a workspace default (EC-02).
 */

const WORKSPACE = "workspace-1";
const clock = { nowIso: () => "2026-07-13T00:00:00.000Z", nowMs() { return Date.parse(this.nowIso()); } };
let idCounter = 0;
const ids = { newId: () => `seo-test-id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function seedPost(overrides: Partial<PostRecord> = {}): PostRecord {
  return buildPostRecord({
    id: "post-1",
    workspaceId: WORKSPACE,
    title: "Hello World",
    slug: "hello-world",
    bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "An excerpt body." }] }] },
    status: "published",
    kind: "post",
    updatedAt: "2026-07-13T00:00:00.000Z",
    version: 1,
    seoExtJson: null,
    ...overrides,
  });
}

/** Fake `OriginRegistryPort` (mirrors `site-evidence/__tests__/unit/collect-page-evidence.unit.test.ts`'s
 *  own copy) — `origin: undefined` (the default, and every pre-existing test's implicit behavior)
 *  means "no verified origin registered yet", which `resolveWorkspaceOrigin` degrades to
 *  `undefined`, keeping every canonical/og:url/og:image assertion below unchanged (still relative).
 *  A test that needs the absolute-URL fix passes a real `VerifiedOrigin` explicitly. */
function fakeOriginRegistry(origin?: VerifiedOrigin): OriginRegistryPort {
  return {
    async canonicalOrigin() {
      if (!origin) throw new OriginNotVerifiedError({ message: "no verified origin registered for this workspace" });
      return origin;
    },
    async isAllowedRedirectTarget() {
      return false;
    },
    async isAllowedEgressTarget() {
      return false;
    },
  };
}

async function makeDeps(posts: PostRecord[], origin?: VerifiedOrigin) {
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
    originRegistry: fakeOriginRegistry(origin),
  };
}

test("getEntryMeta: entry not found rejects SeoEntryNotFoundError", async () => {
  const deps = await makeDeps([]);
  await assert.rejects(
    () => getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "missing" }),
    SeoEntryNotFoundError
  );
});

test("getEntryMeta: no overrides and no site defaults resolves fully derived meta (AC-07)", async () => {
  const deps = await makeDeps([seedPost()]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });

  assert.equal(meta.title, "Hello World");
  assert.equal(meta.robots.noindex, false);
  assert.equal(meta.robots.nofollow, false);
  assert.ok(meta.canonical.includes("hello-world"));
});

test("getEntryMeta: title override wins over derived template (AC-06)", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ title: "Override Title" }) })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.title, "Override Title");
});

test("getEntryMeta: title is derived from titleTemplate applied to entry.title when no override", async () => {
  const deps = await makeDeps([seedPost()]);
  await setSeoSettings(deps.settingsDeps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "caller-1",
    patch: { titleTemplate: "%s — My Site" },
  });
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.title, "Hello World — My Site");
});

test("getEntryMeta: the default title template preserves a one-character entry title", async () => {
  const deps = await makeDeps([seedPost({ title: "X" })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.ok(meta.title.length > 0);
  assert.equal(meta.title, "X");
});

test("getEntryMeta: description — site default wins when no override (behavior.spec.md example)", async () => {
  const deps = await makeDeps([seedPost()]);
  await setSeoSettings(deps.settingsDeps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "caller-1",
    patch: { defaultDescription: "A great site" },
  });
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "A great site");
});

test("getEntryMeta: description override wins over site default", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ description: "Override description" }) })]);
  await setSeoSettings(deps.settingsDeps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "caller-1",
    patch: { defaultDescription: "Site default" },
  });
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "Override description");
});

test("getEntryMeta: description derives from excerpt when override and site default are both absent", async () => {
  const deps = await makeDeps([seedPost()]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "An excerpt body.");
});

test("getEntryMeta: all precedence sources absent for description resolves undefined (EC, behavior.spec.md §7)", async () => {
  const deps = await makeDeps([seedPost({ bodyJson: { type: "doc", content: [] } })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, undefined);
});

// ---------------------------------------------------------------------------
// Regression: clearing a description override (via `setEntrySeoOverrides`'
// `null`-clears-a-key semantics) must fall through the SAME precedence chain
// as an entry that never had an override — not resolve to `""`/`undefined`
// merely because the raw JSON key is gone. This is the behavior that actually
// matters (an empty-string override previously suppressed the site default/
// derived excerpt via `??`, which doesn't filter `""`); asserting only that
// the JSON key vanished would not catch that regression.
// ---------------------------------------------------------------------------

test("getEntryMeta: clearing a description override falls through to the derived excerpt, not an empty string (regression)", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ description: "" }) })]);

  await setEntrySeoOverrides({
    deps: { postRepo: deps.postRepo, authorize: alwaysAllow, invalidateSitemapCache: () => {}, clock },
    input: { workspaceId: WORKSPACE, entryId: "post-1", patch: { description: null }, callerPrincipalId: "caller-1" },
  });

  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "An excerpt body.");
});

test("getEntryMeta: clearing a description override falls through to the site default when one is configured (regression)", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ description: "Old override" }) })]);
  await setSeoSettings(deps.settingsDeps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "caller-1",
    patch: { defaultDescription: "A great site" },
  });

  await setEntrySeoOverrides({
    deps: { postRepo: deps.postRepo, authorize: alwaysAllow, invalidateSitemapCache: () => {}, clock },
    input: { workspaceId: WORKSPACE, entryId: "post-1", patch: { description: null }, callerPrincipalId: "caller-1" },
  });

  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "A great site");
});

test("getEntryMeta: description derives from an html-format page's bodyHtml when override and site default are absent (SPEC-047 gap)", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      bodyFormat: "html",
      bodyHtml: "<header><h1>Quickstart</h1></header><p>From nothing to a published post in five steps.</p>",
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "Quickstart From nothing to a published post in five steps.");
});

test("getEntryMeta: html-format description strips a leading <style> block and decodes entities instead of leaking CSS/markup", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      bodyFormat: "html",
      bodyHtml: "<style>.qs-wrap { max-width: 46rem; }</style><div class=\"qs-wrap\"><p>Tovu &amp; you: &lt;init&gt; a site in minutes.</p></div>",
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "Tovu & you: <init> a site in minutes.");
});

test("getEntryMeta: html-format description truncates at the same length and with the same ellipsis as the doc-format path", async () => {
  const longSentence = "A".repeat(200);
  const deps = await makeDeps([
    seedPost({ kind: "page", bodyFormat: "html", bodyHtml: `<p>${longSentence}</p>` }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, `${"A".repeat(160)}…`);
});

test("getEntryMeta: html-format description skips a `post-detail-header` block instead of doubling the title (/media regression)", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      bodyFormat: "html",
      bodyHtml:
        '<header class="post-detail-header"><h1>Media</h1><p>Sep 3, 2026</p></header>' +
        '<div class="post-detail-body"><p>Media is where…</p></div>',
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.ok(
    meta.description?.startsWith("Media is where"),
    `expected description to start with "Media is where", got: ${meta.description}`
  );
});

test("getEntryMeta: html-format description is unchanged when there is no `post-detail-header` block", async () => {
  const deps = await makeDeps([
    seedPost({ kind: "page", bodyFormat: "html", bodyHtml: "<p>Plain content with no header block.</p>" }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "Plain content with no header block.");
});

test("getEntryMeta: doc-format description is unchanged by the post-detail-header stripping (bodyHtml path not taken)", async () => {
  const deps = await makeDeps([seedPost()]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "An excerpt body.");
});

test("getEntryMeta: html-format `post-detail-header` block is skipped even with extra classes alongside it", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      bodyFormat: "html",
      bodyHtml:
        '<header class="post-detail-header foo"><h1>Media</h1><p>Sep 3, 2026</p></header>' +
        '<div class="post-detail-body"><p>Media is where…</p></div>',
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.ok(
    meta.description?.startsWith("Media is where"),
    `expected description to start with "Media is where", got: ${meta.description}`
  );
});

test("getEntryMeta: an explicit description override still wins over the derived html excerpt", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      bodyFormat: "html",
      bodyHtml: "<p>This should never be used as the description.</p>",
      seoExtJson: JSON.stringify({ description: "Manual override description" }),
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "Manual override description");
});

test("getEntryMeta: canonical override is accepted cross-domain as-is (EC-10)", async () => {
  const deps = await makeDeps([
    seedPost({ seoExtJson: JSON.stringify({ canonical: "https://other-domain.example/elsewhere" }) }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.canonical, "https://other-domain.example/elsewhere");
});

test("getEntryMeta: no canonical override falls back to the routing-resolved canonical, never a seo setting", async () => {
  const deps = await makeDeps([seedPost()]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.ok(meta.canonical.endsWith("/hello-world"));
});

// 2026-09-03 absolute-URL fix — reproduced on both production and local via `curl` before this fix:
// every page emitted a RELATIVE `canonical`/`og:url`, and `og:image` is required to be absolute per
// the Open Graph protocol (a relative one breaks every social crawler/link-preview fetcher).
const VERIFIED_ORIGIN: VerifiedOrigin = {
  scheme: "https",
  host: "example.test",
  verifiedAt: "2026-09-03T00:00:00.000Z",
  source: "workspace-setting",
};

test("getEntryMeta: with a verified origin, canonical and og:url are absolute (2026-09-03 fix)", async () => {
  const deps = await makeDeps([seedPost()], VERIFIED_ORIGIN);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.canonical, "https://example.test/hello-world");
  assert.equal(meta.openGraph.url, "https://example.test/hello-world");
});

test("getEntryMeta: the root-slug '/' page's absolute canonical is 'https://host/', never 'https://host//' (2026-09-03 fix)", async () => {
  const deps = await makeDeps([seedPost({ slug: "/" })], VERIFIED_ORIGIN);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.canonical, "https://example.test/");
});

test("getEntryMeta: with NO verified origin registered, canonical degrades to the bare relative path (disclosed fallback, 2026-09-03 fix)", async () => {
  const deps = await makeDeps([seedPost()]); // no origin argument -> fakeOriginRegistry() throws OriginNotVerifiedError
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.canonical, "/hello-world");
  assert.equal(meta.openGraph.url, "/hello-world");
});

test("getEntryMeta: an already-absolute canonical override is never double-prefixed with the verified origin (EC-10 preserved, 2026-09-03 fix)", async () => {
  const deps = await makeDeps(
    [seedPost({ seoExtJson: JSON.stringify({ canonical: "https://other-domain.example/elsewhere" }) })],
    VERIFIED_ORIGIN
  );
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.canonical, "https://other-domain.example/elsewhere");
});

test("getEntryMeta: a media-resolved og:image (the '/m/...' contract) becomes absolute with a verified origin (2026-09-03 fix)", async () => {
  const now = "2026-09-03T00:00:00.000Z";
  const mediaRepo = new InMemoryMediaRepo({}, { initialRows: [
    {
      id: "asset-1",
      workspaceId: WORKSPACE,
      title: "Cover",
      alt: "",
      caption: "",
      credit: "",
      source: { kind: "upload", sha256: "a".repeat(64) } as never,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      version: 1,
      width: null,
      height: null,
      cssClass: null,
    } as never,
  ] });
  const transformDefinitionRepo = new InMemoryTransformDefinitionRepo({}, { initialRows: [
    { id: "transform-1", workspaceId: WORKSPACE, name: "og", version: 1, params: { format: "jpeg" }, createdAt: now } as never,
  ] });
  const assetRenditionRepo = new InMemoryAssetRenditionRepo({}, { initialRows: [
    { id: "rendition-1", workspaceId: WORKSPACE, assetId: "asset-1", transformName: "og", version: 1, storageKey: "k", createdAt: now },
  ] });
  const deps = {
    ...(await makeDeps(
      [seedPost({ seoExtJson: JSON.stringify({ ogImage: "asset-1:og" }) })],
      VERIFIED_ORIGIN
    )),
    media: { mediaRepo, transformDefinitionRepo, assetRenditionRepo },
  };
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.openGraph.image, "https://example.test/m/asset-1/og.v1/image.jpg");
});

test("getEntryMeta: a draft with no explicit noindex override and no site default defaults to noindex:true (EC-11)", async () => {
  const deps = await makeDeps([seedPost({ status: "draft" })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.robots.noindex, true);
});

// 2026-09-05 fix: `softDelete` (post.ts) stamps only `deletedAt`/`updatedAt`/`version` — it never
// clears `status`, so a post that was `published` when trashed stays `status: "published"` forever.
// `postRepo.findById` (this function's own read) is documented trash-BLIND, so the derived-noindex
// fallback below must check `isTrashed` itself rather than trust the stale `status` column — the
// admin SEO panel (`GET .../seo/entries/:entryId`) and the `seo_get_entry_meta`/`seo_analyze_entry`
// agent tools all resolve meta for a bare `entryId` with no trash gate of their own, so a trashed
// entry reaches this exact fallback with its pre-trash `status` still intact. (The live public
// render path is NOT reachable this way: `getPublishedPostBySlug`/`findPublishedPostById` already
// gate trash before a `post` ever reaches `getEntryMeta` there — but this function is documented as
// "the one evaluator, no back door (INV-09)" for every consumer, admin included.)
test("getEntryMeta: a trashed entry with no explicit noindex override defaults to noindex:true, even though status still reads 'published'", async () => {
  const deps = await makeDeps([seedPost({ deletedAt: "2026-09-05T00:00:00.000Z" })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.robots.noindex, true);
});

test("getEntryMeta: a draft with an explicit noindex:false override still wins over the draft-safety default", async () => {
  const deps = await makeDeps([seedPost({ status: "draft", seoExtJson: JSON.stringify({ noindex: false }) })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.robots.noindex, false);
});

test("getEntryMeta: entry override noindex:false beats a workspace default noindex:true (EC-02)", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ noindex: false }) })]);
  await setSeoSettings(deps.settingsDeps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "caller-1",
    patch: { defaultRobots: { noindex: true, nofollow: false } },
  });
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.robots.noindex, false);
});

test("getEntryMeta: a published entry's noindex derives false when nothing else is set", async () => {
  const deps = await makeDeps([seedPost({ status: "published" })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.robots.noindex, false);
});

test("getEntryMeta: openGraph.image is omitted when no override and no site default exist", async () => {
  const deps = await makeDeps([seedPost()]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.openGraph.image, undefined);
});

test("getEntryMeta: openGraph.image resolves from the entry override (absolute URL passthrough)", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ ogImage: "https://cdn.example.com/x.jpg" }) })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.openGraph.image, "https://cdn.example.com/x.jpg");
});

test("getEntryMeta: twitter.site comes only from the site default (no per-entry override field exists)", async () => {
  const deps = await makeDeps([seedPost()]);
  await setSeoSettings(deps.settingsDeps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "caller-1",
    patch: { twitterSite: "@example" },
  });
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.twitter.site, "@example");
});

test("getEntryMeta: jsonLd @type derives from content type — post -> Article, page -> WebPage", async () => {
  const deps = await makeDeps([seedPost({ kind: "post" }), seedPost({ id: "page-1", kind: "page", slug: "about" })]);
  const postMeta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  const pageMeta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "page-1" });
  assert.equal(postMeta.jsonLd[0]!["@type"], "Article");
  assert.equal(pageMeta.jsonLd[0]!["@type"], "WebPage");
});

test("getEntryMeta: schemaType override changes the emitted jsonLd @type", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ schemaType: "NewsArticle" }) })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.jsonLd[0]!["@type"], "NewsArticle");
});

test("getEntryMeta: explicit site default noindex and nofollow apply when no overrides exist", async () => {
  const deps = await makeDeps([seedPost()]);
  await setSeoSettings(deps.settingsDeps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "caller-1",
    patch: { defaultRobots: { noindex: true, nofollow: true } },
  });
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.robots.noindex, true);
  assert.equal(meta.robots.nofollow, true);
});

test("getEntryMeta: nofollow override true wins over site default false", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({ nofollow: true }) })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.robots.nofollow, true);
});

test("getEntryMeta: malformed seoExtJson parses safely into empty overrides", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: "{not-valid-json" })]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.title, "Hello World");
});

test("getEntryMeta: decodes numeric hex and decimal html entities, and preserves unknown entities", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      bodyFormat: "html",
      bodyHtml: "<p>It&#39;s &#x22;great&#x22; &lt;rock&gt; &amp; &unknown;</p>",
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, `It's "great" <rock> & &unknown;`);
});

test("getEntryMeta: decodes typographic named entities (live /media + /forms regression: `&mdash;` surfaced as a literal)", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      bodyFormat: "html",
      bodyHtml: "<p>Upload &mdash; JPEG &ndash; &ldquo;once&rdquo; &lsquo;x&rsquo; &hellip; &copy; &trade;</p>",
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "Upload — JPEG – “once” ‘x’ … © ™");
});

test("getEntryMeta: a nested element inside `post-detail-header` does not end the stripped block early", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      bodyFormat: "html",
      bodyHtml:
        '<div class="post-detail-header"><div class="post-meta"><time>Sep 3, 2026</time></div><h1>Media</h1></div>' +
        '<div class="post-detail-body"><p>Media is where…</p></div>',
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "Media is where…");
});

test("getEntryMeta: the production `renderPostDetailHeader` shape (nested `.post-meta` div) is stripped whole", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      bodyFormat: "html",
      bodyHtml:
        '<div class="post-detail-header"><h1>What Is Tovu?</h1><div class="post-meta"><time datetime="2026-09-04T02:04:06.038Z">Sep 3, 2026</time></div></div>' +
        '<div class="post-detail-body"><p>Tovu is a content platform.</p></div>',
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.description, "Tovu is a content platform.");
});

test("getEntryMeta: all openGraph and twitter field overrides are respected", async () => {
  const deps = await makeDeps([
    seedPost({
      kind: "page",
      seoExtJson: JSON.stringify({
        ogTitle: "Custom OG Title",
        ogDescription: "Custom OG Desc",
        ogType: "profile",
        twitterTitle: "Custom Twitter Title",
        twitterDescription: "Custom Twitter Desc",
        twitterCard: "summary",
        twitterImage: "https://cdn.example.com/tw.png",
      }),
    }),
  ]);
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.openGraph.title, "Custom OG Title");
  assert.equal(meta.openGraph.description, "Custom OG Desc");
  assert.equal(meta.openGraph.type, "profile");
  assert.equal(meta.twitter.title, "Custom Twitter Title");
  assert.equal(meta.twitter.description, "Custom Twitter Desc");
  assert.equal(meta.twitter.card, "summary");
  assert.equal(meta.twitter.image, "https://cdn.example.com/tw.png");
  assert.equal(meta.jsonLd[0]!["name"], "Hello World");
});



test("getEntryMeta: an explicitly empty title override remains visible to SEO analysis", async () => {
  const deps = await makeDeps([seedPost()]);
  await setEntrySeoOverrides({ deps: { postRepo: deps.postRepo, authorize: alwaysAllow,
    invalidateSitemapCache: () => {}, clock }, input: {
    workspaceId: WORKSPACE, entryId: "post-1", callerPrincipalId: "caller-1", patch: { title: "" },
  } });
  const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.title, "");
  const analysis = await analyzeEntry(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.ok(analysis.issues.some((issue) => issue.code === "missing_title" && issue.field === "title"));
});

for (const kind of ["post", "page"] as const) {
  for (const withSiteImage of [false, true]) {
    test(`getEntryMeta: ${kind} social defaults with site image ${withSiteImage}`, async () => {
      const deps = await makeDeps([seedPost({ kind })]);
      if (withSiteImage) await setSeoSettings(deps.settingsDeps, {
        workspaceId: WORKSPACE, callerPrincipalId: "caller-1",
        patch: { defaultOgImage: "https://cdn.example/site-default.jpg", twitterSite: "@defaultsite" },
      });
      const meta = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
      assert.deepEqual(meta.openGraph, {
        title: "Hello World", description: "An excerpt body.", type: kind === "page" ? "website" : "article",
        url: "/hello-world", image: withSiteImage ? "https://cdn.example/site-default.jpg" : undefined, siteName: undefined,
      });
      assert.deepEqual(meta.twitter, {
        card: "summary_large_image", title: "Hello World", description: "An excerpt body.",
        image: withSiteImage ? "https://cdn.example/site-default.jpg" : undefined, site: withSiteImage ? "@defaultsite" : undefined,
      });
      if (withSiteImage) {
        await setEntrySeoOverrides({ deps: { postRepo: deps.postRepo, authorize: alwaysAllow,
          invalidateSitemapCache: () => {}, clock }, input: {
          workspaceId: WORKSPACE, entryId: "post-1", callerPrincipalId: "caller-1",
          patch: { ogImage: "https://cdn.example/entry-og.jpg", twitterImage: "https://cdn.example/entry-twitter.jpg" },
        } });
        const overridden = await getEntryMeta(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
        assert.equal(overridden.openGraph.image, "https://cdn.example/entry-og.jpg");
        assert.equal(overridden.twitter.image, "https://cdn.example/entry-twitter.jpg");
      }
    });
  }
}

// wm S10: settings writes clear a populated cache, not merely an empty one.
test("SEO default robots writes invalidate the populated sitemap", async () => {
  const { buildSitemap, invalidateSitemapCache } = await import("./support/legacy-api.fixture.js");
  const deps = await makeDeps([seedPost()]);
  invalidateSitemapCache({ workspaceId: WORKSPACE });
  assert.equal((await buildSitemap(deps, { workspaceId: WORKSPACE })).length, 1);
  await setSeoSettings({ ...deps.settingsDeps, invalidateSitemap: invalidateSitemapCache }, {
    workspaceId: WORKSPACE, callerPrincipalId: "system-seo", patch: { defaultRobots: { noindex: true, nofollow: false } },
  });
  assert.deepEqual(await buildSitemap(deps, { workspaceId: WORKSPACE }), []);
});

test("daemon invalidation stays pending until the serving bus drains it", async () => {
  const { createSeoEventSubscriptions, buildSitemap, invalidateSitemapCache } = await import("./support/legacy-api.fixture.js");
  const { requestSitemapInvalidation, SITEMAP_INVALIDATED_EVENT } = await import("../sitemap.js");
  const { InMemoryOutbox, InMemoryEventBus } = await import("../../redirects/__tests__/support/events.fixture.js");
  // CAPABILITIES.md's publication warning predates infra's events/outbox export.
  // Resolve that owner's source at runtime (as the package-boundary guard does) so the CMS
  // compiler stays inside src and the real delivery assertions never depend on stale dist output.
  const workerPath = fileURLToPath(new URL("../../../../infra/src/events/outbox/index.ts", import.meta.url));
  const { processOutbox, toEnqueueOnlyOutbox, createNodeOutboxScheduler, DEFAULT_OUTBOX_CLAIM_LEASE_MS } = await import(workerPath);
  const deps = await makeDeps([seedPost()]);
  const outbox = new InMemoryOutbox(), servingBus = new InMemoryEventBus();
  // Adapt envelope argument shapes only; infra retains all claim, retry and delivery ownership.
  const workerOutbox = ({ outbox }: { outbox: OutboxPort }, _optional: Record<string, never> = {}) => ({
    enqueue: ({ event }: { event: DomainEvent }) => outbox.enqueue(event),
    claimPending: (input: Parameters<OutboxPort["claimPending"]>[0]) => outbox.claimPending(input),
    markDelivered: (input: Parameters<OutboxPort["markDelivered"]>[0]) => outbox.markDelivered(input),
    markFailed: (input: Parameters<OutboxPort["markFailed"]>[0]) => outbox.markFailed(input),
  });
  const enqueueOnly = toEnqueueOnlyOutbox({ outbox: workerOutbox({ outbox }) });
  const daemonOutbox: OutboxPort = {
    enqueue: event => enqueueOnly.enqueue({ event }),
    claimPending: input => enqueueOnly.claimPending({ ...input, claimLeaseMs: DEFAULT_OUTBOX_CLAIM_LEASE_MS }),
    markDelivered: input => enqueueOnly.markDelivered(input),
    markFailed: input => enqueueOnly.markFailed(input),
  };
  const dispatch: SitemapInvalidationDeps["dispatch"] = ({ outbox, bus, clock }) => processOutbox({
    outbox: workerOutbox({ outbox }), bus: { publish: ({ event }: { event: DomainEvent }) => bus.publish(event) },
    clock, scheduler: createNodeOutboxScheduler({}, {}), random: () => 0,
    logger: { error: () => assert.fail("unexpected outbox delivery failure") },
  });
  const subscription = createSeoEventSubscriptions(deps);
  await servingBus.subscribe({ eventName: SITEMAP_INVALIDATED_EVENT, handler: subscription.onSitemapInvalidated });
  await requestSitemapInvalidation({ deps: { outbox: daemonOutbox, bus: new InMemoryEventBus(),
    clock, idGen: ids, dispatch, invalidateSitemapCache }, input: { workspaceId: WORKSPACE } });
  // Refill the web cache independently before the deferred delivery, simulating a second process.
  invalidateSitemapCache({ workspaceId: WORKSPACE });
  assert.equal((await buildSitemap(deps, { workspaceId: WORKSPACE })).length, 1);
  await setSeoSettings(deps.settingsDeps, { workspaceId: WORKSPACE, callerPrincipalId: "system-seo", patch: { defaultRobots: { noindex: true, nofollow: false } } });
  assert.equal((await buildSitemap(deps, { workspaceId: WORKSPACE })).length, 1);
  assert.equal(await dispatch({ outbox, bus: servingBus, clock }), 1);
  assert.deepEqual(await buildSitemap(deps, { workspaceId: WORKSPACE }), []);
  assert.equal(await dispatch({ outbox, bus: servingBus, clock }), 0);
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
