import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";
import { InMemoryPostRepo, type PostRecord } from "./support/post.fixture.js";
import { InMemorySettingsRepo } from "./support/legacy-api.fixture.js";
import { InMemoryMediaRepo, InMemoryAssetRenditionRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError, type OriginRegistryPort, type VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { ensureSeoSettingDefinitions } from "./support/legacy-api.fixture.js";
import { buildFeed, renderRssXml } from "./support/legacy-api.fixture.js";

function post(overrides: Partial<PostRecord> = {}): PostRecord {
  return { id: "live", workspaceId: "feed-ws", title: "Live", slug: "live", kind: "post", status: "published", version: 1,
    bodyFormat: "doc", bodyHtml: null, bodyJson: { type: "doc", content: [] }, updatedAt: "2026-10-01T12:00:00.000Z", ...overrides };
}
async function deps(posts: PostRecord[], origin?: VerifiedOrigin) {
  const settingsRepo = new InMemorySettingsRepo();
  let seq = 0;
  await ensureSeoSettingDefinitions({ settingsRepo, clock: { nowIso: () => "2026-10-01T12:00:00.000Z" },
    ids: { newId: () => `setting-${++seq}` }, principals: { findById: async () => null } as never },
    { workspaceId: "feed-ws", systemPrincipalId: "system" });
  const originRegistry: OriginRegistryPort = {
    canonicalOrigin: async ({ workspaceId }) => {
      assert.equal(workspaceId, "feed-ws");
      if (!origin) throw new OriginNotVerifiedError({ message: "unverified" });
      return origin;
    },
    isAllowedRedirectTarget: async () => false, isAllowedEgressTarget: async () => false,
  };
  return { postRepo: new InMemoryPostRepo(posts), settingsRepo, originRegistry, media: {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }), assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }), transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
  } };
}

test("feed excludes effective-noindex posts and retains an empty-body post without inventing a description", async () => {
  const d = await deps([post(), post({ id: "hidden", slug: "hidden", title: "Hidden", seoExtJson: '{"noindex":true}' })]);
  assert.deepEqual(await buildFeed(d, { workspaceId: "feed-ws", siteTitle: "Independent title" }), {
    siteTitle: "Independent title", siteLink: "/", feedUrl: "/feed.xml", items: [
      { title: "Live", link: "/live", publishedAt: "2026-10-01T12:00:00.000Z", description: undefined },
    ],
  });
});

for (const mode of ["production", "local"] as const) {
  test(`feed treats a development origin explicitly in ${mode} mode`, async () => {
    const prior = process.env.TOVU_RUNTIME_MODE;
    process.env.TOVU_RUNTIME_MODE = mode;
    try {
      const d = await deps([post()], { scheme: "http", host: "localhost", port: 3000, verifiedAt: "2026-10-01T12:00:00.000Z", source: "dev-capability" });
      const prefix = mode === "production" ? "" : "http://localhost:3000";
      const feed = await buildFeed(d, { workspaceId: "feed-ws", siteTitle: "My site" });
      assert.equal(feed.siteLink, `${prefix}/`);
      assert.equal(feed.feedUrl, `${prefix}/feed.xml`);
      assert.deepEqual(feed.items.map((item) => item.link), [`${prefix}/live`]);
    } finally {
      if (prior === undefined) delete process.env.TOVU_RUNTIME_MODE;
      else process.env.TOVU_RUNTIME_MODE = prior;
    }
  });
}

test("RSS escapes channel and item values, omits absent descriptions, and emits an exact UTC date", () => {
  assert.equal(renderRssXml({ siteTitle: 'A & <B> "C"', siteLink: "https://example.test/?a=1&b=2", feedUrl: "https://example.test/feed.xml?a=1&b=2", items: [
    { title: "First <item>", link: "https://example.test/first?a=1&b=2", publishedAt: "2026-10-01T12:00:00.000Z", description: "Text & more" },
    { title: "Empty", link: "https://example.test/empty", publishedAt: "2026-09-30T12:00:00.000Z", description: undefined },
  ] }), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>A &amp; &lt;B&gt; &quot;C&quot;</title>
    <link>https://example.test/?a=1&amp;b=2</link>
    <description>A &amp; &lt;B&gt; &quot;C&quot;</description>
    <atom:link href="https://example.test/feed.xml?a=1&amp;b=2" rel="self" type="application/rss+xml"/>
    <item>
      <title>First &lt;item&gt;</title>
      <link>https://example.test/first?a=1&amp;b=2</link>
      <guid isPermaLink="true">https://example.test/first?a=1&amp;b=2</guid>
      <pubDate>Thu, 01 Oct 2026 12:00:00 GMT</pubDate>
      <description>Text &amp; more</description>
    </item>
    <item>
      <title>Empty</title>
      <link>https://example.test/empty</link>
      <guid isPermaLink="true">https://example.test/empty</guid>
      <pubDate>Wed, 30 Sep 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
`);
});

test("a real origin-registry failure propagates instead of silently producing relative links", async (t) => {
  const d = await deps([]);
  const error = new Error("origin database unavailable");
  vi.spyOn(d.originRegistry, "canonicalOrigin").mockImplementation( async () => { throw error; });
  await assert.rejects(buildFeed(d, { workspaceId: "feed-ws", siteTitle: "My site" }), (caught) => caught === error);
});

test("an item's pubDate is the post's go-live time (publishAt), not updatedAt — owner decision 2026-10-05", async () => {
  const d = await deps([post({ publishAt: "2026-09-15T08:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z" })]);
  const xml = renderRssXml(await buildFeed(d, { workspaceId: "feed-ws", siteTitle: "My site" }));
  assert.match(xml, /<pubDate>Tue, 15 Sep 2026 08:00:00 GMT<\/pubDate>/);
  assert.doesNotMatch(xml, /01 Oct 2026/);
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
