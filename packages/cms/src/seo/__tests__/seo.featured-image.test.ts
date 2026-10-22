import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { InMemoryPostRepo, type PostRecord } from "./support/post.fixture.js";
import { InMemorySettingsRepo } from "./support/legacy-api.fixture.js";
import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError, type OriginRegistryPort, type VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { ensureSeoSettingDefinitions, setSeoSettings } from "./support/legacy-api.fixture.js";
import { getEntryMeta } from "./support/legacy-api.fixture.js";
import { buildPostRecord } from "./support/post.fixture.js";

/**
 * @file A post's featured image as its share image (2026-10-05). Precedence for og:image and
 * twitter:image: the entry's explicit override, then its featured image (through the core "public"
 * transform), then the site default.
 */

const WORKSPACE = "workspace-1";
const ASSET_ID = "asset-featured";
const NOW = "2026-10-05T00:00:00.000Z";
const VERIFIED_ORIGIN: VerifiedOrigin = { scheme: "https", host: "example.test", verifiedAt: NOW, source: "workspace-setting" };
const clock = { nowIso: () => NOW, nowMs: () => Date.parse(NOW) };
let idCounter = 0;
const ids = { newId: () => `seo-featured-id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function seedPost(overrides: Partial<PostRecord> = {}): PostRecord {
  return buildPostRecord({
    id: "post-1",
    workspaceId: WORKSPACE,
    title: "Hello World",
    slug: "hello-world",
    bodyJson: { type: "doc", content: [] },
    status: "published",
    kind: "post",
    updatedAt: NOW,
    version: 1,
    seoExtJson: null,
    featuredMediaId: ASSET_ID,
    ...overrides,
  });
}

function originRegistry(origin?: VerifiedOrigin): OriginRegistryPort {
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

function media(assetStatus: "ready" | "trashed" = "ready") {
  return {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [
      {
        id: ASSET_ID, workspaceId: WORKSPACE, title: "Cover", alt: "", caption: "", credit: "",
        source: { kind: "upload", sha256: "a".repeat(64) } as never,
        status: assetStatus, createdAt: NOW, updatedAt: NOW, version: 1, width: null, height: null, cssClass: null,
      } as never,
    ] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [
      { id: "transform-public", workspaceId: WORKSPACE, name: "public", version: 2, params: { format: "jpeg" }, createdAt: NOW } as never,
    ] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [
      { id: "rendition-1", workspaceId: WORKSPACE, assetId: ASSET_ID, transformName: "public", version: 2, storageKey: "k", createdAt: NOW },
    ] }),
  };
}

async function makeDeps(posts: PostRecord[], options: { assetStatus?: "ready" | "trashed"; siteDefault?: string } = {}) {
  const settingsRepo = new InMemorySettingsRepo();
  const settingsDeps = { settingsRepo, clock, ids, authorize: alwaysAllow, principals: { findById: async () => null } as never };
  await ensureSeoSettingDefinitions(settingsDeps, { workspaceId: WORKSPACE, systemPrincipalId: "system-seo" });
  if (options.siteDefault) {
    await setSeoSettings(settingsDeps, { workspaceId: WORKSPACE, callerPrincipalId: "caller-1", patch: { defaultOgImage: options.siteDefault } });
  }
  return { postRepo: new InMemoryPostRepo(posts), settingsRepo, media: media(options.assetStatus), originRegistry: originRegistry(VERIFIED_ORIGIN) };
}

const FEATURED_URL = `https://example.test/m/${ASSET_ID}/public.v2/image.jpg`;
const SITE_DEFAULT = "https://cdn.example/site-default.jpg";

test("getEntryMeta: with no override, og:image and twitter:image fall back to the featured image", async () => {
  const meta = await getEntryMeta(await makeDeps([seedPost()]), { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.openGraph.image, FEATURED_URL);
  assert.equal(meta.twitter.image, FEATURED_URL);
});

test("getEntryMeta: the featured image beats the site default", async () => {
  const meta = await getEntryMeta(await makeDeps([seedPost()], { siteDefault: SITE_DEFAULT }), { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.openGraph.image, FEATURED_URL);
});

test("getEntryMeta: an explicit per-entry override beats the featured image", async () => {
  const row = seedPost({ seoExtJson: JSON.stringify({ ogImage: "https://cdn.example/og.jpg", twitterImage: "https://cdn.example/tw.jpg" }) });
  const meta = await getEntryMeta(await makeDeps([row]), { workspaceId: WORKSPACE, entryId: "post-1" });
  assert.equal(meta.openGraph.image, "https://cdn.example/og.jpg");
  assert.equal(meta.twitter.image, "https://cdn.example/tw.jpg");
});

test("getEntryMeta: without a featured image the site default still applies", async () => {
  const meta = await getEntryMeta(await makeDeps([seedPost({ featuredMediaId: undefined })], { siteDefault: SITE_DEFAULT }), {
    workspaceId: WORKSPACE,
    entryId: "post-1",
  });
  assert.equal(meta.openGraph.image, SITE_DEFAULT);
});

test("getEntryMeta: a trashed featured image falls through to the site default instead of leaving no share image", async () => {
  const meta = await getEntryMeta(await makeDeps([seedPost()], { assetStatus: "trashed", siteDefault: SITE_DEFAULT }), {
    workspaceId: WORKSPACE,
    entryId: "post-1",
  });
  assert.equal(meta.openGraph.image, SITE_DEFAULT);
  assert.equal(meta.twitter.image, SITE_DEFAULT);
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
