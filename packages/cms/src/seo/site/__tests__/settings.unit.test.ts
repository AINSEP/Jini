import assert from "node:assert/strict";
import { test } from "vitest";

import type { PrincipalRepoPort } from "@jini-ai/core/contracts/site/user-management";
import { ensureSettingDefinitions, getEffective, InMemorySettingsRepo, set, type AuthorizeFn } from "@jini-ai/core/settings";

import { SeoSettingsValidationError } from "../../errors.js";
import type { SeoFeaturedImagePort } from "../../ports.js";
import {
  ensureSeoSettingDefinitions,
  getSeoSettings,
  isDefaultRobotsNoindexExplicitlySet,
  setSeoSettings,
  type SeoSettingsWriteDeps,
} from "../settings.js";

/**
 * @file Characterization of the `site.seo.*` settings mapping, written when the module moved from the
 * host: the registered defaults read back as `SeoSettings`, a patch decomposes into chokepoint writes
 * through the injected `set` (with the `admin.seo.manage` override), a refused patch writes nothing,
 * and every ledger collaborator (registrar, reader, write, principal-lookup binder) is the injected one.
 * The host's SQLite-backed settings tests run the same functions against its real ledger.
 */

const WORKSPACE = "ws-seo";
const clock = { nowIso: () => "2026-11-23T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `seo-id-${++idCounter}` };
const allowAll: AuthorizeFn = async () => ({ allowed: true, reason: "test" });
const principalRepo = {} as PrincipalRepoPort;
const featuredImage = new Proxy({}, { get: () => { throw new Error("no image lookup expected"); } }) as SeoFeaturedImagePort;

interface Recorded { lookupRepos: unknown[]; registrations: string[]; reads: string[]; writes: Array<{ key: string; value: unknown; requiredPermissionOverride: unknown }>; invalidations: string[] }

async function makeDeps(): Promise<{ deps: SeoSettingsWriteDeps; recorded: Recorded }> {
  const recorded: Recorded = { lookupRepos: [], registrations: [], reads: [], writes: [], invalidations: [] };
  const deps: SeoSettingsWriteDeps = {
    settingsRepo: new InMemorySettingsRepo(),
    clock,
    ids,
    authorize: allowAll,
    principals: principalRepo,
    media: { featuredImage },
    invalidateSitemap: ({ workspaceId }) => { recorded.invalidations.push(workspaceId); },
    createPrincipalLookup: ({ repo }) => {
      recorded.lookupRepos.push(repo);
      return { findActiveById: async ({ id }) => ({ id }) };
    },
    getEffective: (async (args) => { recorded.reads.push(args.key); return getEffective(args); }) as typeof getEffective,
    set: (async (args) => {
      recorded.writes.push({ key: args.input.key, value: args.input.value, requiredPermissionOverride: args.input.requiredPermissionOverride });
      return set(args);
    }) as typeof set,
  };
  const registrar = (async (d, input) => { recorded.registrations.push(input.namespace); return ensureSettingDefinitions(d, input); }) as typeof ensureSettingDefinitions;
  await ensureSeoSettingDefinitions({ ...deps, ensureSettingDefinitions: registrar }, { workspaceId: WORKSPACE, systemPrincipalId: "system-seo" });
  return { deps, recorded };
}

test("registers site.seo through the injected registrar and principal-lookup binder; defaults read back", async () => {
  const { deps, recorded } = await makeDeps();
  assert.deepEqual(recorded.registrations, ["site.seo"]);
  assert.deepEqual(recorded.lookupRepos, [principalRepo]);
  assert.deepEqual(await getSeoSettings(deps, { workspaceId: WORKSPACE }), {
    titleTemplate: "%s",
    defaultDescription: undefined,
    defaultOgImage: undefined,
    twitterSite: undefined,
    defaultRobots: { noindex: false, nofollow: false },
    sitemapEnabled: true,
    robotsRules: [],
  });
  assert.equal(recorded.reads.length, 8);
  assert.equal(await isDefaultRobotsNoindexExplicitlySet({ deps, input: { workspaceId: WORKSPACE } }, {}), false);
});

test("a patch decomposes into ordered writes through the injected set with the admin.seo.manage override", async () => {
  const { deps, recorded } = await makeDeps();
  const result = await setSeoSettings(deps, {
    workspaceId: WORKSPACE,
    callerPrincipalId: "editor",
    patch: { titleTemplate: "%s | Site", defaultDescription: null, defaultRobots: { noindex: true, nofollow: false }, sitemapEnabled: false },
  });
  assert.deepEqual(recorded.writes.map(({ key, value }) => [key, value]), [
    ["title_template", "%s | Site"],
    ["default_description", ""],
    ["default_robots_noindex", true],
    ["default_robots_nofollow", false],
    ["sitemap_enabled", false],
  ]);
  assert.ok(recorded.writes.every((write) => write.requiredPermissionOverride === "admin.seo.manage"));
  // One binding at registration, then one per chokepoint write.
  assert.deepEqual(recorded.lookupRepos, Array(6).fill(principalRepo));
  assert.deepEqual(recorded.invalidations, [WORKSPACE]);
  assert.equal(result.titleTemplate, "%s | Site");
  assert.deepEqual(result.defaultRobots, { noindex: true, nofollow: false });
  assert.equal(result.sitemapEnabled, false);
  assert.equal(await isDefaultRobotsNoindexExplicitlySet({ deps, input: { workspaceId: WORKSPACE } }, {}), true);
});

test("a title-only patch does not invalidate the sitemap", async () => {
  const { deps, recorded } = await makeDeps();
  await setSeoSettings(deps, { workspaceId: WORKSPACE, callerPrincipalId: "editor", patch: { titleTemplate: "Blog: %s" } });
  assert.deepEqual(recorded.invalidations, []);
});

test("a refused patch writes nothing (all-or-nothing)", async () => {
  const { deps, recorded } = await makeDeps();
  await assert.rejects(setSeoSettings(deps, { workspaceId: WORKSPACE, callerPrincipalId: "editor", patch: {} }), SeoSettingsValidationError);
  await assert.rejects(
    setSeoSettings(deps, { workspaceId: WORKSPACE, callerPrincipalId: "editor", patch: { sitemapEnabled: false, titleTemplate: "no placeholder" } }),
    /titleTemplate must contain '%s'/,
  );
  await assert.rejects(
    setSeoSettings(deps, { workspaceId: WORKSPACE, callerPrincipalId: "editor", patch: { unknownField: 1 } as never }),
    /'unknownField' is not a registered SEO setting field/,
  );
  assert.deepEqual(recorded.writes, []);
  assert.equal((await getSeoSettings(deps, { workspaceId: WORKSPACE })).sitemapEnabled, true);
});
