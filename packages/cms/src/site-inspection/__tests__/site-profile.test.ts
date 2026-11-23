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
