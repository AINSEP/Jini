import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { InMemoryPostRepo } from "./support/post.fixture.js";
import { InMemorySettingsRepo } from "./support/legacy-api.fixture.js";
import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError, type OriginRegistryPort, type VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { ensureSeoSettingDefinitions, setSeoSettings } from "./support/legacy-api.fixture.js";
import { buildRobots, invalidateSitemapCache } from "./support/legacy-api.fixture.js";

/**
 * @file T034 — failing-first unit certification of `buildRobots` (REQ-09,
 * AC-19/20/21, EC-09): `sitemapEnabled:true` -> `Sitemap:` (sitemapUrls
 * non-empty); `false` -> `sitemapUrls: []`. Plus the 2026-09-04 absolute-URL
 * fix: the advertised `Sitemap:` URL is joined onto the workspace's verified
 * origin the same way `getEntryMeta`'s `canonical`/`og:url` already are
 * (`seo.test.ts`'s identical fixture shape), degrading to the bare relative
 * path when no origin is verified yet (disclosed fallback, unchanged from
 * before this fix).
 */

const WORKSPACE = "workspace-robots-1";
const clock = { nowIso: () => "2026-07-13T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `robots-test-id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

/** Fake `OriginRegistryPort` — mirrors `seo.test.ts`'s own copy. `origin: undefined` (the default)
 *  means "no verified origin registered yet", which `resolveWorkspaceOrigin` degrades to
 *  `undefined`, keeping the pre-fix relative-path assertions below unchanged. */
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

const VERIFIED_ORIGIN: VerifiedOrigin = {
  scheme: "https",
  host: "example.test",
  verifiedAt: "2026-09-04T00:00:00.000Z",
  source: "workspace-setting",
};

async function makeDeps(origin?: VerifiedOrigin) {
  invalidateSitemapCache({ workspaceId: WORKSPACE });
  const postRepo = new InMemoryPostRepo([]);
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

test("buildRobots: sitemapEnabled:true advertises a non-empty sitemapUrls", async () => {
  const deps = await makeDeps();
  const policy = await buildRobots(deps, { workspaceId: WORKSPACE });
  assert.ok(policy.sitemapUrls.length > 0);
});

test("buildRobots: sitemapEnabled:false yields an empty sitemapUrls", async () => {
  const deps = await makeDeps();
  await setSeoSettings(deps.settingsDeps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "caller-1",
    patch: { sitemapEnabled: false },
  });

  const policy = await buildRobots(deps, { workspaceId: WORKSPACE });
  assert.deepEqual(policy.sitemapUrls, []);
});

test("buildRobots: carries the configured robotsRules through as-is", async () => {
  const deps = await makeDeps();
  await setSeoSettings(deps.settingsDeps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "caller-1",
    patch: { robotsRules: [{ userAgent: "*", disallow: ["/admin"] }] },
  });

  const policy = await buildRobots(deps, { workspaceId: WORKSPACE });
  assert.deepEqual(policy.rules, [{ userAgent: "*", disallow: ["/admin"] }]);
});

test("buildRobots: with a verified origin, the advertised Sitemap URL is absolute (2026-09-04 fix)", async () => {
  const deps = await makeDeps(VERIFIED_ORIGIN);
  const policy = await buildRobots(deps, { workspaceId: WORKSPACE });
  assert.deepEqual(policy.sitemapUrls, ["https://example.test/sitemap.xml"]);
});

test("buildRobots: with NO verified origin registered, the Sitemap URL degrades to the bare relative path (disclosed fallback, 2026-09-04 fix)", async () => {
  const deps = await makeDeps(); // no origin argument -> fakeOriginRegistry() throws OriginNotVerifiedError
  const policy = await buildRobots(deps, { workspaceId: WORKSPACE });
  assert.deepEqual(policy.sitemapUrls, ["/sitemap.xml"]);
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
