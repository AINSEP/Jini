import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { InMemoryPostRepo, type PostRecord } from "./support/post.fixture.js";
import { InMemorySettingsRepo } from "./support/legacy-api.fixture.js";
import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError, type OriginRegistryPort } from "@jini-ai/http-kit/verified-origin";
import { ensureSeoSettingDefinitions } from "./support/legacy-api.fixture.js";
import { analyzeEntry } from "./support/legacy-api.fixture.js";
import { buildPostRecord } from "./support/post.fixture.js";

/**
 * @file T025 — failing-first unit certification of `analyzeEntry`
 * (REQ-14, AC-28): missing title/description -> issue present; nothing
 * missing -> `score: 100, issues: []`.
 */

const WORKSPACE = "workspace-1";
const clock = { nowIso: () => "2026-07-13T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `seo-analyze-id-${++idCounter}` };
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

/** No verified origin registered — mirrors `seo.test.ts`'s own copy; see that file for the
 *  absolute-URL join coverage itself. */
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
    media: {
      mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
      assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
    },
    originRegistry: fakeOriginRegistry(),
  };
}

test("analyzeEntry: nothing missing -> score 100, issues []", async () => {
  const deps = await makeDeps([seedPost()]);
  const analysis = await analyzeEntry(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(analysis.score, 100);
  assert.deepEqual(analysis.issues, []);
});

test("analyzeEntry: a missing description produces an issue", async () => {
  const deps = await makeDeps([seedPost({ bodyJson: { type: "doc", content: [] } })]);
  const analysis = await analyzeEntry(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.deepEqual(analysis.issues, [{ code: "missing_description", severity: "warning", message: "Description is missing.", field: "description" }]);
  assert.equal(analysis.score, 80);
});

test("analyzeEntry: a missing title produces an issue and lowers score", async () => {
  const deps = await makeDeps([
    seedPost({
      bodyJson: { type: "doc", content: [] },
      seoExtJson: JSON.stringify({ title: "" }),
    }),
  ]);
  const analysis = await analyzeEntry(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.ok(analysis.issues.some((issue) => issue.field === "title" && issue.code === "missing_title"));
  assert.equal(analysis.score, 60);
});

test("analyzeEntry: carries the fully-resolved SeoMeta in `resolved`", async () => {
  const deps = await makeDeps([seedPost({ seoExtJson: JSON.stringify({
    title: "Search title", description: "Search description", canonical: "https://canonical.test/article",
    noindex: true, nofollow: true, schemaType: "NewsArticle", ogType: "website",
    ogTitle: "Social title", ogDescription: "Social description", ogImage: "https://cdn.test/social.png",
    twitterTitle: "Twitter title", twitterDescription: "Twitter description", twitterCard: "summary", twitterImage: "https://cdn.test/twitter.jpg",
  }) })]);
  const analysis = await analyzeEntry(deps, { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.deepEqual(analysis.resolved, {
    title: "Search title", description: "Search description", canonical: "https://canonical.test/article",
    robots: { noindex: true, nofollow: true },
    openGraph: { title: "Social title", description: "Social description", type: "website", url: "https://canonical.test/article", image: "https://cdn.test/social.png", siteName: undefined },
    twitter: { title: "Twitter title", description: "Twitter description", card: "summary", image: "https://cdn.test/twitter.jpg", site: undefined },
    jsonLd: [{ "@context": "https://schema.org", "@type": "NewsArticle", headline: "Search title", description: "Search description" }],
  });
  assert.equal(analysis.entryId, "post-1");
});


afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
