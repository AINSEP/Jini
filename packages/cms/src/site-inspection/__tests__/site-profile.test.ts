import assert from "node:assert/strict";
import { test } from "vitest";

import { buildSiteProfile, type SiteProfileDeps, type SiteProfileThemeRow } from "../site-profile.js";

const PRINCIPAL_ID = "principal-under-test";
const NO_THEME = "host-no-theme";

function themeRow(id: string): SiteProfileThemeRow {
  return { manifest: { id, name: id, version: "1.0.0", tier: "static" }, source: "site", status: "ok", errors: [] };
}

/** The host's alias rule, as the host injects it: `old-name` was renamed to `new-name`. */
function hostCandidates({ id }: { id: string }): string[] {
  return id === "old-name" || id === "new-name" ? ["new-name", "old-name"] : [id];
}

function makeDeps(overrides: Partial<SiteProfileDeps> = {}): SiteProfileDeps {
  return {
    workspaceId: "ws-site-profile",
    authorize: async () => ({ allowed: true, reason: "matched" }),
    clock: { nowIso: () => "2026-11-23T00:00:00.000Z" },
    listPosts: async () => [],
    listThemes: async () => [themeRow("old-name"), themeRow("new-name")],
    readActiveThemeId: async () => "old-name",
    listPlugins: async () => [],
    listPluginActivations: async () => [],
    readSetting: async () => null,
    listContentTypes: async () => [],
    noThemeId: NO_THEME,
    themeIdCandidates: hostCandidates,
    reportSectionFailure: () => {},
    ...overrides,
  };
}

test("theme section resolves the stored id through the host's injected alias candidates", async () => {
  const profile = await buildSiteProfile({ deps: makeDeps(), input: { principalId: PRINCIPAL_ID } }, { sections: ["theme"] });
  const theme = profile.sections.theme;
  assert.equal(theme?.status, "ok");
  assert.equal(theme?.data?.activeThemeId, "old-name");
  assert.equal(theme?.data?.active?.id, "new-name", "the current name wins when both are installed");
  assert.equal(theme?.data?.themeDisabled, false);
});

test("theme section reports themeDisabled only for the host's injected no-theme id", async () => {
  const off = await buildSiteProfile(
    { deps: makeDeps({ readActiveThemeId: async () => NO_THEME }), input: { principalId: PRINCIPAL_ID } },
    { sections: ["theme"] },
  );
  assert.deepEqual([off.sections.theme?.data?.themeDisabled, off.sections.theme?.data?.active], [true, null]);

  const missing = await buildSiteProfile(
    { deps: makeDeps({ readActiveThemeId: async () => "deleted-theme" }), input: { principalId: PRINCIPAL_ID } },
    { sections: ["theme"] },
  );
  assert.deepEqual([missing.sections.theme?.data?.themeDisabled, missing.sections.theme?.data?.active], [false, null]);
});

test("a failing section is reported to the injected reporter with the profile label", async () => {
  const reported: { label: string; section: string; error: unknown }[] = [];
  const error = new TypeError("SECRET_THEME_READ");
  const profile = await buildSiteProfile(
    {
      deps: makeDeps({ listThemes: async () => { throw error; }, reportSectionFailure: (failure) => { reported.push(failure); } }),
      input: { principalId: PRINCIPAL_ID },
    },
    { sections: ["theme"] },
  );
  assert.deepEqual(profile.sections.theme, { status: "unavailable", reason: "TypeError" });
  assert.deepEqual(reported, [{ label: "site-profile", section: "theme", error }]);
  assert.equal(profile.completeness, "partial");
});

test("pages counts all living content while returning only a body-free sample", async () => {
  const current = { id: "page-1", title: "About", slug: "about", kind: "page", status: "published", bodyFormat: "html", updatedAt: "2026-11-10T00:00:00.000Z" };
  const deps = makeDeps({ listPosts: async () => [
    { ...current, id: "trashed", deletedAt: "2026-11-20T00:00:00.000Z" },
    { ...current, bodyHtml: "<p>Unrequested body</p>" },
    { ...current, id: "post-1", kind: "post", status: "draft", deletedAt: null },
    { ...current, id: "page-2" },
  ] });
  const found = await buildSiteProfile({ deps, input: { principalId: PRINCIPAL_ID } }, { sections: ["pages"], pageLimit: 1 });
  assert.deepEqual(found.sections.pages, {
    status: "ok", truncated: true,
    data: { total: 3, countsByKind: { page: 2, post: 1 }, countsByStatus: { published: 2, draft: 1 }, items: [current] },
  });
});

test("page limits fall back on invalid values, clamp at the public ceiling and omit truncation when all fit", async () => {
  const deps = makeDeps({ listPosts: async () => Array.from({ length: 201 }, (_, i) => ({
    id: `post-${i}`, title: "Post", slug: `post-${i}`, kind: "post", status: "draft", bodyFormat: "doc", updatedAt: "now",
  })) });
  for (const [pageLimit, expected] of [[-1, 50], [1.5, 50], [500, 200]] as const) {
    const found = await buildSiteProfile({ deps, input: { principalId: PRINCIPAL_ID } }, { sections: ["pages"], pageLimit });
    assert.equal(found.sections.pages?.data?.items.length, expected);
    assert.equal(found.sections.pages?.data?.items.at(-1)?.id, `post-${expected - 1}`);
    assert.equal(found.sections.pages?.truncated, true);
  }
  const empty = await buildSiteProfile({ deps: makeDeps(), input: { principalId: PRINCIPAL_ID } }, { sections: ["pages"] });
  assert.deepEqual(empty.sections.pages, { status: "ok", data: { total: 0, countsByKind: {}, countsByStatus: {}, items: [] } });
});

test("operators see only this workspace's plugin activations and counts for non-tombstoned content types", async () => {
  const local = { id: "local", name: "Local", version: "4", source: "site", tier: "builtin", status: "ok" };
  const foreign = { id: "foreign", name: "Foreign", version: "2", source: "host", status: "ready" };
  const entry = { key: "article", label: "Article", status: "active", version: 3 };
  const deps = makeDeps({
    listPlugins: async () => [local, foreign],
    listPluginActivations: async () => [
      { pluginId: "local", workspaceId: "ws-site-profile", enabled: true },
      { pluginId: "local", workspaceId: "other", enabled: false },
      { pluginId: "foreign", workspaceId: "other", enabled: true },
    ],
    listContentTypes: async () => [
      { ...entry, fields: [{ key: "headline" }, { key: "story" }], tombstonedAt: null },
      { ...entry, key: "retired", fields: [], tombstonedAt: "2026-11-22T00:00:00.000Z" },
    ],
    readActiveThemeId: async () => null,
  });
  const found = await buildSiteProfile({ deps, input: { principalId: PRINCIPAL_ID } });
  assert.deepEqual(found.sections.plugins, { status: "ok", data: [{ ...local, enabled: true }, { ...foreign, tier: null, enabled: false }] });
  assert.deepEqual(found.sections.contentTypes, { status: "ok", data: [{ ...entry, fieldCount: 2 }] });
  assert.deepEqual([found.sections.theme?.data?.activeThemeId, found.sections.theme?.data?.active, found.sections.theme?.data?.themeDisabled], [null, null, false]);
});

test("settings disclose only inventory keys and drop values strictly past the serialized cap", async () => {
  const reads: string[] = [];
  const allowed = ["title_template", "default_description", "default_og_image", "twitter_site", "default_robots_noindex", "default_robots_nofollow", "sitemap_enabled", "robots_rules"];
  const deps = makeDeps({ readSetting: async ({ namespace, key }) => {
    reads.push(`${namespace}:${key}`);
    if (key === "default_description") return "a".repeat(1998);
    if (key === "twitter_site") return "b".repeat(1999);
    if (key === "sitemap_enabled") return false;
    return null;
  } });
  const found = await buildSiteProfile({ deps, input: { principalId: PRINCIPAL_ID } }, { sections: ["settings"] });
  assert.deepEqual(reads, allowed.map(key => `site.seo:${key}`));
  assert.equal(found.sections.settings?.truncated, true);
  assert.deepEqual(found.sections.settings?.data, allowed.map(key => ({
    namespace: "site.seo", key,
    configured: ["default_description", "twitter_site", "sitemap_enabled"].includes(key),
    value: key === "default_description" ? "a".repeat(1998) : key === "sitemap_enabled" ? false : null,
    ...(key === "twitter_site" ? { truncated: true } : {}),
  })));
});
